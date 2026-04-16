// backend/server.js - AI Phone System FOR RENDER.COM
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKey = process.env.TWILIO_API_KEY;
const apiSecret = process.env.TWILIO_API_SECRET;
const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

const client = twilio(accountSid, authToken);
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Simple in-memory user store (replace with database later)
const users = {
  'demo@user.com': { 
    password: 'demo123', 
    identity: 'demo_user',
    name: 'Demo User'
  },
  'admin@business.com': { 
    password: 'admin123', 
    identity: 'admin_user',
    name: 'Admin User'
  },
  'kimo@pyramidrepairs.com': {
    password: 'pyramid2024',
    identity: 'kimo_admin',
    name: 'Kimo - Pyramid Repairs'
  }
};

// Health check endpoint (Render uses this)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Web Softphone API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  console.log('Login attempt:', email);
  
  if (users[email] && users[email].password === password) {
    res.json({ 
      success: true, 
      identity: users[email].identity,
      name: users[email].name,
      message: 'Login successful' 
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid email or password' 
    });
  }
});

// Generate Twilio access token
app.post('/api/token', (req, res) => {
  const { identity } = req.body;
  
  console.log('Token requested for:', identity);
  
  if (!identity) {
    return res.status(400).json({ error: 'Identity required' });
  }
  
  try {
    // Create access token
    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity: identity,
      ttl: 3600 // 1 hour
    });
    
    // Create voice grant
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true
    });
    
    token.addGrant(voiceGrant);
    
    res.json({
      identity: identity,
      token: token.toJwt()
    });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Make outbound call
app.post('/api/call', async (req, res) => {
  const { to, from } = req.body;
  
  console.log('Outbound call request:', { to, from });
  
  try {
    const call = await client.calls.create({
      url: `${process.env.SERVER_URL}/api/twiml`,
      to: to,
      from: from || process.env.TWILIO_PHONE_NUMBER
    });
    
    res.json({ 
      success: true, 
      callSid: call.sid,
      status: call.status 
    });
  } catch (error) {
    console.error('Call error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// TwiML endpoint for voice
app.all('/api/twiml', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  
  console.log('TwiML request:', req.body);
  
  // This is where calls connect
  const numberToDial = req.body.To || req.query.To;
  
  if (numberToDial) {
    const dial = twiml.dial({
      callerId: process.env.TWILIO_PHONE_NUMBER
    });
    dial.number(numberToDial);
  } else {
    twiml.say('Thank you for calling. Please enter a phone number.');
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Get call history
app.get('/api/calls/:identity', async (req, res) => {
  const { identity } = req.params;
  
  console.log('Call history requested for:', identity);
  
  try {
    const calls = await client.calls.list({
      limit: 50
    });
    
    res.json({ 
      success: true, 
      calls: calls.map(call => ({
        sid: call.sid,
        from: call.from,
        to: call.to,
        status: call.status,
        duration: call.duration,
        startTime: call.startTime,
        endTime: call.endTime,
        direction: call.direction
      }))
    });
  } catch (error) {
    console.error('Call history error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Phone Sytsem running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
});
