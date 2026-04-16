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
