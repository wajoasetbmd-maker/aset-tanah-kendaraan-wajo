/* SITKAW — Sistem Informasi Tanah dan Kendaraan Aset Wajo */
/* WEB V18.0.8 — expose global state agar identitas login dan delta sync selalu aktif. */
try {
  if (typeof state !== 'undefined' && state) window.state = state;
} catch (_) {}
(() => {
  const V171 = '17.2.1';
  const CACHE_KEYS = {
    offlineSession: asset => `v17_1_offline_session_${asset}`,
    bootstrap: asset => `v17_1_bootstrap_${asset}`,
    landDashboard: 'v17_1_land_dashboard',
    landLastList: 'v17_1_land_last_list',
    landList: (p,s,f) => `v17_1_land_list_${p}_${encodeURIComponent(s||'')}_${encodeURIComponent(f||'')}`,
    landOfflineMap: 'v17_1_land_offline_map'
  };

  function localGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (_) { return fallback; }
  }
  function localSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
  function isOnline() { return navigator.onLine !== false; }
  function friendlyNetworkError(err) {
    const msg = String(err && err.message ? err.message : err || '');
    if (!isOnline() || /failed to fetch|networkerror|network request failed|load failed/i.test(msg)) {
      return 'Tidak ada sambungan internet. Data yang pernah dimuat tetap dapat dibuka; perubahan baru akan disinkronkan setelah online.';
    }
    return msg || 'Terjadi gangguan sambungan.';
  }
  async function hashText(text) {
    try {
      const data = new TextEncoder().encode(String(text || ''));
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    } catch (_) { return ''; }
  }
  function setNetworkBanner(online, flash = false) {
    let el = document.getElementById('networkBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'networkBanner';
      document.body.prepend(el);
    }
    el.className = `network-banner show ${online ? 'online' : ''}`;
    el.textContent = online ? 'Sambungan internet kembali aktif.' : 'Mode offline aktif — data baru disimpan sementara di perangkat.';
    if (online && flash) setTimeout(() => el.classList.remove('show'), 3500);
    if (online && !flash) el.classList.remove('show');
  }

  window.server = async function serverV171(fn, ...args) {
    if (!isOnline()) throw new Error('OFFLINE: Perangkat sedang offline.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await fetch('/api', {
            method:'POST',
            headers:{'Content-Type':'application/json','Accept':'application/json'},
            body:JSON.stringify({module:state.asset,fn,args}),
            signal:controller.signal,
            cache:'no-store'
          });
          const text = await response.text();
          let payload;
          try { payload = JSON.parse(text); }
          catch (_) { throw new Error('Respons server bukan JSON yang valid.'); }
          if (!response.ok || !payload.ok) throw new Error(payload && payload.error ? payload.error.message : `HTTP ${response.status}`);
          return payload.data;
        } catch (e) {
          lastError = e;
          if (e.name === 'AbortError') throw e;
          if (attempt < 2) await new Promise(r => setTimeout(r, 900));
        }
      }
      throw lastError;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Server terlalu lama merespons. Silakan ulangi.');
      throw new Error(friendlyNetworkError(e));
    } finally { clearTimeout(timeout); }
  };
  window.errorText = friendlyNetworkError;

  const originalShowModal = window.showModal;
  window.showModal = function(title, body, footer, cls='modal') {
    const extra = cls === 'modal-sm' ? 'modal-sm' : cls === 'modal-xl' ? 'modal-xl' : cls === 'modal-plot' ? 'modal-plot' : '';
    $('modalRoot').innerHTML = `<div class="modal-backdrop" onclick="backdropClose(event)"><div class="modal ${extra}"><div class="modal-head"><h3>${esc(title)}</h3><button class="close" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div><div class="modal-foot">${footer}</div></div></div>`;
  };

  window.handleLogin = async function handleLoginV171(e) {
    e.preventDefault();
    $('loginError').classList.add('hidden');
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;
    loading(true, isOnline() ? 'Memeriksa login...' : 'Membuka mode offline...');
    try {
      if (!isOnline()) {
        const cached = localGet(CACHE_KEYS.offlineSession(state.asset));
        const passHash = await hashText(password);
        if (!cached || cached.username.toLowerCase() !== username.toLowerCase() || !cached.passwordHash || cached.passwordHash !== passHash) {
          throw new Error('Login pertama harus dilakukan saat online. Mode offline hanya tersedia untuk akun yang pernah login pada perangkat ini.');
        }
        state.token = cached.token || '';
        state.user = cached.user;
        state.bootstrap = cached.bootstrap;
        await startOfflineAppV171();
        return;
      }
      const result = await server('login', username, password);
      state.token = result.token;
      safeStoreSet('v17_session_' + state.asset, state.token);
      await startApp();
      localSet(CACHE_KEYS.offlineSession(state.asset), {
        username,
        passwordHash: await hashText(password),
        token: state.token,
        user: state.user,
        bootstrap: state.bootstrap,
        savedAt: Date.now()
      });
    } catch (err) {
      $('loginError').textContent = friendlyNetworkError(err);
      $('loginError').classList.remove('hidden');
    } finally { loading(false); }
  };

  async function startOfflineAppV171() {
    if (!state.user || !state.bootstrap) throw new Error('Cache sesi offline belum tersedia.');
    $('loginScreen').classList.add('hidden'); $('appScreen').classList.remove('hidden');
    $('userMiniName').textContent = state.user.name || state.user.username;
    $('userMiniRole').textContent = state.user.role;
    $('topUser').textContent = `${state.asset} · ${state.user.name || state.user.username} · ${state.user.role} · OFFLINE`;
    setNetworkBanner(false);
    if (state.asset === 'TANAH') { renderLandShell(); await landNavigate('dashboard'); }
    else { renderVehicleShell(); $('content').innerHTML = '<section class="panel"><div class="panel-body"><div class="warning">Modul kendaraan membutuhkan internet untuk membaca database dan surat.</div></div></section>'; }
  }

  const originalStartApp = window.startApp;
  window.startApp = async function startAppV171() {
    loading(true,'Memuat aplikasi...');
    try {
      if (!isOnline()) return startOfflineAppV171();
      state.bootstrap = await server('getBootstrap',state.token);
      state.user = state.bootstrap.user;
      localSet(CACHE_KEYS.bootstrap(state.asset), state.bootstrap);
      $('loginScreen').classList.add('hidden'); $('appScreen').classList.remove('hidden');
      $('userMiniName').textContent=state.user.name||state.user.username; $('userMiniRole').textContent=state.user.role;
      $('topUser').textContent=state.asset+' · '+(state.user.name||state.user.username)+' · '+state.user.role;
      setNetworkBanner(true);
      if(state.asset==='TANAH'){renderLandShell();await landNavigate('dashboard');}
      else{renderVehicleShell();await navigate('dashboard');if(state.user.mustChange)setTimeout(()=>{toast('Password awal harus segera diganti.','error');openPasswordModal(true)},500);}
    } finally { loading(false); }
  };

  window.addEventListener('offline', () => setNetworkBanner(false));
  window.addEventListener('online', () => {
    setNetworkBanner(true, true);
    if (state.asset === 'TANAH' && state.token && getLandQueue().length) syncLandQueue().catch(() => {});
  });

  // ---------- SHELL TANAH ----------
  window.renderLandShell = function renderLandShellV171() {
    const brand=document.querySelector('.brand b'); if(brand)brand.innerHTML='<span class="brand-short">SITKAW</span><span class="brand-long">SISTEM INFORMASI TANAH DAN KENDARAAN ASET WAJO</span>';
    const admin = state.user && state.user.role === 'ADMIN';
    document.querySelector('.nav').innerHTML=`
      <button data-land="dashboard" class="active">▦ Dashboard Tanah</button>
      <button data-land="data">▤ Data Tanah</button>
      <button data-land="map">⌖ Peta & Ploting</button>
      <button data-land="sync">⇄ Sinkronisasi</button>
      ${admin ? '<button data-land="users">♟ Pengguna Tanah</button><button data-land="settings">⚙ Pengaturan Tanah</button>' : ''}`;
    document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>landNavigate(b.dataset.land)));
  };

  window.landNavigate = async function landNavigateV171(view) {
    state.view='land-'+view;
    document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.land===view));
    const titles={dashboard:'Dashboard Tanah',data:'Data Tanah',map:'Peta & Ploting',sync:'Sinkronisasi',users:'Pengguna Tanah',settings:'Pengaturan Tanah'};
    $('pageTitle').textContent=titles[view]||'Aset Tanah';
    loading(true,'Memuat '+(titles[view]||'halaman')+'...',18);
    try{
      if(view==='dashboard')await loadLandDashboard();
      if(view==='data'){landState.page=1;await loadLandList();}
      if(view==='map')await loadLandMapPage();
      if(view==='sync')renderLandSync();
      if(view==='users')await loadLandUsers();
      if(view==='settings')await loadLandSettings();
    }catch(e){
      $('content').innerHTML=`<section class="panel"><div class="panel-body"><div class="danger">${esc(friendlyNetworkError(e))}</div><button class="btn btn-primary" id="landRetry">Coba Lagi</button></div></section>`;
      const r=$('landRetry');if(r)r.onclick=()=>landNavigate(view);
    }finally{loading(false);}
  };

  window.loadLandDashboard = async function loadLandDashboardV171() {
    let d;
    try {
      d = await server('getDashboard',state.token);
      localSet(CACHE_KEYS.landDashboard,d);
    } catch(e) {
      d = localGet(CACHE_KEYS.landDashboard);
      if(!d) throw e;
      toast('Dashboard ditampilkan dari cache offline.','error');
    }
    landState.dashboard=d;landState.settings=d.settings || (state.bootstrap && state.bootstrap.settings) || {};
    $('content').innerHTML=`<div class="cards land-cards">
      ${landCard('Total Aset Tanah',d.total,'blue','ALL')}
      ${landCard('Bersertifikat',d.certified,'green','BERSERTIFIKAT')}
      ${landCard('Non-Sertifikat',d.uncertified,'red','NON-SERTIFIKAT')}
      ${landCard('Sudah Diploting',d.plotted,'purple','SUDAH DIPLOTING')}
      ${landCard('Belum Diploting',d.unplotted,'orange','BELUM DIPLOTING')}
    </div>
    <section class="panel"><div class="panel-head"><h3>Peta Koordinat Aset Tanah</h3><div class="map-toolbar"><button class="btn btn-light btn-sm" id="landDownloadOffline">⬇ Unduh Peta Offline Wajo</button><button class="btn btn-light btn-sm" id="landRefreshDash">↻ Muat Ulang</button></div></div><div class="panel-body"><div id="landMap" class="land-map"></div><div class="muted" style="margin-top:8px">${d.plotted||0} titik dari ${d.total||0} aset. Peta offline ringan menyimpan wilayah dan titik aset, sedangkan detail jalan memerlukan internet.</div></div></section>`;
    document.querySelectorAll('[data-land-filter]').forEach(b=>b.addEventListener('click',()=>{landState.filter=b.dataset.landFilter==='ALL'?'':b.dataset.landFilter;landNavigate('data')}));
    $('landRefreshDash').onclick=loadLandDashboard;
    $('landDownloadOffline').onclick=downloadLandOfflineMap;
    renderLandMap('landMap',d.points||[]);
  };

  // ---------- DAFTAR TANAH ----------
  window.loadLandList = async function loadLandListV171() {
    let res;
    const key = CACHE_KEYS.landList(landState.page,landState.search,landState.filter);
    try {
      res = await server('listTanah',state.token,landState.page,landState.pageSize,landState.search,landState.filter);
      localSet(key,res);localSet(CACHE_KEYS.landLastList,res);
    } catch(e) {
      res = localGet(key) || localGet(CACHE_KEYS.landLastList);
      if(!res) throw e;
      toast('Daftar tanah ditampilkan dari cache offline.','error');
    }
    landState.rows=res.rows||[];
    $('content').innerHTML=`<section class="panel land-data-panel" style="margin-top:0">
      <div class="panel-head land-data-head">
        <div class="toolbar land-data-toolbar">
          <input id="landSearch" class="input" style="min-width:330px" placeholder="Cari berangkas, uraian, OPD, penggunaan, lokasi, sertifikat" value="${esc(landState.search)}">
          <select id="landFilter" class="select"><option value="">Semua Status</option><option>Bersertifikat</option><option>Non-Sertifikat</option><option>Sudah Diploting</option><option>Belum Diploting</option></select>
          <button id="landSearchBtn" class="btn btn-light">Cari</button>
          <span class="land-total-info muted">${res.total||0} data${!isOnline()?' · cache offline':''}</span>
        </div>
        <button class="btn btn-primary" id="addLandBtn">＋ Tambah Tanah</button>
      </div>
      <div class="table-wrap land-table-wrap"><table class="table land-table"><thead><tr><th>NO. BERANGKAS</th><th>URAIAN</th><th>NAMA OPD</th><th>PENGGUNAAN</th><th>LOKASI</th><th>LUAS</th><th>TAHUN</th><th>NOMOR SERTIFIKAT</th><th>STATUS</th><th>KOORDINAT</th><th>DOKUMEN</th><th>AKSI</th></tr></thead><tbody>${(res.rows||[]).map(r=>landRowHtml(r)).join('')||'<tr><td colspan="12" class="empty">Data tidak ditemukan.</td></tr>'}</tbody></table></div>
      <div class="pagination"><button class="btn btn-light btn-sm" id="landPrev" ${res.page<=1?'disabled':''}>Sebelumnya</button><span>Halaman ${res.page} / ${res.pages}</span><button class="btn btn-light btn-sm" id="landNext" ${res.page>=res.pages?'disabled':''}>Berikutnya</button></div>
    </section>`;
    $('landFilter').value=landState.filter||'';
    $('addLandBtn').onclick=()=>openLandForm();
    $('landSearchBtn').onclick=()=>{landState.search=$('landSearch').value;landState.filter=$('landFilter').value.toUpperCase();landState.page=1;loadLandList()};
    $('landSearch').onkeydown=e=>{if(e.key==='Enter')$('landSearchBtn').click()};
    $('landPrev').onclick=()=>{if(landState.page>1){landState.page--;loadLandList()}};
    $('landNext').onclick=()=>{if(landState.page<res.pages){landState.page++;loadLandList()}};
    document.querySelectorAll('[data-land-edit]').forEach(b=>b.onclick=()=>openLandForm(b.dataset.landEdit));
    document.querySelectorAll('[data-land-delete]').forEach(b=>b.onclick=()=>deleteLandRecord(b.dataset.landDelete));
    document.querySelectorAll('[data-land-map]').forEach(b=>b.onclick=()=>openLandPoint(b.dataset.landMap));
  };

  window.landRowHtml = function landRowHtmlV171(r) {
    const docLinks=[];
    if(r.fotoUrl)docLinks.push(`<a class="btn btn-light btn-sm" href="${esc(r.fotoUrl)}" target="_blank" rel="noopener">Foto</a>`);
    if(r.sertifikatUrl)docLinks.push(`<a class="btn btn-light btn-sm" href="${esc(r.sertifikatUrl)}" target="_blank" rel="noopener">Sertifikat</a>`);
    const coords=r.lat!=null&&r.lng!=null?`${Number(r.lat).toFixed(7)}, ${Number(r.lng).toFixed(7)}`:'-';
    return `<tr>
      <td data-label="No. Berangkas">${esc(r.noBerangkas||'-')}</td>
      <td data-label="Uraian" class="land-main"><b>${esc(r.uraian||'-')}</b></td>
      <td data-label="Nama OPD">${esc(r.opd||r.nama_opd||'-')}</td>
      <td data-label="Penggunaan">${esc(r.penggunaan||'-')}</td>
      <td data-label="Lokasi" class="location-text">${esc(r.kecamatan||'-')}<br>${esc(r.desa||'-')}<br><span class="muted">${esc(r.alamat||'')}</span></td>
      <td data-label="Luas">${esc(r.luas||'-')}</td>
      <td data-label="Tahun">${esc(r.tahun||'-')}</td>
      <td data-label="Nomor Sertifikat">${esc(r.nomorSertifikat||'-')}</td>
      <td data-label="Status"><span class="badge">${esc(r.status||'-')}</span><div class="muted">${esc(r.statusPloting||'')}</div></td>
      <td data-label="Koordinat" class="coordinate-text">${esc(coords)}</td>
      <td data-label="Dokumen"><div class="land-doc-links">${docLinks.join('')||'Belum ada'}</div></td>
      <td data-label="Aksi" class="land-actions"><div class="icon-actions"><button class="icon-btn" title="Edit" data-land-edit="${esc(r.id)}">✎</button><button class="icon-btn" title="Lihat titik" data-land-map="${esc(r.id)}">⌖</button><button class="icon-btn danger-icon" title="Hapus" data-land-delete="${esc(r.id)}">🗑</button></div></td>
    </tr>`;
  };

  // ---------- FORM TANAH & PLOTING ----------
  window.openLandForm = async function openLandFormV171(id='', plotting=false) {
    loading(true,id?'Memuat data tanah...':'Menyiapkan form...');
    try{
      let d;
      if(id) d=await server('getTanah',state.token,id);
      else {
        let next={id:'Otomatis saat disimpan'};
        if(isOnline()){try{next=await server('getNextTanahId',state.token)}catch(_){}}
        d={eid:next.id,nama_opd:state.user.opd||'',Status:'Non-Sertifikat'};
      }
      const maxMb=Number((state.bootstrap&&state.bootstrap.maxUploadMb)||2);
      const body=`<div class="form-grid land-form">
        ${landInput('EID','landId',d.eid||'Otomatis saat disimpan',true,false,'land-id-auto')}${landInput('Nomor Berangkas','landBox',d.no_brangkas||'')}${landInput('OPD','landOpd',d.nama_opd||'',false,true)}
        ${landInput('Uraian/Nama Aset','landName',d.uraian||'',false,false,'span-2')}${landInput('Kecamatan','landDistrict',d.kecamatan||'')}${landInput('Desa/Kelurahan','landVillage',d.desa||'')}${landInput('Alamat','landAddress',d.alamat||'',false,false,'span-2')}
        ${landInput('Luas','landArea',d.luas||'')}${landInput('Penggunaan','landUse',d.penggunaan||'')}${landInput('Nomor Bukti','landProof',d.no_bukti||'')}${landInput('Tahun','landYear',d.tahun||'')}${landInput('Harga','landPrice',d.harga||'')}
        <div class="field"><label>Status Sertifikat *</label><select id="landCert" class="select"><option>Bersertifikat</option><option>Non-Sertifikat</option></select></div>
        ${landInput('Nomor Sertifikat','landCertNo',d.NOMOR_SERTIFIKAT||'')}${landInput('Jenis Hak','landRight',d.JENIS_HAK||'')}
        ${landInput('Latitude','landLat',d.lat??'')}${landInput('Longitude','landLng',d.lng??'')}<div class="field"><label>&nbsp;</label><button type="button" class="btn btn-light" id="takeGpsBtn">⌖ Ambil GPS HP & Lokasi</button></div>
        <div class="field span-2"><label>Keterangan</label><textarea id="landNotes" class="textarea">${esc(d.keterangan||'')}</textarea></div>
        <div class="field"><label>Foto Tanah (maks. ${maxMb} MB)</label><input id="landPhoto" class="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
        <div class="field"><label>Sertifikat (maks. ${maxMb} MB)</label><input id="landCertificate" class="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
        ${plotting?'<div class="field span-3"><label>Klik peta untuk menentukan titik</label><div id="plotLandMap" class="land-map"></div></div>':''}
      </div>`;
      showModal(id?'Edit Data Tanah':plotting?'Tambah Ploting Tanah':'Tambah Data Tanah',body,`<button class="btn btn-light" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="saveLandBtn">Simpan</button>`,plotting?'modal-plot':'modal-xl');
      $('landCert').value=String(d.Status||'').toUpperCase().includes('NON')?'Non-Sertifikat':'Bersertifikat';
      $('takeGpsBtn').onclick=takeLandGps;$('saveLandBtn').onclick=saveLandForm;
      if(plotting) setTimeout(()=>renderPlottingMap('plotLandMap',d.lat,d.lng),80);
    }catch(e){toast(friendlyNetworkError(e),'error');}finally{loading(false);}
  };

  async function reverseGeocodeLand(lat,lng) {
    if(!isOnline())return;
    try{
      const r=await fetch(`/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,{cache:'no-store'});
      const d=await r.json();if(!d.ok)return;
      if(!$('landDistrict').value&&d.kecamatan)$('landDistrict').value=d.kecamatan;
      if(!$('landVillage').value&&d.desa)$('landVillage').value=d.desa;
      if(!$('landAddress').value&&d.alamat)$('landAddress').value=d.alamat;
      toast('Koordinat dan lokasi otomatis berhasil diisi.');
    }catch(_){toast('Koordinat terisi. Nama lokasi dapat dilengkapi manual.','error');}
  }

  window.takeLandGps = function takeLandGpsV171() {
    if(!navigator.geolocation){toast('GPS tidak didukung perangkat ini.','error');return;}
    loading(true,'Mengambil lokasi GPS...',35);
    navigator.geolocation.getCurrentPosition(async pos=>{
      loading(false);
      const lat=pos.coords.latitude.toFixed(7),lng=pos.coords.longitude.toFixed(7);
      $('landLat').value=lat;$('landLng').value=lng;
      await reverseGeocodeLand(lat,lng);
      if(landState.plotMap){landState.plotMap.setView([Number(lat),Number(lng)],16);setPlotMarker(Number(lat),Number(lng));}
    },err=>{loading(false);toast('Lokasi gagal: '+err.message,'error');},{enableHighAccuracy:true,timeout:25000,maximumAge:0});
  };

  function activeLandRegion() {
    const s=(landState.dashboard&&landState.dashboard.settings)||(state.bootstrap&&state.bootstrap.settings)||{};
    const regions=s.regions||[];return regions.find(r=>r.id===s.activeRegionId)||regions[0]||{centerLat:-4.11,centerLng:120.03,zoom:10,minLat:-4.30,maxLat:-3.55,minLng:119.75,maxLng:120.60};
  }
  function setPlotMarker(lat,lng){
    if(!window.L||!landState.plotMap)return;
    if(landState.plotMarker)landState.plotMarker.setLatLng([lat,lng]);
    else landState.plotMarker=L.marker([lat,lng],{draggable:true}).addTo(landState.plotMap).on('dragend',e=>{const p=e.target.getLatLng();$('landLat').value=p.lat.toFixed(7);$('landLng').value=p.lng.toFixed(7);reverseGeocodeLand(p.lat,p.lng);});
  }
  async function renderPlottingMap(id,lat,lng){
    const el=$(id);if(!el)return;const ready=await ensureLeaflet();if(!ready||!window.L){renderCoordinateFallback(el,[]);return;}
    const r=activeLandRegion();
    const map=L.map(id,{zoomControl:true}).setView([Number(lat)||r.centerLat,Number(lng)||r.centerLng],lat?16:r.zoom);landState.plotMap=map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    if(lat&&lng)setPlotMarker(Number(lat),Number(lng));
    map.on('click',e=>{$('landLat').value=e.latlng.lat.toFixed(7);$('landLng').value=e.latlng.lng.toFixed(7);setPlotMarker(e.latlng.lat,e.latlng.lng);reverseGeocodeLand(e.latlng.lat,e.latlng.lng);});
    setTimeout(()=>map.invalidateSize(),150);
  }

  window.saveLandForm = async function saveLandFormV171() {
    const autoId = $('landId').value === 'Otomatis saat disimpan' ? '' : $('landId').value;
    const payload={eid:autoId,no_brangkas:$('landBox').value,nama_opd:$('landOpd').value,uraian:$('landName').value,kecamatan:$('landDistrict').value,desa:$('landVillage').value,alamat:$('landAddress').value,luas:$('landArea').value,penggunaan:$('landUse').value,no_bukti:$('landProof').value,tahun:$('landYear').value,harga:$('landPrice').value,Status:$('landCert').value,NOMOR_SERTIFIKAT:$('landCertNo').value,JENIS_HAK:$('landRight').value,lat:$('landLat').value,lng:$('landLng').value,keterangan:$('landNotes').value};
    const missing=[['OPD',payload.nama_opd],['Uraian',payload.uraian],['Kecamatan',payload.kecamatan],['Desa/Kelurahan',payload.desa],['Luas',payload.luas],['Status',payload.Status]].filter(x=>!String(x[1]||'').trim()).map(x=>x[0]);
    if(missing.length){toast('Wajib diisi: '+missing.join(', '),'error');return;}
    const maxMb=Number((state.bootstrap&&state.bootstrap.maxUploadMb)||2);
    for(const inputId of ['landPhoto','landCertificate']){const f=$(inputId).files[0];if(f&&f.size>maxMb*1024*1024){toast(`Ukuran ${f.name} maksimal ${maxMb} MB.`,'error');return;}}
    loading(true,'Menyimpan data tanah...',25);
    try{
      if(!isOnline()){
        if($('landPhoto').files[0]||$('landCertificate').files[0])toast('Data disimpan offline, tetapi dokumen harus dipilih kembali setelah online.','error');
        queueLandOffline(payload);closeModal();toast('Data tanah disimpan di antrean offline.');return;
      }
      const result=await server('saveTanah',state.token,payload);const id=result.id;
      for(const [inputId,type] of [['landPhoto','FOTO'],['landCertificate','SERTIFIKAT']]){
        const f=$(inputId).files[0];if(f){loadingStep(60,'Mengunggah '+type+'...');await server('uploadDokumenTanah',state.token,id,type,{name:f.name,mimeType:f.type,base64:await readFile(f)});}
      }
      closeModal();toast('Data tanah berhasil disimpan.');await loadLandList();
    }catch(e){toast(friendlyNetworkError(e),'error');}finally{loading(false);}
  };

  // ---------- PETA ----------
  window.renderLandMap = async function renderLandMapV171(containerId,points) {
    const el=$(containerId);if(!el)return;
    const r=activeLandRegion();
    if(!isOnline()){renderCoordinateFallback(el,points||[]);return;}
    const leafletReady=await ensureLeaflet();
    if(leafletReady&&window.L){
      if(landState.map){try{landState.map.remove();}catch(_){}}
      const map=L.map(containerId,{zoomControl:true}).setView([r.centerLat,r.centerLng],r.zoom);landState.map=map;
      const tile=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'});
      tile.on('tileerror',()=>el.classList.add('map-offline'));tile.addTo(map);
      const bounds=[];(points||[]).forEach(p=>{if(Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))){const m=L.marker([Number(p.lat),Number(p.lng)]).addTo(map);m.bindPopup(`<b>${esc(p.name||'-')}</b><br>${esc(p.opd||'-')}<br>${esc(p.status||'-')}<br>${Number(p.lat).toFixed(7)}, ${Number(p.lng).toFixed(7)}`);bounds.push([Number(p.lat),Number(p.lng)]);}});
      if(bounds.length)map.fitBounds(bounds,{padding:[20,20],maxZoom:14});
      setTimeout(()=>map.invalidateSize(),100);
    }else renderCoordinateFallback(el,points||[]);
  };

  window.loadLandMapPage = async function loadLandMapPageV171() {
    let d;
    try{d=await server('getDashboard',state.token);localSet(CACHE_KEYS.landDashboard,d);}catch(e){d=localGet(CACHE_KEYS.landDashboard)||localGet(CACHE_KEYS.landOfflineMap);if(!d)throw e;}
    landState.dashboard=d;landState.settings=d.settings||{};
    $('content').innerHTML=`<section class="panel"><div class="panel-head"><h3>Peta & Ploting</h3><div class="map-toolbar"><button class="btn btn-light" id="downloadLandMap">⬇ Unduh Peta Offline Wajo</button><button class="btn btn-primary" id="newLandPlot">+ Tambah Ploting</button></div></div><div class="panel-body"><div id="fullLandMap" class="land-map land-map-large"></div><div class="offline-note">Peta offline ringan menyimpan wilayah pengaturan dan semua titik aset. Saat internet tidak tersedia, titik tetap ditampilkan pada peta koordinat.</div></div></section>`;
    $('newLandPlot').onclick=()=>openLandForm('',true);$('downloadLandMap').onclick=downloadLandOfflineMap;renderLandMap('fullLandMap',d.points||[]);
  };

  window.downloadLandOfflineMap = function downloadLandOfflineMapV171() {
    const d=landState.dashboard||localGet(CACHE_KEYS.landDashboard);
    if(!d){toast('Data peta belum tersedia. Muat dashboard saat online terlebih dahulu.','error');return;}
    localSet(CACHE_KEYS.landOfflineMap,d);
    const geo={type:'FeatureCollection',name:'Aset Tanah Kabupaten Wajo',features:(d.points||[]).map(p=>({type:'Feature',properties:{id:p.id,nama:p.name,opd:p.opd,status:p.status},geometry:{type:'Point',coordinates:[Number(p.lng),Number(p.lat)]}}))};
    const blob=new Blob([JSON.stringify(geo,null,2)],{type:'application/geo+json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='PETA_ASET_TANAH_WAJO_OFFLINE.geojson';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast(`${(d.points||[]).length} titik aset tersimpan untuk mode offline.`);
  };

  // ---------- PENGGUNA TANAH ----------
  window.loadLandUsers = async function loadLandUsersV171() {
    const res=await server('listTanahUsers',state.token);
    $('content').innerHTML=`<section class="panel"><div class="panel-head"><div><h3>Pengguna Tanah</h3><div class="muted">Atur username, role, OPD, dan status pengguna.</div></div><button class="btn btn-primary" id="addLandUser">+ Tambah Pengguna</button></div><div class="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>OPD</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${(res.rows||[]).map(u=>`<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.role)}</td><td>${esc(u.opd||'-')}</td><td class="${u.active?'user-status-active':'user-status-inactive'}">${u.active?'AKTIF':'TIDAK AKTIF'}</td><td><div class="icon-actions"><button class="icon-btn" data-land-user-edit="${esc(u.username)}">✎</button><button class="icon-btn danger-icon" data-land-user-delete="${esc(u.username)}">🗑</button></div></td></tr>`).join('')}</tbody></table></div></section>`;
    $('addLandUser').onclick=()=>openLandUserModal();
    document.querySelectorAll('[data-land-user-edit]').forEach(b=>b.onclick=()=>openLandUserModal((res.rows||[]).find(x=>x.username===b.dataset.landUserEdit)));
    document.querySelectorAll('[data-land-user-delete]').forEach(b=>b.onclick=()=>deleteLandUser(b.dataset.landUserDelete));
  };
  function openLandUserModal(u={}){
    const opds=(state.bootstrap.opds||[]).map(x=>`<option value="${esc(x)}">`).join('');
    showModal(u.username?'Edit Pengguna Tanah':'Tambah Pengguna Tanah',`<div class="form-grid"><div class="field"><label>Username</label><input id="luUsername" class="input" value="${esc(u.username||'')}" ${u.username?'readonly':''}></div><div class="field"><label>Password ${u.username?'(kosongkan jika tidak diubah)':''}</label><input id="luPassword" type="password" class="input"></div><div class="field"><label>Role</label><select id="luRole" class="select"><option>ADMIN</option><option>OPERATOR</option><option>USER</option></select></div><div class="field"><label>OPD</label><input id="luOpd" class="input" list="luOpdList" value="${esc(u.opd||'')}"><datalist id="luOpdList">${opds}</datalist></div><div class="field"><label>Status</label><select id="luActive" class="select"><option value="YA">AKTIF</option><option value="TIDAK">TIDAK AKTIF</option></select></div></div>`,`<button class="btn btn-light" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="saveLandUserBtn">Simpan</button>`,'modal');
    $('luRole').value=u.role||'USER';$('luActive').value=u.active===false?'TIDAK':'YA';$('saveLandUserBtn').onclick=saveLandUser;
  }
  async function saveLandUser(){
    loading(true,'Menyimpan pengguna...');try{await server('saveTanahUser',state.token,{username:$('luUsername').value,password:$('luPassword').value,role:$('luRole').value,opd:$('luOpd').value,active:$('luActive').value==='YA'});closeModal();toast('Pengguna disimpan.');await loadLandUsers();}catch(e){toast(friendlyNetworkError(e),'error');}finally{loading(false);}
  }
  async function deleteLandUser(username){if(!confirm(`Hapus pengguna ${username}?`))return;loading(true,'Menghapus pengguna...');try{await server('deleteTanahUser',state.token,username);toast('Pengguna dihapus.');await loadLandUsers();}catch(e){toast(friendlyNetworkError(e),'error');}finally{loading(false);}}

  // ---------- PENGATURAN TANAH ----------
  window.loadLandSettings = async function loadLandSettingsV171() {
    const s=await server('getTanahSettings',state.token);landState.settings=s;
    renderLandSettingsForm(s);
  };
  function renderLandSettingsForm(s){
    $('content').innerHTML=`<section class="panel"><div class="panel-head"><div><h3>Pengaturan Tanah</h3><div class="muted">Atur wilayah peta dan batas ukuran dokumen.</div></div><button class="btn btn-light" id="addMapRegion">+ Tambah Wilayah Map</button></div><div class="panel-body"><div class="field" style="max-width:260px"><label>Maksimum Upload Dokumen (MB)</label><input id="landMaxUpload" type="number" min="1" max="10" class="input" value="${esc(s.maxUploadMb||2)}"></div><div class="field" style="max-width:420px"><label>Wilayah Aktif</label><select id="activeLandRegion" class="select">${(s.regions||[]).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div><div id="mapRegionGrid" class="region-grid">${(s.regions||[]).map((r,i)=>regionCardHtml(r,i)).join('')}</div><div style="margin-top:14px"><button class="btn btn-primary" id="saveLandSettingsBtn">Simpan Pengaturan</button></div></div></section>`;
    $('activeLandRegion').value=s.activeRegionId||'';$('addMapRegion').onclick=addLandRegionCard;$('saveLandSettingsBtn').onclick=saveLandSettings;
    bindRegionRemove();
  }
  function regionCardHtml(r,i){return `<div class="region-card" data-region-index="${i}"><div class="region-card-head"><b>${esc(r.name||`Wilayah ${i+1}`)}</b><button class="icon-btn danger-icon" type="button" data-remove-region="${i}">🗑</button></div><div class="field"><label>ID</label><input class="input rg-id" value="${esc(r.id||`REGION_${i+1}`)}"></div><div class="field"><label>Nama Wilayah</label><input class="input rg-name" value="${esc(r.name||'')}"></div><div class="field"><label>Center Lat</label><input class="input rg-clat" value="${esc(r.centerLat)}"></div><div class="field"><label>Center Lng</label><input class="input rg-clng" value="${esc(r.centerLng)}"></div><div class="field"><label>Zoom</label><input class="input rg-zoom" type="number" value="${esc(r.zoom||10)}"></div><div class="field"><label>Min Lat</label><input class="input rg-minlat" value="${esc(r.minLat)}"></div><div class="field"><label>Max Lat</label><input class="input rg-maxlat" value="${esc(r.maxLat)}"></div><div class="field"><label>Min Lng</label><input class="input rg-minlng" value="${esc(r.minLng)}"></div><div class="field"><label>Max Lng</label><input class="input rg-maxlng" value="${esc(r.maxLng)}"></div></div>`;}
  function bindRegionRemove(){document.querySelectorAll('[data-remove-region]').forEach(b=>b.onclick=()=>{if(document.querySelectorAll('.region-card').length<=1){toast('Minimal satu wilayah map harus tersedia.','error');return;}b.closest('.region-card').remove();refreshActiveRegionOptions();});}
  function addLandRegionCard(){const grid=$('mapRegionGrid'),i=grid.children.length;grid.insertAdjacentHTML('beforeend',regionCardHtml({id:`REGION_${Date.now()}`,name:`Wilayah Baru ${i+1}`,centerLat:-4.11,centerLng:120.03,zoom:10,minLat:-4.30,maxLat:-3.55,minLng:119.75,maxLng:120.60},i));bindRegionRemove();refreshActiveRegionOptions();}
  function collectRegions(){return Array.from(document.querySelectorAll('.region-card')).map(c=>({id:c.querySelector('.rg-id').value.trim(),name:c.querySelector('.rg-name').value.trim(),centerLat:Number(c.querySelector('.rg-clat').value),centerLng:Number(c.querySelector('.rg-clng').value),zoom:Number(c.querySelector('.rg-zoom').value),minLat:Number(c.querySelector('.rg-minlat').value),maxLat:Number(c.querySelector('.rg-maxlat').value),minLng:Number(c.querySelector('.rg-minlng').value),maxLng:Number(c.querySelector('.rg-maxlng').value)}));}
  function refreshActiveRegionOptions(){const sel=$('activeLandRegion'),old=sel.value,regions=collectRegions();sel.innerHTML=regions.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');if(regions.some(r=>r.id===old))sel.value=old;}
  async function saveLandSettings(){loading(true,'Menyimpan pengaturan tanah...');try{const s=await server('saveTanahSettings',state.token,{maxUploadMb:Number($('landMaxUpload').value),activeRegionId:$('activeLandRegion').value,regions:collectRegions()});state.bootstrap.settings=s;state.bootstrap.maxUploadMb=s.maxUploadMb;landState.settings=s;localSet(CACHE_KEYS.bootstrap('TANAH'),state.bootstrap);toast('Pengaturan tanah disimpan.');renderLandSettingsForm(s);}catch(e){toast(friendlyNetworkError(e),'error');}finally{loading(false);}}

  // ---------- KENDARAAN: NOMOR BERANGKAS ----------
  window.fetchVehicles = async function fetchVehiclesV171(){
    const requestId=++state.vehicleRequestSeq,target=$('vehicleTable'),searchBtn=$('vehicleSearchBtn');
    if(target)target.innerHTML='<div class="empty">Memuat data kendaraan...</div>';if(searchBtn){searchBtn.disabled=true;searchBtn.textContent='Memuat...';}
    try{
      const res=await server('listKendaraan',state.token,{page:state.vehiclePage,pageSize:25,search:state.vehicleSearch,opd:state.vehicleOpd});
      if(requestId!==state.vehicleRequestSeq)return;state.bootstrap.opds=res.opds||state.bootstrap.opds||[];
      const opdSel=$('vehicleOpd');if(opdSel&&opdSel.options.length<=1)opdSel.innerHTML='<option value="">Semua OPD</option>'+res.opds.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('');if(opdSel)opdSel.value=state.vehicleOpd;
      const current=$('vehicleTable');if(!current)return;if(!res.rows.length){current.innerHTML='<div class="empty">Data kendaraan tidak ditemukan.</div>';return;}
      current.innerHTML=`<div class="table-wrap"><table class="table vehicle-table"><thead><tr><th>NOMOR BERANGKAS BPKB</th><th>NAMA BARANG/JENIS/MODEL</th><th>MERK/TYPE</th><th>OPD TERINVENTARIS</th><th>PENANGGUNG JAWAB</th><th>NOMOR POLISI</th><th>NOMOR RANGKA</th><th>NOMOR MESIN</th><th>NOMOR BPKB</th><th>DOKUMEN</th><th>AKSI</th></tr></thead><tbody>${res.rows.map(vehicleRow).join('')}</tbody></table></div>${pagination('vehicle',res)}`;
    }catch(e){if(requestId===state.vehicleRequestSeq&&$('vehicleTable'))$('vehicleTable').innerHTML=`<div class="danger">${esc(friendlyNetworkError(e))}</div>`;}finally{if(requestId===state.vehicleRequestSeq&&searchBtn){searchBtn.disabled=false;searchBtn.textContent='Cari';}}
  };
  window.vehicleRow = function vehicleRowV171(r){
    const att=r.attachments||{},uploaded=[att.bpkb,att.bast,att.stnk,att.foto].filter(Boolean).length,complete=uploaded===4?' complete':'';
    return `<tr><td class="berangkas-col">${esc(r.nomorBerangkasBpkb||'-')}</td><td><b>${esc(r.namaBarangJenisModel||'-')}</b></td><td>${esc(r.merkType||'-')}</td><td title="${esc(r.opdTerinventaris||'')}">${esc(r.opdTerinventaris||'-')}</td><td title="${esc(r.penanggungJawab||'')}">${esc(r.penanggungJawab||'-')}</td><td class="nowrap"><b>${esc(r.nomorPolisi||'-')}</b></td><td class="nowrap">${esc(r.nomorRangka||'-')}</td><td class="nowrap">${esc(r.nomorMesin||'-')}</td><td class="nowrap">${esc(r.nomorBpkb||'-')}</td><td style="text-align:center"><span class="doc-count${complete}">${uploaded}/4</span></td><td><div class="action-icons"><button class="icon-btn edit" title="Edit / Detail" onclick="openVehicle('${esc(r.id)}')">${iconSvg('edit')}</button><button class="icon-btn docs" title="Lihat Dokumen" onclick="viewUploadedDocuments('${esc(r.id)}')">${iconSvg('docs')}</button><button class="icon-btn letter" title="Buat Surat" onclick="openLetter('${esc(r.id)}')">${iconSvg('letter')}</button>${['ADMIN','OPERATOR'].includes(state.user.role)?`<button class="icon-btn delete" title="Hapus" onclick="removeVehicle('${esc(r.id)}','${esc(r.nomorPolisi)}')">${iconSvg('delete')}</button>`:''}</div></td></tr>`;
  };

  // patch footer/version and initial network state after DOM ready
  window.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('*').forEach(el=>{if(el.childNodes.length===1&&el.firstChild.nodeType===3&&/Frontend V17\.0/.test(el.textContent))el.textContent='Frontend V17.1';});
    setNetworkBanner(isOnline());
  });
})();

