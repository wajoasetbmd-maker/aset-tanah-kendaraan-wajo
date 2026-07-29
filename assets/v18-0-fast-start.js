/* WEB V18.0 — startup cepat, navigasi tanpa blocking, cache-read / online-write */
(() => {
  'use strict';
  const VERSION = '18.0.0';
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
    const t = document.getElementById('topUser'); if (t) t.textContent = `${state.asset} · ${name} · ${role}`;
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
      if (/sesi login berakhir|session/i.test(String(error?.message||error))) {
        try { safeStoreRemove('v17_session_'+state.asset); } catch(_) {}
      }
    }
  }

  async function startFast() {
    const cached = readCache();
    if (!state.user && cached?.user) state.user=cached.user;
    if (!state.bootstrap && cached?.bootstrap) state.bootstrap=cached.bootstrap;
    if (state.bootstrap && state.user) state.bootstrap.user=state.user;
    if (!state.user || !state.bootstrap) {
      const fresh = await window.server('getBootstrap', state.token);
      state.bootstrap=fresh; state.user=fresh.user; writeCache();
    }
    showApp();
    if(state.asset==='TANAH') { renderLandShell(); await landNavigateFast('dashboard'); }
    else { renderVehicleShell(); await navigateFast('dashboard'); }
    setTimeout(refreshBootstrapInBackground, 50);
    setTimeout(() => window.WebCacheOnlineV180?.ensure?.(), 300);
    if(state.user?.mustChange) setTimeout(()=>{toast('Password awal harus segera diganti.','error');openPasswordModal(true);},500);
  }

  function install() {
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
    window.WebFastV180={version:VERSION,start:startFast,refreshBootstrap:refreshBootstrapInBackground};
  }

  document.addEventListener('DOMContentLoaded', install, {once:true});
  if(document.readyState!=='loading') install();
})();
