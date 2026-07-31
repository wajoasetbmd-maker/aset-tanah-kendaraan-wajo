
(function(){
  const visitor=()=>String(window.state?.user?.role||'').toUpperCase()==='PENGUNJUNG';
  window.isSitkawVisitor=visitor;
  function makeReadOnly(root=document){
    if(!visitor())return;
    root.querySelectorAll('input,select,textarea').forEach(el=>{el.disabled=true;el.readOnly=true;});
    root.querySelectorAll('button,a').forEach(el=>{
      const text=(el.textContent+' '+(el.title||'')).toLowerCase();
      if(/tambah|simpan|edit|hapus|surat|upload|pilih file|unduh|download|cetak|print/.test(text)){el.style.display='none';el.setAttribute('aria-hidden','true');}
    });
    root.querySelectorAll('a[download]').forEach(a=>a.removeAttribute('download'));
  }
  const mo=new MutationObserver(()=>makeReadOnly(document));mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('contextmenu',e=>{if(visitor()&&e.target.closest('.attachment-box,.document-viewer,img,iframe,embed'))e.preventDefault();});
  document.addEventListener('keydown',e=>{if(visitor()&&(e.ctrlKey||e.metaKey)&&['s','p','u'].includes(e.key.toLowerCase()))e.preventDefault();});
  ['submitVehicle','submitLand','saveLandUser','saveUser','openLetter','removeVehicle','deleteLandUser','deleteUser'].forEach(name=>{const old=window[name];if(!old)return;window[name]=function(){if(visitor()){window.toast?.('Role PENGUNJUNG hanya dapat melihat data.','error');return;}return old.apply(this,arguments);};});
  setInterval(()=>{document.querySelectorAll('select').forEach(sel=>{if(/role/i.test(sel.id||sel.name||''))if(!Array.from(sel.options).some(o=>o.value==='PENGUNJUNG'))sel.add(new Option('PENGUNJUNG','PENGUNJUNG'));});makeReadOnly(document);},700);
})();
