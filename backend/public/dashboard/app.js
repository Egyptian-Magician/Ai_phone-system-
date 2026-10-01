// Call Shield dashboard: talks to the /screening admin API on this server.

const API = '/screening';
const SECRET_KEY = 'callShieldSecret';
const REFRESH_MS = 30000;

const STRICTNESS_HELP = {
  relaxed: 'Only blocks callers with very strong spam signals. Fewest false alarms.',
  balanced: 'Blocks clear spam and sends doubtful callers to voicemail.',
  strict: 'Sends anything questionable to voicemail and blocks more aggressively.',
};
const ACTION_LABEL = { allow: 'Allowed', voicemail: 'Voicemail', block: 'Blocked', honeypot: 'Honeypot' };

const $ = (id) => document.getElementById(id);
let state = null;
let refreshTimer = null;

// ── Secret storage (best effort; private mode may block storage) ──
function loadSecret() {
  try { return localStorage.getItem(SECRET_KEY) || sessionStorage.getItem(SECRET_KEY) || ''; } catch { return ''; }
}
function saveSecret(secret, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(SECRET_KEY, secret);
  } catch { /* in-memory only */ }
  memorySecret = secret;
}
function clearSecret() {
  memorySecret = '';
  try { localStorage.removeItem(SECRET_KEY); sessionStorage.removeItem(SECRET_KEY); } catch { /* ignore */ }
}
let memorySecret = loadSecret();

// ── API ──
async function api(path, body) {
  const resp = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': memorySecret },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resp.status === 403) {
    const err = new Error('Wrong admin secret');
    err.forbidden = true;
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.success === false) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

// ── Helpers ──
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function fmtNumber(n) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (n || 'Unknown');
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function pill(action) {
  return `<span class="pill pill-${esc(action)}">${esc(ACTION_LABEL[action] || action)}</span>`;
}

// ── Views ──
function showLogin(message) {
  stopRefresh();
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginError').textContent = message || '';
  $('secretInput').focus();
}
function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
}

function render() {
  if (!state) return;
  const s = state.stats;
  $('statTotal').textContent = s.total;
  $('statAllow').textContent = s.allow;
  $('statVoicemail').textContent = s.voicemail;
  $('statBlocked').textContent = s.block + s.honeypot;

  $('statusPill').textContent = state.enabled ? 'Screening on' : 'Screening off';
  $('disabledNote').hidden = state.enabled;
  $('updatedAt').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Recent calls
  const allow = new Set(state.allowlist);
  const block = new Set(state.blacklist);
  $('callsEmpty').hidden = state.decisions.length > 0;
  $('callList').innerHTML = state.decisions.map((d) => {
    const n = d.number || '';
    const canList = /^\+\d{6,}$/.test(n);
    const actions = canList ? [
      allow.has(n) ? '' : `<button class="btn-link" data-list="allow" data-op="add" data-number="${esc(n)}">Always allow</button>`,
      block.has(n) ? '' : `<button class="btn-link" data-list="block" data-op="add" data-number="${esc(n)}">Always block</button>`,
    ].join('') : '';
    const why = (d.reasons || []).join(' · ') || 'no spam signals';
    return `<li>
      <span class="call-number">${esc(fmtNumber(n))}</span>
      ${pill(d.action)}
      <span class="call-meta">${esc(fmtTime(d.time))} · score ${esc(d.score)} · ${esc(why)}</span>
      ${actions ? `<span class="call-actions">${actions}</span>` : ''}
    </li>`;
  }).join('');

  // Settings
  const st = state.settings;
  document.querySelectorAll('#strictness button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.value === st.strictness));
  });
  $('strictnessHelp').textContent = STRICTNESS_HELP[st.strictness] || '';
  $('anonymousAction').value = st.anonymousAction;
  $('blacklistAction').value = st.blacklistAction;

  // Lists
  renderList('allowList', state.allowlist, 'allow');
  renderList('blockList', state.blacklist, 'block');
}

function renderList(id, numbers, list) {
  $(id).innerHTML = numbers.length
    ? numbers.map((n) => `<li><span>${esc(fmtNumber(n))}</span>
        <button class="btn-link" data-list="${list}" data-op="remove" data-number="${esc(n)}">Remove</button></li>`).join('')
    : '<li class="none">None yet</li>';
}

// ── Data ──
async function refresh() {
  try {
    state = await api('/state');
    showApp();
    render();
  } catch (err) {
    if (err.forbidden) { clearSecret(); showLogin('That secret was not accepted.'); }
    else { $('updatedAt').textContent = 'Could not refresh: ' + err.message; }
  }
}
function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
}
function stopRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = null; }

async function changeList(list, op, number) {
  $('listMsg').textContent = '';
  try {
    const data = await api('/list', { list, op, number });
    state.allowlist = data.allowlist;
    state.blacklist = data.blacklist;
    render();
    return true;
  } catch (err) {
    $('listMsg').textContent = err.message;
    return false;
  }
}

async function saveSettings(patch) {
  $('settingsMsg').textContent = 'Saving…';
  try {
    const data = await api('/settings', patch);
    state.settings = data.settings;
    render();
    $('settingsMsg').textContent = 'Saved';
    setTimeout(() => { $('settingsMsg').textContent = ''; }, 1500);
  } catch (err) {
    $('settingsMsg').textContent = err.message;
  }
}

// ── Events ──
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  saveSecret($('secretInput').value.trim(), $('rememberInput').checked);
  $('secretInput').value = '';
  await refresh();
  if (state) startRefresh();
});

$('logoutBtn').addEventListener('click', () => { clearSecret(); state = null; showLogin(); });
$('refreshBtn').addEventListener('click', refresh);

$('checkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('checkBtn');
  btn.disabled = true;
  $('checkResult').innerHTML = '<p class="muted small">Checking…</p>';
  try {
    const { result: r } = await api('/check', { number: $('checkInput').value.trim() });
    const why = (r.reasons || []).join(' · ') || 'No spam signals found';
    const note = r.source === 'timeout' ? ' (lookup timed out; decided on local info)' : '';
    $('checkResult').innerHTML = `<div class="result">
      <span class="result-score">${esc(r.score)}</span>
      <div class="result-body">
        <strong>${esc(fmtNumber(r.number))} would be: ${pill(r.action)}</strong>
        <span class="muted small">${esc(why)}${esc(note)}</span>
      </div></div>`;
  } catch (err) {
    $('checkResult').innerHTML = `<p class="error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
});

// Allow / Block buttons on the list form (submitter tells us which).
$('listForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = (e.submitter && e.submitter.dataset.list) || 'block';
  if (await changeList(list, 'add', $('listInput').value.trim())) $('listInput').value = '';
});

// Delegated clicks: remove buttons and "always allow/block" on recent calls.
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-op]');
  if (b) changeList(b.dataset.list, b.dataset.op, b.dataset.number);
});

$('strictness').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-value]');
  if (b && state && b.dataset.value !== state.settings.strictness) saveSettings({ strictness: b.dataset.value });
});
$('anonymousAction').addEventListener('change', (e) => saveSettings({ anonymousAction: e.target.value }));
$('blacklistAction').addEventListener('change', (e) => saveSettings({ blacklistAction: e.target.value }));

document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refresh(); });

// ── Boot ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell is optional */ });
}
if (memorySecret) {
  refresh().then(() => { if (state) startRefresh(); });
} else {
  showLogin();
}
