const BASE = window.location.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '');
const api = (path) => `${BASE}${path}`;

let evtSource = null;
let logCount = 0;

const FAVORITES_KEY = 'fattal_favorites';
function getFavorites() { try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')); } catch { return new Set(); } }
function saveFavorites(s) { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...s])); }

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadCitiesWithHotels(), loadDevices(), loadConfig()]);
  await refreshAll();
  connectLogStream();
  setInterval(refreshAll, 30000);
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadDeals()]);
}

// ── Log streaming ─────────────────────────────────────────────────────────────

function connectLogStream() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource(api('/api/logs/stream'));
  evtSource.onmessage = (e) => {
    try { appendLog(JSON.parse(e.data)); } catch {}
  };
  evtSource.onerror = () => {
    setTimeout(connectLogStream, 5000);
  };
}

function appendLog(entry) {
  const el = document.getElementById('log-output');
  const line = document.createElement('div');
  line.className = `log-line ${entry.level || ''}`;
  line.innerHTML = `<span class="log-time">${entry.time}</span><span class="log-msg">${escHtml(entry.msg)}</span>`;
  el.appendChild(line);
  logCount++;
  document.getElementById('logs-count').textContent = logCount;
  if (document.getElementById('log-autoscroll').checked) {
    el.scrollTop = el.scrollHeight;
  }
}

function clearLogs() {
  document.getElementById('log-output').innerHTML = '';
  logCount = 0;
  document.getElementById('logs-count').textContent = 0;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  btn.classList.add('active');
  document.getElementById(`tab-${name}`).classList.remove('hidden');
}

// ── Hotel tree ────────────────────────────────────────────────────────────────

async function loadCitiesWithHotels() {
  const container = document.getElementById('hotels-tree');
  container.innerHTML = '<div class="loading-text">Loading…</div>';
  try {
    const cities = await get(api('/api/cities-with-hotels'));
    if (!cities.length) {
      container.innerHTML = '<div class="loading-text">No hotels found.</div>';
      return;
    }
    container.innerHTML = cities.map(city => buildCityGroup(city)).join('');
  } catch {
    container.innerHTML = '<div class="loading-text">Failed to load hotels.</div>';
  }
}

function buildCityGroup(city) {
  const hotelRows = city.hotels.map(h => `
    <label>
      <input type="checkbox" class="hotel-cb" data-city="${city.slug}" value="${h.id}"
             onchange="onHotelCbChange('${city.slug}')">
      ${escHtml(h.name)}
    </label>`).join('');

  return `
  <div class="city-group">
    <div class="city-row">
      <input type="checkbox" class="city-cb" id="city-cb-${city.slug}"
             data-city="${city.slug}"
             onchange="onCityCbChange('${city.slug}')">
      <span class="city-toggle" onclick="toggleCity('${city.slug}')">▶</span>
      <label class="city-label" for="city-cb-${city.slug}">
        ${escHtml(city.name)} <span class="city-count">(${city.hotels.length})</span>
      </label>
    </div>
    <div class="city-hotels collapsed" id="city-hotels-${city.slug}">
      ${hotelRows}
    </div>
  </div>`;
}

function toggleCity(slug) {
  const el = document.getElementById(`city-hotels-${slug}`);
  const toggle = el.previousElementSibling.querySelector('.city-toggle');
  el.classList.toggle('collapsed');
  toggle.textContent = el.classList.contains('collapsed') ? '▶' : '▼';
}

function onCityCbChange(slug) {
  const cityCb = document.getElementById(`city-cb-${slug}`);
  // Expand city when checking it
  if (cityCb.checked) {
    const el = document.getElementById(`city-hotels-${slug}`);
    el.classList.remove('collapsed');
    el.previousElementSibling.querySelector('.city-toggle').textContent = '▼';
  }
  document.querySelectorAll(`.hotel-cb[data-city="${slug}"]`).forEach(cb => {
    cb.checked = cityCb.checked;
  });
  cityCb.indeterminate = false;
}

