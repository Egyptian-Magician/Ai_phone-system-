// app.js - Web Softphone Logic

// API URL - automatically uses current domain
const API_URL = window.location.origin;

let twilioDevice = null;
let currentCall = null;
let userIdentity = null;
let isMuted = false;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const softphoneScreen = document.getElementById('softphoneScreen');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const userIdentityEl = document.getElementById('userIdentity');
const connectionStatus = document.getElementById('connectionStatus');
const phoneNumber = document.getElementById('phoneNumber');
const callBtn = document.getElementById('callBtn');
const hangupBtn = document.getElementById('hangupBtn');
const muteBtn = document.getElementById('muteBtn');
const callStatus = document.getElementById('callStatus');
const callHistory = document.getElementById('callHistory');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

// Event Listeners
loginBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
callBtn.addEventListener('click', makeCall);
hangupBtn.addEventListener('click', hangupCall);
muteBtn.addEventListener('click', toggleMute);
refreshHistoryBtn.addEventListener('click', loadCallHistory);

// Allow Enter key to login
loginPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleLogin();
});

loginEmail.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleLogin();
});

// Dialpad functionality
document.querySelectorAll('.dial-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const digit = btn.getAttribute('data-digit');
    phoneNumber.value += digit;
    
    // Send DTMF tone if on active call
    if (currentCall) {
      currentCall.sendDigits(digit);
    }
  });
});

// Quick dial button
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const number = btn.getAttribute('data-number');
    phoneNumber.value = number;
    makeCall();
  });
});

