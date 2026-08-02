/* SITKAW coordinate map patch WEB V18.0.9
 * - Removes the separate "Peta & Ploting" menu.
 * - Renames plotting status to coordinate availability.
 * - Shows every valid land coordinate on the dashboard map.
 * - Opens land details on the map and provides free external Google Maps navigation.
 */
(() => {
  'use strict';
  const VERSION = 'WEB V18.0.9';
  const PATCH_KEY = '__sitkawCoordinateWebV1809';

  function validNumber(value) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function coordinateOf(record) {
    const lat = validNumber(record?.lat ?? record?.LATITUDE);
    const lng = validNumber(record?.lng ?? record?.LONGITUDE);
    if (lat === null || lng === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return null;
    return {lat, lng};
  }

  function text(value, fallback = '-') {
    const out = String(value ?? '').trim();
    return out || fallback;
  }

  function html(value) {
    if (typeof window.esc === 'function') return window.esc(value ?? '');
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function mapSearchUrl(lat, lng) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  function mapDirectionsUrl(lat, lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=driving`;
  }

  function openExternal(url) {
    try {
      if (window.NativeApp && typeof window.NativeApp.openExternalUrl === 'function') {
        window.NativeApp.openExternalUrl(url);
        return;
      }
    } catch (_) {}
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
  }

  window.openLandNavigation = function openLandNavigation(lat, lng, label = '') {
    const point = coordinateOf({lat, lng});
    if (!point) {
      window.toast?.('Koordinat tanah belum tersedia.', 'error');
      return;
    }
    try {
      if (window.NativeApp && typeof window.NativeApp.openMapNavigation === 'function') {
        window.NativeApp.openMapNavigation(point.lat, point.lng, String(label || 'Lokasi Aset Tanah'));
        return;
      }
    } catch (_) {}
    openExternal(mapDirectionsUrl(point.lat, point.lng));
  };

  window.openLandInMaps = function openLandInMaps(lat, lng, label = '') {
    const point = coordinateOf({lat, lng});
    if (!point) {
      window.toast?.('Koordinat tanah belum tersedia.', 'error');
      return;
    }
    try {
      if (window.NativeApp && typeof window.NativeApp.openMapLocation === 'function') {
        window.NativeApp.openMapLocation(point.lat, point.lng, String(label || 'Lokasi Aset Tanah'));
        return;
      }
    } catch (_) {}
    openExternal(mapSearchUrl(point.lat, point.lng));
  };

  function landPermissions() {
    const permissions = window.state?.bootstrap?.permissions || {};
    const role = String(window.state?.user?.role || '').toUpperCase();
    return {
      canEdit: role !== 'PENGUNJUNG' && permissions.canEdit !== false,
      canDelete: role !== 'PENGUNJUNG' && permissions.canDelete !== false && ['ADMIN','OPERATOR'].includes(role)
    };
  }

  function landRecordFromCaches(id) {
    const match = (window.landState?.rows || []).find(row => String(row.id ?? row.eid) === String(id));
    if (match) return match;
    const point = (window.landState?.dashboard?.points || []).find(row => String(row.id ?? row.eid) === String(id));
    return point || null;
  }

  async function getLandRecord(id) {
    const cached = landRecordFromCaches(id);
    if (cached && coordinateOf(cached) && (cached.uraian || cached.name)) return cached;
    if (typeof window.server !== 'function') return cached;
    try {
      return await window.server('getTanah', window.state?.token, id);
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }

  function locationLine(record) {
    return [record?.alamat, record?.desa, record?.kecamatan].map(value => text(value, '')).filter(Boolean).join(', ') || '-';
  }

  window.openLandPoint = async function openLandPointCoordinateV1865(id) {
    try {
      window.loading?.(true, 'Membuka lokasi tanah...', 30);
      const record = await getLandRecord(id);
      const point = coordinateOf(record);
      if (!point) throw new Error('Koordinat tanah belum tersedia. Edit data lalu isi Latitude dan Longitude atau gunakan GPS perangkat.');
      const name = text(record?.uraian ?? record?.name, 'Aset Tanah');
      const opd = text(record?.nama_opd ?? record?.opd);
      const body = `<div id="singleLandMap" class="land-map"></div>
        <div class="land-location-detail-v1865">
          <h4>${html(name)}</h4>
          <div><b>OPD:</b> ${html(opd)}</div>
          <div><b>Lokasi:</b> ${html(locationLine(record))}</div>
          <div><b>Koordinat:</b> ${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}</div>
          <div class="coordinate-ready-v1865">● Ada Koordinat</div>
        </div>`;
      const footer = `<button class="btn btn-light" onclick="closeModal()">Tutup</button>
        <button class="btn btn-light" id="landOpenMapsV1865">Buka di Google Maps</button>
        <button class="btn btn-primary" id="landNavigateV1865">Navigasi ke Lokasi</button>`;
      window.showModal?.('Lokasi Aset Tanah', body, footer, 'modal-lg');
      setTimeout(() => {
        window.renderLandMap?.('singleLandMap', [{id, name, opd, status: record?.Status ?? record?.status, lat: point.lat, lng: point.lng}]);
        const openButton = document.getElementById('landOpenMapsV1865');
        const navButton = document.getElementById('landNavigateV1865');
        if (openButton) openButton.onclick = () => window.openLandInMaps(point.lat, point.lng, name);
        if (navButton) navButton.onclick = () => window.openLandNavigation(point.lat, point.lng, name);
      }, 60);
    } catch (error) {
      window.toast?.(typeof window.errorText === 'function' ? window.errorText(error) : String(error?.message || error), 'error');
    } finally {
      window.loading?.(false);
    }
  };

  function popupContent(point) {
    const node = document.createElement('div');
    node.className = 'land-map-popup-v1865';
    const coord = coordinateOf(point);
    node.innerHTML = `<b>${html(point?.name || point?.uraian || 'Aset Tanah')}</b>
      <div>${html(point?.opd || point?.nama_opd || '-')}</div>
      <div>${coord ? `${coord.lat.toFixed(7)}, ${coord.lng.toFixed(7)}` : '-'}</div>`;
    if (coord) {
      const actions = document.createElement('div');
      actions.className = 'land-map-popup-actions-v1865';
      if (point?.id || point?.eid) {
        const detail = document.createElement('button');
        detail.type = 'button';
        detail.textContent = 'Lihat Data';
        detail.onclick = () => window.openLandPoint(point.id || point.eid);
        actions.appendChild(detail);
      }
      const route = document.createElement('button');
      route.type = 'button';
      route.textContent = 'Navigasi';
      route.onclick = () => window.openLandNavigation(coord.lat, coord.lng, point?.name || point?.uraian || 'Aset Tanah');
      actions.appendChild(route);
      node.appendChild(actions);
    }
    return node;
  }

  window.renderLandMap = async function renderLandMapCoordinateV1865(containerId, points) {
    const host = document.getElementById(containerId);
    if (!host) return;
    const valid = (Array.isArray(points) ? points : []).filter(point => coordinateOf(point));
    if (!valid.length) {
      host.innerHTML = '<div class="empty land-map-empty-v1865">Belum ada aset tanah yang memiliki koordinat.</div>';
      return;
    }
    let leafletReady = !!window.L;
    if (!leafletReady && typeof window.ensureLeaflet === 'function') {
      try { leafletReady = await window.ensureLeaflet(); } catch (_) { leafletReady = false; }
    }
    if (!leafletReady || !window.L) {
      host.innerHTML = `<div class="land-coordinate-list-v1865">${valid.slice(0, 500).map(point => {
        const coord = coordinateOf(point);
        return `<button type="button" data-land-fallback-id="${html(point.id || point.eid || '')}" data-lat="${coord.lat}" data-lng="${coord.lng}" data-name="${html(point.name || point.uraian || 'Aset Tanah')}"><b>${html(point.name || point.uraian || 'Aset Tanah')}</b><span>${coord.lat.toFixed(7)}, ${coord.lng.toFixed(7)}</span></button>`;
      }).join('')}</div>`;
      host.querySelectorAll('[data-land-fallback-id]').forEach(button => {
        button.onclick = () => {
          const id = button.dataset.landFallbackId;
          if (id) window.openLandPoint(id);
          else window.openLandInMaps(Number(button.dataset.lat), Number(button.dataset.lng), button.dataset.name || 'Aset Tanah');
        };
      });
      return;
    }

    if (window.landState?.map) {
      try { window.landState.map.remove(); } catch (_) {}
    }
    host.innerHTML = '';
    const map = window.L.map(containerId, {zoomControl:true, preferCanvas:true}).setView([-4.11, 120.03], 10);
    if (window.landState) window.landState.map = map;
    const tile = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19,
      attribution:'&copy; OpenStreetMap contributors'
    });
    tile.on('tileerror', () => host.classList.add('map-offline'));
    tile.addTo(map);
    const bounds = [];
    const useCircle = valid.length > 350;
    valid.forEach(point => {
      const coord = coordinateOf(point);
      const marker = useCircle
        ? window.L.circleMarker([coord.lat, coord.lng], {radius:6, weight:2, fillOpacity:.85})
        : window.L.marker([coord.lat, coord.lng]);
      marker.addTo(map).bindPopup(popupContent(point), {maxWidth:280});
      bounds.push([coord.lat, coord.lng]);
    });
    if (bounds.length === 1) map.setView(bounds[0], 17);
    else map.fitBounds(bounds, {padding:[24,24], maxZoom:15});
    setTimeout(() => map.invalidateSize(), 80);
  };

  function landRowHtmlCoordinateV1865(record) {
    const documents = [];
    if (record?.fotoUrl) documents.push(`<a class="btn btn-light btn-sm" href="${html(record.fotoUrl)}" target="_blank" rel="noopener">Foto</a>`);
    if (record?.sertifikatUrl) documents.push(`<a class="btn btn-light btn-sm" href="${html(record.sertifikatUrl)}" target="_blank" rel="noopener">Sertifikat</a>`);
    const point = coordinateOf(record);
    const coordinateStatus = point ? 'Ada Koordinat' : 'Belum Ada Koordinat';
    const coordinates = point ? `${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}` : '-';
    const permissions = landPermissions();
    const rowAttrs = point ? ` class="land-row-coordinate-v1865" data-land-point="${html(record.id || record.eid || '')}" title="Klik untuk melihat lokasi dan navigasi"` : '';
    return `<tr${rowAttrs}>
      <td data-label="No. Berangkas">${html(record.noBerangkas || record.no_brangkas || '-')}</td>
      <td data-label="Uraian" class="land-main"><b>${html(record.uraian || '-')}</b></td>
      <td data-label="Nama OPD">${html(record.opd || record.nama_opd || '-')}</td>
      <td data-label="Penggunaan">${html(record.penggunaan || '-')}</td>
      <td data-label="Lokasi" class="location-text">${html(record.kecamatan || '-')}<br>${html(record.desa || '-')}<br><span class="muted">${html(record.alamat || '')}</span></td>
      <td data-label="Luas">${html(record.luas || '-')}</td>
      <td data-label="Tahun">${html(record.tahun || '-')}</td>
      <td data-label="Nomor Sertifikat">${html(record.nomorSertifikat || record.NOMOR_SERTIFIKAT || '-')}</td>
      <td data-label="Status"><span class="badge">${html(record.status || record.Status || '-')}</span><div class="muted ${point ? 'coordinate-ready-v1865' : 'coordinate-empty-v1865'}">${coordinateStatus}</div></td>
      <td data-label="Koordinat" class="coordinate-text">${html(coordinates)}</td>
      <td data-label="Dokumen"><div class="land-doc-links">${documents.join('') || 'Belum ada'}</div></td>
      <td data-label="Aksi" class="land-actions"><div class="icon-actions">
        ${permissions.canEdit ? `<button class="icon-btn" title="Edit" data-land-edit="${html(record.id || record.eid || '')}">✎</button>` : ''}
        ${point ? `<button class="icon-btn land-map-action-v1865" title="Lihat lokasi dan navigasi" data-land-map="${html(record.id || record.eid || '')}">⌖</button>` : `<button class="icon-btn" title="Koordinat belum tersedia" disabled>⌖</button>`}
        ${permissions.canDelete ? `<button class="icon-btn danger-icon" title="Hapus" data-land-delete="${html(record.id || record.eid || '')}">🗑</button>` : ''}
      </div></td>
    </tr>`;
  }

  function updateCoordinateLabels() {
    const dashboard = window.landState?.dashboard || {};
    const mapCount = Array.isArray(dashboard.points) ? dashboard.points.filter(point => coordinateOf(point)).length : Number(dashboard.plotted || dashboard.withCoordinates || 0);
    document.querySelectorAll('[data-land-filter]').forEach(card => {
      const value = String(card.dataset.landFilter || '').toUpperCase();
      const label = card.querySelector('span');
      if (value === 'SUDAH DIPLOTING' && label) label.textContent = 'Ada Koordinat';
      if (value === 'BELUM DIPLOTING' && label) label.textContent = 'Belum Ada Koordinat';
    });
    const select = document.getElementById('landFilter');
    if (select) Array.from(select.options).forEach(option => {
      if (String(option.value).toUpperCase() === 'SUDAH DIPLOTING') option.textContent = 'Ada Koordinat';
      if (String(option.value).toUpperCase() === 'BELUM DIPLOTING') option.textContent = 'Belum Ada Koordinat';
    });
    document.querySelectorAll('.panel-head h3').forEach(title => {
      if (/Peta Koordinat Aset Tanah|Peta\s*&\s*Ploting|Peta Aset Tanah/i.test(title.textContent || '')) title.textContent = 'Peta Lokasi Aset Tanah';
    });
    const map = document.getElementById('landMap');
    if (map) {
      const note = map.parentElement?.querySelector('.muted');
      if (note) note.textContent = `${mapCount} aset memiliki koordinat dan ditampilkan sebagai titik lokasi. Klik titik untuk melihat data atau membuka navigasi.`;
    }
  }

  function removePlottingMenu() {
    document.querySelectorAll('[data-land="map"]').forEach(button => button.remove());
  }

  function bindClickableLandRows() {
    document.querySelectorAll('tr[data-land-point]').forEach(row => {
      if (row.dataset.landPointBound === '1') return;
      row.dataset.landPointBound = '1';
      row.addEventListener('click', event => {
        if (event.target.closest('button,a,input,select,textarea')) return;
        window.openLandPoint(row.dataset.landPoint);
      });
    });
  }

  function installStyles() {
    if (document.getElementById('sitkawCoordinateStyleV1865')) return;
    const style = document.createElement('style');
    style.id = 'sitkawCoordinateStyleV1865';
    style.textContent = `
      .land-row-coordinate-v1865{cursor:pointer}.land-row-coordinate-v1865:hover{background:#eef6ff!important}
      .coordinate-ready-v1865{color:#167443!important;font-weight:700}.coordinate-empty-v1865{color:#9a6700!important;font-weight:700}
      .land-location-detail-v1865{padding:12px 2px 2px;line-height:1.55}.land-location-detail-v1865 h4{margin:0 0 7px;font-size:18px}
      .land-map-popup-actions-v1865{display:flex;gap:7px;margin-top:9px}.land-map-popup-actions-v1865 button{border:0;border-radius:7px;padding:7px 10px;background:#2868a8;color:white;cursor:pointer;font-weight:700}
      .land-coordinate-list-v1865{display:grid;gap:8px;padding:12px;max-height:100%;overflow:auto}.land-coordinate-list-v1865 button{display:flex;justify-content:space-between;gap:12px;text-align:left;border:1px solid #cfdbe8;border-radius:9px;padding:10px;background:white;cursor:pointer}
      .land-map-empty-v1865{display:flex;align-items:center;justify-content:center;height:100%}
      @media(max-width:700px){.modal-foot #landOpenMapsV1865,.modal-foot #landNavigateV1865{width:100%}.land-map-popup-actions-v1865{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);
  }

  function installPatch() {
    if (window[PATCH_KEY]) return;
    window[PATCH_KEY] = {version:VERSION};
    installStyles();

    const originalRenderShell = window.renderLandShell;
    if (typeof originalRenderShell === 'function') {
      window.renderLandShell = function renderLandShellCoordinateV1865(...args) {
        const result = originalRenderShell.apply(this, args);
        removePlottingMenu();
        return result;
      };
    }

    const originalNavigate = window.landNavigate;
    if (typeof originalNavigate === 'function') {
      window.landNavigate = async function landNavigateCoordinateV1865(view, ...args) {
        if (String(view) === 'map') view = 'dashboard';
        const result = await originalNavigate.call(this, view, ...args);
        removePlottingMenu();
        updateCoordinateLabels();
        bindClickableLandRows();
        return result;
      };
    }

    const originalDashboard = window.loadLandDashboard;
    if (typeof originalDashboard === 'function') {
      window.loadLandDashboard = async function loadLandDashboardCoordinateV1865(...args) {
        const result = await originalDashboard.apply(this, args);
        updateCoordinateLabels();
        removePlottingMenu();
        return result;
      };
    }

    const originalList = window.loadLandList;
    if (typeof originalList === 'function') {
      window.loadLandList = async function loadLandListCoordinateV1865(...args) {
        const result = await originalList.apply(this, args);
        updateCoordinateLabels();
        bindClickableLandRows();
        [80,260,700].forEach(delay => setTimeout(() => {updateCoordinateLabels();bindClickableLandRows();}, delay));
        return result;
      };
    }

    window.landRowHtml = landRowHtmlCoordinateV1865;
    window.loadLandMapPage = async function removedLandPlottingPageV1865() {
      return window.landNavigate?.('dashboard');
    };

    removePlottingMenu();
    updateCoordinateLabels();
    const observer = new MutationObserver(() => {
      removePlottingMenu();
      updateCoordinateLabels();
      bindClickableLandRows();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
    window.SitkawCoordinateMap = {version:VERSION, coordinateOf, openLandPoint:window.openLandPoint, navigate:window.openLandNavigation};
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => {
    installPatch();
    setTimeout(installPatch, 100);
  }, {once:true});
  else installPatch();
})();
