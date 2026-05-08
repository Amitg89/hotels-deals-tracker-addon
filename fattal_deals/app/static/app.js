const BASE = window.location.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '');
const api = (path) => `${BASE}${path}`;

let evtSource = null;
let logCount = 0;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadHotels(), loadDevices(), loadConfig()]);
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
    // Reconnect after 5s
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

// ── Data Loaders ──────────────────────────────────────────────────────────────

async function loadHotels() {
  const city = document.getElementById('city').value;
  const container = document.getElementById('hotels-list');
  container.innerHTML = '<div class="loading-text">Loading…</div>';
  try {
    const hotels = await get(api(`/api/hotels?city=${city}`));
    container.innerHTML = hotels.map(h => `
      <label>
        <input type="checkbox" class="hotel-cb" value="${h.id}" checked>
        ${escHtml(h.name)}
      </label>`).join('') || '<div class="loading-text">No hotels found.</div>';
  } catch {
    container.innerHTML = '<div class="loading-text">Failed to load hotels.</div>';
  }
}

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
    if (cfg.city) document.getElementById('city').value = cfg.city;
    if (cfg.date_from) document.getElementById('date-from').value = cfg.date_from;
    if (cfg.date_to)   document.getElementById('date-to').value   = cfg.date_to;
    if (cfg.adults !== undefined)   document.getElementById('adults').value   = cfg.adults;
    if (cfg.children !== undefined) document.getElementById('children').value = cfg.children;
    if (cfg.interval_hours) document.getElementById('interval').value = cfg.interval_hours;

    // Threshold
    if (cfg.price_threshold) {
      if (cfg.threshold_type === 'night') {
        document.getElementById('threshold-night').value = cfg.price_threshold;
        document.getElementById('threshold-stay').disabled = true;
      } else {
        document.getElementById('threshold-stay').value = cfg.price_threshold;
        document.getElementById('threshold-night').disabled = true;
      }
    }

    // Nights
    if (cfg.nights) {
      document.querySelectorAll('.nights-cb').forEach(cb => {
        cb.checked = cfg.nights.includes(Number(cb.value));
      });
    }

    // Hotels (after DOM is ready)
    if (cfg.hotels?.length) {
      setTimeout(() => {
        document.querySelectorAll('.hotel-cb').forEach(cb => {
          cb.checked = cfg.hotels.includes(cb.value);
        });
      }, 400);
    }

    // Device
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
    container.innerHTML = deals.slice(0, 30).map(d => `
      <div class="deal-item">
        <div class="deal-hotel">${escHtml(d.hotel_name || d.hotel_id)}</div>
        <div class="deal-meta">${d.check_in} · ${d.nights} nights · ${fmtDate(d.checked_at)}</div>
        <div class="deal-prices">
          <span class="deal-price-stay">₪${fmtPrice(d.price)}</span>
          <span class="deal-price-night">₪${fmtPrice(d.price_per_night)}/night</span>
        </div>
        <div class="deal-club">Club: ₪${fmtPrice(d.club_price)}</div>
      </div>`).join('');
  } catch {}
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function startJob() {
  const cfg = collectConfig();
  if (!cfg.hotels.length)         { toast('Select at least one hotel', 'error'); return; }
  if (!cfg.date_from || !cfg.date_to) { toast('Set a date range', 'error'); return; }
  if (!cfg.price_threshold)       { toast('Set a price threshold', 'error'); return; }
  if (!cfg.nights.length)         { toast('Select at least one night duration', 'error'); return; }
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
    switchTab('logs', document.querySelectorAll('.tab')[1]);
    toast('Check triggered — watch the console!', 'success');
  } catch { toast('Failed to trigger run', 'error'); }
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function selectAllHotels()  { document.querySelectorAll('.hotel-cb').forEach(cb => cb.checked = true); }
function selectNoHotels()   { document.querySelectorAll('.hotel-cb').forEach(cb => cb.checked = false); }
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
    city: document.getElementById('city').value,
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
