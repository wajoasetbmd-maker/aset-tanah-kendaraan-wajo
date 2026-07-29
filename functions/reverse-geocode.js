const HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff'
};

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim();

  if (query) return searchLocation(query);

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return response({ ok: false, error: 'Masukkan nama wilayah atau koordinat yang valid.' }, 400);
  }
  return reverseLocation(lat, lng);
}

async function searchLocation(query) {
  try {
    const upstreamUrl = new URL('https://nominatim.openstreetmap.org/search');
    upstreamUrl.searchParams.set('format', 'jsonv2');
    upstreamUrl.searchParams.set('q', query);
    upstreamUrl.searchParams.set('countrycodes', 'id');
    upstreamUrl.searchParams.set('addressdetails', '1');
    upstreamUrl.searchParams.set('limit', '8');
    upstreamUrl.searchParams.set('dedupe', '1');

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        accept: 'application/json',
        'accept-language': 'id-ID,id;q=0.9,en;q=0.6',
        'user-agent': 'AsetTanahKendaraanWajo/17.3 (BPKPD Kabupaten Wajo)'
      }
    });
    if (!upstream.ok) throw new Error('Layanan pencarian wilayah tidak merespons.');
    const data = await upstream.json();
    const results = (Array.isArray(data) ? data : []).map(item => {
      const address = item.address || {};
      const box = Array.isArray(item.boundingbox) && item.boundingbox.length === 4
        ? [Number(item.boundingbox[0]), Number(item.boundingbox[1]), Number(item.boundingbox[2]), Number(item.boundingbox[3])]
        : null;
      return {
        name: address.county || address.city || address.town || address.village || address.state_district || item.name || item.display_name,
        displayName: item.display_name || '',
        type: item.type || '',
        lat: Number(item.lat),
        lng: Number(item.lon),
        boundingBox: box,
        kecamatan: address.city_district || address.district || address.county || '',
        desa: address.village || address.suburb || address.hamlet || address.town || address.city || '',
        province: address.state || ''
      };
    }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    return response({ ok: true, results });
  } catch (error) {
    return response({ ok: false, error: error?.message || 'Pencarian wilayah gagal.' }, 502);
  }
}

async function reverseLocation(lat, lng) {
  try {
    const upstreamUrl = new URL('https://nominatim.openstreetmap.org/reverse');
    upstreamUrl.searchParams.set('format', 'jsonv2');
    upstreamUrl.searchParams.set('lat', String(lat));
    upstreamUrl.searchParams.set('lon', String(lng));
    upstreamUrl.searchParams.set('zoom', '18');
    upstreamUrl.searchParams.set('addressdetails', '1');

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        accept: 'application/json',
        'accept-language': 'id-ID,id;q=0.9,en;q=0.6',
        'user-agent': 'AsetTanahKendaraanWajo/17.3 (BPKPD Kabupaten Wajo)'
      }
    });
    if (!upstream.ok) throw new Error('Layanan lokasi tidak merespons.');
    const data = await upstream.json();
    const address = data.address || {};
    return response({
      ok: true,
      displayName: data.display_name || '',
      kecamatan: address.city_district || address.district || address.county || '',
      desa: address.village || address.suburb || address.hamlet || address.town || address.city || '',
      alamat: [address.road, address.neighbourhood, address.suburb, address.village, address.town, address.city]
        .filter(Boolean)
        .filter((value, index, array) => array.indexOf(value) === index)
        .join(', ')
    });
  } catch (error) {
    return response({ ok: false, error: error?.message || 'Lokasi tidak dapat dikenali.' }, 502);
  }
}

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}