function onHotelCbChange(slug) {
  const hotelCbs = [...document.querySelectorAll(`.hotel-cb[data-city="${slug}"]`)];
  const checkedCount = hotelCbs.filter(cb => cb.checked).length;
  const cityCb = document.getElementById(`city-cb-${slug}`);
  if (checkedCount === 0) {
    cityCb.checked = false;
    cityCb.indeterminate = false;
  } else if (checkedCount === hotelCbs.length) {
    cityCb.checked = true;
    cityCb.indeterminate = false;
  } else {
    cityCb.checked = false;
    cityCb.indeterminate = true;
  }
}

function selectAllHotels() {
  document.querySelectorAll('.hotel-cb').forEach(cb => cb.checked = true);
  document.querySelectorAll('.city-cb').forEach(cb => { cb.checked = true; cb.indeterminate = false; });
  // Expand all
  document.querySelectorAll('.city-hotels').forEach(el => {
    el.classList.remove('collapsed');
    el.previousElementSibling.querySelector('.city-toggle').textContent = '▼';
  });
}

function selectNoHotels() {
  document.querySelectorAll('.hotel-cb').forEach(cb => cb.checked = false);
  document.querySelectorAll('.city-cb').forEach(cb => { cb.checked = false; cb.indeterminate = false; });
}

// ── Data Loaders ──────────────────────────────────────────────────────────────

async function loadDevices() {
  const sel = document.getElementById('notify-device');
  try {
    const devices = await get(api('/api/notify-devices'));
    if (!devices.length) {
      sel.innerHTML = '<option value="">No mobile_app devices found in HA</option>';
    } else {
      sel.innerHTML = '<option value="">— Select device —</option>' +
        devices.map(d => `<option value="${d.id}">${escHtml(d.name)}</option>`).join('');
    }
  } catch {
    sel.innerHTML = '<option value="">Could not reach HA API</option>';
  }
}

async function loadConfig() {
  try {
    const cfg = await get(api('/api/config'));
    if (cfg.date_from) document.getElementById('date-from').value = cfg.date_from;
    if (cfg.date_to)   document.getElementById('date-to').value   = cfg.date_to;
    if (cfg.adults !== undefined)   document.getElementById('adults').value   = cfg.adults;
    if (cfg.children !== undefined) document.getElementById('children').value = cfg.children;
    if (cfg.interval_hours) document.getElementById('interval').value = cfg.interval_hours;

    if (cfg.price_threshold) {
      if (cfg.threshold_type === 'night') {
        document.getElementById('threshold-night').value = cfg.price_threshold;
        document.getElementById('threshold-stay').disabled = true;
      } else {
        document.getElementById('threshold-stay').value = cfg.price_threshold;
        document.getElementById('threshold-night').disabled = true;
      }
    }

    if (cfg.nights) {
      document.querySelectorAll('.nights-cb').forEach(cb => {
        cb.checked = cfg.nights.includes(Number(cb.value));
      });
    }

    // Restore hotel selection after tree is rendered
    if (cfg.hotels?.length) {
      setTimeout(() => {
        document.querySelectorAll('.hotel-cb').forEach(cb => {
          cb.checked = cfg.hotels.includes(cb.value);
        });
        // Expand cities that have at least one hotel checked
        const slugs = new Set([...document.querySelectorAll('.city-cb')].map(cb => cb.dataset.city));
        slugs.forEach(slug => {
          onHotelCbChange(slug);
          const hasChecked = [...document.querySelectorAll(`.hotel-cb[data-city="${slug}"]`)].some(cb => cb.checked);
          if (hasChecked) {
            const el = document.getElementById(`city-hotels-${slug}`);
            if (el) {
              el.classList.remove('collapsed');
              el.previousElementSibling.querySelector('.city-toggle').textContent = '▼';
            }
          }
        });
      }, 600);
    }

    if (cfg.notify_device) {
      setTimeout(() => {
        const sel = document.getElementById('notify-device');
        if ([...sel.options].some(o => o.value === cfg.notify_device)) {
          sel.value = cfg.notify_device;
        }
      }, 600);
    }
  } catch {}
}

