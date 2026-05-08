// Resolve base URL for HA ingress compatibility
const BASE = window.location.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '');
const api = (path) => `${BASE}${path}`;

let allHotels = [];
let refreshTimer = null;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadHotels(), loadDevices(), loadConfig()]);
  await refreshAll();
  refreshTimer = setInterval(refreshAll, 30000);
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadDeals(), loadHistory()]);
}

// ── Data Loaders ──────────────────────────────────────────────────────────────

async function loadHotels() {
  const city = document.getElementById('city').value;
  const container = document.getElementById('hotels-list');
  container.innerHTML = '<div class="loading-text">Loading...</div>';
  try {
    const hotels = await get(api(`/api/hotels?city=${city}`));
    allHotels = hotels;
    renderHotelCheckboxes(hotels);
  } catch {
    container.innerHTML = '<div class="loading-text">Failed to load hotels.</div>';
  }
}

function renderHotelCheckboxes(hotels) {
  const container = document.getElementById('hotels-list');
  if (!hotels.length) { container.innerHTML = '<div class="loading-text">No hotels found.</div>'; return; }
  container.innerHTML = hotels.map(h => `
    <label>
      <input type="checkbox" class="hotel-cb" value="${h.id}" checked>
      ${h.name}
    </label>
  `).join('');
}

async function loadDevices() {
  const sel = document.getElementById('notify-device');
  try {
    const devices = await get(api('/api/notify-devices'));
    if (!devices.length) {
      sel.innerHTML = '<option value="">No mobile_app devices found</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Select device —</option>' +
      devices.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
  } catch {
    sel.innerHTML = '<option value="">Could not load devices</option>';
  }
}

async function loadConfig() {
  try {
    const cfg = await get(api('/api/config'));
    if (cfg.city) document.getElementById('city').value = cfg.city;
    if (cfg.date_from) document.getElementById('date-from').value = cfg.date_from;
    if (cfg.date_to) document.getElementById('date-to').value = cfg.date_to;
    if (cfg.adults) document.getElementById('adults').value = cfg.adults;
    if (cfg.children !== undefined) document.getElementById('children').value = cfg.children;
    if (cfg.price_threshold) document.getElementById('price-threshold').value = cfg.price_threshold;
    if (cfg.interval_hours) document.getElementById('interval').value = cfg.interval_hours;

    if (cfg.nights) {
      document.getElementById('nights-2').checked = cfg.nights.includes(2);
      document.getElementById('nights-3').checked = cfg.nights.includes(3);
    }

    // Restore hotel selection after hotels are loaded
    if (cfg.hotels && cfg.hotels.length) {
      setTimeout(() => {
        document.querySelectorAll('.hotel-cb').forEach(cb => {
          cb.checked = cfg.hotels.includes(cb.value);
        });
      }, 300);
    }

    if (cfg.notify_device) {
      setTimeout(() => {
        const sel = document.getElementById('notify-device');
        if ([...sel.options].some(o => o.value === cfg.notify_device)) {
          sel.value = cfg.notify_device;
        }
      }, 500);
    }
  } catch { /* ignore on first load */ }
}

async function loadStatus() {
  try {
    const s = await get(api('/api/status'));
    const active = s.active;

    document.getElementById('status-badge').className = `badge ${active ? 'badge-on' : 'badge-off'}`;
    document.getElementById('status-badge').textContent = active ? '● Active' : '● Inactive';
    document.getElementById('status-text').textContent = active ? 'Running' : 'Inactive';
    document.getElementById('status-text').className = `stat-value ${active ? 'active' : 'muted'}`;
    document.getElementById('last-run').textContent = s.last_run ? formatDate(s.last_run) : '—';
    document.getElementById('next-run').textContent = s.next_run ? formatDate(s.next_run) : '—';

    document.getElementById('btn-start').disabled = active;
    document.getElementById('btn-stop').disabled = !active;
  } catch { /* ignore */ }
}

async function loadDeals() {
  try {
    const threshold = parseFloat(document.getElementById('price-threshold').value) || 5000;
    const deals = await get(api(`/api/deals?threshold=${threshold}`));
    document.getElementById('deals-count').textContent = deals.length;
    const container = document.getElementById('deals-list');

    if (!deals.length) {
      container.innerHTML = '<div class="empty-text">No deals below threshold yet.</div>';
      return;
    }

    container.innerHTML = deals.slice(0, 10).map(d => `
      <div class="deal-item">
        <div class="deal-hotel">${d.hotel_name || d.hotel_id}</div>
        <div class="deal-meta">${d.check_in} · ${d.nights} nights</div>
        <div class="deal-price">₪${fmtPrice(d.price)}</div>
        <div class="deal-club">Club: ₪${fmtPrice(d.club_price)}</div>
      </div>
    `).join('');
  } catch { /* ignore */ }
}

async function loadHistory() {
  try {
    const rows = await get(api('/api/history'));
    const threshold = parseFloat(document.getElementById('price-threshold').value) || 5000;
    document.getElementById('history-count').textContent = `${rows.length} records`;
    const tbody = document.getElementById('history-body');

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-text">No history yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(r => `
      <tr class="${r.price <= threshold ? 'is-deal' : ''}">
        <td>${r.hotel_name || r.hotel_id}</td>
        <td>${r.check_in}</td>
        <td>${r.nights}n</td>
        <td>₪${fmtPrice(r.price)}</td>
        <td>₪${fmtPrice(r.club_price)}</td>
        <td>${formatDate(r.checked_at)}</td>
      </tr>
    `).join('');
  } catch { /* ignore */ }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function startJob() {
  const cfg = collectConfig();
  if (!cfg.hotels.length) { toast('Select at least one hotel', 'error'); return; }
  if (!cfg.date_from || !cfg.date_to) { toast('Set a date range', 'error'); return; }

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
    toast('Check triggered! Results appear in history.', 'success');
  } catch { toast('Failed to trigger run', 'error'); }
}

function selectAllHotels() {
  document.querySelectorAll('.hotel-cb').forEach(cb => cb.checked = true);
}

function selectNoHotels() {
  document.querySelectorAll('.hotel-cb').forEach(cb => cb.checked = false);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectConfig() {
  const nights = [];
  if (document.getElementById('nights-2').checked) nights.push(2);
  if (document.getElementById('nights-3').checked) nights.push(3);
  const hotels = [...document.querySelectorAll('.hotel-cb:checked')].map(cb => cb.value);

  return {
    city: document.getElementById('city').value,
    hotels,
    date_from: document.getElementById('date-from').value,
    date_to: document.getElementById('date-to').value,
    nights,
    adults: parseInt(document.getElementById('adults').value),
    children: parseInt(document.getElementById('children').value),
    price_threshold: parseFloat(document.getElementById('price-threshold').value),
    interval_hours: parseInt(document.getElementById('interval').value),
    notify_device: document.getElementById('notify-device').value,
  };
}

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

async function post(url, data) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

function fmtPrice(n) {
  if (!n && n !== 0) return '—';
  return Number(n).toLocaleString('he-IL');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

let _toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
