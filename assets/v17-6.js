/* ASET TANAH DAN KENDARAAN V17.5 */
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
  const validPoint = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180;
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