// Login handler
async function handleLogin() {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  
  if (!email || !password) {
    loginError.textContent = 'Please enter email and password';
    return;
  }
  
  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in...';
  loginError.textContent = '';
  
  try {
    console.log('Attempting login for:', email);
    
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      userIdentity = data.identity;
      console.log('✅ Login successful:', userIdentity);
      await initializeTwilioDevice();
      showSoftphone();
    } else {
      loginError.textContent = data.message || 'Login failed';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    }
  } catch (error) {
    console.error('❌ Login error:', error);
    loginError.textContent = 'Connection error. Please check your internet and try again.';
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

// Initialize Twilio Device
async function initializeTwilioDevice() {
  console.log('🔧 Initializing Twilio Device for:', userIdentity);
  
  try {
    const response = await fetch(`${API_URL}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: userIdentity })
    });
    
    if (!response.ok) {
      throw new Error('Failed to get access token');
    }
    
    const data = await response.json();
    console.log('✅ Access token received');
    
    // Initialize Twilio Device
    twilioDevice = new Twilio.Device(data.token, {
      codecPreferences: ['opus', 'pcmu'],
      fakeLocalDTMF: true,
      enableRingingState: true
    });
    
    // Device event handlers
    twilioDevice.on('ready', (device) => {
      console.log('✅ Twilio Device ready');
      updateStatus('connected');
      callStatus.textContent = 'Ready to make calls';
    });
    
    twilioDevice.on('error', (error) => {
      console.error('❌ Twilio Device error:', error);
      updateStatus('disconnected');
      callStatus.textContent = `Error: ${error.message}`;
    });
    
    twilioDevice.on('connect', (conn) => {
      console.log('📞 Call connected');
      currentCall = conn;
      updateCallUI(true);
      updateStatus('calling');
      callStatus.textContent = `Connected to ${phoneNumber.value}`;
    });
    
    twilioDevice.on('disconnect', (conn) => {
      console.log('📴 Call disconnected');
      currentCall = null;
      updateCallUI(false);
      updateStatus('connected');
      callStatus.textContent = 'Call ended';
      
      // Refresh call history after call ends
      setTimeout(loadCallHistory, 1000);
    });
    
    twilioDevice.on('incoming', (conn) => {
      console.log('📱 Incoming call from:', conn.parameters.From);
      
      if (confirm(`Incoming call from ${conn.parameters.From}. Accept?`)) {
        conn.accept();
        currentCall = conn;
        updateCallUI(true);
        phoneNumber.value = conn.parameters.From;
      } else {
        conn.reject();
      }
    });
    
    twilioDevice.on('cancel', () => {
      console.log('🚫 Call canceled');
      updateCallUI(false);
      callStatus.textContent = 'Call canceled';
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize Twilio Device:', error);
    alert('Failed to initialize phone. Please try logging in again.');
    handleLogout();
  }
}

// Make outbound call
async function makeCall() {
  const number = phoneNumber.value.trim();
  
  if (!number) {
    alert('Please enter a phone number');
    phoneNumber.focus();
    return;
  }
  
  if (!twilioDevice) {
    alert('Phone not ready. Please try logging in again.');
    return;
  }
  
  try {
    console.log('📞 Making call to:', number);
    callStatus.textContent = `Calling ${number}...`;
    updateStatus('calling');
    
    const params = {
      To: number
    };
    
    twilioDevice.connect(params);
    
  } catch (error) {
    console.error('❌ Call failed:', error);
    callStatus.textContent = `Call failed: ${error.message}`;
    updateStatus('connected');
  }
}

// Hang up call
function hangupCall() {
  if (currentCall) {
    console.log('📴 Hanging up call');
    currentCall.disconnect();
  }
}

// Toggle mute
function toggleMute() {
  if (currentCall) {
    isMuted = !isMuted;
    currentCall.mute(isMuted);
    
    muteBtn.innerHTML = isMuted 
      ? '<span class="icon">🔊</span> Unmute' 
      : '<span class="icon">🔇</span> Mute';
    
    muteBtn.style.background = isMuted ? '#ffc107' : '#6c757d';
    
    console.log('🔇 Mute toggled:', isMuted);
  }
}

// Update connection status indicator
function updateStatus(status) {
  connectionStatus.className = `status-${status}`;
  
  const statusText = {
    'connected': '● Connected',
    'disconnected': '● Disconnected',
    'calling': '● In Call'
  };
  
  connectionStatus.textContent = statusText[status] || status;
}

// Update call control buttons
function updateCallUI(inCall) {
  callBtn.disabled = inCall;
  hangupBtn.disabled = !inCall;
  muteBtn.disabled = !inCall;
  
  if (!inCall) {
    isMuted = false;
    muteBtn.innerHTML = '<span class="icon">🔇</span> Mute';
    muteBtn.style.background = '';
  }
}

// Show softphone interface
function showSoftphone() {
  loginScreen.classList.remove('active');
  softphoneScreen.classList.add('active');
  userIdentityEl.textContent = userIdentity;
  loadCallHistory();
  
  loginBtn.disabled = false;
  loginBtn.textContent = 'Login';
}

// Load call history
async function loadCallHistory() {
  console.log('📋 Loading call history for:', userIdentity);
  
  try {
    callHistory.innerHTML = '<p class="loading">Loading call history...</p>';
    
    const response = await fetch(`${API_URL}/api/calls/${userIdentity}`);
    
    if (!response.ok) {
      throw new Error('Failed to load call history');
    }
    
    const data = await response.json();
    
    if (data.success && data.calls.length > 0) {
      callHistory.innerHTML = data.calls.map(call => {
        const statusClass = call.status.toLowerCase().replace(/-/g, '');
        const direction = call.direction === 'outbound-api' ? '📤' : '📥';
        const displayNumber = call.direction === 'outbound-api' ? call.to : call.from;
        
        return `
          <div class="call-item">
            <div class="call-item-info">
              <div class="call-item-number">
                ${direction} ${displayNumber}
              </div>
              <div class="call-item-time">
                ${call.startTime ? new Date(call.startTime).toLocaleString() : 'Recent'}
                ${call.duration ? ` • ${call.duration}s` : ''}
              </div>
            </div>
            <span class="call-item-status status-${statusClass}">
              ${call.status}
            </span>
          </div>
        `;
      }).join('');
    } else {
      callHistory.innerHTML = '<p class="loading">No calls yet. Make your first call! 📞</p>';
    }
  } catch (error) {
    console.error('❌ Failed to load call history:', error);
    callHistory.innerHTML = '<p class="loading">Failed to load history. Click refresh to try again.</p>';
  }
}

// Logout
function handleLogout() {
  console.log('👋 Logging out');
  
  if (currentCall) {
    currentCall.disconnect();
  }
  
  if (twilioDevice) {
    twilioDevice.destroy();
    twilioDevice = null;
  }
  
  softphoneScreen.classList.remove('active');
  loginScreen.classList.add('active');
  
  userIdentity = null;
  phoneNumber.value = '';
  loginPassword.value = '';
  loginError.textContent = '';
  callStatus.textContent = '';
  
  updateStatus('disconnected');
}

// Auto-logout on page unload
window.addEventListener('beforeunload', () => {
  if (twilioDevice) {
    twilioDevice.destroy();
  }
});

// Log initialization
console.log('📱 Web Softphone initialized');
console.log('🌐 API URL:', API_URL);
console.log('✅ Ready for login');

// ── Caller Triage (authorized OSINT) ─────────────────────────────
const triageBtn = document.getElementById('triageBtn');
const triageNumber = document.getElementById('triageNumber');
const triageEmail = document.getElementById('triageEmail');
const triageHandle = document.getElementById('triageHandle');
const triageAuthorized = document.getElementById('triageAuthorized');
const triageError = document.getElementById('triageError');
const triageResults = document.getElementById('triageResults');

if (triageBtn) {
  triageBtn.addEventListener('click', runTriage);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function yn(v) {
  if (v === true) return '<span class="pill pill-bad">yes</span>';
  if (v === false) return '<span class="pill pill-good">no</span>';
  return '<span class="pill pill-neutral">unknown</span>';
}

function row(label, valueHtml) {
  return `<div class="triage-row"><span class="label">${esc(label)}</span>` +
         `<span class="value">${valueHtml}</span></div>`;
}

async function runTriage() {
  triageError.textContent = '';
  triageResults.innerHTML = '';

  const number = triageNumber.value.trim();
  if (!number) {
    triageError.textContent = 'Enter a phone number.';
    return;
  }
  if (!triageAuthorized.checked) {
    triageError.textContent = 'Please confirm you are authorized to look this up.';
    return;
  }

  triageBtn.disabled = true;
  triageBtn.textContent = 'Running…';
  try {
    const resp = await fetch(`${API_URL}/api/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number,
        email: triageEmail.value.trim() || undefined,
        handle: triageHandle.value.trim() || undefined,
        authorized: true,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      triageError.textContent = data.error || `Request failed (${resp.status}).`;
      return;
    }
    renderTriage(data.report);
  } catch (err) {
    triageError.textContent = 'Network error: ' + err.message;
  } finally {
    triageBtn.disabled = false;
    triageBtn.textContent = 'Run triage';
  }
}

function renderTriage(r) {
  const parts = [];
  const v = r.validation || {};

  // Number card
  let numCard = `<div class="triage-card"><h4>📱 Number</h4>`;
  numCard += row('Valid', yn(v.valid));
  if (v.valid) {
    numCard += row('Number', esc(v.national || v.e164));
    numCard += row('Region', esc(v.region || 'n/a'));
    numCard += row('Line type', esc(v.lineType || 'unknown'));
    numCard += row('VoIP / Google Voice (hint)', yn(v.voipOrGoogleVoiceHint));
  } else {
    numCard += row('Error', esc(v.error || 'could not parse'));
  }
  numCard += `</div>`;
  parts.push(numCard);

  // Live lookup card
  const live = r.liveLookup && r.liveLookup.verdict;
  if (live) {
    let c = `<div class="triage-card"><h4>🌐 Live carrier lookup</h4>`;
    c += row('Line type', esc(live.lineType || 'n/a'));
    c += row('Carrier', esc(live.carrier || 'n/a'));
    c += row('Is VoIP', yn(live.isVoip));
    c += row('Is Google Voice', yn(live.isGoogleVoice));
    const tw = r.liveLookup.twilio || {};
    if (tw.callerName) c += row('Caller name (CNAM)', esc(tw.callerName));
    if (tw.status && tw.status !== 'ok') c += row('Twilio', esc(tw.status + (tw.reason ? ': ' + tw.reason : '')));
    c += `</div>`;
    parts.push(c);
  }

  // Reputation card
  const sp = r.phoneReputation;
  if (sp) {
    let c = `<div class="triage-card"><h4>🚨 Spam / fraud reputation</h4>`;
    if (sp.status === 'ok') {
      c += row('Fraud score', `${esc(sp.fraudScore)} / 100`);
      c += row('Flagged spammer', yn(sp.spammer));
      c += row('Recent abuse', yn(sp.recentAbuse));
      c += row('Risky', yn(sp.risky));
    } else {
      c += row('Status', esc(sp.status + (sp.reason ? ': ' + sp.reason : '')));
    }
    c += `</div>`;
    parts.push(c);
  }

  // Identifier card
  const id = r.identifier;
  if (id) {
    let c = `<div class="triage-card"><h4>📧 Identifier abuse signals</h4>`;
    c += row('Target', esc(id.target));
    const rep = id.emailReputation || {};
    if (rep.status === 'ok') {
      c += row('Email fraud score', `${esc(rep.fraudScore)} / 100`);
      c += row('Disposable', yn(rep.disposable));
      c += row('Recent abuse', yn(rep.recentAbuse));
    }
    const br = id.breaches || {};
    if (br.status === 'ok') {
      c += row('Breach appearances', `<span class="pill ${br.breachCount ? 'pill-bad' : 'pill-good'}">${esc(br.breachCount)}</span>`);
      if (br.breaches && br.breaches.length) {
        c += row('Breaches', esc(br.breaches.slice(0, 12).join(', ')));
      }
    }
    const st = id.static || {};
    if (st.status === 'ok') c += row('Likely disposable domain', yn(st.likelyDisposable));
    c += `</div>`;
    parts.push(c);
  }

  // Username presence card
  const up = r.usernamePresence;
  if (up && up.status === 'ok') {
    let c = `<div class="triage-card"><h4>👤 Username presence: ${esc(up.username)}</h4>`;
    c += row('Found', `<span class="pill pill-warn">${esc(up.foundCount)}</span>`);
    c += row('Absent', esc(up.absentCount));
    c += row('Unknown / blocked', esc(up.unknownCount));
    if (up.found && up.found.length) {
      c += `<ul class="triage-found-list">`;
      up.found.forEach((f) => {
        c += `<li>✅ <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.site)}</a></li>`;
      });
      c += `</ul>`;
    }
    c += `</div>`;
    parts.push(c);
  }

  triageResults.innerHTML = parts.join('');
}