/* V17.2 — role kendaraan USER per OPD */
(() => {
  'use strict';

  const isVehicleUser = () => state.asset === 'KENDARAAN' && state.user && state.user.role === 'USER';
  const canUseLetters = () => !isVehicleUser();
  const canDeleteVehicle = () => !isVehicleUser() && ['ADMIN','OPERATOR'].includes((state.user && state.user.role) || '');

  window.renderVehicleShell = function renderVehicleShellV172() {
    const brand = document.querySelector('.brand b');
    if (brand) brand.innerHTML = '<span class="brand-short">SITKAW</span><span class="brand-long">SISTEM INFORMASI TANAH DAN KENDARAAN ASET WAJO</span>';
    const role = (state.user && state.user.role) || '';
    document.querySelector('.nav').innerHTML = `
      <button data-view="dashboard" class="active">▦ Dashboard</button>
      <button data-view="vehicles">▤ Data Kendaraan</button>
      ${role !== 'USER' ? '<button data-view="letters">▧ Riwayat Surat</button>' : ''}
      ${role === 'ADMIN' ? '<button data-view="officers">♙ Master Pejabat</button><button data-view="users">♟ Pengguna</button><button data-view="settings">⚙ Pengaturan</button>' : ''}`;
    document.querySelectorAll('.nav button').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.view));
    });
  };

  const navigateBaseV172 = window.navigate;
  window.navigate = async function navigateV172(view) {
    if (isVehicleUser() && ['letters','officers','users','settings'].includes(view)) {
      toast('Role USER hanya dapat mengelola data kendaraan milik OPD-nya.', 'error');
      return;
    }
    return navigateBaseV172(view);
  };

  const openLetterBaseV172 = window.openLetter;
  window.openLetter = async function openLetterV172(vehicleId, letterId = '') {
    if (!canUseLetters()) {
      toast('Role USER tidak dapat membuat atau membuka surat rekomendasi.', 'error');
      return;
    }
    return openLetterBaseV172(vehicleId, letterId);
  };

  const openVehicleBaseV172 = window.openVehicle;
  window.openVehicle = async function openVehicleV172(id = '') {
    await openVehicleBaseV172(id);
    if (isVehicleUser()) {
      const opdInput = $('vOpd');
      if (opdInput) {
        opdInput.value = state.user.opd || opdInput.value || '';
        opdInput.readOnly = true;
        opdInput.title = 'OPD dikunci sesuai akun USER.';
      }
    }
  };

  window.dashboardVehicleRow = function dashboardVehicleRowV172(r) {
    const att = r.attachments || {};
    const uploaded = [att.bpkb,att.bast,att.stnk,att.foto].filter(Boolean).length;
    const letterButton = canUseLetters()
      ? `<button class="icon-btn letter" title="Buat Surat Rekomendasi" onclick="openLetter('${esc(r.id)}')">${iconSvg('letter')}</button>`
      : '';
    return `<tr>
      <td><b>${esc(r.namaBarangJenisModel||'-')}</b><div class="muted">${esc(r.merkType||'-')}</div></td>
      <td><b>${esc(r.jenisKendaraan||'LAINNYA')}</b></td>
      <td><span class="badge badge-AKTIF">${esc(r.statusPenggunaan||'BELUM DIISI')}</span></td>
      <td><b>${esc(r.nomorPolisi||'-')}</b><div class="muted">${esc(r.nomorRangka||'-')} / ${esc(r.nomorMesin||'-')}</div></td>
      <td>${esc(r.opdTerinventaris||'-')}</td>
      <td>${esc(r.penanggungJawab||'-')}</td>
      <td><span class="badge ${badgeClass(r.statusStnk)}">${esc(r.statusStnk||'-')}</span></td>
      <td>${displayDate(r.tglBerlakuStnk)}</td>
      <td><span class="doc-count${uploaded===4?' complete':''}">${uploaded}/4</span></td>
      <td><div class="action-icons">
        <button class="icon-btn edit" title="Edit / Detail" onclick="openVehicle('${esc(r.id)}')">${iconSvg('edit')}</button>
        ${letterButton}
      </div></td>
    </tr>`;
  };

  window.vehicleRow = function vehicleRowV172(r) {
    const att = r.attachments || {};
    const uploaded = [att.bpkb,att.bast,att.stnk,att.foto].filter(Boolean).length;
    const complete = uploaded === 4 ? ' complete' : '';
    const letterButton = canUseLetters()
      ? `<button class="icon-btn letter" title="Buat Surat" onclick="openLetter('${esc(r.id)}')">${iconSvg('letter')}</button>`
      : '';
    const deleteButton = canDeleteVehicle()
      ? `<button class="icon-btn delete" title="Hapus" onclick="removeVehicle('${esc(r.id)}','${esc(r.nomorPolisi)}')">${iconSvg('delete')}</button>`
      : '';
    return `<tr>
      <td class="berangkas-col">${esc(r.nomorBerangkasBpkb||'-')}</td>
      <td><b>${esc(r.namaBarangJenisModel||'-')}</b></td>
      <td>${esc(r.merkType||'-')}</td>
      <td title="${esc(r.opdTerinventaris||'')}">${esc(r.opdTerinventaris||'-')}</td>
      <td title="${esc(r.penanggungJawab||'')}">${esc(r.penanggungJawab||'-')}</td>
      <td class="nowrap"><b>${esc(r.nomorPolisi||'-')}</b></td>
      <td class="nowrap">${esc(r.nomorRangka||'-')}</td>
      <td class="nowrap">${esc(r.nomorMesin||'-')}</td>
      <td class="nowrap">${esc(r.nomorBpkb||'-')}</td>
      <td style="text-align:center"><span class="doc-count${complete}">${uploaded}/4</span></td>
      <td><div class="action-icons">
        <button class="icon-btn edit" title="Edit / Detail" onclick="openVehicle('${esc(r.id)}')">${iconSvg('edit')}</button>
        <button class="icon-btn docs" title="Lihat Dokumen" onclick="viewUploadedDocuments('${esc(r.id)}')">${iconSvg('docs')}</button>
        ${letterButton}${deleteButton}
      </div></td>
    </tr>`;
  };

  window.loadUsers = async function loadUsersV172() {
    $('content').innerHTML = '<section class="panel" style="margin-top:0"><div class="panel-head"><h3>Pengguna Kendaraan</h3><button class="btn btn-primary" onclick="openUser()">+ Tambah Pengguna</button></div><div id="userTable"><div class="empty">Memuat...</div></div></section>';
    try {
      const rows = await server('listUsers', state.token);
      state.usersCache = rows;
      $('userTable').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Username</th><th>Nama</th><th>Role</th><th>OPD</th><th>Status</th><th>Login Terakhir</th><th>Aksi</th></tr></thead><tbody>${rows.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td><span class="badge ${badgeClass(u.role)}">${esc(u.role)}</span></td><td>${esc(u.opd||'-')}</td><td>${u.active?'Aktif':'Tidak Aktif'}${u.mustChange?' · Wajib ganti password':''}</td><td>${u.lastLogin?new Date(u.lastLogin).toLocaleString('id-ID'):'-'}</td><td><div class="actions"><button class="btn btn-light btn-sm" onclick="openUserByName('${esc(u.username)}')">Edit</button><button class="btn btn-red btn-sm" onclick="removeUser('${esc(u.username)}')">Hapus</button></div></td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  window.openUserByName = function openUserByNameV172(username) {
    const user = (state.usersCache || []).find(item => item.username === username) || {};
    openUser(user);
  };

  window.openUser = function openUserV172(user = {}) {
    const opdOptions = (state.bootstrap.opds || []).map(opd => `<option value="${esc(opd)}"></option>`).join('');
    showModal(user.username ? 'Edit Pengguna Kendaraan' : 'Tambah Pengguna Kendaraan', `
      <div class="form-grid">
        ${input('Username *','uUsername',user.username,'text')}
        ${input('Nama *','uName',user.name,'text','span-2')}
        <div class="field"><label>Role</label><select id="uRole" class="select"><option value="ADMIN">ADMIN</option><option value="OPERATOR">OPERATOR</option><option value="USER">USER OPD</option></select></div>
        <div class="field"><label>OPD ${user.role==='USER'?'*':''}</label><input id="uOpd" class="input" list="uOpdList" value="${esc(user.opd||'')}" placeholder="Wajib untuk role USER"><datalist id="uOpdList">${opdOptions}</datalist></div>
        <div class="field"><label>Status</label><select id="uActive" class="select"><option value="YA">Aktif</option><option value="TIDAK">Tidak Aktif</option></select></div>
        ${input(user.username?'Password Baru (kosongkan jika tidak diubah)':'Password *','uPassword','','password','span-2')}
        <div class="span-2 muted">USER OPD hanya dapat melihat, menambah, memperbarui, dan mengunggah dokumen kendaraan milik OPD yang dipilih. USER tidak memiliki akses surat dan menu administrasi.</div>
      </div>`,
      '<button class="btn btn-light" onclick="closeModal()">Batal</button><button class="btn btn-primary" onclick="submitUser()">Simpan</button>',
      'modal-sm');
    $('uRole').value = user.role || 'OPERATOR';
    $('uActive').value = user.active === false ? 'TIDAK' : 'YA';
    if (user.username) $('uUsername').readOnly = true;
  };

  window.submitUser = async function submitUserV172() {
    const role = $('uRole').value;
    const opd = $('uOpd').value.trim();
    if (role === 'USER' && !opd) {
      toast('OPD wajib dipilih untuk role USER.', 'error');
      $('uOpd').focus();
      return;
    }
    loading(true, 'Menyimpan pengguna...');
    try {
      await server('saveUser', state.token, {
        username: $('uUsername').value,
        name: $('uName').value,
        role,
        opd,
        active: $('uActive').value === 'YA',
        password: $('uPassword').value
      });
      closeModal();
      toast('Pengguna berhasil disimpan.');
      await loadUsers();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      loading(false);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('*').forEach(el => {
      if (el.childNodes.length === 1 && el.firstChild.nodeType === 3 && /Frontend V17\.1/.test(el.textContent)) {
        el.textContent = 'Frontend V17.2.1';
      }
    });
  });
})();


/* V17.3 — pencarian/filter dengan loading, peta form terpadu, dan pengaturan wilayah interaktif */
(() => {
  'use strict';

  const cacheV173 = {
    bootstrap: asset => `v17_1_bootstrap_${asset}`,
    landDashboard: 'v17_1_land_dashboard',
    landLastList: 'v17_1_land_last_list',
    landList: (page, search, filter) => `v17_1_land_list_${page}_${encodeURIComponent(search || '')}_${encodeURIComponent(filter || '')}`,
    landOfflineMap: 'v17_1_land_offline_map'
  };
  const cacheGetV173 = (key, fallback = null) => {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  };
  const cacheSetV173 = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  };
  const onlineV173 = () => navigator.onLine !== false;
  const friendlyV173 = error => typeof errorText === 'function'
    ? errorText(error)
    : String(error && error.message ? error.message : error || 'Terjadi gangguan sambungan.');

  const patchState = {
    landRequest: 0,
    vehicleRequest: 0,
    landTimer: null,
    vehicleTimer: null,
    editMap: null,
    editMarker: null,
    editAutoLocation: false,
    settingsMap: null,
    settingsMarker: null,
    settingsBounds: null,
    settingsSearchResults: []
  };

  function currentLandRegionV173() {
    const settings = (landState && landState.settings) ||
      (landState && landState.dashboard && landState.dashboard.settings) ||
      (state.bootstrap && state.bootstrap.settings) || {};
    const regions = Array.isArray(settings.regions) ? settings.regions : [];
    return regions.find(region => region.id === settings.activeRegionId) || regions[0] || {
      id: 'WAJO', name: 'Kabupaten Wajo', centerLat: -4.11, centerLng: 120.03, zoom: 10,
      minLat: -4.30, maxLat: -3.55, minLng: 119.75, maxLng: 120.60
    };
  }

  function tableLoadingHtmlV173(colspan, message) {
    return `<tr class="table-loading-row"><td colspan="${colspan}"><div class="table-loading-box"><span class="mini-spinner"></span>${esc(message)}</div></td></tr>`;
  }

  function setSearchStatusV173(id, active, text) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = active ? `<span class="mini-spinner"></span>${esc(text || 'Memuat...')}` : esc(text || '');
  }

  // ---------- PENCARIAN & FILTER TANAH ----------
  window.applyLandFilterV173 = async function applyLandFilterV173(source = 'search') {
    if (!$('landSearch') || !$('landFilter')) return;
    landState.search = $('landSearch').value.trim();
    landState.filter = $('landFilter').value;
    landState.page = 1;
    await loadLandList({ source });
  };

  window.clearLandFilterV173 = async function clearLandFilterV173() {
    if ($('landSearch')) $('landSearch').value = '';
    if ($('landFilter')) $('landFilter').value = '';
    landState.search = '';
    landState.filter = '';
    landState.page = 1;
    await loadLandList({ source: 'clear' });
  };

  window.loadLandList = async function loadLandListV173(options = {}) {
    const requestId = ++patchState.landRequest;
    const existingBody = document.querySelector('.land-table tbody');
    const searchButton = $('landSearchBtn');
    if (existingBody) existingBody.innerHTML = tableLoadingHtmlV173(12, 'Mencari data tanah...');
    if (searchButton) {
      searchButton.disabled = true;
      searchButton.textContent = 'Memuat...';
    }
    setSearchStatusV173('landSearchStatus', true, 'Memuat hasil...');
    loading(true, landState.search || landState.filter ? 'Mencari dan memfilter data tanah...' : 'Memuat data tanah...', 24);

    let res;
    const key = cacheV173.landList(landState.page, landState.search, landState.filter);
    try {
      try {
        res = await server('listTanah', state.token, landState.page, landState.pageSize, landState.search, landState.filter);
        cacheSetV173(key, res);
        cacheSetV173(cacheV173.landLastList, res);
      } catch (error) {
        res = cacheGetV173(key) || cacheGetV173(cacheV173.landLastList);
        if (!res) throw error;
        toast('Daftar tanah ditampilkan dari cache offline.', 'error');
      }
      if (requestId !== patchState.landRequest) return;
      landState.rows = res.rows || [];

      $('content').innerHTML = `<section class="panel land-data-panel" style="margin-top:0">
        <div class="panel-head land-data-head">
          <div class="filter-toolbar land-data-toolbar">
            <input id="landSearch" class="input" placeholder="Cari no. berangkas, uraian, OPD, penggunaan, lokasi, sertifikat" value="${esc(landState.search)}">
            <select id="landFilter" class="select">
              <option value="">Semua Status</option>
              <option value="BERSERTIFIKAT">Bersertifikat</option>
              <option value="NON-SERTIFIKAT">Non-Sertifikat</option>
              <option value="SUDAH DIPLOTING">Sudah Diploting</option>
              <option value="BELUM DIPLOTING">Belum Diploting</option>
            </select>
            <button id="landSearchBtn" class="btn btn-light">Cari</button>
            <button id="landClearBtn" class="btn btn-light">Bersihkan</button>
            <span id="landSearchStatus" class="search-status">${res.total || 0} data${!onlineV173() ? ' · cache offline' : ''}</span>
          </div>
          <button class="btn btn-primary" id="addLandBtn">＋ Tambah Tanah</button>
        </div>
        <div class="table-wrap land-table-wrap"><table class="table land-table"><thead><tr><th>NO. BERANGKAS</th><th>URAIAN</th><th>NAMA OPD</th><th>PENGGUNAAN</th><th>LOKASI</th><th>LUAS</th><th>TAHUN</th><th>NOMOR SERTIFIKAT</th><th>STATUS</th><th>KOORDINAT</th><th>DOKUMEN</th><th>AKSI</th></tr></thead><tbody>${(res.rows || []).map(row => landRowHtml(row)).join('') || '<tr><td colspan="12" class="empty">Data tidak ditemukan.</td></tr>'}</tbody></table></div>
        <div class="pagination"><button class="btn btn-light btn-sm" id="landPrev" ${res.page <= 1 ? 'disabled' : ''}>Sebelumnya</button><span>${res.total || 0} data · Halaman ${res.page} / ${res.pages}</span><button class="btn btn-light btn-sm" id="landNext" ${res.page >= res.pages ? 'disabled' : ''}>Berikutnya</button></div>
      </section>`;

      $('landFilter').value = landState.filter || '';
      $('addLandBtn').onclick = () => openLandForm();
      $('landSearchBtn').onclick = () => applyLandFilterV173('button');
      $('landClearBtn').onclick = clearLandFilterV173;
      $('landFilter').onchange = () => applyLandFilterV173('filter');
      $('landSearch').onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyLandFilterV173('enter');
        }
      };
      $('landSearch').oninput = () => {
        clearTimeout(patchState.landTimer);
        patchState.landTimer = setTimeout(() => applyLandFilterV173('typing'), 650);
      };
      $('landPrev').onclick = async () => {
        if (landState.page > 1) {
          landState.page--;
          await loadLandList({ source: 'page' });
        }
      };
      $('landNext').onclick = async () => {
        if (landState.page < res.pages) {
          landState.page++;
          await loadLandList({ source: 'page' });
        }
      };
      document.querySelectorAll('[data-land-edit]').forEach(button => button.onclick = () => openLandForm(button.dataset.landEdit));
      document.querySelectorAll('[data-land-delete]').forEach(button => button.onclick = () => deleteLandRecord(button.dataset.landDelete));
      document.querySelectorAll('[data-land-map]').forEach(button => button.onclick = () => openLandPoint(button.dataset.landMap));
    } catch (error) {
      if (requestId === patchState.landRequest) {
        const target = document.querySelector('.land-table tbody');
        if (target) target.innerHTML = `<tr><td colspan="12"><div class="danger">${esc(friendlyV173(error))}</div></td></tr>`;
        else toast(friendlyV173(error), 'error');
      }
    } finally {
      if (requestId === patchState.landRequest) {
        loading(false);
        const button = $('landSearchBtn');
        if (button) {
          button.disabled = false;
          button.textContent = 'Cari';
        }
      }
    }
  };

  // ---------- PENCARIAN & FILTER KENDARAAN ----------
  window.applyVehicleFilter = async function applyVehicleFilterV173(source = 'search') {
    if (!$('vehicleSearch') || !$('vehicleOpd')) return;
    state.vehicleSearch = $('vehicleSearch').value.trim();
    state.vehicleOpd = $('vehicleOpd').value;
    state.vehiclePage = 1;
    loading(true, state.vehicleSearch || state.vehicleOpd ? 'Mencari dan memfilter data kendaraan...' : 'Memuat data kendaraan...', 24);
    try {
      await fetchVehicles({ source });
    } finally {
      loading(false);
    }
  };

  window.clearVehicleFilterV173 = async function clearVehicleFilterV173() {
    if ($('vehicleSearch')) $('vehicleSearch').value = '';
    if ($('vehicleOpd')) $('vehicleOpd').value = '';
    state.vehicleSearch = '';
    state.vehicleOpd = '';
    state.vehiclePage = 1;
    loading(true, 'Memuat seluruh data kendaraan...', 24);
    try {
      await fetchVehicles({ source: 'clear' });
    } finally {
      loading(false);
    }
  };

  window.loadVehicles = async function loadVehiclesV173() {
    const opdOptions = (state.bootstrap.opds || []).map(opd => `<option value="${esc(opd)}">${esc(opd)}</option>`).join('');
    $('content').innerHTML = `<section class="panel" style="margin-top:0">
      <div class="panel-head">
        <div class="filter-toolbar">
          <input id="vehicleSearch" class="input" placeholder="Cari berangkas BPKB, jenis, merk, OPD, polisi, rangka, mesin, BPKB" value="${esc(state.vehicleSearch)}">
          <select id="vehicleOpd" class="select"><option value="">Semua OPD</option>${opdOptions}</select>
          <button id="vehicleSearchBtn" class="btn btn-light">Cari</button>
          <button id="vehicleClearBtn" class="btn btn-light">Bersihkan</button>
          <span id="vehicleSearchStatus" class="search-status"></span>
        </div>
        <button class="btn btn-primary" id="addVehicleBtn">＋ Tambah Kendaraan</button>
      </div>
      <div id="vehicleTable"><div class="empty"><span class="mini-spinner"></span> Memuat data kendaraan...</div></div>
    </section>`;
    $('vehicleOpd').value = state.vehicleOpd || '';
    $('addVehicleBtn').onclick = () => openVehicle();
    $('vehicleSearchBtn').onclick = () => applyVehicleFilter('button');
    $('vehicleClearBtn').onclick = clearVehicleFilterV173;
    $('vehicleOpd').onchange = () => applyVehicleFilter('opd');
    $('vehicleSearch').onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyVehicleFilter('enter');
      }
    };
    $('vehicleSearch').oninput = () => {
      clearTimeout(patchState.vehicleTimer);
      patchState.vehicleTimer = setTimeout(() => applyVehicleFilter('typing'), 650);
    };
    await fetchVehicles({ source: 'initial' });
  };

  window.fetchVehicles = async function fetchVehiclesV173() {
    const requestId = ++state.vehicleRequestSeq;
    patchState.vehicleRequest = requestId;
    const target = $('vehicleTable');
    const searchButton = $('vehicleSearchBtn');
    if (target) target.innerHTML = '<div class="empty"><span class="mini-spinner"></span> Memuat data kendaraan...</div>';
    if (searchButton) {
      searchButton.disabled = true;
      searchButton.textContent = 'Memuat...';
    }
    setSearchStatusV173('vehicleSearchStatus', true, 'Memuat hasil...');
    try {
      const res = await server('listKendaraan', state.token, {
        page: state.vehiclePage,
        pageSize: 25,
        search: state.vehicleSearch,
        opd: state.vehicleOpd
      });
      if (requestId !== state.vehicleRequestSeq) return;
      state.bootstrap.opds = res.opds || state.bootstrap.opds || [];
      const opdSelect = $('vehicleOpd');
      if (opdSelect) {
        const selected = state.vehicleOpd || '';
        opdSelect.innerHTML = '<option value="">Semua OPD</option>' + (res.opds || []).map(opd => `<option value="${esc(opd)}">${esc(opd)}</option>`).join('');
        opdSelect.value = selected;
      }
      const current = $('vehicleTable');
      if (!current) return;
      setSearchStatusV173('vehicleSearchStatus', false, `${res.total || 0} data`);
      if (!res.rows.length) {
        current.innerHTML = '<div class="empty">Data kendaraan tidak ditemukan.</div>';
        return;
      }
      current.innerHTML = `<div class="table-wrap"><table class="table vehicle-table"><thead><tr><th>NOMOR BERANGKAS BPKB</th><th>NAMA BARANG/JENIS/MODEL</th><th>MERK/TYPE</th><th>OPD TERINVENTARIS</th><th>PENANGGUNG JAWAB</th><th>NOMOR POLISI</th><th>NOMOR RANGKA</th><th>NOMOR MESIN</th><th>NOMOR BPKB</th><th>DOKUMEN</th><th>AKSI</th></tr></thead><tbody>${res.rows.map(vehicleRow).join('')}</tbody></table></div>${pagination('vehicle', res)}`;
    } catch (error) {
      if (requestId === state.vehicleRequestSeq && $('vehicleTable')) {
        $('vehicleTable').innerHTML = `<div class="danger">${esc(friendlyV173(error))}</div>`;
        setSearchStatusV173('vehicleSearchStatus', false, 'Gagal memuat');
      }
    } finally {
      if (requestId === state.vehicleRequestSeq && searchButton) {
        searchButton.disabled = false;
        searchButton.textContent = 'Cari';
      }
    }
  };

  // ---------- FORM TANAH DENGAN PETA UNTUK TAMBAH DAN EDIT ----------
  async function reverseLandPointV173(lat, lng, overwrite = false) {
    if (!onlineV173()) {
      toast('Koordinat sudah diisi. Nama lokasi dapat dilengkapi manual saat offline.', 'error');
      return;
    }
    try {
      const response = await fetch(`/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Lokasi tidak dikenali.');
      const setValue = (id, value) => {
        const input = $(id);
        if (input && value && (overwrite || !input.value.trim())) input.value = value;
      };
      setValue('landDistrict', data.kecamatan);
      setValue('landVillage', data.desa);
      setValue('landAddress', data.alamat || data.displayName);
      toast('Lokasi berhasil dibaca dari titik peta.');
    } catch (error) {
      toast('Koordinat terisi. Nama lokasi dapat dikoreksi manual.', 'error');
    }
  }

  function setLandEditMarkerV173(lat, lng, reverse = false, overwrite = false) {
    if (!patchState.editMap || !window.L || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
    const point = [Number(lat), Number(lng)];
    if (patchState.editMarker) {
      patchState.editMarker.setLatLng(point);
    } else {
      patchState.editMarker = L.marker(point, { draggable: true }).addTo(patchState.editMap);
      patchState.editMarker.on('dragend', event => {
        const position = event.target.getLatLng();
        $('landLat').value = position.lat.toFixed(7);
        $('landLng').value = position.lng.toFixed(7);
        reverseLandPointV173(position.lat, position.lng, false);
      });
    }
    if ($('landLat')) $('landLat').value = Number(lat).toFixed(7);
    if ($('landLng')) $('landLng').value = Number(lng).toFixed(7);
    if (reverse) reverseLandPointV173(lat, lng, overwrite);
  }

  async function renderLandEditorMapV173(containerId, lat, lng, isNew) {
    const container = $(containerId);
    if (!container) return;
    const ready = await ensureLeaflet();
    if (!ready || !window.L) {
      container.innerHTML = '<div class="empty">Peta tidak dapat dimuat. Latitude dan Longitude tetap dapat diisi manual.</div>';
      return;
    }
    if (patchState.editMap) {
      try { patchState.editMap.remove(); } catch (_) {}
      patchState.editMap = null;
      patchState.editMarker = null;
    }
    const region = currentLandRegionV173();
    const hasPoint = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    const center = hasPoint ? [Number(lat), Number(lng)] : [Number(region.centerLat), Number(region.centerLng)];
    patchState.editAutoLocation = Boolean(isNew);
    patchState.editMap = L.map(containerId, { zoomControl: true }).setView(center, hasPoint ? 17 : Number(region.zoom || 10));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(patchState.editMap);
    if (hasPoint) setLandEditMarkerV173(lat, lng, false);
    patchState.editMap.on('click', event => {
      setLandEditMarkerV173(event.latlng.lat, event.latlng.lng, true, patchState.editAutoLocation);
    });
    setTimeout(() => patchState.editMap && patchState.editMap.invalidateSize(), 160);
  }

  window.takeLandGps = function takeLandGpsV173() {
    if (!navigator.geolocation) {
      toast('GPS tidak didukung perangkat ini.', 'error');
      return;
    }
    loading(true, 'Mengambil lokasi GPS dengan akurasi tinggi...', 35);
    navigator.geolocation.getCurrentPosition(async position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      if (patchState.editMap) patchState.editMap.setView([lat, lng], 18);
      setLandEditMarkerV173(lat, lng, false);
      await reverseLandPointV173(lat, lng, true);
      loading(false);
    }, error => {
      loading(false);
      toast('Lokasi GPS gagal: ' + error.message, 'error');
    }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  };

  window.openLandForm = async function openLandFormV173(id = '') {
    loading(true, id ? 'Memuat data dan peta tanah...' : 'Menyiapkan form dan peta tanah...', 20);
    try {
      let data;
      if (id) {
        data = await server('getTanah', state.token, id);
      } else {
        let next = { id: 'Otomatis saat disimpan' };
        if (onlineV173()) {
          try { next = await server('getNextTanahId', state.token); } catch (_) {}
        }
        data = { eid: next.id, nama_opd: state.user.opd || '', Status: 'Non-Sertifikat' };
      }
      const maxMb = Number((state.bootstrap && state.bootstrap.maxUploadMb) || 2);
      const body = `<div class="form-grid land-form">
        ${landInput('EID', 'landId', data.eid || 'Otomatis saat disimpan', true, false, 'land-id-auto')}
        ${landInput('Nomor Berangkas', 'landBox', data.no_brangkas || '')}
        ${landInput('OPD', 'landOpd', data.nama_opd || '', false, true)}
        ${landInput('Uraian/Nama Aset', 'landName', data.uraian || '', false, false, 'span-2')}
        ${landInput('Kecamatan', 'landDistrict', data.kecamatan || '')}
        ${landInput('Desa/Kelurahan', 'landVillage', data.desa || '')}
        ${landInput('Alamat', 'landAddress', data.alamat || '', false, false, 'span-2')}
        ${landInput('Luas', 'landArea', data.luas || '')}
        ${landInput('Penggunaan', 'landUse', data.penggunaan || '')}
        ${landInput('Nomor Bukti', 'landProof', data.no_bukti || '')}
        ${landInput('Tahun', 'landYear', data.tahun || '')}
        ${landInput('Harga', 'landPrice', data.harga || '')}
        <div class="field"><label>Status Sertifikat *</label><select id="landCert" class="select"><option>Bersertifikat</option><option>Non-Sertifikat</option></select></div>
        ${landInput('Nomor Sertifikat', 'landCertNo', data.NOMOR_SERTIFIKAT || '')}
        ${landInput('Jenis Hak', 'landRight', data.JENIS_HAK || '')}
        ${landInput('Latitude', 'landLat', data.lat ?? '')}
        ${landInput('Longitude', 'landLng', data.lng ?? '')}
        <div class="field span-3">
          <div class="map-field-head"><div><label>Peta Titik Lokasi Tanah</label><div class="muted">Klik peta atau geser marker untuk memilih titik yang tepat.</div></div><div class="map-field-actions"><button type="button" class="btn btn-light" id="takeGpsBtn">⌖ Ambil GPS Otomatis</button><button type="button" class="btn btn-light" id="syncTypedPointBtn">Tampilkan Koordinat Manual</button><button type="button" class="btn btn-light" id="readPointLocationBtn">Isi Lokasi dari Titik</button></div></div>
          <div id="plotLandMap" class="land-map land-editor-map"></div>
          <div class="map-help">Titik dapat dipilih otomatis dari GPS, diklik langsung pada peta, digeser melalui marker, atau diisi manual melalui Latitude dan Longitude.</div>
        </div>
        <div class="field span-2"><label>Keterangan</label><textarea id="landNotes" class="textarea">${esc(data.keterangan || '')}</textarea></div>
        <div class="field"><label>Foto Tanah (maks. ${maxMb} MB)</label><input id="landPhoto" class="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
        <div class="field"><label>Sertifikat (maks. ${maxMb} MB)</label><input id="landCertificate" class="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
      </div>`;
      showModal(id ? 'Edit Data Tanah' : 'Tambah Data Tanah', body, '<button class="btn btn-light" onclick="closeModal()">Batal</button><button class="btn btn-primary" id="saveLandBtn">Simpan</button>', 'modal-plot');
      $('landCert').value = String(data.Status || '').toUpperCase().includes('NON') ? 'Non-Sertifikat' : 'Bersertifikat';
      $('takeGpsBtn').onclick = takeLandGps;
      $('saveLandBtn').onclick = saveLandForm;
      $('syncTypedPointBtn').onclick = () => {
        const lat = Number($('landLat').value);
        const lng = Number($('landLng').value);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          toast('Latitude dan Longitude belum valid.', 'error');
          return;
        }
        if (patchState.editMap) patchState.editMap.setView([lat, lng], 17);
        setLandEditMarkerV173(lat, lng, false);
      };
      $('readPointLocationBtn').onclick = () => {
        const lat = Number($('landLat').value);
        const lng = Number($('landLng').value);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          toast('Pilih titik peta atau isi koordinat terlebih dahulu.', 'error');
          return;
        }
        reverseLandPointV173(lat, lng, true);
      };
      setTimeout(() => renderLandEditorMapV173('plotLandMap', data.lat, data.lng, !id), 100);
    } catch (error) {
      toast(friendlyV173(error), 'error');
    } finally {
      loading(false);
    }
  };

  // ---------- SATUKAN TAMBAH TANAH DAN PLOTING ----------
  window.loadLandMapPage = async function loadLandMapPageV173() {
    loading(true, 'Memuat peta aset tanah...', 25);
    let dashboard;
    try {
      try {
        dashboard = await server('getDashboard', state.token);
        cacheSetV173(cacheV173.landDashboard, dashboard);
      } catch (error) {
        dashboard = cacheGetV173(cacheV173.landDashboard) || cacheGetV173(cacheV173.landOfflineMap);
        if (!dashboard) throw error;
        toast('Peta ditampilkan dari cache offline.', 'error');
      }
      landState.dashboard = dashboard;
      landState.settings = dashboard.settings || {};
      $('content').innerHTML = `<section class="panel"><div class="panel-head"><div><h3>Peta Aset Tanah</h3><div class="muted">Tambah dan edit tanah menggunakan satu form yang selalu dilengkapi peta.</div></div><div class="map-toolbar"><button class="btn btn-light" id="downloadLandMap">⬇ Unduh Data Peta Offline Wajo</button><button class="btn btn-primary" id="newLandFromMap">＋ Tambah Data Tanah</button></div></div><div class="panel-body"><div id="fullLandMap" class="land-map land-map-large"></div><div class="offline-note">Tidak ada lagi menu Tambah Ploting terpisah. Setiap Tambah Data Tanah dan Edit Data Tanah sudah memiliki peta, GPS, marker yang dapat digeser, serta koordinat manual.</div></div></section>`;
      $('newLandFromMap').onclick = () => openLandForm();
      $('downloadLandMap').onclick = downloadLandOfflineMap;
      renderLandMap('fullLandMap', dashboard.points || []);
    } catch (error) {
      $('content').innerHTML = `<div class="danger">${esc(friendlyV173(error))}</div>`;
    } finally {
      loading(false);
    }
  };

  // ---------- PENGATURAN WILAYAH DENGAN PETA & PENCARIAN ----------
  function settingsRegionCardsV173() {
    return Array.from(document.querySelectorAll('.region-card-v173'));
  }

  function collectRegionsV173() {
    return settingsRegionCardsV173().map(card => ({
      id: card.querySelector('.rg-id').value.trim(),
      name: card.querySelector('.rg-name').value.trim(),
      centerLat: Number(card.querySelector('.rg-clat').value),
      centerLng: Number(card.querySelector('.rg-clng').value),
      zoom: Number(card.querySelector('.rg-zoom').value),
      minLat: Number(card.querySelector('.rg-minlat').value),
      maxLat: Number(card.querySelector('.rg-maxlat').value),
      minLng: Number(card.querySelector('.rg-minlng').value),
      maxLng: Number(card.querySelector('.rg-maxlng').value)
    }));
  }

  function activeRegionIndexV173() {
    const select = $('activeLandRegion');
    return select ? Math.max(0, Number(select.value) || 0) : 0;
  }

  function activeRegionCardV173() {
    return settingsRegionCardsV173()[activeRegionIndexV173()] || settingsRegionCardsV173()[0] || null;
  }

  function renderRegionCardV173(region, index) {
    return `<div class="region-card-v173${index === 0 ? ' active' : ''}" data-region-index="${index}">
      <div class="region-card-head"><b>${esc(region.name || `Wilayah ${index + 1}`)}</b><button class="icon-btn danger-icon" type="button" data-remove-region="${index}" title="Hapus wilayah">🗑</button></div>
      <div class="region-coordinate-grid">
        <div class="field"><label>ID Wilayah</label><input class="input rg-id" value="${esc(region.id || `REGION_${index + 1}`)}"></div>
        <div class="field"><label>Nama Wilayah</label><input class="input rg-name" value="${esc(region.name || '')}"></div>
        <div class="field"><label>Zoom Awal</label><input class="input rg-zoom" type="number" min="3" max="19" value="${esc(region.zoom || 10)}"></div>
        <div class="field"><label>Latitude Tengah</label><input class="input rg-clat" value="${esc(region.centerLat)}"></div>
        <div class="field"><label>Longitude Tengah</label><input class="input rg-clng" value="${esc(region.centerLng)}"></div>
      </div>
      <div class="region-bound-grid">
        <div class="field"><label>Batas Selatan / Min Latitude</label><input class="input rg-minlat" value="${esc(region.minLat)}"></div>
        <div class="field"><label>Batas Utara / Max Latitude</label><input class="input rg-maxlat" value="${esc(region.maxLat)}"></div>
        <div class="field"><label>Batas Barat / Min Longitude</label><input class="input rg-minlng" value="${esc(region.minLng)}"></div>
        <div class="field"><label>Batas Timur / Max Longitude</label><input class="input rg-maxlng" value="${esc(region.maxLng)}"></div>
      </div>
    </div>`;
  }

  function refreshRegionSelectV173(selectedIndex = activeRegionIndexV173()) {
    const select = $('activeLandRegion');
    if (!select) return;
    const regions = collectRegionsV173();
    select.innerHTML = regions.map((region, index) => `<option value="${index}">${esc(region.name || `Wilayah ${index + 1}`)}</option>`).join('');
    select.value = String(Math.min(selectedIndex, Math.max(0, regions.length - 1)));
    settingsRegionCardsV173().forEach((card, index) => card.classList.toggle('active', index === Number(select.value)));
  }

  function updateSettingsMapFromCardV173(fitBounds = true) {
    const card = activeRegionCardV173();
    if (!card || !patchState.settingsMap || !window.L) return;
    const centerLat = Number(card.querySelector('.rg-clat').value);
    const centerLng = Number(card.querySelector('.rg-clng').value);
    const zoom = Number(card.querySelector('.rg-zoom').value) || 10;
    const minLat = Number(card.querySelector('.rg-minlat').value);
    const maxLat = Number(card.querySelector('.rg-maxlat').value);
    const minLng = Number(card.querySelector('.rg-minlng').value);
    const maxLng = Number(card.querySelector('.rg-maxlng').value);
    if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
      if (patchState.settingsMarker) patchState.settingsMarker.setLatLng([centerLat, centerLng]);
      else {
        patchState.settingsMarker = L.marker([centerLat, centerLng], { draggable: true }).addTo(patchState.settingsMap);
        patchState.settingsMarker.on('dragend', event => {
          const position = event.target.getLatLng();
          const active = activeRegionCardV173();
          if (!active) return;
          active.querySelector('.rg-clat').value = position.lat.toFixed(7);
          active.querySelector('.rg-clng').value = position.lng.toFixed(7);
        });
      }
      if (!fitBounds) patchState.settingsMap.setView([centerLat, centerLng], zoom);
    }
    if ([minLat, maxLat, minLng, maxLng].every(Number.isFinite) && minLat < maxLat && minLng < maxLng) {
      const bounds = [[minLat, minLng], [maxLat, maxLng]];
      if (patchState.settingsBounds) patchState.settingsBounds.setBounds(bounds);
      else patchState.settingsBounds = L.rectangle(bounds, { color: '#2f6dad', weight: 2, fillOpacity: 0.08 }).addTo(patchState.settingsMap);
      if (fitBounds) patchState.settingsMap.fitBounds(bounds, { padding: [20, 20] });
    } else if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
      patchState.settingsMap.setView([centerLat, centerLng], zoom);
    }
  }

  async function renderSettingsMapV173() {
    const container = $('landSettingsMap');
    if (!container) return;
    const ready = await ensureLeaflet();
    if (!ready || !window.L) {
      container.innerHTML = '<div class="empty">Peta pengaturan tidak dapat dimuat. Batas wilayah tetap dapat diisi manual.</div>';
      return;
    }
    if (patchState.settingsMap) {
      try { patchState.settingsMap.remove(); } catch (_) {}
    }
    patchState.settingsMap = L.map('landSettingsMap', { zoomControl: true });
    patchState.settingsMarker = null;
    patchState.settingsBounds = null;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(patchState.settingsMap);
    patchState.settingsMap.on('click', event => {
      const card = activeRegionCardV173();
      if (!card) return;
      card.querySelector('.rg-clat').value = event.latlng.lat.toFixed(7);
      card.querySelector('.rg-clng').value = event.latlng.lng.toFixed(7);
      updateSettingsMapFromCardV173(false);
    });
    updateSettingsMapFromCardV173(true);
    setTimeout(() => patchState.settingsMap && patchState.settingsMap.invalidateSize(), 120);
  }

  function bindRegionCardsV173() {
    document.querySelectorAll('[data-remove-region]').forEach(button => {
      button.onclick = () => {
        if (settingsRegionCardsV173().length <= 1) {
          toast('Minimal satu wilayah peta harus tersedia.', 'error');
          return;
        }
        const card = button.closest('.region-card-v173');
        const index = Number(card.dataset.regionIndex) || 0;
        card.remove();
        settingsRegionCardsV173().forEach((item, position) => item.dataset.regionIndex = String(position));
        refreshRegionSelectV173(Math.max(0, index - 1));
        bindRegionCardsV173();
        updateSettingsMapFromCardV173(true);
      };
    });
    settingsRegionCardsV173().forEach((card, index) => {
      card.querySelectorAll('input').forEach(input => {
        input.onchange = () => {
          if (input.classList.contains('rg-name')) refreshRegionSelectV173(index);
          if (index === activeRegionIndexV173()) updateSettingsMapFromCardV173(false);
        };
      });
      card.onclick = event => {
        if (event.target.closest('button') || event.target.closest('input')) return;
        $('activeLandRegion').value = String(index);
        refreshRegionSelectV173(index);
        updateSettingsMapFromCardV173(true);
      };
    });
  }

  function addRegionV173() {
    const grid = $('mapRegionGrid');
    if (!grid) return;
    const index = settingsRegionCardsV173().length;
    const mapBounds = patchState.settingsMap ? patchState.settingsMap.getBounds() : null;
    const center = patchState.settingsMap ? patchState.settingsMap.getCenter() : { lat: -4.11, lng: 120.03 };
    const region = {
      id: `REGION_${Date.now()}`,
      name: `Wilayah Baru ${index + 1}`,
      centerLat: center.lat,
      centerLng: center.lng,
      zoom: patchState.settingsMap ? patchState.settingsMap.getZoom() : 10,
      minLat: mapBounds ? mapBounds.getSouth() : -4.30,
      maxLat: mapBounds ? mapBounds.getNorth() : -3.55,
      minLng: mapBounds ? mapBounds.getWest() : 119.75,
      maxLng: mapBounds ? mapBounds.getEast() : 120.60
    };
    grid.insertAdjacentHTML('beforeend', renderRegionCardV173(region, index));
    refreshRegionSelectV173(index);
    bindRegionCardsV173();
    updateSettingsMapFromCardV173(true);
  }

  function useVisibleMapBoundsV173() {
    if (!patchState.settingsMap) return;
    const card = activeRegionCardV173();
    if (!card) return;
    const bounds = patchState.settingsMap.getBounds();
    const center = patchState.settingsMap.getCenter();
    card.querySelector('.rg-clat').value = center.lat.toFixed(7);
    card.querySelector('.rg-clng').value = center.lng.toFixed(7);
    card.querySelector('.rg-zoom').value = patchState.settingsMap.getZoom();
    card.querySelector('.rg-minlat').value = bounds.getSouth().toFixed(7);
    card.querySelector('.rg-maxlat').value = bounds.getNorth().toFixed(7);
    card.querySelector('.rg-minlng').value = bounds.getWest().toFixed(7);
    card.querySelector('.rg-maxlng').value = bounds.getEast().toFixed(7);
    updateSettingsMapFromCardV173(true);
    toast('Batas wilayah diambil dari tampilan peta saat ini.');
  }

  async function searchMapRegionV173() {
    const query = $('landRegionSearch').value.trim();
    if (!query) {
      toast('Masukkan nama wilayah, kecamatan, desa, atau alamat.', 'error');
      return;
    }
    const button = $('landRegionSearchBtn');
    button.disabled = true;
    button.textContent = 'Mencari...';
    $('landRegionResults').innerHTML = '<div class="table-loading-box"><span class="mini-spinner"></span>Mencari wilayah...</div>';
    try {
      const response = await fetch(`/reverse-geocode?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Wilayah tidak ditemukan.');
      patchState.settingsSearchResults = data.results || [];
      $('landRegionResults').innerHTML = patchState.settingsSearchResults.length
        ? patchState.settingsSearchResults.map((result, index) => `<button type="button" class="region-search-result" data-region-result="${index}"><b>${esc(result.name || result.displayName)}</b><small>${esc(result.displayName || '')}</small></button>`).join('')
        : '<div class="empty">Wilayah tidak ditemukan.</div>';
      document.querySelectorAll('[data-region-result]').forEach(resultButton => {
        resultButton.onclick = () => applyRegionSearchResultV173(Number(resultButton.dataset.regionResult));
      });
    } catch (error) {
      $('landRegionResults').innerHTML = `<div class="danger">${esc(error.message || 'Pencarian wilayah gagal.')}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Cari Wilayah';
    }
  }

  function applyRegionSearchResultV173(index) {
    const result = patchState.settingsSearchResults[index];
    const card = activeRegionCardV173();
    if (!result || !card) return;
    const box = Array.isArray(result.boundingBox) ? result.boundingBox.map(Number) : [];
    card.querySelector('.rg-name').value = result.name || result.displayName || card.querySelector('.rg-name').value;
    card.querySelector('.rg-clat').value = Number(result.lat).toFixed(7);
    card.querySelector('.rg-clng').value = Number(result.lng).toFixed(7);
    if (box.length === 4 && box.every(Number.isFinite)) {
      card.querySelector('.rg-minlat').value = box[0].toFixed(7);
      card.querySelector('.rg-maxlat').value = box[1].toFixed(7);
      card.querySelector('.rg-minlng').value = box[2].toFixed(7);
      card.querySelector('.rg-maxlng').value = box[3].toFixed(7);
    }
    refreshRegionSelectV173(activeRegionIndexV173());
    updateSettingsMapFromCardV173(true);
    $('landRegionResults').innerHTML = '';
    toast('Wilayah, titik tengah, dan batas peta berhasil diisi.');
  }

  async function saveLandSettingsV173() {
    const regions = collectRegionsV173();
    const invalid = regions.find(region => !region.id || !region.name ||
      ![region.centerLat, region.centerLng, region.zoom, region.minLat, region.maxLat, region.minLng, region.maxLng].every(Number.isFinite) ||
      region.minLat >= region.maxLat || region.minLng >= region.maxLng);
    if (invalid) {
      toast(`Wilayah ${invalid.name || invalid.id || '-'} memiliki titik atau batas yang belum valid.`, 'error');
      return;
    }
    const selectedIndex = activeRegionIndexV173();
    const activeId = regions[selectedIndex] ? regions[selectedIndex].id : regions[0].id;
    loading(true, 'Menyimpan pengaturan wilayah dan peta...', 25);
    try {
      const settings = await server('saveTanahSettings', state.token, {
        maxUploadMb: Number($('landMaxUpload').value),
        activeRegionId: activeId,
        regions
      });
      state.bootstrap.settings = settings;
      state.bootstrap.maxUploadMb = settings.maxUploadMb;
      landState.settings = settings;
      cacheSetV173(cacheV173.bootstrap('TANAH'), state.bootstrap);
      toast('Pengaturan tanah berhasil disimpan.');
      await loadLandSettings();
    } catch (error) {
      toast(friendlyV173(error), 'error');
    } finally {
      loading(false);
    }
  }

  window.loadLandSettings = async function loadLandSettingsV173() {
    loading(true, 'Memuat pengaturan wilayah dan peta...', 20);
    try {
      const settings = await server('getTanahSettings', state.token);
      landState.settings = settings;
      const regions = Array.isArray(settings.regions) && settings.regions.length ? settings.regions : [currentLandRegionV173()];
      let activeIndex = regions.findIndex(region => region.id === settings.activeRegionId);
      if (activeIndex < 0) activeIndex = 0;
      $('content').innerHTML = `<section class="panel"><div class="panel-head"><div><h3>Pengaturan Tanah</h3><div class="muted">Cari wilayah, tentukan titik tengah, atur batas wilayah secara visual, dan atur kapasitas dokumen.</div></div><button class="btn btn-light" id="addMapRegion">＋ Tambah Wilayah Map</button></div><div class="panel-body">
        <div class="form-grid">
          <div class="field"><label>Maksimum Upload Dokumen (MB)</label><input id="landMaxUpload" type="number" min="1" max="10" class="input" value="${esc(settings.maxUploadMb || 2)}"></div>
          <div class="field span-2"><label>Wilayah Aktif</label><select id="activeLandRegion" class="select">${regions.map((region, index) => `<option value="${index}">${esc(region.name)}</option>`).join('')}</select></div>
        </div>
        <div class="settings-map-panel">
          <div class="settings-map-toolbar"><input id="landRegionSearch" class="input" placeholder="Cari contoh: Kabupaten Wajo, Kecamatan Tempe, Sengkang"><button class="btn btn-light" id="landRegionSearchBtn">Cari Wilayah</button><button class="btn btn-light" id="useMapBoundsBtn">Gunakan Batas Tampilan Peta</button></div>
          <div id="landRegionResults" class="region-search-results"></div>
          <div id="landSettingsMap" class="settings-map"></div>
          <div class="settings-map-note">Klik peta atau geser marker untuk mengatur titik tengah. Geser dan zoom peta, lalu klik “Gunakan Batas Tampilan Peta” untuk mengisi batas Selatan, Utara, Barat, dan Timur secara otomatis.</div>
        </div>
        <div id="mapRegionGrid" class="region-grid-v173">${regions.map((region, index) => renderRegionCardV173(region, index)).join('')}</div>
        <div style="margin-top:16px"><button class="btn btn-primary" id="saveLandSettingsBtn">Simpan Pengaturan</button></div>
      </div></section>`;
      $('activeLandRegion').value = String(activeIndex);
      refreshRegionSelectV173(activeIndex);
      $('addMapRegion').onclick = addRegionV173;
      $('activeLandRegion').onchange = () => {
        refreshRegionSelectV173(activeRegionIndexV173());
        updateSettingsMapFromCardV173(true);
      };
      $('landRegionSearchBtn').onclick = searchMapRegionV173;
      $('landRegionSearch').onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          searchMapRegionV173();
        }
      };
      $('useMapBoundsBtn').onclick = useVisibleMapBoundsV173;
      $('saveLandSettingsBtn').onclick = saveLandSettingsV173;
      bindRegionCardsV173();
      setTimeout(renderSettingsMapV173, 80);
    } catch (error) {
      $('content').innerHTML = `<div class="danger">${esc(friendlyV173(error))}</div>`;
    } finally {
      loading(false);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('*').forEach(element => {
      if (element.childNodes.length === 1 && element.firstChild.nodeType === 3 && /Frontend V17\.2\.1/.test(element.textContent)) {
        element.textContent = 'Frontend V17.3';
      }
    });
  });
})();

/* V17.4 — Penyempurnaan Form Lokasi Tanah */
(() => {
  'use strict';

  const editor = {
    map: null,
    marker: null,
    reverseSeq: 0,
    searchSeq: 0,
    coordinateTimer: null,
    suppressCoordinateEvents: false
  };

  const byId = id => document.getElementById(id);
  const textValue = id => String(byId(id)?.value || '').trim();
  const validPoint = (lat, lng) => { const la=Number(lat), ln=Number(lng); return Number.isFinite(la)&&Number.isFinite(ln)&&la>=-90&&la<=90&&ln>=-180&&ln<=180&&(Math.abs(la)>0.000001||Math.abs(ln)>0.000001); };
  const escapeHtml = value => typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function activeRegion() {
    const settings = (window.landState && (landState.settings || landState.dashboard?.settings)) || window.state?.bootstrap?.settings || {};
    const regions = Array.isArray(settings.regions) ? settings.regions : [];
    return regions.find(region => region.id === settings.activeRegionId) || regions[0] || {
      centerLat: -4.11,
      centerLng: 120.03,
      zoom: 10
    };
  }

  function cleanupEditorMap() {
    clearTimeout(editor.coordinateTimer);
    editor.coordinateTimer = null;
    if (editor.map) {
      try { editor.map.remove(); } catch (_) {}
    }
    editor.map = null;
    editor.marker = null;
    editor.reverseSeq++;
    editor.searchSeq++;
  }

  const originalCloseModal = window.closeModal;
  window.closeModal = function closeModalV174() {
    cleanupEditorMap();
    if (typeof originalCloseModal === 'function') originalCloseModal();
    else if (byId('modalRoot')) byId('modalRoot').innerHTML = '';
  };

  function showLandEditorModal(title, body, footer) {
    cleanupEditorMap();
    const root = byId('modalRoot');
    if (!root) throw new Error('Kontainer modal tidak ditemukan.');
    root.innerHTML = `<div class="modal-backdrop land-modal-backdrop-v174">
      <div class="modal modal-plot land-editor-modal-v174" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-head"><h3>${escapeHtml(title)}</h3><button type="button" class="close" id="landEditorCloseV174" aria-label="Tutup">×</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${footer}</div>
      </div>
    </div>`;
    byId('landEditorCloseV174').onclick = () => window.closeModal();
    // Backdrop sengaja tidak menutup modal agar penghapusan/pengetikan alamat pada HP tidak menutup form secara tidak sengaja.
    const modal = root.querySelector('.land-editor-modal-v174');
    if (modal) modal.addEventListener('click', event => event.stopPropagation());
  }

  function setLocationStatus(message, tone = '') {
    const target = byId('landLocationStatusV174');
    if (!target) return;
    target.className = `land-location-status-v174 ${tone}`.trim();
    target.textContent = message || '';
  }

  function writeCoordinateFields(lat, lng) {
    editor.suppressCoordinateEvents = true;
    if (byId('landLat')) byId('landLat').value = Number(lat).toFixed(7);
    if (byId('landLng')) byId('landLng').value = Number(lng).toFixed(7);
    editor.suppressCoordinateEvents = false;
  }

  function writeLocationFields(data, overwrite = true) {
    const assign = (id, value) => {
      const input = byId(id);
      if (!input || !value) return;
      if (overwrite || !input.value.trim()) input.value = value;
    };
    assign('landDistrict', data.kecamatan || data.district || '');
    assign('landVillage', data.desa || data.village || '');
    assign('landAddress', data.alamat || data.displayName || '');
  }

  async function reversePoint(lat, lng, overwrite = true) {
    if (navigator.onLine === false) {
      setLocationStatus('Koordinat tersimpan. Nama lokasi dapat diisi manual saat offline.', 'warning');
      return;
    }
    const seq = ++editor.reverseSeq;
    setLocationStatus('Membaca kecamatan, desa/kelurahan, dan alamat dari titik...', 'loading');
    try {
      const response = await fetch(`/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, { cache: 'no-store' });
      const data = await response.json();
      if (seq !== editor.reverseSeq) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Lokasi tidak dapat dikenali.');
      writeLocationFields(data, overwrite);
      setLocationStatus('Lokasi dan koordinat sudah diperbarui. Kolom lokasi tetap dapat dikoreksi manual.', 'success');
    } catch (error) {
      if (seq !== editor.reverseSeq) return;
      setLocationStatus('Koordinat sudah diperbarui, tetapi nama lokasi gagal dibaca. Isi lokasi secara manual.', 'warning');
    }
  }

  function setMarker(lat, lng, options = {}) {
    const { center = true, reverse = true, overwriteLocation = true, zoom = 18 } = options;
    if (!validPoint(lat, lng)) return false;
    const point = [Number(lat), Number(lng)];
    writeCoordinateFields(point[0], point[1]);
    if (editor.map && window.L) {
      if (!editor.marker) {
        editor.marker = L.marker(point, { draggable: true }).addTo(editor.map);
        editor.marker.on('dragend', event => {
          const position = event.target.getLatLng();
          setMarker(position.lat, position.lng, { center: false, reverse: true, overwriteLocation: true });
        });
      } else {
        editor.marker.setLatLng(point);
      }
      if (center) editor.map.setView(point, zoom);
    }
    if (reverse) reversePoint(point[0], point[1], overwriteLocation);
    return true;
  }

  async function initEditorMap(lat, lng) {
    const container = byId('landEditorMapV174');
    if (!container) return;
    const ready = typeof ensureLeaflet === 'function' ? await ensureLeaflet() : Boolean(window.L);
    if (!ready || !window.L) {
      container.innerHTML = '<div class="empty">Peta tidak dapat dimuat. Latitude, Longitude, dan lokasi tetap dapat diisi manual.</div>';
      return;
    }
    cleanupEditorMap();
    const region = activeRegion();
    const hasPoint = validPoint(lat, lng);
    const center = hasPoint ? [Number(lat), Number(lng)] : [Number(region.centerLat), Number(region.centerLng)];
    editor.map = L.map('landEditorMapV174', { zoomControl: true }).setView(center, hasPoint ? 17 : Number(region.zoom || 10));
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(editor.map);
    editor.map.on('click', event => {
      setMarker(event.latlng.lat, event.latlng.lng, { center: false, reverse: true, overwriteLocation: true });
    });
    if (hasPoint) setMarker(lat, lng, { center: false, reverse: false });
    setTimeout(() => editor.map?.invalidateSize(), 180);
  }

  function geolocationErrorMessage(error) {
    if (!error) return 'Lokasi perangkat tidak dapat diambil.';
    if (error.code === 1) return 'Izin lokasi ditolak. Aktifkan izin lokasi untuk browser lalu coba lagi.';
    if (error.code === 2) return 'Lokasi perangkat tidak tersedia. Pastikan GPS/lokasi perangkat aktif.';
    if (error.code === 3) return 'Pengambilan lokasi terlalu lama. Pindah ke area dengan sinyal lokasi yang lebih baik lalu coba lagi.';
    return error.message || 'Lokasi perangkat tidak dapat diambil.';
  }

  window.takeLandGps = function takeLandDeviceLocationV174() {
    if (!navigator.geolocation) {
      toast('Browser/perangkat ini tidak mendukung pengambilan lokasi.', 'error');
      return;
    }
    loading(true, 'Mengambil lokasi perangkat...', 30);
    setLocationStatus('Mengambil lokasi HP/laptop...', 'loading');
    navigator.geolocation.getCurrentPosition(async position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setMarker(lat, lng, { center: true, reverse: false, zoom: 18 });
      await reversePoint(lat, lng, true);
      const accuracy = Number(position.coords.accuracy || 0);
      if (accuracy > 0) setLocationStatus(`Lokasi perangkat diterapkan. Perkiraan akurasi ±${Math.round(accuracy)} meter.`, accuracy <= 50 ? 'success' : 'warning');
      loading(false);
    }, error => {
      loading(false);
      const message = geolocationErrorMessage(error);
      setLocationStatus(message, 'warning');
      toast(message, 'error');
    }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
  };

  async function searchMapLocation() {
    const input = byId('landMapSearchV174');
    const results = byId('landMapResultsV174');
    const button = byId('landMapSearchBtnV174');
    if (!input || !results || !button) return;
    const rawQuery = input.value.trim();
    if (!rawQuery) {
      results.innerHTML = '<div class="land-location-empty-v174">Ketik nama tempat, jalan, desa/kelurahan, kecamatan, atau alamat.</div>';
      input.focus();
      return;
    }
    if (navigator.onLine === false) {
      results.innerHTML = '<div class="land-location-empty-v174">Pencarian nama lokasi membutuhkan internet. Anda tetap dapat menggeser peta atau mengisi koordinat.</div>';
      return;
    }
    const seq = ++editor.searchSeq;
    const query = /wajo|sulawesi selatan/i.test(rawQuery) ? rawQuery : `${rawQuery}, Kabupaten Wajo, Sulawesi Selatan`;
    button.disabled = true;
    button.textContent = 'Mencari...';
    results.innerHTML = '<div class="land-location-empty-v174"><span class="mini-spinner"></span> Mencari lokasi...</div>';
    try {
      const response = await fetch(`/reverse-geocode?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
      const data = await response.json();
      if (seq !== editor.searchSeq) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'Pencarian lokasi gagal.');
      const rows = Array.isArray(data.results) ? data.results : [];
      if (!rows.length) {
        results.innerHTML = '<div class="land-location-empty-v174">Lokasi tidak ditemukan. Coba kata yang lebih lengkap.</div>';
        return;
      }
      results.innerHTML = rows.map((row, index) => `<button type="button" class="land-location-result-v174" data-land-location-index="${index}">
        <b>${escapeHtml(row.name || 'Lokasi')}</b><span>${escapeHtml(row.displayName || '')}</span>
      </button>`).join('');
      results.querySelectorAll('[data-land-location-index]').forEach(resultButton => {
        resultButton.onclick = async () => {
          const row = rows[Number(resultButton.dataset.landLocationIndex)];
          if (!row || !validPoint(row.lat, row.lng)) return;
          input.value = row.displayName || row.name || rawQuery;
          if (editor.map && Array.isArray(row.boundingBox) && row.boundingBox.length === 4 && row.boundingBox.every(Number.isFinite)) {
            editor.map.fitBounds([[row.boundingBox[0], row.boundingBox[2]], [row.boundingBox[1], row.boundingBox[3]]], { padding: [24, 24], maxZoom: 18 });
          }
          setMarker(row.lat, row.lng, { center: !row.boundingBox, reverse: false, zoom: 18 });
          writeLocationFields(row, true);
          await reversePoint(row.lat, row.lng, true);
          results.innerHTML = '';
        };
      });
    } catch (error) {
      results.innerHTML = `<div class="land-location-empty-v174">${escapeHtml(error.message || 'Pencarian lokasi gagal.')}</div>`;
    } finally {
      if (seq === editor.searchSeq) {
        button.disabled = false;
        button.textContent = 'Cari di Peta';
      }
    }
  }

  function syncTypedCoordinates() {
    if (editor.suppressCoordinateEvents) return;
    clearTimeout(editor.coordinateTimer);
    editor.coordinateTimer = setTimeout(() => {
      const lat = Number(textValue('landLat'));
      const lng = Number(textValue('landLng'));
      if (!validPoint(lat, lng)) {
        setLocationStatus('Masukkan Latitude dan Longitude yang valid.', 'warning');
        return;
      }
      setMarker(lat, lng, { center: true, reverse: true, overwriteLocation: true, zoom: 17 });
    }, 500);
  }

  function bindEditorEvents() {
    byId('takeGpsBtn').onclick = window.takeLandGps;
    byId('saveLandBtn').onclick = saveLandForm;
    byId('landMapSearchBtnV174').onclick = searchMapLocation;
    byId('landMapSearchV174').onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchMapLocation();
      }
    };
    ['landLat', 'landLng'].forEach(id => {
      const input = byId(id);
      if (!input) return;
      input.addEventListener('change', syncTypedCoordinates);
      input.addEventListener('blur', syncTypedCoordinates);
    });
    // Pengetikan/penghapusan Kecamatan, Desa, dan Alamat tidak boleh menutup atau memuat ulang modal.
    ['landDistrict', 'landVillage', 'landAddress'].forEach(id => {
      const input = byId(id);
      if (!input) return;
      input.addEventListener('keydown', event => event.stopPropagation());
      input.addEventListener('input', event => event.stopPropagation());
    });
  }

  window.openLandForm = async function openLandFormV174(id = '') {
    loading(true, id ? 'Memuat data dan peta tanah...' : 'Menyiapkan form data tanah...', 20);
    try {
      let data;
      if (id) {
        data = await server('getTanah', state.token, id);
      } else {
        let next = { id: 'Otomatis saat disimpan' };
        if (navigator.onLine !== false) {
          try { next = await server('getNextTanahId', state.token); } catch (_) {}
        }
        data = { eid: next.id, nama_opd: state.user.opd || '', Status: 'Non-Sertifikat' };
      }
      const maxMb = Number((state.bootstrap && state.bootstrap.maxUploadMb) || 2);
      const body = `<div class="form-grid land-form land-form-v174">
        ${landInput('EID', 'landId', data.eid || 'Otomatis saat disimpan', true, false, 'land-id-auto')}
        ${landInput('Nomor Berangkas', 'landBox', data.no_brangkas || '')}
        ${landInput('OPD', 'landOpd', data.nama_opd || '', false, true)}
        ${landInput('Uraian/Nama Aset', 'landName', data.uraian || '', false, false, 'span-2')}
        ${landInput('Kecamatan', 'landDistrict', data.kecamatan || '')}
        ${landInput('Desa/Kelurahan', 'landVillage', data.desa || '')}
        ${landInput('Alamat/Lokasi', 'landAddress', data.alamat || '', false, false, 'span-2')}
        ${landInput('Luas', 'landArea', data.luas || '')}
        ${landInput('Penggunaan', 'landUse', data.penggunaan || '')}
        ${landInput('Nomor Bukti', 'landProof', data.no_bukti || '')}
        ${landInput('Tahun', 'landYear', data.tahun || '')}
        ${landInput('Harga', 'landPrice', data.harga || '')}
        <div class="field"><label>Status Sertifikat *</label><select id="landCert" class="select"><option>Bersertifikat</option><option>Non-Sertifikat</option></select></div>
        ${landInput('Nomor Sertifikat', 'landCertNo', data.NOMOR_SERTIFIKAT || '')}
        ${landInput('Jenis Hak', 'landRight', data.JENIS_HAK || '')}
        ${landInput('Latitude', 'landLat', data.lat ?? '')}
        ${landInput('Longitude', 'landLng', data.lng ?? '')}
        <div class="field span-3 land-location-panel-v174">
          <div class="land-location-title-v174"><div><label>Pilih Lokasi Aset Tanah</label><div class="muted">Cari nama lokasi, gunakan lokasi perangkat, klik peta, atau geser marker. Setiap perubahan titik otomatis memperbarui koordinat dan kolom lokasi.</div></div><button type="button" class="btn btn-primary" id="takeGpsBtn">⌖ Gunakan Lokasi Perangkat</button></div>
          <div class="land-location-search-v174"><input id="landMapSearchV174" class="input" placeholder="Cari jalan, desa/kelurahan, kecamatan, kantor, atau alamat di Kabupaten Wajo"><button type="button" class="btn btn-light" id="landMapSearchBtnV174">Cari di Peta</button></div>
          <div id="landMapResultsV174" class="land-location-results-v174"></div>
          <div id="landEditorMapV174" class="land-map land-editor-map"></div>
          <div id="landLocationStatusV174" class="land-location-status-v174">Kolom Kecamatan, Desa/Kelurahan, dan Alamat tetap dapat dikoreksi manual tanpa menutup form.</div>
        </div>
        <div class="field span-2"><label>Keterangan</label><textarea id="landNotes" class="textarea">${escapeHtml(data.keterangan || '')}</textarea></div>
        <div class="field"><label>Foto Tanah (maks. ${maxMb} MB)</label><input id="landPhoto" class="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
        <div class="field"><label>Sertifikat (maks. ${maxMb} MB)</label><input id="landCertificate" class="input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
      </div>`;
      showLandEditorModal(id ? 'Edit Data Tanah' : 'Tambah Data Tanah', body, '<button type="button" class="btn btn-light" id="cancelLandEditorV174">Batal</button><button type="button" class="btn btn-primary" id="saveLandBtn">Simpan</button>');
      byId('cancelLandEditorV174').onclick = () => window.closeModal();
      byId('landCert').value = String(data.Status || '').toUpperCase().includes('NON') ? 'Non-Sertifikat' : 'Bersertifikat';
      bindEditorEvents();
      setTimeout(() => initEditorMap(data.lat, data.lng), 120);
    } catch (error) {
      toast(typeof errorText === 'function' ? errorText(error) : String(error?.message || error), 'error');
    } finally {
      loading(false);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('*').forEach(element => {
      if (element.childNodes.length === 1 && element.firstChild.nodeType === 3 && /Frontend V17\.3/.test(element.textContent)) {
        element.textContent = 'Frontend V17.4';
      }
    });
  });
})();

/* V17.5 — kartu responsif tanah/kendaraan dan perbaikan scroll modal tanah */
(() => {
  'use strict';

  const byIdV175 = id => document.getElementById(id);
  const textV175 = value => String(value == null ? '' : value).trim();

  function getHeadersV175(table) {
    return Array.from(table.querySelectorAll('thead th')).map(th => textV175(th.textContent));
  }

  function normalizeLabelV175(label) {
    return textV175(label).replace(/\s+/g, ' ');
  }

  function isFullFieldV175(label) {
    return /URAIAN|NAMA BARANG|NAMA OPD|OPD TERINVENTARIS|PENANGGUNG JAWAB|LOKASI|KOORDINAT|DOKUMEN/i.test(label);
  }

  function preferredTitleIndexV175(headers, kind) {
    const patterns = kind === 'land'
      ? [/^URAIAN$/i, /NAMA ASET/i]
      : [/NAMA BARANG/i, /JENIS\/MODEL/i];
    for (const pattern of patterns) {
      const index = headers.findIndex(header => pattern.test(header));
      if (index >= 0) return index;
    }
    return 0;
  }

  function preferredSubtitleV175(cells, headers, kind) {
    const labels = kind === 'land'
      ? [/NO\. BERANGKAS/i, /NAMA OPD/i]
      : [/NOMOR BERANGKAS/i, /NOMOR POLISI/i];
    return labels.map(pattern => {
      const index = headers.findIndex(header => pattern.test(header));
      if (index < 0 || !cells[index]) return '';
      const value = textV175(cells[index].textContent);
      return value && value !== '-' ? `${headers[index]}: ${value}` : '';
    }).filter(Boolean).join(' · ');
  }

  function bindLandCardActionsV175(container) {
    container.querySelectorAll('[data-land-edit]').forEach(button => {
      button.onclick = () => window.openLandForm(button.dataset.landEdit);
    });
    container.querySelectorAll('[data-land-delete]').forEach(button => {
      button.onclick = () => window.deleteLandRecord(button.dataset.landDelete);
    });
    container.querySelectorAll('[data-land-map]').forEach(button => {
      button.onclick = () => window.openLandPoint(button.dataset.landMap);
    });
  }

  function createCardsFromTableV175(table, kind) {
    const headers = getHeadersV175(table);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const cards = document.createElement('div');
    cards.className = `mobile-record-cards ${kind}-mobile-cards`;
    cards.dataset.mobileCardsFor = kind;

    if (!rows.length) {
      cards.innerHTML = '<div class="mobile-record-empty">Data tidak ditemukan.</div>';
      return cards;
    }

    rows.forEach(row => {
      const cells = Array.from(row.children);
      if (!cells.length) return;
      if (cells.length === 1 && (cells[0].colSpan > 1 || cells[0].classList.contains('empty'))) {
        const empty = document.createElement('div');
        empty.className = 'mobile-record-empty';
        empty.textContent = textV175(cells[0].textContent) || 'Data tidak ditemukan.';
        cards.appendChild(empty);
        return;
      }

      const titleIndex = preferredTitleIndexV175(headers, kind);
      const actionIndex = headers.findIndex(header => /^AKSI$/i.test(header));
      const card = document.createElement('article');
      card.className = 'mobile-record-card';

      const head = document.createElement('div');
      head.className = 'mobile-record-card-head';
      const title = document.createElement('div');
      title.className = 'mobile-record-card-title';
      title.innerHTML = cells[titleIndex] ? cells[titleIndex].innerHTML : '-';
      head.appendChild(title);
      const subtitleText = preferredSubtitleV175(cells, headers, kind);
      if (subtitleText) {
        const subtitle = document.createElement('div');
        subtitle.className = 'mobile-record-card-subtitle';
        subtitle.textContent = subtitleText;
        head.appendChild(subtitle);
      }
      card.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'mobile-record-card-grid';
      cells.forEach((cell, index) => {
        if (index === titleIndex || index === actionIndex) return;
        const label = normalizeLabelV175(cell.getAttribute('data-label') || headers[index] || `Kolom ${index + 1}`);
        const valueText = textV175(cell.textContent);
        if (!valueText && !cell.querySelector('a,button,.badge,.doc-count')) return;
        const field = document.createElement('div');
        field.className = `mobile-record-field${isFullFieldV175(label) ? ' full-mobile' : ''}`;
        const labelElement = document.createElement('div');
        labelElement.className = 'mobile-record-label';
        labelElement.textContent = label;
        const value = document.createElement('div');
        value.className = 'mobile-record-value';
        value.innerHTML = cell.innerHTML;
        field.append(labelElement, value);
        grid.appendChild(field);
      });
      card.appendChild(grid);

      if (actionIndex >= 0 && cells[actionIndex]) {
        const actions = document.createElement('div');
        actions.className = 'mobile-record-actions';
        actions.innerHTML = cells[actionIndex].innerHTML;
        card.appendChild(actions);
      }
      cards.appendChild(card);
    });

    if (kind === 'land') bindLandCardActionsV175(cards);
    return cards;
  }

  function syncCardsV175() {
    const targets = [
      { table: document.querySelector('.land-table'), kind: 'land' },
      { table: document.querySelector('.vehicle-table'), kind: 'vehicle' }
    ];
    targets.forEach(({ table, kind }) => {
      if (!table) return;
      const wrap = table.closest('.table-wrap');
      if (!wrap || !wrap.parentElement) return;
      const existing = wrap.parentElement.querySelector(`:scope > .mobile-record-cards[data-mobile-cards-for="${kind}"]`);
      if (existing) existing.remove();
      wrap.insertAdjacentElement('afterend', createCardsFromTableV175(table, kind));
    });
  }

  let scheduledV175 = false;
  function scheduleSyncV175() {
    if (scheduledV175) return;
    scheduledV175 = true;
    requestAnimationFrame(() => {
      scheduledV175 = false;
      syncCardsV175();
    });
  }

  const contentV175 = byIdV175('content');
  if (contentV175) {
    const observerV175 = new MutationObserver(mutations => {
      if (mutations.some(mutation => Array.from(mutation.addedNodes).some(node => node.nodeType === 1 && !node.classList?.contains('mobile-record-cards')))) {
        scheduleSyncV175();
      }
    });
    observerV175.observe(contentV175, { childList: true, subtree: true });
  }
  window.addEventListener('resize', scheduleSyncV175, { passive: true });
  window.addEventListener('DOMContentLoaded', scheduleSyncV175);

  const originalShowLandEditorModalV175 = window.showLandEditorModal;
  if (typeof originalShowLandEditorModalV175 === 'function') {
    window.showLandEditorModal = function showLandEditorModalV175(title, body, footer) {
      originalShowLandEditorModalV175(title, body, footer);
      document.documentElement.classList.add('land-editor-open');
      document.body.classList.add('land-editor-open');
      const modalBody = document.querySelector('.land-editor-modal-v174 .modal-body');
      if (modalBody) {
        modalBody.scrollTop = 0;
        modalBody.setAttribute('tabindex', '0');
      }
    };
  }

  const originalCloseModalV175 = window.closeModal;
  window.closeModal = function closeModalV175() {
    document.documentElement.classList.remove('land-editor-open');
    document.body.classList.remove('land-editor-open');
    if (typeof originalCloseModalV175 === 'function') return originalCloseModalV175();
    const root = byIdV175('modalRoot');
    if (root) root.innerHTML = '';
  };

  // Pantau modal karena showLandEditorModal V17.4 adalah fungsi lokal di dalam modul.
  const modalRootV175 = byIdV175('modalRoot');
  if (modalRootV175) {
    const syncLandModalStateV175 = () => {
      const editorModal = modalRootV175.querySelector('.land-editor-modal-v174');
      document.documentElement.classList.toggle('land-editor-open', Boolean(editorModal));
      document.body.classList.toggle('land-editor-open', Boolean(editorModal));
      if (editorModal) {
        const modalBody = editorModal.querySelector('.modal-body');
        if (modalBody && !modalBody.dataset.scrollPreparedV175) {
          modalBody.dataset.scrollPreparedV175 = '1';
          modalBody.scrollTop = 0;
          modalBody.setAttribute('tabindex', '0');
        }
      }
    };
    new MutationObserver(syncLandModalStateV175).observe(modalRootV175, { childList: true, subtree: true });
    syncLandModalStateV175();
  }

  document.querySelectorAll('*').forEach(element => {
    if (element.childNodes.length === 1 && element.firstChild.nodeType === 3 && /Frontend V17\.4/.test(element.textContent)) {
      element.textContent = 'Frontend V17.5';
    }
  });
})();

/* V17.6 — pengaman universal scroll untuk seluruh modal/form */
(() => {
  'use strict';
  const VERSION = '17.6';
  const root = document.getElementById('modalRoot');
  let lastPreparedModal = null;

  function syncUniversalModalScrollV176() {
    if (!root) return;
    const backdrop = root.querySelector('.modal-backdrop');
    const modal = root.querySelector('.modal');
    const body = modal && modal.querySelector(':scope > .modal-body');

    if (!modal || !body) {
      document.documentElement.classList.remove('modal-open-v176');
      document.body.classList.remove('modal-open-v176');
      lastPreparedModal = null;
      return;
    }

    backdrop && backdrop.classList.add('universal-modal-backdrop-v176');
    modal.classList.add('universal-scroll-modal-v176');
    document.documentElement.classList.add('modal-open-v176');
    document.body.classList.add('modal-open-v176');

    if (lastPreparedModal !== modal) {
      lastPreparedModal = modal;
      body.scrollTop = 0;
      body.setAttribute('tabindex', '0');
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label', 'Isi formulir yang dapat digulir');

      // Mencegah sentuhan pada isi form menyeret halaman di belakang modal.
      body.addEventListener('touchmove', event => {
        event.stopPropagation();
      }, { passive: true });

      // Setelah keyboard HP tertutup/terbuka, pertahankan bidang aktif di area terlihat.
      body.addEventListener('focusin', event => {
        const target = event.target;
        if (!target || !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
        window.setTimeout(() => {
          try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        }, 260);
      });
    }
  }

  if (root) {
    new MutationObserver(syncUniversalModalScrollV176).observe(root, {
      childList: true,
      subtree: true
    });
    root.addEventListener('click', () => window.setTimeout(syncUniversalModalScrollV176, 0));
  }

  // Tetap bekerja untuk modal yang dibuat setelah fungsi async selesai.
  document.addEventListener('DOMContentLoaded', syncUniversalModalScrollV176, { once: true });
  window.addEventListener('resize', syncUniversalModalScrollV176, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(syncUniversalModalScrollV176, 180), { passive: true });
  window.prepareUniversalModalScrollV176 = syncUniversalModalScrollV176;
  window.V17_FRONTEND_VERSION = VERSION;
})();
/* SITKAW WEB V18.0.5 — cache-read, online-write, delta sync per perubahan */
(() => {
  'use strict';

  const VERSION = '18.0.5';
  const DB_NAME = 'aset-wajo-web-local-first';
  const DB_VERSION = 1;
  const MAX_GPS_ACCURACY = 35;
  const TARGET_GPS_ACCURACY = 20;
  const SNAPSHOT_PAGE_SIZE = 1000;
  const SYNC_BATCH_SIZE = 5;
  const REFRESH_CHECK_MS = 2 * 60 * 1000;
  const DELTA_PAGE_SIZE = 200;
  const DELTA_CURSOR_META = 'deltaCursorV1862';
  const MASTER_REVISION_META = 'masterRevisionV1862';
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

  function normalizeRecordAliases(module, row) {
    const data = row && typeof row === 'object' ? {...row} : {};
    if (module === 'TANAH') {
      const namaOpd = String(data.nama_opd ?? '').trim();
      const opd = String(data.opd ?? '').trim();
      if (!opd && namaOpd) data.opd = namaOpd;
      if (!namaOpd && opd) data.nama_opd = opd;
      const eid = String(data.eid ?? '').trim();
      const id = String(data.id ?? '').trim();
      if (!id && eid) data.id = eid;
      if (!eid && id) data.eid = id;
      if (data.status == null && data.Status != null) data.status = data.Status;
      if (data.Status == null && data.status != null) data.Status = data.status;
    }
    return data;
  }


  async function putRecords(module, rows, source='server', detail=false) {
    if (!Array.isArray(rows) || !rows.length) return;
    await idb('records', 'readwrite', store => {
      for (const rawRow of rows) {
        const row = normalizeRecordAliases(module, rawRow);
        const id = recordId(module, row);
        if (!id) continue;
        store.put({key:`${module}:${id}`, module, id, source, detail:!!detail, data:row, updatedAt:Date.now()});
      }
    });
    if (memoryRecords[module]) {
      const map = new Map(memoryRecords[module].map(row => [recordId(module, row), row]));
      for (const rawRow of rows) {
        const row = normalizeRecordAliases(module, rawRow);
        const id = recordId(module, row);
        if (id) map.set(id, row);
      }
      memoryRecords[module] = [...map.values()];
    }
  }

  async function getRecord(module, id, requireDetail=false) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(`${module}:${id}`);
      req.onsuccess = () => {
        const item = req.result || null;
        if (!item) return resolve(null);
        if (requireDetail && !item.detail) return resolve(null);
        resolve(normalizeRecordAliases(module, item.data || {}));
      };
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
      req.onsuccess = () => resolve((req.result || []).map(item => normalizeRecordAliases(module, item.data)));
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
          if (id) store.put({key:`${module}:${id}`, module, id, source:'server', detail:false, data:row, updatedAt:Date.now()});
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

  function hasVehicleBpkbLocal(row={}) {
    const raw = String(row.nomorBpkb ?? row.NOMOR_BPKB ?? '').trim();
    if (!raw) return false;
    const normalized = raw.toUpperCase().replace(/\s+/g,' ');
    return !new Set(['-','0','N/A','NA','NULL','NIHIL','TIDAK ADA','BELUM ADA','TIDAK ADA BPKB','BELUM ADA BPKB']).has(normalized);
  }

  function filterRows(module, rows, options={}) {
    const search = String(options.search || '').trim().toLowerCase();
    const rawFilter = String(options.opd || options.filter || '').trim();
    const filter = rawFilter.toLowerCase();
    const filterUpper = rawFilter.toUpperCase();
    let filtered = rows.filter(row => !row._deleted);
    if (search) filtered = filtered.filter(row => JSON.stringify(row).toLowerCase().includes(search));
    if (rawFilter) {
      if (module === 'KENDARAAN') {
        if (filterUpper === 'BPKB_ADA') filtered = filtered.filter(hasVehicleBpkbLocal);
        else if (filterUpper === 'BPKB_TIDAK_ADA') filtered = filtered.filter(row => !hasVehicleBpkbLocal(row));
        else filtered = filtered.filter(row => {
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
    const out = {total:rows.length, active:0, expired:0, newData:0, noDate:0, withBpkb:0, withoutBpkb:0, vehicleTypes:[], usageStatuses:[]};
    for (const row of rows) {
      if (hasVehicleBpkbLocal(row)) out.withBpkb++; else out.withoutBpkb++;
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
    if (fn === 'getKendaraan') return await getRecord('KENDARAAN', String(args[1] || ''), true);
    if (fn === 'listTanah') return await listLocalRecords('TANAH', {page:args[1], pageSize:args[2], search:args[3], filter:args[4]});
    if (fn === 'getTanah') return await getRecord('TANAH', String(args[1] || ''), true);
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
    if (fn === 'getKendaraan') await putRecords('KENDARAAN', [result], 'server', true);
    if (fn === 'listTanah') await putRecords('TANAH', result.rows || [], 'server');
    if (fn === 'getTanah') await putRecords('TANAH', [result], 'server', true);
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

  function deltaMetaKey() { return key(userScope(), DELTA_CURSOR_META); }
  function masterRevisionMetaKey() { return key(userScope(), MASTER_REVISION_META); }

  async function refreshMasterDelta(remoteRevision) {
    const revision = Number(remoteRevision || 0);
    const localRevision = Number(await getMeta(masterRevisionMetaKey(), 0));
    if (!revision || revision === localRevision) return false;
    const master = await cloudServer('getOfflineMasterV182', state.token);
    if (master?.bootstrapPatch) {
      Object.assign(state.bootstrap, master.bootstrapPatch);
      state.user = state.bootstrap.user || state.user;
      await putCache(key(userScope(), 'bootstrap'), state.bootstrap);
      if (typeof setTop === 'function') setTop();
    }
    await putMeta(masterRevisionMetaKey(), revision);
    return true;
  }

  async function applyDeltaChange(module, change) {
    const action = String(change?.action || 'UPSERT').toUpperCase();
    const id = String(change?.recordId || change?.payload?.id || change?.payload?.eid || '').trim();
    if (!id) return false;
    if (action === 'DELETE') {
      await deleteRecordFromCache(module, id);
      return true;
    }
    const payload = {...(change.payload || {})};
    if (module === 'TANAH') {
      payload.eid = String(payload.eid || payload.id || id);
      payload.id = String(payload.id || payload.eid || id);
    } else payload.id = String(payload.id || id);
    payload._localPending = false;
    payload._deltaSeq = Number(change.seq || 0);
    payload._deltaChangedAt = change.changedAt || nowIso();
    await putRecords(module, [payload], 'server', true);
    return true;
  }

  async function rerenderAfterDelta(module, changedCount) {
    if (!changedCount) return;
    const dashboard = await buildLocalDashboard(module);
    await putCache(key(userScope(), 'dashboard'), dashboard);
    if (state.bootstrap) state.bootstrap.dashboard = dashboard;
    try {
      if (module === 'KENDARAAN') {
        if (state.view === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
        else if (state.view === 'vehicles' && typeof loadVehicles === 'function') await loadVehicles();
      } else {
        if (state.view === 'land-dashboard' && typeof loadLandDashboard === 'function') await loadLandDashboard();
        else if (state.view === 'land-data' && typeof loadLandList === 'function') await loadLandList();
        else if (state.view === 'land-map' && typeof loadLandMapPage === 'function') await loadLandMapPage();
      }
    } catch (error) { console.warn('Render setelah delta:', error); }
  }

  async function establishDeltaBaseline() {
    const syncState = await cloudServer('getSyncStateV1862', state.token);
    await putMeta(deltaMetaKey(), Number(syncState.cursor || 0));
    await putMeta(masterRevisionMetaKey(), Number(syncState.masterRevision || 0));
    await putMeta(key(userScope(), 'deltaBaselineAt'), Date.now());
    return syncState;
  }

  async function syncDeltaChanges(force=false) {
    if (!navigator.onLine || !window.state?.token || !cloudServer || snapshotRunning) return {changes:0};
    const now = Date.now();
    if (!force && now - lastRevisionCheck < REFRESH_CHECK_MS) return {changes:0, skipped:true};
    lastRevisionCheck = now;

    const existingCursor = await getMeta(deltaMetaKey(), null);
    if (existingCursor === null || existingCursor === undefined) {
      updateStatus('Migrasi cache delta satu kali', 'syncing');
      await downloadSnapshot(true);
      return {changes:0, baseline:true};
    }

    let cursor = Math.max(0, Number(existingCursor || 0));
    let totalChanges = 0;
    let page = 0;
    let masterChanged = false;
    updateStatus('Memeriksa perubahan data', 'syncing');
    try {
      while (page++ < 200) {
        const result = await cloudServer('getSyncDeltaV186', state.token, cursor, DELTA_PAGE_SIZE);
        if (result?.resetRequired) {
          updateStatus('Riwayat delta terlalu lama · memuat ulang', 'pending');
          await downloadSnapshot(true);
          return {changes:totalChanges, reset:true};
        }
        masterChanged = (await refreshMasterDelta(result?.masterRevision)) || masterChanged;
        const changes = Array.isArray(result?.changes) ? result.changes : [];
        for (const change of changes) {
          if (await applyDeltaChange(moduleName(), change)) totalChanges++;
        }
        cursor = Math.max(cursor, Number(result?.cursor || cursor));
        await putMeta(deltaMetaKey(), cursor);
        await putMeta(key(userScope(), 'lastDeltaAt'), Date.now());
        if (changes.length) updateStatus(`Mengambil perubahan ${totalChanges} data`, 'syncing');
        if (!result?.hasMore) break;
        await sleep(0);
      }
      await rerenderAfterDelta(moduleName(), totalChanges);
      const text = totalChanges
        ? `${totalChanges} perubahan diterapkan`
        : (masterChanged ? 'Master diperbarui' : 'Data sudah terbaru');
      updateStatus(text, 'ready');
      return {changes:totalChanges, cursor, masterChanged};
    } catch (error) {
      console.warn('Delta sync web gagal:', error);
      if (window.WebFastV180?.isSessionExpired?.(error)) window.WebFastV180.handleSessionExpired(error);
      else updateStatus('Pemeriksaan perubahan tertunda', 'error');
      throw error;
    }
  }

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
        await putRecords('KENDARAAN', [row], 'server', true);
      } else if (fn === 'deleteKendaraan') {
        await deleteRecordFromCache('KENDARAAN', String(args[1] || ''));
      } else if (fn === 'saveTanah' && (result?.id || result?.eid)) {
        const id = result.id || result.eid;
        const row = await cloudServer('getTanah', state.token, id);
        await putRecords('TANAH', [row], 'server', true);
      } else if (fn === 'deleteTanah') {
        await deleteRecordFromCache('TANAH', String(args[1] || ''));
      } else if (fn === 'saveSurat') {
        const vehicleId = String(args[1]?.vehicleId || '');
        if (vehicleId) {
          const row = await cloudServer('getKendaraan', state.token, vehicleId).catch(() => null);
          if (row) await putRecords('KENDARAAN', [row], 'server', true);
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
        setTimeout(() => syncDeltaChanges(true).catch(error => console.warn('Delta setelah simpan:', error)), 0);
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

      let optimized = true;
      let info;
      try {
        info = await cloudServer('getWebSnapshotInfoV180', state.token);
      } catch (error) {
        optimized = false;
        info = await cloudServer('getOfflineSnapshotInfoV18', state.token);
      }

      const totalRows = Math.max(1, Number(info.totalRows || info.sourceRows || 1));
      const freshRows = [];
      let cursor = optimized ? '0' : '1';
      let received = 0;
      while (cursor !== '') {
        const page = optimized
          ? await cloudServer('getWebSnapshotPageV180', state.token, cursor, SNAPSHOT_PAGE_SIZE)
          : await cloudServer('getOfflineSnapshotV18', state.token, cursor, SNAPSHOT_PAGE_SIZE);
        freshRows.push(...(page.rows || []));
        received += (page.rows || []).length;
        const progressBase = Number(page.scanned || received);
        const pct = page.done ? 99 : Math.min(98, Math.max(1, Math.round((progressBase / totalRows) * 100)));
        syncView.current = `Download ${module} · ${received} data`;
        syncView.percent = pct;
        updateStatus(`Download ${received} data · ${pct}%`, 'syncing');
        cursor = page.nextCursor == null ? '' : String(page.nextCursor);
        if (page.done) cursor = '';
        await sleep(0);
      }
      await replaceServerRecords(module, freshRows);
      const dashboard = await buildLocalDashboard(module);
      await putCache(key(userScope(), 'dashboard'), dashboard);
      if (state.bootstrap) state.bootstrap.dashboard = dashboard;
      await establishDeltaBaseline();
      await putMeta(key(userScope(), 'snapshotReady'), true);
      await putMeta(key(userScope(), 'snapshotAt'), Date.now());
      updateStatus(`Cache siap · ${freshRows.length} data`, 'ready');
      if (state.view === 'dashboard' && typeof renderDashboard === 'function') renderDashboard();
    } catch (error) {
      console.warn('Download cache web gagal:', error);
      if (window.WebFastV180?.isSessionExpired?.(error)) window.WebFastV180.handleSessionExpired(error);
      else updateStatus('Cache data belum lengkap', 'error');
    } finally {
      snapshotRunning = false;
    }
  }

  async function refreshIfChanged(force=false) {
    return await syncDeltaChanges(force);
  }

  async function showDeltaSyncPanel() {
    const cursor = Number(await getMeta(deltaMetaKey(), 0));
    const lastAt = Number(await getMeta(key(userScope(), 'lastDeltaAt'), 0));
    const lastText = lastAt ? new Date(lastAt).toLocaleString('id-ID') : 'Belum pernah';
    const content = `
      <div style="display:grid;gap:10px">
        <div class="offline-note"><b>Sinkronisasi perubahan</b><br>Cursor perangkat: ${cursor}<br>Terakhir diperiksa: ${escText(lastText)}</div>
        <div class="muted">Sinkron perubahan hanya mengambil data yang ditambah, diedit, atau dihapus setelah cursor terakhir. Download penuh hanya digunakan untuk pemasangan awal, cursor kedaluwarsa, atau perubahan manual langsung pada Spreadsheet.</div>
      </div>`;
    showModal('Sinkronisasi Data Web', content,
      '<button class="btn btn-light" id="deltaFullRefreshBtn">Download Ulang Penuh</button><button class="btn btn-primary" id="deltaRefreshBtn">Ambil Perubahan</button>', 'modal');
    const refresh = document.getElementById('deltaRefreshBtn');
    const full = document.getElementById('deltaFullRefreshBtn');
    if (refresh) refresh.onclick = async () => { closeModal(); await syncDeltaChanges(true); };
    if (full) full.onclick = async () => {
      if (!confirm('Download ulang seluruh data? Gunakan hanya jika data Spreadsheet diubah langsung atau cache bermasalah.')) return;
      closeModal(); await downloadSnapshot(true);
    };
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
      node.title = 'Klik untuk sinkronisasi perubahan atau download ulang penuh.';
      node.onclick = async () => {
        if (!navigator.onLine) { toast('Perangkat offline. Data cache tetap dapat dilihat, tetapi pembaruan memerlukan internet.', 'error'); return; }
        await showDeltaSyncPanel();
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
            updateStatus(navigator.onLine ? 'Cache siap · delta aktif' : 'Offline · mode baca', navigator.onLine ? 'ready' : 'pending');
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
  window.WebCacheOnlineV180 = {version:VERSION, refresh:() => syncDeltaChanges(true), download:() => downloadSnapshot(true), ensure:() => downloadSnapshot(false), delta:() => syncDeltaChanges(true), panel:showDeltaSyncPanel};
  window.WebCacheOnlineV179 = window.WebCacheOnlineV180;
})();
/* WEB V18.0 — startup cepat, navigasi tanpa blocking, cache-read / online-write */
(() => {
  'use strict';
  const VERSION = '18.0.1';
  const assetName = () => String(window.state?.asset || 'KENDARAAN').toUpperCase();
  const lastUserKey = () => `aset_wajo_web_v180_last_${assetName()}`;
  const cacheKey = username => `aset_wajo_web_v180_${assetName()}_${String(username || '').trim().toUpperCase()}`;
  const readCache = username => {
    try {
      const user = username || window.state?.user?.username || localStorage.getItem(lastUserKey()) || '';
      return user ? JSON.parse(localStorage.getItem(cacheKey(user)) || 'null') : null;
    } catch (_) { return null; }
  };
  const writeCache = () => {
    try {
      if (!window.state?.user || !window.state?.bootstrap) return;
      localStorage.setItem(lastUserKey(), String(state.user.username || ''));
      localStorage.setItem(cacheKey(state.user.username), JSON.stringify({user:state.user, bootstrap:state.bootstrap, savedAt:Date.now()}));
    } catch (_) {}
  };
  const setTop = () => {
    if (!window.state?.user) return;
    const name = state.user.name || state.user.username || '-';
    const role = state.user.role || '-';
    const n = document.getElementById('userMiniName'); if (n) n.textContent = name;
    const r = document.getElementById('userMiniRole'); if (r) r.textContent = role;
    const t = document.getElementById('topUser');
    if (t) {
      let identity = document.getElementById('topUserIdentity');
      if (!identity) {
        identity = document.createElement('span');
        identity.id = 'topUserIdentity';
        t.insertBefore(identity, t.firstChild);
      }
      identity.textContent = `${state.asset} · ${name} · ${role}`;
    }
  };
  const showApp = () => {
    document.getElementById('loginScreen')?.classList.add('hidden');
    document.getElementById('appScreen')?.classList.remove('hidden');
    setTop();
  };
  const setTitle = (title) => { const el=document.getElementById('pageTitle'); if(el) el.textContent=title; };
  const setNav = (attr, view) => document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset[attr] === view));
  const contentError = error => {
    const c=document.getElementById('content');
    if(c) c.innerHTML=`<section class="panel"><div class="panel-body"><div class="danger">${typeof esc==='function'?esc(error?.message||String(error)):String(error)}</div></div></section>`;
  };

  let sessionRedirecting = false;
  const isSessionExpired = error => /sesi login berakhir|session (expired|invalid)|token.*(expired|invalid)/i.test(String(error?.message || error || ''));

  const handleSessionExpired = error => {
    if (sessionRedirecting) return;
    sessionRedirecting = true;
    try { safeStoreRemove('v17_session_' + state.asset); } catch (_) {}
    state.token = '';
    try { if (typeof loading === 'function') loading(false); } catch (_) {}
    try { if (typeof closeModal === 'function') closeModal(); } catch (_) {}

    const app = document.getElementById('appScreen');
    const login = document.getElementById('loginScreen');
    if (app) app.classList.add('hidden');
    if (login) login.classList.remove('hidden');

    const errorBox = document.getElementById('loginError');
    if (errorBox) {
      errorBox.textContent = 'Sesi login telah berakhir. Silakan login kembali. Data yang sudah tersimpan di server tetap aman.';
      errorBox.classList.remove('hidden');
    }
    const password = document.getElementById('loginPassword');
    if (password) password.value = '';
    setTimeout(() => document.getElementById('loginUsername')?.focus(), 50);
  };

  async function navigateFast(view) {
    if (['officers','users','settings'].includes(view) && state.user?.role !== 'ADMIN') return;
    if (state.user?.role === 'USER' && ['letters','officers','users','settings'].includes(view)) {
      toast('Role USER hanya dapat mengelola data kendaraan milik OPD-nya.', 'error'); return;
    }
    state.view=view; setNav('view',view);
    const titles={dashboard:'Dashboard',vehicles:'Data Kendaraan',letters:'Riwayat Surat',officers:'Master Pejabat',users:'Pengguna',settings:'Pengaturan'};
    setTitle(titles[view]||'Aplikasi');
    try {
      if(view==='dashboard') await loadDashboard();
      else if(view==='vehicles'){state.vehiclePage=1;await loadVehicles();}
      else if(view==='letters'){state.letterPage=1;await loadLetters();}
      else if(view==='officers') await loadOfficers();
      else if(view==='users') await loadUsers();
      else if(view==='settings') await loadSettings();
    } catch(error) { contentError(error); }
  }

  async function landNavigateFast(view) {
    state.view='land-'+view; setNav('land',view);
    const titles={dashboard:'Dashboard Tanah',data:'Data Tanah',map:'Peta & Ploting',sync:'Sinkronisasi',users:'Pengguna Tanah',settings:'Pengaturan Tanah'};
    setTitle(titles[view]||'Aset Tanah');
    try {
      if(view==='dashboard') await loadLandDashboard();
      else if(view==='data'){landState.page=1;await loadLandList();}
      else if(view==='map') await loadLandMapPage();
      else if(view==='sync' && typeof renderLandSync==='function') renderLandSync();
      else if(view==='users') await loadLandUsers();
      else if(view==='settings') await loadLandSettings();
    } catch(error) { contentError(error); }
  }

  async function refreshBootstrapInBackground() {
    if (!navigator.onLine || !state.token) return;
    try {
      const fresh = await window.server('getBootstrap', state.token);
      state.bootstrap = {...(state.bootstrap||{}), ...(fresh||{}), user:fresh?.user||state.user};
      state.user = state.bootstrap.user || state.user;
      writeCache(); setTop();
      if (state.asset==='KENDARAAN' && state.view==='dashboard' && typeof renderDashboard==='function') renderDashboard();
    } catch(error) {
      console.warn('Bootstrap latar belakang gagal:', error);
      if (isSessionExpired(error)) handleSessionExpired(error);
    }
  }

  async function startFast() {
    sessionRedirecting = false;
    const cached = readCache();
    if (!state.user && cached?.user) state.user=cached.user;
    if (!state.bootstrap && cached?.bootstrap) state.bootstrap=cached.bootstrap;
    if (state.bootstrap && state.user) state.bootstrap.user=state.user;
    if (!state.user || !state.bootstrap) {
      const fresh = await window.server('getBootstrap', state.token);
      state.bootstrap=fresh; state.user=fresh.user; writeCache();
    }
    showApp();
    if(state.asset==='TANAH') {
      renderLandShell();
      setTop();
      await landNavigateFast('dashboard');
    } else {
      renderVehicleShell();
      setTop();
      await navigateFast('dashboard');
    }
    setTimeout(setTop, 0);
    setTimeout(setTop, 250);
    setTimeout(refreshBootstrapInBackground, 50);
    setTimeout(() => window.WebCacheOnlineV180?.ensure?.(), 300);
    if(state.user?.mustChange) setTimeout(()=>{toast('Password awal harus segera diganti.','error');openPasswordModal(true);},500);
  }

  function install() {
    if (window.__webV1801Installed) return;
    window.__webV1801Installed = true;

    const priorServer = window.server;
    if (typeof priorServer === 'function' && !priorServer.__v1801SessionGuard) {
      const guardedServer = async function guardedServerV1801(fn, ...args) {
        try {
          return await priorServer(fn, ...args);
        } catch (error) {
          if (isSessionExpired(error)) handleSessionExpired(error);
          throw error;
        }
      };
      guardedServer.__v1801SessionGuard = true;
      window.server = guardedServer;
    }

    const legacyLogin = window.handleLogin;
    window.handleLogin = async function handleLoginV180(e) {
      if (navigator.onLine === false) return legacyLogin.apply(this, arguments);
      e.preventDefault();
      document.getElementById('loginError')?.classList.add('hidden');
      loading(true,'Memeriksa login...',18,'Menghubungkan akun; data halaman berikutnya dibaca dari cache browser.');
      try {
        const result = await window.server('login', document.getElementById('loginUsername').value, document.getElementById('loginPassword').value);
        state.token=result.token; state.user=result.user || null;
        try { safeStoreSet('v17_session_'+state.asset,state.token); } catch(_) {}
        const cached=readCache(state.user?.username);
        if(cached?.bootstrap) state.bootstrap={...cached.bootstrap,user:state.user||cached.user};
        await startFast();
      } catch(error) {
        const el=document.getElementById('loginError'); if(el){el.textContent=errorText(error);el.classList.remove('hidden');}
      } finally { loading(false); }
    };

    window.startApp = startFast;
    window.navigate = navigateFast;
    window.landNavigate = landNavigateFast;
    window.WebFastV180={version:VERSION,start:startFast,refreshBootstrap:refreshBootstrapInBackground,isSessionExpired,handleSessionExpired,setTop};
  }

  document.addEventListener('DOMContentLoaded', install, {once:true});
  if(document.readyState!=='loading') install();
})();

/* WEB V18.0.2 CLEAN — pengunci identitas sidebar/topbar dan cache-buster final */
(() => {
  'use strict';
  const VERSION = '18.0.2';
  let lastSignature = '';

  function resolveUser() {
    const current = window.state?.user || window.state?.bootstrap?.user;
    if (current && (current.username || current.name || current.role)) return current;
    try {
      const asset = String(window.state?.asset || sessionStorage.getItem('v17_asset') || 'KENDARAAN').toUpperCase();
      const lastUser = localStorage.getItem(`aset_wajo_web_v180_last_${asset}`) || '';
      const cached = lastUser ? JSON.parse(localStorage.getItem(`aset_wajo_web_v180_${asset}_${lastUser.toUpperCase()}`) || 'null') : null;
      return cached?.user || cached?.bootstrap?.user || null;
    } catch (_) { return null; }
  }

  function applyIdentity() {
    const user = resolveUser();
    if (!user) return false;
    const name = String(user.name || user.nama || user.NAMA || user.username || user.USERNAME || '').trim() || '-';
    const role = String(user.role || user.Role || user.ROLE || '').trim().toUpperCase() || '-';
    const asset = String(window.state?.asset || 'KENDARAAN').toUpperCase();
    const signature = `${asset}|${name}|${role}`;

    const nameEl = document.getElementById('userMiniName');
    const roleEl = document.getElementById('userMiniRole');
    if (nameEl && nameEl.textContent !== name) nameEl.textContent = name;
    if (roleEl && roleEl.textContent !== role) roleEl.textContent = role;

    const top = document.getElementById('topUser');
    if (top) {
      let identity = document.getElementById('topUserIdentityV1802');
      if (!identity) {
        identity = document.createElement('span');
        identity.id = 'topUserIdentityV1802';
        identity.style.marginRight = '8px';
        top.prepend(identity);
      }
      identity.textContent = `${asset} · ${name} · ${role}`;
    }
    lastSignature = signature;
    return true;
  }

  function repeatIdentity() {
    applyIdentity();
    [50, 200, 600, 1500, 3000].forEach(delay => setTimeout(applyIdentity, delay));
  }

  function wrap(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__identityV1802) return;
    const wrapped = async function(...args) {
      const result = await original.apply(this, args);
      repeatIdentity();
      return result;
    };
    wrapped.__identityV1802 = true;
    window[name] = wrapped;
  }

  function install() {
    wrap('startApp');
    wrap('navigate');
    wrap('landNavigate');
    wrap('renderVehicleShell');
    wrap('renderLandShell');
    repeatIdentity();

    const target = document.getElementById('appScreen') || document.documentElement;
    const observer = new MutationObserver(() => {
      const n = document.getElementById('userMiniName');
      const r = document.getElementById('userMiniRole');
      if (!n || !r || n.textContent.trim() === '-' || r.textContent.trim() === '-' || !lastSignature) applyIdentity();
    });
    observer.observe(target, {childList:true, subtree:true});

    window.addEventListener('focus', applyIdentity);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) applyIdentity(); });
    window.WebCleanV1802 = {version:VERSION, applyIdentity};
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
