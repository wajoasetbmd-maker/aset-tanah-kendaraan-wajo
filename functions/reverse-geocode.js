const HEADERS = {'content-type':'application/json; charset=UTF-8','cache-control':'public, max-age=86400','x-content-type-options':'nosniff'};

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return response({ok:false,error:'Koordinat tidak valid.'},400);
  }
  try {
    const upstreamUrl = new URL('https://nominatim.openstreetmap.org/reverse');
    upstreamUrl.searchParams.set('format','jsonv2');
    upstreamUrl.searchParams.set('lat',String(lat));
    upstreamUrl.searchParams.set('lon',String(lng));
    upstreamUrl.searchParams.set('zoom','18');
    upstreamUrl.searchParams.set('addressdetails','1');
    const upstream = await fetch(upstreamUrl.toString(), {
      headers:{'accept':'application/json','user-agent':'AsetTanahKendaraanWajo/17.1 (BPKPD Kabupaten Wajo)'}
    });
    if(!upstream.ok) throw new Error('Layanan lokasi tidak merespons.');
    const data = await upstream.json();
    const a = data.address || {};
    return response({
      ok:true,
      displayName:data.display_name || '',
      kecamatan:a.city_district || a.district || a.county || '',
      desa:a.village || a.suburb || a.hamlet || a.town || a.city || '',
      alamat:[a.road,a.neighbourhood,a.suburb,a.village,a.town,a.city].filter(Boolean).filter((v,i,x)=>x.indexOf(v)===i).join(', ')
    });
  } catch (error) {
    return response({ok:false,error:error?.message || 'Lokasi tidak dapat dikenali.'},502);
  }
}

function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:HEADERS});}
