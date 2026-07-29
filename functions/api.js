const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

export async function onRequestGet({ env }) {
  return proxyToAppsScript(env, { module: 'KENDARAAN', fn: 'ping', args: [] });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ok:false,error:{code:'REQUEST_INVALID',message:'Permintaan bukan JSON yang valid.'}},400); }

  const moduleName = String(body.module || '').toUpperCase();
  if (!['KENDARAAN','TANAH'].includes(moduleName)) {
    return json({ok:false,error:{code:'MODULE_INVALID',message:'Modul tidak valid.'}},400);
  }
  if (!body.fn || !Array.isArray(body.args)) {
    return json({ok:false,error:{code:'ACTION_INVALID',message:'Nama fungsi atau argumen tidak valid.'}},400);
  }
  return proxyToAppsScript(env, {module:moduleName, fn:String(body.fn), args:body.args});
}

async function proxyToAppsScript(env, payload) {
  if (!env.GAS_BACKEND_URL || !env.GAS_API_KEY) {
    return json({ok:false,error:{code:'PROXY_NOT_CONFIGURED',message:'Variabel GAS_BACKEND_URL dan GAS_API_KEY belum diatur di Cloudflare Pages.'}},500);
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 115000);
    try {
      const upstream = await fetch(env.GAS_BACKEND_URL, {
        method: 'POST',
        headers: {'content-type':'text/plain;charset=UTF-8','accept':'application/json'},
        body: JSON.stringify({...payload, apiKey:env.GAS_API_KEY}),
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); }
      catch {
        return json({ok:false,error:{code:'UPSTREAM_INVALID',message:'Backend Apps Script tidak mengembalikan JSON. Pastikan deployment memakai /exec dan aksesnya Anyone.'},detail:text.slice(0,300)},502);
      }
      return json(data, upstream.ok ? 200 : 502);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200));
    } finally { clearTimeout(timer); }
  }

  const message = lastError && lastError.name === 'AbortError'
    ? 'Backend Apps Script melewati batas waktu.'
    : 'Sambungan ke backend Apps Script gagal. Periksa jaringan lalu coba kembali.';
  return json({ok:false,error:{code:'UPSTREAM_NETWORK',message}},504);
}

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
