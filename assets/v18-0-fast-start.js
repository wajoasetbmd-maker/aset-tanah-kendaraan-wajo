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
