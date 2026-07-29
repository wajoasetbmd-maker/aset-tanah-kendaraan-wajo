/* ASET TANAH DAN KENDARAAN V17.2.1 */
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
    const brand=document.querySelector('.brand b'); if(brand)brand.innerHTML='ASET TANAH<br>KABUPATEN WAJO';
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
      <td data-label="Nama OPD">${esc(r.opd||'-')}</td>
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
    if (brand) brand.innerHTML = 'KENDARAAN DINAS ASET<br>BPKPD WAJO';
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