async function loadStatus() {
  try {
    const s = await get(api('/api/status'));
    const active = s.active;
    document.getElementById('status-badge').className = `badge ${active ? 'badge-on' : 'badge-off'}`;
    document.getElementById('status-badge').textContent = active ? '● Active' : '● Inactive';
    document.getElementById('status-text').textContent = active ? 'Running' : 'Inactive';
    document.getElementById('status-text').className = `stat-value ${active ? 'active' : 'muted'}`;
    document.getElementById('last-run').textContent = s.last_run ? fmtDate(s.last_run) : '—';
    document.getElementById('next-run').textContent = s.next_run ? fmtDate(s.next_run) : '—';
    document.getElementById('btn-start').disabled = active;
    document.getElementById('btn-stop').disabled  = !active;
    // Cancel-run button visibility
    const cancelBtn = document.getElementById('btn-cancel-run');
    cancelBtn.style.display = s.run_in_progress ? '' : 'none';
  } catch {}
}

async function loadDeals() {
  try {
    const deals = await get(api('/api/deals'));
    document.getElementById('deals-count').textContent = deals.length;
    const container = document.getElementById('deals-list');
    if (!deals.length) {
      container.innerHTML = '<div class="empty-text">No deals saved yet.</div>';
      return;
    }
    const favs = getFavorites();
    container.innerHTML = deals.slice(0, 100).map(d => {
      const isFav = favs.has(String(d.id));
      const bbStr = d.bb_price  ? `<span class="plan-pill bb">BB ₪${fmtPrice(d.bb_price)}</span>`  : '';
      const hbStr = d.hb_price  ? `<span class="plan-pill hb">HB ₪${fmtPrice(d.hb_price)}</span>`  : '';
      const aiStr = d.ai_price  ? `<span class="plan-pill ai">AI ₪${fmtPrice(d.ai_price)}</span>`  : '';
      const ppn   = d.comparison_price && d.nights ? Math.round(d.comparison_price / d.nights) : null;
      return `
      <div class="deal-item${isFav ? ' starred' : ''}" data-id="${d.id}">
        <div class="deal-row-actions">
          <button class="deal-star" onclick="toggleFavorite('${d.id}', this)" title="Favourite">${isFav ? '★' : '☆'}</button>
          <button class="deal-delete" onclick="deleteDeal(${d.id})" title="Delete">✕</button>
        </div>
        <div class="deal-hotel">${escHtml(d.hotel_name || d.hotel_id)}</div>
        <div class="deal-meta">${d.check_in} → ${d.check_out} · ${d.nights} nights · ${fmtDate(d.checked_at)}</div>
        <div class="deal-plans">${bbStr}${hbStr}${aiStr}</div>
        ${ppn ? `<div class="deal-ppn">₪${fmtPrice(ppn)}/night (HB basis)</div>` : ''}
      </div>`;
    }).join('');
  } catch {}
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function startJob() {
  const cfg = collectConfig();
  if (!cfg.hotels.length)              { toast('Select at least one hotel', 'error'); return; }
  if (!cfg.date_from || !cfg.date_to)  { toast('Set a date range', 'error'); return; }
  if (!cfg.price_threshold)            { toast('Set a price threshold', 'error'); return; }
  if (!cfg.nights.length)              { toast('Select at least one night duration', 'error'); return; }
  try {
    await post(api('/api/jobs/start'), cfg);
    toast('Tracker started!', 'success');
    await loadStatus();
  } catch { toast('Failed to start', 'error'); }
}

async function stopJob() {
  try {
    await post(api('/api/jobs/stop'), {});
    toast('Tracker stopped.', 'success');
    await loadStatus();
  } catch { toast('Failed to stop', 'error'); }
}

async function runNow() {
  const cfg = collectConfig();
  try {
    await post(api('/api/config'), cfg);
    await post(api('/api/jobs/run-now'), {});
    // Show cancel button immediately
    document.getElementById('btn-cancel-run').style.display = '';
    switchTab('logs', document.querySelectorAll('.tab')[1]);
    toast('Check triggered — watch the console!', 'success');
  } catch { toast('Failed to trigger run', 'error'); }
}

async function cancelRun() {
  try {
    await post(api('/api/jobs/cancel-run'), {});
    document.getElementById('btn-cancel-run').style.display = 'none';
    toast('Run cancelled.', 'success');
  } catch { toast('Failed to cancel', 'error'); }
}

let _clearPending = false;
let _clearTimer = null;
async function clearAllDeals() {
  const btn = document.querySelector('.btn-xs-danger[onclick="clearAllDeals()"]');
  if (!_clearPending) {
    _clearPending = true;
    if (btn) { btn.textContent = 'Sure? Click again'; btn.style.background = 'rgba(248,113,113,0.15)'; }
    _clearTimer = setTimeout(() => {
      _clearPending = false;
      if (btn) { btn.textContent = 'Clear all'; btn.style.background = ''; }
    }, 3000);
    return;
  }
  clearTimeout(_clearTimer);
  _clearPending = false;
  if (btn) { btn.textContent = 'Clear all'; btn.style.background = ''; }
  try {
    await del(api('/api/deals'));
    toast('All deals cleared.', 'success');
    await loadDeals();
  } catch { toast('Failed to clear deals', 'error'); }
}

async function deleteDeal(id) {
  try {
    await del(api(`/api/deals/${id}`));
    const el = document.querySelector(`.deal-item[data-id="${id}"]`);
    if (el) el.remove();
    const remaining = document.querySelectorAll('.deal-item').length;
    document.getElementById('deals-count').textContent = remaining;
    if (!remaining) document.getElementById('deals-list').innerHTML = '<div class="empty-text">No deals saved yet.</div>';
  } catch { toast('Failed to delete deal', 'error'); }
}

function toggleFavorite(id, btn) {
  const favs = getFavorites();
  const item = btn.closest('.deal-item');
  if (favs.has(String(id))) {
    favs.delete(String(id));
    btn.textContent = '☆';
    item.classList.remove('starred');
  } else {
    favs.add(String(id));
    btn.textContent = '★';
    item.classList.add('starred');
  }
  saveFavorites(favs);
}

// ── Threshold mutual-disable ──────────────────────────────────────────────────

function onThresholdInput(type) {
  const stayEl  = document.getElementById('threshold-stay');
  const nightEl = document.getElementById('threshold-night');
  if (type === 'stay') {
    nightEl.disabled = stayEl.value.trim() !== '';
    if (!stayEl.value.trim()) nightEl.disabled = false;
  } else {
    stayEl.disabled = nightEl.value.trim() !== '';
    if (!nightEl.value.trim()) stayEl.disabled = false;
  }
}

function selectAllNights()  { document.querySelectorAll('.nights-cb').forEach(cb => cb.checked = true); }
function selectNoNights()   { document.querySelectorAll('.nights-cb').forEach(cb => cb.checked = false); }

function collectConfig() {
  const nights = [...document.querySelectorAll('.nights-cb:checked')].map(cb => Number(cb.value));
  const hotels = [...document.querySelectorAll('.hotel-cb:checked')].map(cb => cb.value);
  const stayVal  = document.getElementById('threshold-stay').value.trim();
  const nightVal = document.getElementById('threshold-night').value.trim();
  const thresholdType = nightVal ? 'night' : 'stay';
  const priceThreshold = nightVal ? parseFloat(nightVal) : (stayVal ? parseFloat(stayVal) : null);

  return {
    hotels,
    date_from: document.getElementById('date-from').value,
    date_to:   document.getElementById('date-to').value,
    nights,
    adults:    parseInt(document.getElementById('adults').value),
    children:  parseInt(document.getElementById('children').value),
    threshold_type: thresholdType,
    price_threshold: priceThreshold,
    interval_hours: parseInt(document.getElementById('interval').value),
    notify_device: document.getElementById('notify-device').value,
  };
}

// ── Utils ─────────────────────────────────────────────────────────────────────

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function post(url, data) {
  const r = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function del(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function fmtPrice(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('he-IL');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}); }
  catch { return iso; }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let _toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

document.addEventListener('DOMContentLoaded', init);
