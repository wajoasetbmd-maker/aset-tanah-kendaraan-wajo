/* ASET TANAH DAN KENDARAAN WEB V17.9 — cache-read, online-write, surat resmi online */
(() => {
  'use strict';

  const VERSION = '17.9.0';
  const DB_NAME = 'aset-wajo-web-local-first';
  const DB_VERSION = 1;
  const MAX_GPS_ACCURACY = 35;
  const TARGET_GPS_ACCURACY = 20;
  const SNAPSHOT_PAGE_SIZE = 250;
  const SYNC_BATCH_SIZE = 5;
  const REFRESH_CHECK_MS = 10 * 60 * 1000;
  const DEVICE_ID_KEY = 'aset_wajo_web_device_id';

  let dbPromise = null;
  let cloudServer = null;
  let syncRunning = false;
  let snapshotRunning = false;
  let lastRevisionCheck = 0;
  let originalPreviewLetterPdf = null;
  let installed = false;
  const memoryRecords = {KENDARAAN:null, TANAH:null};
  const syncView = {total:0, done:0, percent:0, current:'', failed:[], lastError:'', lastSyncAt:0, running:false};

  function nowIso() { return new Date().toISOString(); }
  function moduleName() { return String(window.state?.asset || '').toUpperCase(); }
  function userScope() { return `${moduleName()}:${String(window.state?.user?.username || 'ANON').toUpperCase()}`; }
  function key(scope, suffix) { return `${scope}:${suffix}`; }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function escText(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function isZeroPoint(lat, lng) { return Math.abs(Number(lat) || 0) < 0.000001 && Math.abs(Number(lng) || 0) < 0.000001; }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', {keyPath:'key'});
          store.createIndex('module', 'module', {unique:false});
          store.createIndex('source', 'source', {unique:false});
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath:'key'});
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', {keyPath:'key'});
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', {keyPath:'id', autoIncrement:true});
          store.createIndex('scope', 'scope', {unique:false});
        }
        if (!db.objectStoreNames.contains('letters')) {
          const store = db.createObjectStore('letters', {keyPath:'key'});
          store.createIndex('scope', 'scope', {unique:false});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Database browser tidak dapat dibuka.'));
    });
    return dbPromise;
  }

  async function idb(storeName, mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = action(store, tx); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Operasi database lokal gagal.'));
      tx.onabort = () => reject(tx.error || new Error('Operasi database lokal dibatalkan.'));
    });
  }

  async function putMeta(metaKey, value) {
    await idb('meta', 'readwrite', store => store.put({key:metaKey, value, updatedAt:Date.now()}));
  }
  async function getMeta(metaKey, fallback=null) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(metaKey);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  }
  async function putCache(cacheKey, value) {
    await idb('cache', 'readwrite', store => store.put({key:cacheKey, value, updatedAt:Date.now()}));
  }
  async function getCache(cacheKey, fallback=null) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(cacheKey);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  }

  function recordId(module, row) {
    return String(module === 'TANAH' ? (row.eid || row.id || '') : (row.id || '')).trim();
  }

  async function putRecords(module, rows, source='server') {
    if (!Array.isArray(rows) || !rows.length) return;
    await idb('records', 'readwrite', store => {
      for (const row of rows) {
        const id = recordId(module, row);
        if (!id) continue;
        store.put({key:`${module}:${id}`, module, id, source, data:row, updatedAt:Date.now()});
      }
    });
    if (memoryRecords[module]) {
      const map = new Map(memoryRecords[module].map(row => [recordId(module, row), row]));
      for (const row of rows) {
        const id = recordId(module, row);
        if (id) map.set(id, row);
      }
      memoryRecords[module] = [...map.values()];
    }
  }

  async function getRecord(module, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(`${module}:${id}`);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteRecordFromCache(module, id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').delete(`${module}:${id}`);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Cache data tidak dapat diperbarui.'));
    });
    memoryRecords[module] = null;
  }

  async function allRecords(module) {
    if (Array.isArray(memoryRecords[module])) return memoryRecords[module].slice();
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const index = tx.objectStore('records').index('module');
      const req = index.getAll(IDBKeyRange.only(module));
      req.onsuccess = () => resolve((req.result || []).map(item => item.data));
      req.onerror = () => reject(req.error);
    });
    memoryRecords[module] = rows;
    return rows.slice();
  }

  async function removeServerRecords(module) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const index = tx.objectStore('records').index('module');
      const req = index.openCursor(IDBKeyRange.only(module));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (cursor.value.source === 'server') cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    memoryRecords[module] = null;
  }

  async function replaceServerRecords(module, rows) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      const index = store.index('module');
      const req = index.openCursor(IDBKeyRange.only(module));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (cursor.value.source === 'server') cursor.delete();
          cursor.continue();
          return;
        }
        for (const row of rows || []) {
          const id = recordId(module, row);
          if (id) store.put({key:`${module}:${id}`, module, id, source:'server', data:row, updatedAt:Date.now()});
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Cache server tidak dapat diganti.'));
    });
    memoryRecords[module] = null;
  }

  async function saveLocalRecord(module, payload) {
    const idField = module === 'TANAH' ? 'eid' : 'id';
    let id = String(payload[idField] || payload.id || '').trim();
    if (!id) id = `${module === 'TANAH' ? 'TNH' : 'KDR'}-OFF-WEB-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
    const previous = await getRecord(module, id) || {};
    const data = {...previous, ...payload, [idField]:id, id:module === 'TANAH' ? (payload.id || id) : id, _localPending:true, _localUpdatedAt:nowIso()};
    await putRecords(module, [data], 'local');
    await queueOperation('UPSERT', id, data);
    await putMeta(key(userScope(), 'snapshotReady'), true);
    return {id, eid:id, queued:true, offline:true};
  }

  async function deleteLocalRecord(module, id) {
    const existing = await getRecord(module, id);
    if (existing) {
      existing._deleted = true;
      existing._localPending = true;
      await putRecords(module, [existing], 'local');
    }
    await queueOperation('DELETE', id, {});
    return {id, queued:true, offline:true};
  }

  async function queueOperation() {
    throw new Error('Perubahan data pada versi web harus disimpan saat online. Tidak ada antrean offline baru.');
  }

  async function getOutbox() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const req = tx.objectStore('outbox').index('scope').getAll(IDBKeyRange.only(userScope()));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteOutboxIds(ids) {
    if (!ids.length) return;
    await idb('outbox', 'readwrite', store => ids.forEach(id => store.delete(id)));
  }

  async function cleanupLegacyOfflineLetters() {
    const pending = await getOutbox().catch(() => []);
    const letterIds = pending.filter(item => String(item.operation || '').toUpperCase() === 'LETTER').map(item => item.id);
    if (letterIds.length) await deleteOutboxIds(letterIds);
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('letters', 'readwrite');
        const index = tx.objectStore('letters').index('scope');
        const req = index.openCursor(IDBKeyRange.only(userScope()));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const data = cursor.value && cursor.value.data ? cursor.value.data : {};
          if (data.pending || data.local || String(data.id || '').startsWith('LTR-WEB-')) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) { console.warn('Pembersihan surat lokal lama:', error); }
    if (letterIds.length) {
      setTimeout(() => toast(`${letterIds.length} antrean surat lokal lama dibersihkan. Surat harus dibuat ulang saat online.`, 'error'), 700);
    }
    return letterIds.length;
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `WEB-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  async function remapRecordId(module, oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const row = await getRecord(module, oldId);
    if (!row) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      const store = tx.objectStore('records');
      store.delete(`${module}:${oldId}`);
      const copy = {...row, id:newId, _localPending:false};
      if (module === 'TANAH') copy.eid = newId;
      store.put({key:`${module}:${newId}`, module, id:newId, source:'server', data:copy, updatedAt:Date.now()});
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function markRecordSynced(module, oldId, newId, result={}, operation='UPSERT') {
    const targetId = String(newId || oldId || '');
    if (!targetId) return;
    if (String(operation).toUpperCase() === 'DELETE') {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').delete(`${module}:${oldId}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return;
    }
    if (oldId && newId && oldId !== newId) {
      await remapRecordId(module, oldId, newId);
      return;
    }
    const row = await getRecord(module, targetId);
    if (!row) return;
    const merged = {...row, ...(result || {}), _localPending:false, _localSyncedAt:nowIso()};
    await putRecords(module, [merged], 'server');
  }

  async function remapLetterId(oldId, newId, result={}) {
    if (!oldId || !newId) return;
    const letter = await getLocalLetter(oldId);
    if (!letter) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('letters', 'readwrite');
      const store = tx.objectStore('letters');
      if (oldId !== newId) store.delete(`${userScope()}:${oldId}`);
      const updated = {...letter, ...result, id:newId, number:result.number || letter.number || letter.letterNumber, pending:false, local:false, syncedAt:nowIso()};
      store.put({key:`${userScope()}:${newId}`, scope:userScope(), id:newId, data:updated, updatedAt:Date.now()});
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function operationLabel(item) {
    const operation = String(item?.operation || '').toUpperCase();
    const p = item?.payload || {};
    const nested = p.payload || p;
    const vehicle = nested.vehicle || p.vehicle || {};
    if (operation === 'LETTER') return `Surat ${nested.letterNumber || nested.number || item.recordId || ''}`.trim();
    if (operation === 'ATTACHMENT') return `${p.kind || 'Lampiran'} · ${p.fileName || item.recordId || ''}`.trim();
    if (operation === 'DELETE') return `Hapus ${item.recordId || 'data'}`;
    const name = vehicle.nomorPolisi || p.nomorPolisi || p.uraian || p.namaBarangJenisModel || p.nama_opd || item.recordId || 'data';
    return `${operation === 'UPSERT' ? 'Data' : operation} · ${name}`;
  }

  async function syncOutbox() {
    if (syncRunning || !navigator.onLine || !window.state?.token || !cloudServer) return;
    const initial = await getOutbox();
    if (!initial.length) {
      syncView.running = false; syncView.total = 0; syncView.done = 0; syncView.percent = 100; syncView.current = ''; syncView.failed = [];
      updateStatus('Tersinkron', 'ready');
      return;
    }
    syncRunning = true;
    syncView.running = true;
    syncView.total = initial.length;
    syncView.done = 0;
    syncView.percent = 0;
    syncView.failed = [];
    syncView.lastError = '';
    updateStatus(`Sinkron 0/${syncView.total} · 0%`, 'syncing');
    try {
      let guard = 0;
      while (navigator.onLine && guard++ < 1000) {
        const remaining = await getOutbox();
        if (!remaining.length) break;
        const operations = remaining.slice(0, SYNC_BATCH_SIZE);
        syncView.current = operationLabel(operations[0]);
        syncView.percent = Math.min(99, Math.round((syncView.done / Math.max(1, syncView.total)) * 100));
        updateStatus(`Sinkron ${syncView.done}/${syncView.total} · ${syncView.percent}%`, 'syncing');
        const payload = operations.map(item => ({localQueueId:item.id, operation:item.operation, recordId:item.recordId, payload:item.payload}));
        const result = await cloudServer('syncOfflineBatchV18', state.token, getDeviceId(), payload);
        if (result && Array.isArray(result.reservedNumbers) && result.reservedNumbers.length) await mergeReservedNumbers(result.reservedNumbers);
        const ack = result.ack || [];
        const ackIds = new Set(ack.map(item => Number(item.localQueueId)));
        await deleteOutboxIds([...ackIds]);
        for (const item of ack) {
          syncView.current = operationLabel(operations.find(op => Number(op.id) === Number(item.localQueueId)) || item);
          const operation = String(item.operation || '').toUpperCase();
          if (operation === 'LETTER' && item.serverId) {
            await remapLetterId(String(item.recordId || ''), String(item.serverId), item.result || {});
          } else if (operation === 'UPSERT' || operation === 'DELETE') {
            await markRecordSynced(moduleName(), String(item.recordId || ''), String(item.serverId || item.recordId || ''), item.result || {}, operation);
          }
          syncView.done++;
          syncView.percent = Math.min(100, Math.round((syncView.done / Math.max(1, syncView.total)) * 100));
          updateStatus(`Sinkron ${syncView.done}/${syncView.total} · ${syncView.percent}%`, 'syncing');
        }
        const failed = result.failed || [];
        if (failed.length) {
          syncView.failed.push(...failed.map(f => ({...f, label:operationLabel(operations.find(op => Number(op.id) === Number(f.localQueueId)) || f)})));
          syncView.lastError = failed[0].error || 'Sebagian data gagal disinkronkan.';
        }
        if (!ack.length && failed.length) break;
        await sleep(120);
      }
      const left = await getOutbox();
      syncView.running = false;
      syncView.lastSyncAt = Date.now();
      if (left.length) {
        syncView.total = Math.max(syncView.total, syncView.done + left.length);
        syncView.percent = Math.round((syncView.done / Math.max(1, syncView.total)) * 100);
        updateStatus(`${left.length} data menunggu · ${syncView.percent}%`, syncView.failed.length ? 'error' : 'pending');
      } else {
        syncView.percent = 100;
        syncView.current = '';
        try {
          const revision = await cloudServer('getOfflineRevisionV183', state.token);
          await putMeta(key(userScope(), 'revision'), revision);
          lastRevisionCheck = Date.now();
        } catch (_) {}
        updateStatus('Tersinkron · 100%', 'ready');
      }
    } catch (error) {
      console.warn('Sinkronisasi web local-first gagal:', error);
      syncView.running = false;
      syncView.lastError = error?.message || String(error);
      const left = await getOutbox().catch(() => []);
      updateStatus(`${left.length || syncView.total} data tertunda`, 'pending');
    } finally {
      syncRunning = false;
    }
  }

  async function saveLetterLocal(payload) {
    let id = String(payload.id || '').trim();
    if (!id) id = `LTR-OFF-WEB-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
    const vehicle = payload.vehicle || {};
    const officer = resolveOfficer(payload);
    const letter = {
      ...payload, id, number:payload.letterNumber, date:payload.letterDate,
      officerSnapshot:officer, officerName:officer.name || '', officerNip:officer.nip || '', officerPosition:officer.position || '',
      nomorPolisi:vehicle.nomorPolisi || '', merkType:vehicle.merkType || '',
      nomorRangka:vehicle.nomorRangka || '', nomorMesin:vehicle.nomorMesin || '',
      opd:vehicle.opdTerinventaris || '', officer:officer.name || '',
      ownershipType:payload.ownershipType || '', local:true, pending:true, savedAt:nowIso()
    };
    await idb('letters', 'readwrite', store => store.put({key:`${userScope()}:${id}`, scope:userScope(), id, data:letter, updatedAt:Date.now()}));
    await queueOperation('LETTER', id, {payload:letter});
    return {id, number:payload.letterNumber, updated:!!payload.id, offline:true, queued:true};
  }

  async function getLocalLetter(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('letters', 'readonly');
      const req = tx.objectStore('letters').get(`${userScope()}:${id}`);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function listLocalLetters(options={}) {
    const db = await openDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('letters', 'readonly');
      const req = tx.objectStore('letters').index('scope').getAll(IDBKeyRange.only(userScope()));
      req.onsuccess = () => resolve((req.result || []).map(x => x.data));
      req.onerror = () => reject(req.error);
    });
    const search = String(options.search || '').toLowerCase();
    const filtered = rows.filter(row => !search || JSON.stringify(row).toLowerCase().includes(search));
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = Math.max(1, Number(options.pageSize || 20));
    return {rows:filtered.slice((page-1)*pageSize, page*pageSize), total:filtered.length, page, pages:Math.max(1, Math.ceil(filtered.length/pageSize))};
  }

  function filterRows(module, rows, options={}) {
    const search = String(options.search || '').trim().toLowerCase();
    const filter = String(options.opd || options.filter || '').trim().toLowerCase();
    let filtered = rows.filter(row => !row._deleted);
    if (search) filtered = filtered.filter(row => JSON.stringify(row).toLowerCase().includes(search));
    if (filter) {
      if (module === 'KENDARAAN') {
        filtered = filtered.filter(row => {
          const opd = String(row.opdTerinventaris || '').toLowerCase();
          const type = String(row.jenisKendaraan || '').toLowerCase();
          const status = String(row.statusStnk || row.statusPenggunaan || '').toLowerCase();
          return opd.includes(filter) || type.includes(filter) || status.includes(filter);
        });
      } else {
        filtered = filtered.filter(row => JSON.stringify(row).toLowerCase().includes(filter));
      }
    }
    return filtered;
  }

  async function listLocalRecords(module, options={}) {
    const rows = filterRows(module, await allRecords(module), options);
    const page = Math.max(1, Number(options.page || 1));
    const pageSize = Math.max(1, Number(options.pageSize || 20));
    const pages = Math.max(1, Math.ceil(rows.length/pageSize));
    return {rows:rows.slice((page-1)*pageSize, page*pageSize), total:rows.length, page, pages, opds:[...new Set(rows.map(r => module === 'KENDARAAN' ? r.opdTerinventaris : (r.nama_opd || r.opd)).filter(Boolean))].sort()};
  }

  function vehicleStatusLocal(row) {
    const explicit = String(row.statusStnk || '').trim().toUpperCase();
    if (['AKTIF','MATI','BARU','BELUM ADA TANGGAL'].includes(explicit)) return explicit;
    if (String(row.statusData || '').trim().toUpperCase() === 'BARU') return 'BARU';
    const raw = row.tglBerlakuStnk || row.tanggalBerlakuStnk || '';
    if (!raw) return 'BELUM ADA TANGGAL';
    const date = new Date(String(raw).slice(0,10) + 'T23:59:59');
    if (Number.isNaN(date.getTime())) return 'BELUM ADA TANGGAL';
    return date.getTime() >= Date.now() ? 'AKTIF' : 'MATI';
  }

  async function buildLocalDashboard(module) {
    const rows = (await allRecords(module)).filter(row => !row._deleted);
    if (module === 'TANAH') {
      const points = [];
      let certified = 0, plotted = 0;
      for (const row of rows) {
        const status = String(row.Status || row.status || '').toUpperCase();
        if (status.includes('SERTIFIKAT') && !status.includes('NON')) certified++;
        const lat = Number(row.lat), lng = Number(row.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && !isZeroPoint(lat,lng)) {
          plotted++;
          points.push({name:row.uraian || row.nama || '-', opd:row.nama_opd || row.opd || '-', status:row.Status || row.status || '-', lat, lng});
        }
      }
      const cached = await getCache(key(userScope(), 'dashboard'), {}) || {};
      return {...cached, total:rows.length, certified, uncertified:Math.max(0,rows.length-certified), plotted, unplotted:Math.max(0,rows.length-plotted), points};
    }
    const typeCounts = {}, usageCounts = {};
    const out = {total:rows.length, active:0, expired:0, newData:0, noDate:0, vehicleTypes:[], usageStatuses:[]};
    for (const row of rows) {
      const status = vehicleStatusLocal(row);
      if (status === 'AKTIF') out.active++;
      else if (status === 'MATI') out.expired++;
      else if (status === 'BARU') out.newData++;
      else out.noDate++;
      const type = String(row.jenisKendaraan || 'LAINNYA').trim().toUpperCase() || 'LAINNYA';
      const usage = String(row.statusPenggunaan || 'BELUM DIISI').trim().toUpperCase() || 'BELUM DIISI';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      usageCounts[usage] = (usageCounts[usage] || 0) + 1;
    }
    const order = ['RODA 2','RODA 3','RODA 4','RODA 6','RODA 8','RODA 10','RODA 12','NON RODA','LAINNYA'];
    out.vehicleTypes = Object.entries(typeCounts).map(([type,total]) => ({type,total})).sort((a,b) => {
      const ai=order.indexOf(a.type), bi=order.indexOf(b.type);
      if (ai < 0 && bi < 0) return a.type.localeCompare(b.type);
      if (ai < 0) return 1; if (bi < 0) return -1; return ai-bi;
    });
    out.usageStatuses = Object.entries(usageCounts).sort(([a],[b]) => a.localeCompare(b)).map(([status,total]) => ({status,total}));
    return out;
  }

  function normalizeOfficer(raw={}) {
    return {
      id:String(raw.id ?? raw.ID ?? raw.officerId ?? ''),
      name:String(raw.name ?? raw.nama ?? raw.NAMA_PEJABAT ?? raw.officerName ?? '').trim(),
      nip:String(raw.nip ?? raw.NIP ?? raw.NIP_PEJABAT ?? raw.officerNip ?? '').trim(),
      position:String(raw.position ?? raw.jabatan ?? raw.JABATAN_PEJABAT ?? raw.officerPosition ?? '').trim(),
      active:raw.active !== false,
      order:Number(raw.order || 0)
    };
  }

  function officerList(includeInactive=false) {
    const b = window.state?.bootstrap || {};
    const sources = [b.officers, b.officersAll, window.state?.officersCache].filter(Array.isArray);
    const map = new Map();
    for (const source of sources) for (const raw of source) {
      const officer = normalizeOfficer(raw);
      const id = officer.id || `${officer.name}|${officer.nip}`;
      if (!id) continue;
      const previous = map.get(id) || {};
      map.set(id, {...previous, ...officer});
    }
    return [...map.values()].filter(item => includeInactive || item.active !== false).sort((a,b) => (a.order-b.order) || a.name.localeCompare(b.name));
  }

  function resolveOfficer(payload={}) {
    const snap = normalizeOfficer(payload.officerSnapshot || payload);
    const id = String(payload.officerId || snap.id || '');
    const found = officerList(true).find(item => String(item.id) === id) || officerList(true).find(item => item.name && item.name === snap.name);
    return normalizeOfficer({...snap, ...(found || {}), id:id || found?.id || snap.id});
  }

  async function reservedNumbers() { return await getMeta(key(userScope(), 'reservedNumbers'), []); }
  async function mergeReservedNumbers(incoming) {
    const current = await reservedNumbers();
    const merged = [...new Set([...current, ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean))];
    await putMeta(key(userScope(), 'reservedNumbers'), merged);
    return merged;
  }
  async function reserveNumbersIfNeeded(force=false) {
    if (moduleName() !== 'KENDARAAN' || !navigator.onLine || !window.state?.token || !cloudServer) return;
    if (!['ADMIN','OPERATOR'].includes(String(window.state?.user?.role || ''))) return;
    const numbers = await reservedNumbers();
    if (!force && numbers.length >= 5) return;
    try {
      const result = await cloudServer('reserveLetterNumbersV18', state.token, 10);
      await mergeReservedNumbers(result.numbers || []);
    } catch (error) { console.warn('Cadangan nomor surat belum dapat diambil:', error); }
  }
  async function peekReservedNumber() { const numbers = await reservedNumbers(); return numbers[0] || ''; }
  async function consumeReservedNumber(number) {
    const numbers = await reservedNumbers();
    const index = numbers.indexOf(number);
    if (index >= 0) numbers.splice(index, 1);
    await putMeta(key(userScope(), 'reservedNumbers'), numbers);
    setTimeout(reserveNumbersIfNeeded, 1000);
  }

  async function localLetterForm(vehicleId, existing=null) {
    const vehicle = await getRecord('KENDARAAN', vehicleId);
    if (!vehicle) throw new Error('Data kendaraan belum tersedia di cache lokal. Muat ulang data sekali saat online.');
    const b = window.state?.bootstrap || {};
    let nextNumber = existing?.letterNumber || existing?.number || await peekReservedNumber();
    if (!nextNumber && navigator.onLine) {
      await reserveNumbersIfNeeded(true);
      nextNumber = await peekReservedNumber();
    }
    if (!nextNumber) throw new Error('Nomor surat lokal belum tersedia. Hubungkan internet sebentar untuk mengambil cadangan nomor surat.');
    const ownership = existing?.ownershipType || vehicle.jenisKepemilikan || 'PEMDA';
    const narratives = {
      PEMDA:'Menerangkan bahwa kendaraan tersebut di bawah ini adalah Kendaraan Dinas Milik Pemerintah Kabupaten Wajo, dengan identitas kendaraan sebagai berikut:',
      DESA:'Menerangkan bahwa kendaraan tersebut di bawah ini direkomendasikan untuk penerbitan STNK/Plat dan BPKB desa di Kabupaten Wajo, dengan identitas kendaraan sebagai berikut:'
    };
    return {
      id:existing?.id || '', vehicle, officers:officerList(), nextNumber, originalNumber:nextNumber,
      letterDate:existing?.letterDate || existing?.date || new Date().toISOString().slice(0,10),
      officerId:existing?.officerId || '', recommendation:existing?.recommendation || 'Pengesahan STNK',
      recommendations:b.recommendations || ['Pengesahan STNK','Pergantian STNK/Plat (Duplikat STNK)','Penerbitan STNK/Plat dan BPKB'],
      ownershipTypes:b.ownershipTypes || ['PEMDA','DESA'], ownershipType:ownership,
      vehicleTypes:['RODA 2','RODA 3','RODA 4','RODA 6','RODA 8','RODA 10','RODA 12','NON RODA','LAINNYA'],
      narratives, narrative:existing?.narrative || narratives[ownership] || narratives.PEMDA,
      missingRequired:[], isEdit:!!existing
    };
  }

  async function localRead(fn, args) {
    const module = moduleName();
    if (fn === 'getDashboard') return await buildLocalDashboard(module);
    if (fn === 'listKendaraan') return await listLocalRecords('KENDARAAN', args[1] || {});
    if (fn === 'listDashboardVehicles') return await listLocalRecords('KENDARAAN', args[1] || {});
    if (fn === 'getKendaraan') return await getRecord('KENDARAAN', String(args[1] || ''));
    if (fn === 'listTanah') return await listLocalRecords('TANAH', {page:args[1], pageSize:args[2], search:args[3], filter:args[4]});
    if (fn === 'getTanah') return await getRecord('TANAH', String(args[1] || ''));
    if (fn === 'getLetterForm') return await localLetterForm(String(args[1] || ''));
    if (fn === 'getSuratForm') { const letter = await getLocalLetter(String(args[1] || '')); return letter ? await localLetterForm(letter.vehicleId, letter) : null; }
    if (fn === 'listSurat') {
      const local = await listLocalLetters(args[1] || {});
      const ready = await getMeta(key(userScope(), 'lettersReady'), false);
      return (!navigator.onLine || ready || local.total > 0) ? local : null;
    }
    if (fn === 'listPejabat') return window.state?.bootstrap?.officersAll || officerList();
    if (fn === 'getSettings') return window.state?.bootstrap?.settings || {};
    if (fn === 'listUsers') return window.state?.bootstrap?.adminUsers || [];
    if (fn === 'listTanahUsers') return {rows:window.state?.bootstrap?.adminUsers || []};
    return null;
  }

  async function mirrorCloudResult(fn, args, result) {
    const module = moduleName();
    if (!result) return;
    if (fn === 'getBootstrap' || fn === 'getBootstrapAset') {
      await putCache(key(userScope(), 'bootstrap'), result);
      if (result.dashboard) await putCache(key(userScope(), 'dashboard'), result.dashboard);
    }
    if (fn === 'getDashboard') await putCache(key(userScope(), 'dashboard'), result);
    if (fn === 'listKendaraan' || fn === 'listDashboardVehicles') await putRecords('KENDARAAN', result.rows || [], 'server');
    if (fn === 'getKendaraan') await putRecords('KENDARAAN', [result], 'server');
    if (fn === 'listTanah') await putRecords('TANAH', result.rows || [], 'server');
    if (fn === 'getTanah') await putRecords('TANAH', [result], 'server');
    if (fn === 'listPejabat') {
      state.bootstrap.officersAll = result;
      state.bootstrap.officers = (result || []).filter(x => x.active !== false);
      await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
    }
    if (fn === 'getSettings') {
      state.bootstrap.settings = result;
      await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
    }
    if (fn === 'listUsers') {
      state.bootstrap.adminUsers = result;
      await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
    }
    if (fn === 'listSurat') {
      for (const row of result.rows || []) {
        await idb('letters','readwrite',store => store.put({key:`${userScope()}:${row.id}`,scope:userScope(),id:row.id,data:row,updatedAt:Date.now()}));
      }
      await putMeta(key(userScope(), 'lettersReady'), true);
    }
    if (fn === 'getLetterForm' || fn === 'getSuratForm') await cacheLetterForm(result);
  }

  async function cacheLetterForm(form) {
    if (!form || !form.vehicle) return null;
    const officer = normalizeOfficer((form.officers || []).find(item => String(item.id) === String(form.officerId)) || form.officerSnapshot || {});
    const payload = {
      id:form.id || '', vehicleId:form.vehicle.id || form.vehicleId || '', vehicle:form.vehicle,
      letterNumber:form.nextNumber || form.originalNumber || form.number || '', letterDate:form.letterDate || form.date || '',
      officerId:form.officerId || officer.id || '', officerSnapshot:officer, officerName:officer.name, officerNip:officer.nip, officerPosition:officer.position,
      recommendation:form.recommendation || '', ownershipType:form.ownershipType || '', narrative:form.narrative || '',
      number:form.nextNumber || form.originalNumber || form.number || '', date:form.letterDate || form.date || '',
      nomorPolisi:form.vehicle.nomorPolisi || '', merkType:form.vehicle.merkType || '', nomorRangka:form.vehicle.nomorRangka || '', nomorMesin:form.vehicle.nomorMesin || '',
      opd:form.vehicle.opdTerinventaris || '', officer:officer.name || '', pending:false, local:false, hydratedAt:nowIso()
    };
    const id = String(payload.id || '');
    if (!id) return payload;
    await idb('letters','readwrite',store => store.put({key:`${userScope()}:${id}`,scope:userScope(),id,data:payload,updatedAt:Date.now()}));
    return payload;
  }

  async function hasSnapshot() { return !!(await getMeta(key(userScope(), 'snapshotReady'), false)); }

  async function updateRevisionAfterWrite() {
    if (!navigator.onLine || !window.state?.token || !cloudServer) return;
    try {
      const revision = await cloudServer('getOfflineRevisionV183', state.token);
      await putMeta(key(userScope(), 'revision'), revision);
    } catch (error) { console.warn('Nomor revisi belum diperbarui:', error); }
  }

  async function afterOnlineWrite(fn, args, result) {
    const module = moduleName();
    try {
      if (fn === 'saveKendaraan' && result?.id) {
        const row = await cloudServer('getKendaraan', state.token, result.id);
        await putRecords('KENDARAAN', [row], 'server');
      } else if (fn === 'deleteKendaraan') {
        await deleteRecordFromCache('KENDARAAN', String(args[1] || ''));
      } else if (fn === 'saveTanah' && (result?.id || result?.eid)) {
        const id = result.id || result.eid;
        const row = await cloudServer('getTanah', state.token, id);
        await putRecords('TANAH', [row], 'server');
      } else if (fn === 'deleteTanah') {
        await deleteRecordFromCache('TANAH', String(args[1] || ''));
      } else if (fn === 'saveSurat') {
        const vehicleId = String(args[1]?.vehicleId || '');
        if (vehicleId) {
          const row = await cloudServer('getKendaraan', state.token, vehicleId).catch(() => null);
          if (row) await putRecords('KENDARAAN', [row], 'server');
        }
      }

      if (['savePejabat','deletePejabat'].includes(fn)) {
        const rows = await cloudServer('listPejabat', state.token);
        state.bootstrap.officersAll = rows || [];
        state.bootstrap.officers = (rows || []).filter(item => item.active !== false);
        state.officersCache = rows || [];
        await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
      }
      if (['saveUser','deleteUser'].includes(fn) && String(state.user?.role || '') === 'ADMIN') {
        const rows = await cloudServer('listUsers', state.token);
        state.bootstrap.adminUsers = rows || [];
        state.usersCache = rows || [];
        await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
      }
      if (fn === 'saveSettings' || fn === 'saveTanahSettings') {
        const settings = await cloudServer(module === 'TANAH' ? 'getTanahSettings' : 'getSettings', state.token).catch(() => result || {});
        state.bootstrap.settings = settings || result || {};
        await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
      }
      if (['saveKendaraan','deleteKendaraan','saveTanah','deleteTanah','saveSurat','deleteSurat','savePejabat','deletePejabat','saveUser','deleteUser','saveSettings','saveTanahSettings','uploadLampiran','uploadDokumenTanah'].includes(fn)) {
        await updateRevisionAfterWrite();
      }
    } catch (error) { console.warn('Pembaruan cache setelah simpan:', error); }
  }

  async function webServer(fn, ...args) {
    const localReadFns = new Set(['getDashboard','listKendaraan','listDashboardVehicles','getKendaraan','listTanah','getTanah']);
    const onlineWriteFns = new Set([
      'saveKendaraan','deleteKendaraan','saveTanah','deleteTanah','uploadLampiran','uploadDokumenTanah',
      'saveSurat','saveSuratAndGetPdf','deleteSurat','savePejabat','deletePejabat','saveUser','deleteUser',
      'saveTanahUser','deleteTanahUser','saveSettings','saveTanahSettings','changeMyPassword'
    ]);

    if (onlineWriteFns.has(fn) && navigator.onLine === false) {
      throw new Error(fn.includes('Surat') || fn === 'saveSurat'
        ? 'Surat rekomendasi hanya dapat dibuat saat online agar nomor, pejabat, database, dan template resmi selalu benar.'
        : 'Perubahan data hanya dapat disimpan saat online. Mode offline pada web hanya untuk melihat data cache.');
    }

    if (localReadFns.has(fn) && await hasSnapshot()) {
      try {
        const local = await localRead(fn, args);
        if (local != null) return local;
      } catch (error) { console.warn('Baca cache gagal, memakai server:', error); }
    }

    const result = await cloudServer(fn, ...args);
    await mirrorCloudResult(fn, args, result).catch(console.warn);
    if (onlineWriteFns.has(fn)) await afterOnlineWrite(fn, args, result);
    return result;
  }

  async function downloadLettersSnapshot() {
    return;
  }

  async function downloadSnapshot(force=false) {
    if (snapshotRunning || !navigator.onLine || !window.state?.token || !cloudServer) return;
    if (!force && await hasSnapshot()) return;
    snapshotRunning = true;
    updateStatus('Mengunduh cache data', 'syncing');
    try {
      const module = moduleName();
      const master = await cloudServer('getOfflineMasterV182', state.token);
      if (master?.bootstrapPatch) {
        Object.assign(state.bootstrap, master.bootstrapPatch);
        await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
      }
      const info = await cloudServer('getOfflineSnapshotInfoV18', state.token);
      const totalRows = Math.max(1, Number(info.totalRows || 1));
      const freshRows = [];
      let cursor = '1';
      let received = 0;
      while (cursor) {
        const page = await cloudServer('getOfflineSnapshotV18', state.token, cursor, SNAPSHOT_PAGE_SIZE);
        freshRows.push(...(page.rows || []));
        received += (page.rows || []).length;
        const pct = Math.min(99, Math.round((received / totalRows) * 100));
        syncView.current = `Download ${module} · ${received}/${totalRows}`;
        syncView.percent = pct;
        updateStatus(`Download ${received}/${totalRows} · ${pct}%`, 'syncing');
        cursor = page.nextCursor || '';
        await sleep(20);
      }
      await replaceServerRecords(module, freshRows);
      const dashboard = await cloudServer('getDashboard', state.token);
      await putCache(key(userScope(), 'dashboard'), dashboard);
      const revision = await cloudServer('getOfflineRevisionV183', state.token);
      await putMeta(key(userScope(), 'revision'), revision);
      await putMeta(key(userScope(), 'snapshotReady'), true);
      await putMeta(key(userScope(), 'snapshotAt'), Date.now());
      updateStatus('Cache data siap', 'ready');
    } catch (error) {
      console.warn('Download cache web gagal:', error);
      updateStatus('Cache data belum lengkap', 'error');
    } finally {
      snapshotRunning = false;
    }
  }

  async function refreshIfChanged(force=false) {
    if (!navigator.onLine || !window.state?.token || !cloudServer || snapshotRunning) return;
    const now = Date.now();
    if (!force && now - lastRevisionCheck < REFRESH_CHECK_MS) return;
    lastRevisionCheck = now;
    try {
      const remote = await cloudServer('getOfflineRevisionV183', state.token);
      const local = await getMeta(key(userScope(), 'revision'), null);
      if (!local || String(local.revision) !== String(remote.revision)) await downloadSnapshot(true);
      else updateStatus('Cache data terbaru', 'ready');
    } catch (error) { console.warn('Pemeriksaan revisi web gagal:', error); }
  }

  function ensureStatusNode() {
    const top = document.getElementById('topUser');
    if (!top) return null;
    let node = document.getElementById('webLocalFirstStatus');
    if (!node) {
      node = document.createElement('button');
      node.id = 'webLocalFirstStatus';
      node.type = 'button';
      node.style.cssText = 'margin-left:10px;border:1px solid #cbd8e4;border-radius:999px;background:#eef5fa;color:#27465e;padding:5px 9px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap';
      node.title = 'Klik untuk memeriksa perubahan data server. Penyimpanan data dan surat tetap online.';
      node.onclick = async () => {
        if (!navigator.onLine) { toast('Perangkat offline. Data cache tetap dapat dilihat, tetapi pembaruan memerlukan internet.', 'error'); return; }
        updateStatus('Memeriksa data server', 'syncing');
        await refreshIfChanged(true);
      };
      top.appendChild(node);
    }
    return node;
  }

  function updateStatus(text, tone='ready') {
    const node = ensureStatusNode();
    if (!node) return;
    const palette = {
      ready:['#e2f6ea','#176238','#b8e4c9'],
      syncing:['#eaf3ff','#1c5f9d','#a9cbed'],
      pending:['#fff5d8','#684b00','#efd88b'],
      error:['#fde8ea','#8e202b','#efb7bd']
    }[tone] || ['#eef5fa','#27465e','#cbd8e4'];
    node.textContent = `● ${text}`;
    node.style.background = palette[0]; node.style.color = palette[1]; node.style.borderColor = palette[2];
  }

  async function preciseBrowserLocation() {
    if (!navigator.geolocation) throw new Error('Browser/perangkat tidak mendukung lokasi.');
    return await new Promise((resolve, reject) => {
      let best = null;
      let watchId = null;
      let finished = false;
      const started = Date.now();
      const finish = (value, error) => {
        if (finished) return;
        finished = true;
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        clearTimeout(hardTimer);
        error ? reject(error) : resolve(value);
      };
      const hardTimer = setTimeout(() => {
        if (best && Number(best.coords.accuracy) <= MAX_GPS_ACCURACY) finish(best, null);
        else if (best) finish(null, new Error(`Akurasi lokasi baru ±${Math.round(best.coords.accuracy)} meter. Aktifkan lokasi presisi dan berdiri di area terbuka; koordinat tidak diubah.`));
        else finish(null, new Error('Lokasi presisi belum ditemukan. Aktifkan GPS/lokasi presisi lalu coba lagi di area terbuka.'));
      }, 45000);
      watchId = navigator.geolocation.watchPosition(position => {
        const accuracy = Number(position.coords.accuracy || Infinity);
        if (!best || accuracy < Number(best.coords.accuracy || Infinity)) best = position;
        const status = document.getElementById('landLocationStatusV174');
        if (status) status.textContent = `Mengunci GPS… akurasi terbaik sementara ±${Math.round(Number(best.coords.accuracy || 0))} meter.`;
        if (accuracy <= TARGET_GPS_ACCURACY || (Date.now() - started >= 20000 && accuracy <= MAX_GPS_ACCURACY)) finish(position, null);
      }, error => {
        if (error.code === 1) finish(null, new Error('Izin lokasi ditolak. Aktifkan Lokasi Presisi pada izin browser untuk situs ini.'));
        else if (error.code === 2 && Date.now() - started > 10000) finish(null, new Error('GPS belum memperoleh posisi. Pastikan lokasi perangkat aktif.'));
      }, {enableHighAccuracy:true, maximumAge:0, timeout:45000});
    });
  }

  window.takeLandGps = async function takeLandGpsV177() {
    const oldLat = document.getElementById('landLat')?.value || '';
    const oldLng = document.getElementById('landLng')?.value || '';
    if (typeof loading === 'function') loading(true, 'Mengunci lokasi GPS presisi (maks. 45 detik)...', 25);
    try {
      const position = await preciseBrowserLocation();
      const {latitude, longitude, accuracy} = position.coords;
      if (isZeroPoint(latitude, longitude)) throw new Error('Koordinat 0,0 ditolak karena bukan lokasi aset yang valid.');
      const latInput = document.getElementById('landLat');
      const lngInput = document.getElementById('landLng');
      if (!latInput || !lngInput) throw new Error('Kolom koordinat tidak ditemukan.');
      latInput.value = Number(latitude).toFixed(7);
      lngInput.value = Number(longitude).toFixed(7);
      latInput.dispatchEvent(new Event('change',{bubbles:true}));
      lngInput.dispatchEvent(new Event('change',{bubbles:true}));
      if (typeof window.reversePoint === 'function') await window.reversePoint(latitude, longitude, true);
      if (typeof toast === 'function') toast(`Lokasi presisi diterapkan (akurasi ±${Math.round(accuracy)} m).`);
    } catch (error) {
      const latInput = document.getElementById('landLat');
      const lngInput = document.getElementById('landLng');
      if (latInput) latInput.value = oldLat;
      if (lngInput) lngInput.value = oldLng;
      if (typeof toast === 'function') toast(error.message || String(error), 'error');
    } finally {
      if (typeof loading === 'function') loading(false);
    }
  };

  function dateLong(value) {
    if (!value) return '-';
    try { return new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T00:00:00')); }
    catch (_) { return value; }
  }
  function dayName(value) {
    if (!value) return '';
    try { return new Intl.DateTimeFormat('id-ID',{weekday:'long'}).format(new Date(value+'T00:00:00')); }
    catch (_) { return ''; }
  }
  function terbilangId(value) {
    const n = Math.floor(Number(value) || 0);
    const words = ['','Satu','Dua','Tiga','Empat','Lima','Enam','Tujuh','Delapan','Sembilan','Sepuluh','Sebelas'];
    if (n < 12) return words[n];
    if (n < 20) return terbilangId(n-10) + ' Belas';
    if (n < 100) return terbilangId(Math.floor(n/10)) + ' Puluh' + (n%10 ? ' '+terbilangId(n%10) : '');
    if (n < 200) return 'Seratus' + (n-100 ? ' '+terbilangId(n-100) : '');
    if (n < 1000) return terbilangId(Math.floor(n/100)) + ' Ratus' + (n%100 ? ' '+terbilangId(n%100) : '');
    if (n < 2000) return 'Seribu' + (n-1000 ? ' '+terbilangId(n-1000) : '');
    if (n < 1000000) return terbilangId(Math.floor(n/1000)) + ' Ribu' + (n%1000 ? ' '+terbilangId(n%1000) : '');
    return String(n);
  }

  async function imageDataUrl(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  }

  async function loadTemplate(name) {
    const response = await fetch(`./templates/${name}.html`, {cache:'force-cache'});
    if (!response.ok) throw new Error('Template surat lokal tidak ditemukan.');
    return await response.text();
  }

  function fillTemplate(html, map) {
    return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, name) => escText(map[name] ?? ''));
  }

  async function renderLetterPreview(payload, previewWindow) {
    const officer = resolveOfficer(payload);
    if (!officer.name || !officer.position) throw new Error('Data pejabat belum lengkap. Pilih ulang pejabat atau perbarui Master Pejabat, lalu coba lagi.');
    const vehicle = payload.vehicle || {};
    const [template, receiptTemplate, logo] = await Promise.all([
      loadTemplate('surat_rekomendasi'), loadTemplate('tanda_terima_bpkb'), imageDataUrl('./assets/logo-wajo.png')
    ]);
    const settings = window.state?.bootstrap?.settings || {};
    const letterDate = payload.letterDate ? new Date(payload.letterDate+'T00:00:00') : new Date();
    const map = {
      LOGO:logo,
      INSTANSI_1:settings.INSTANSI_1 || 'PEMERINTAH KABUPATEN WAJO',
      INSTANSI_2:settings.INSTANSI_2 || 'BADAN PENGELOLAAN KEUANGAN DAN PENDAPATAN DAERAH',
      ALAMAT_1:settings.ALAMAT_1 || 'Jalan Lamaddukelleng No. 1 Telp. (0485) 21271 Sengkang Kode Pos 90911', ALAMAT_2:settings.ALAMAT_2 || 'Kabupaten Wajo Provinsi Sulawesi Selatan',
      KOTA_TANGGAL:`${settings.KOTA_SURAT || 'Sengkang'}, ${dateLong(payload.letterDate)}`,
      TUJUAN:settings.TUJUAN || 'Ka. Kantor Samsat Kab. Wajo',
      PENANDATANGAN_ATAS_NAMA:settings.PENANDATANGAN_ATAS_NAMA || 'An. Kepala Badan Pengelolaan Keuangan dan Pendapatan Daerah',
      TANGGAL_SURAT:dateLong(payload.letterDate), NOMOR_SURAT:payload.letterNumber,
      NAMA_PEJABAT:officer.name || payload.officerName || '', NIP_PEJABAT:officer.nip || payload.officerNip || '',
      JABATAN_PEJABAT:officer.position || payload.officerPosition || '', NARASI:payload.narrative || '', NARASI_SURAT:payload.narrative || '',
      NAMA_BARANG:vehicle.namaBarangJenisModel || '', NAMA_BARANG_JENIS_MODEL:vehicle.namaBarangJenisModel || '', MERK_TYPE:vehicle.merkType || '',
      NAMA_PEMILIK:vehicle.namaPemilikStnk || '', NAMA_PEMILIK_STNK:vehicle.namaPemilikStnk || '',
      OPD:vehicle.opdTerinventaris || '', OPD_TERINVENTARIS:vehicle.opdTerinventaris || '', NOMOR_POLISI:vehicle.nomorPolisi || '',
      NOMOR_RANGKA:vehicle.nomorRangka || '', NOMOR_MESIN:vehicle.nomorMesin || '', NOMOR_BPKB:vehicle.nomorBpkb || '',
      WARNA:vehicle.warna || '', ISI_SILINDER:vehicle.isiSilinder || '', TAHUN_PEMBUATAN:vehicle.tahunPembuatan || '',
      TAHUN_PERAKITAN:vehicle.tahunPerakitan || '', BERLAKU_STNK:dateLong(vehicle.tglBerlakuStnk), TGL_BERLAKU_STNK:dateLong(vehicle.tglBerlakuStnk),
      REKOMENDASI:payload.recommendation || '', PENANGGUNG_JAWAB:vehicle.penanggungJawab || '',
      HARI_TANGGAL:dateLong(payload.letterDate), HARI_SURAT:dayName(payload.letterDate),
      TANGGAL_TERBILANG:terbilangId(letterDate.getDate()), BULAN_SURAT:new Intl.DateTimeFormat('id-ID',{month:'long'}).format(letterDate),
      TAHUN_TERBILANG:terbilangId(letterDate.getFullYear()),
      JENIS_KENDARAAN:vehicle.jenisKendaraan || vehicle.namaBarangJenisModel || '',
      JENIS_KENDARAAN_TANDA_TERIMA:vehicle.jenisKendaraan || vehicle.namaBarangJenisModel || '',
      NAMA_YANG_MENYERAHKAN:officer.name || '', NAMA_YANG_MENERIMA:vehicle.penanggungJawab || '', NO_HP_PENERIMA:'-'
    };    let html = fillTemplate(template, map);
    if (String(payload.recommendation || '').includes('Pergantian STNK/Plat')) {
      const receipt = fillTemplate(receiptTemplate, map);
      const body = (receipt.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [,''])[1];
      html = html.replace('</body>', `<div style="page-break-before:always"></div>${body}</body>`);
    }
    const toolbar = `<div class="no-print" style="position:fixed;right:16px;top:14px;z-index:9999;display:flex;gap:8px"><button onclick="window.print()" style="border:0;border-radius:8px;background:#173f69;color:#fff;padding:10px 14px;font-weight:700;cursor:pointer">Cetak / Simpan PDF</button><button onclick="window.close()" style="border:1px solid #bbb;border-radius:8px;background:#fff;padding:10px 14px;cursor:pointer">Tutup</button></div>`;
    html = html.replace('</head>', '<style>@media print{.no-print{display:none!important}}</style></head>');
    html = html.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`);
    previewWindow.document.open();
    previewWindow.document.write(html);
    previewWindow.document.close();
    previewWindow.document.title = payload.letterNumber || 'Surat Rekomendasi';
    previewWindow.focus();
  }

  async function getOfficialLetterPdf(letterId) {
    let keyValue = '';
    try {
      const meta = await cloudServer('prepareSuratPdfChunks', state.token, letterId);
      keyValue = meta.key;
      const chunks = [];
      for (let index = 0; index < Number(meta.totalChunks || 0); index++) {
        chunks.push(await cloudServer('getSuratPdfChunk', state.token, meta.key, index));
      }
      return {base64:chunks.join(''), mimeType:meta.mimeType || 'application/pdf', fileName:meta.fileName || 'surat.pdf'};
    } finally {
      if (keyValue) cloudServer('releaseSuratPdfChunks', state.token, keyValue).catch(() => {});
    }
  }

  function writePreviewMessage(previewWindow, title, message, isError=false) {
    try {
      previewWindow.document.open();
      previewWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escText(title)}</title><style>body{font-family:Arial,sans-serif;background:#eef3f7;margin:0;padding:32px;color:#17324d}.box{max-width:620px;margin:10vh auto;background:#fff;border-radius:16px;padding:26px;box-shadow:0 14px 40px rgba(0,0,0,.15)}h2{margin-top:0;color:${isError?'#8e202b':'#174f83'}}p{line-height:1.55}.ok{color:#176238;font-weight:700}</style></head><body><div class="box"><h2>${escText(title)}</h2><p>${escText(message)}</p></div></body></html>`);
      previewWindow.document.close();
    } catch (_) {}
  }

  window.submitLetter = async function submitLetterV179() {
    if (navigator.onLine === false) {
      toast('Surat rekomendasi hanya dapat dibuat saat online agar langsung tersimpan ke Spreadsheet dan memakai template resmi.', 'error');
      return;
    }
    const missing = typeof updateLetterReadiness === 'function' ? updateLetterReadiness() : [];
    if (missing.length) { toast('Lengkapi: '+missing.join(', ')+'.','error'); return; }

    const previewWindow = window.open('about:blank','_blank');
    if (!previewWindow) { toast('Popup diblokir. Izinkan popup untuk melihat PDF resmi.','error'); return; }
    writePreviewMessage(previewWindow, 'Menyimpan surat', 'Data surat sedang diperiksa dan disimpan langsung ke database.');

    const uploadFiles = [['BPKB',$('letterFileBpkb')?.files[0]],['BAST',$('letterFileBast')?.files[0]],['STNK',$('letterFileStnk')?.files[0]],['FOTO',$('letterFileFoto')?.files[0]]];
    if (typeof validateUploadFiles === 'function' && !validateUploadFiles(uploadFiles)) { previewWindow.close(); return; }
    const payload = {
      id:$('letterId').value, vehicleId:$('letterVehicleId').value, letterNumber:$('letterNumber').value,
      officerId:$('letterOfficer').value, letterDate:$('letterDate').value, recommendation:$('letterRecommendation').value,
      ownershipType:$('letterOwnership').value, narrative:$('letterNarrative').value, vehicle:collectLetterVehicle()
    };

    const saveButton = document.getElementById('letterSaveBtn');
    if (saveButton) saveButton.disabled = true;
    if (typeof loading === 'function') loading(true,'1/3 Menyimpan surat ke database...',18,'Surat tidak dibuat offline dan tidak dimasukkan ke antrean.');
    let result = null;
    try {
      result = await cloudServer('saveSurat', state.token, payload);
      await afterOnlineWrite('saveSurat', [state.token, payload], result);
      writePreviewMessage(previewWindow, 'Surat berhasil disimpan', `Surat ${result.number} sudah masuk ke database. PDF resmi dari template Google Docs sedang dibuat.`);
      if (typeof loadingStep === 'function') loadingStep(48,'2/3 Membuat PDF resmi...','Menggunakan template Google Docs aktif; proses penyimpanan database sudah selesai.');
      closeModal();
      toast(`Surat ${result.number} sudah tersimpan di database. PDF resmi sedang disiapkan.`);

      const selected = uploadFiles.filter(item => item[1]);
      const uploadPromise = (async () => {
        const failed = [];
        for (let index=0; index<selected.length; index++) {
          const [type,file] = selected[index];
          try {
            const data = await readFile(file);
            await cloudServer('uploadLampiran', state.token, {vehicleId:payload.vehicleId,type,fileName:file.name,mimeType:file.type,base64:data});
          } catch (error) { failed.push(`${type}: ${error.message || error}`); }
        }
        return failed;
      })();

      const pdf = await getOfficialLetterPdf(result.id);
      if (typeof loadingStep === 'function') loadingStep(92,'3/3 Membuka PDF resmi...','Tata letak mengikuti template Google Docs aktif.');
      const url = base64PdfUrl(pdf.base64, pdf.mimeType);
      previewWindow.location.href = url;
      previewWindow.focus();
      setTimeout(() => URL.revokeObjectURL(url), 180000);

      const uploadFailed = await uploadPromise;
      if (uploadFailed.length) toast('Surat tersimpan, tetapi sebagian lampiran gagal: '+uploadFailed.join('; '), 'error');
      else if (selected.length) toast(`${selected.length} lampiran berhasil diunggah.`);

      state.bootstrap.dashboard = null;
      if (window.state?.view === 'letters' && typeof fetchLetters === 'function') await fetchLetters();
      else if (window.state?.view === 'vehicles' && typeof fetchVehicles === 'function') await fetchVehicles();
    } catch (error) {
      const message = error?.message || String(error);
      if (result?.id) {
        writePreviewMessage(previewWindow, 'Surat sudah tersimpan', `Surat ${result.number} sudah masuk database, tetapi PDF belum dapat dibuat: ${message}. Buka Riwayat Surat lalu pilih Lihat/Cetak PDF.`, true);
        toast(`Surat ${result.number} tersimpan, tetapi PDF gagal dibuat. Buka dari Riwayat Surat.`, 'error');
        if (window.state?.view === 'letters' && typeof fetchLetters === 'function') await fetchLetters().catch(() => {});
      } else {
        previewWindow.close();
        toast(message, 'error');
      }
    } finally {
      if (saveButton) saveButton.disabled = false;
      if (typeof loading === 'function') loading(false);
    }
  };

  async function localPreviewById(id, windowRef) {
    let letter = await getLocalLetter(id);
    if ((!letter || !letter.vehicle || !(letter.letterNumber || letter.number)) && navigator.onLine && cloudServer && state.token) {
      try {
        const form = await cloudServer('getSuratForm', state.token, id);
        letter = await cacheLetterForm(form);
      } catch (error) { console.warn('Detail surat belum dapat dicache:', error); }
    }
    if (!letter || !letter.vehicle || !(letter.letterNumber || letter.number)) return false;
    await renderLetterPreview(letter, windowRef);
    return true;
  }

  function installHooks() {
    if (installed) return;
    if (!cloudServer) cloudServer = window.server;
    if (!cloudServer) return;
    installed = true;
    webServer.__v179 = true;
    window.server = webServer;

    const originalStartApp = window.startApp;
    if (typeof originalStartApp === 'function') {
      window.startApp = async function startAppV179() {
        const result = await originalStartApp.apply(this, arguments);
        ensureStatusNode();
        try {
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => false);
          const cachedBootstrap = await getCache(key(userScope(), 'bootstrap'), null);
          if (cachedBootstrap && window.state?.bootstrap) Object.assign(window.state.bootstrap, cachedBootstrap);
          await cleanupLegacyOfflineLetters();
          const ready = await hasSnapshot();
          if (ready) {
            updateStatus(navigator.onLine ? 'Cache siap · online' : 'Offline · mode baca', navigator.onLine ? 'ready' : 'pending');
            setTimeout(() => refreshIfChanged(false), 1200);
          } else if (navigator.onLine) {
            updateStatus('Menyiapkan cache awal 0%', 'syncing');
            setTimeout(() => downloadSnapshot(false), 150);
          } else {
            updateStatus('Offline · cache belum tersedia', 'error');
          }
        } catch (error) { console.warn(error); }
        return result;
      };
    }

    window.previewLetterPdf = async function previewLetterPdfV179(id, existingWindow=null) {
      if (navigator.onLine === false) { toast('PDF surat resmi hanya dapat dibuat saat online.', 'error'); return; }
      const w = existingWindow || window.open('about:blank','_blank');
      if (!w) { toast('Popup diblokir browser.','error'); return; }
      writePreviewMessage(w, 'Membuat PDF resmi', 'Surat sedang dibuat dari template Google Docs aktif.');
      if (typeof loading === 'function') loading(true,'Membuat PDF resmi dari template...',32,'Data surat dibaca langsung dari database.');
      try {
        const file = await getOfficialLetterPdf(id);
        const url = base64PdfUrl(file.base64, file.mimeType);
        w.location.href = url; w.focus(); setTimeout(() => URL.revokeObjectURL(url),180000);
      } catch (error) { w.close(); toast(error.message || String(error),'error'); }
      finally { if (typeof loading === 'function') loading(false); }
    };

    const originalSaveLandForm = window.saveLandForm;
    if (typeof originalSaveLandForm === 'function') {
      window.saveLandForm = async function saveLandOnlineV179() {
        if (navigator.onLine === false) { toast('Data tanah hanya dapat disimpan saat online. Mode offline web hanya untuk melihat data.', 'error'); return; }
        return originalSaveLandForm.apply(this, arguments);
      };
    }
    const originalSubmitVehicle = window.submitVehicle;
    if (typeof originalSubmitVehicle === 'function') {
      window.submitVehicle = async function submitVehicleOnlineV179() {
        if (navigator.onLine === false) { toast('Data kendaraan hanya dapat disimpan saat online. Mode offline web hanya untuk melihat data.', 'error'); return; }
        return originalSubmitVehicle.apply(this, arguments);
      };
    }

    window.addEventListener('online', () => {
      updateStatus('Online · memeriksa perubahan', 'syncing');
      refreshIfChanged(false);
    });
    window.addEventListener('offline', () => updateStatus('Offline · mode baca', 'pending'));
    window.addEventListener('focus', () => { if (window.state?.token && navigator.onLine) refreshIfChanged(false); });
    setInterval(() => { if (window.state?.token && navigator.onLine) refreshIfChanged(false); }, REFRESH_CHECK_MS);
  }

  document.addEventListener('DOMContentLoaded', installHooks, {once:true});
  if (document.readyState !== 'loading') installHooks();
  window.WebCacheOnlineV179 = {version:VERSION, refresh:() => refreshIfChanged(true), download:() => downloadSnapshot(true)};
})();
