// backend/server.js - AI Phone System for Render.com
// Stack: SignalWire + Claude AI + ElevenLabs Voice

const express = require('express');
const cors = require('cors');
const path = require('path');
const { RestClient } = require('@signalwire/compatibility-api');
const Anthropic = require('@anthropic-ai/sdk');
const { ElevenLabsClient } = require('elevenlabs');
require('dotenv').config();

const app = express();

// ─── Clients ────────────────────────────────────────────────────────────────
const swClient = RestClient(
  process.env.SIGNALWIRE_PROJECT_ID,
  process.env.SIGNALWIRE_AUTH_TOKEN,
  { signalwireSpaceUrl: process.env.SIGNALWIRE_SPACE_URL }
);

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── In-Memory State ─────────────────────────────────────────────────────────
// Simple user store - replace with a database later
const users = {
  'kimo@pyramidrepairs.com': {
    password: process.env.ADMIN_PASSWORD || 'pyramid2024',
    identity: 'kimo_admin',
    name: 'Kimo - Pyramid Repairs'
  }
};

// Active call conversation histories keyed by CallSid
const callSessions = {};

// ─── AI System Prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Charlie, a friendly and professional AI receptionist.
Your job is to answer calls, understand what the caller needs, and help them or transfer them to the right person.

Business context: You work for a local business in San Diego. Be warm, concise, and helpful.

Rules:
- Keep responses SHORT (1-3 sentences). This is a phone call, not a chat.
- If the caller needs urgent help or asks to speak to a human, say you will transfer them now.
- To trigger a transfer, end your response with exactly: [TRANSFER]
- Never say you are an AI unless directly asked.
- Do not use bullet points, markdown, or special characters — speak naturally.`;

// ─── Helper: Claude response ─────────────────────────────────────────────────
async function getAIResponse(callSid, userMessage) {
  if (!callSessions[callSid]) {
    callSessions[callSid] = [];
  }

  callSessions[callSid].push({ role: 'user', content: userMessage });

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: callSessions[callSid]
  });

  const aiText = response.content[0].text;
  callSessions[callSid].push({ role: 'assistant', content: aiText });

  const shouldTransfer = aiText.includes('[TRANSFER]');
  const cleanText = aiText.replace('[TRANSFER]', '').trim();

  return { text: cleanText, shouldTransfer };
}

// ─── Helper: ElevenLabs TTS → base64 audio URL ───────────────────────────────
async function textToSpeech(text) {
  try {
    const audioStream = await elevenlabs.generate({
      voice: process.env.ELEVENLABS_VOICE_ID || 'Charlie',
      text,
      model_id: 'eleven_turbo_v2'
    });

    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('ElevenLabs TTS error:', err.message);
    return null;
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Phone System is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────
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
    res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
});

// ─── SignalWire Access Token (for softphone WebRTC) ───────────────────────────
app.post('/api/token', (req, res) => {
  const { identity } = req.body;
  if (!identity) return res.status(400).json({ error: 'Identity required' });

  try {
    const { jwt } = require('@signalwire/compatibility-api');
    const token = new jwt.AccessToken(
      process.env.SIGNALWIRE_PROJECT_ID,
      process.env.SIGNALWIRE_API_KEY,
      process.env.SIGNALWIRE_API_SECRET,
      { identity, ttl: 3600 }
    );
    const voiceGrant = new jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: process.env.SIGNALWIRE_APP_SID,
      incomingAllow: true
    });
    token.addGrant(voiceGrant);
    res.json({ identity, token: token.toJwt() });
  } catch (err) {
    console.error('Token error:', err.message);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// ─── Inbound Call Webhook (SignalWire calls this when a call arrives) ─────────
app.post('/api/inbound', async (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From || 'Unknown';

  console.log(`📞 Inbound call from ${from} | SID: ${callSid}`);

  const greeting = `Hello! Thanks for calling. How can I help you today?`;
  const { text } = { text: greeting }; // no Claude needed for first greeting

  // Build SignalWire LaML (compatible with TwiML)
  const laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/api/respond" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">${escapeXml(greeting)}</Say>
  </Gather>
  <Redirect>/api/inbound</Redirect>
</Response>`;

  res.type('text/xml').send(laml);
});

// ─── Conversation Loop ────────────────────────────────────────────────────────
app.post('/api/respond', async (req, res) => {
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || '';

  console.log(`🗣️  [${callSid}] Caller said: "${speechResult}"`);

  let laml;

  try {
    const { text, shouldTransfer } = await getAIResponse(callSid, speechResult);
    console.log(`🤖 [${callSid}] AI: "${text}" | Transfer: ${shouldTransfer}`);

    if (shouldTransfer) {
      // Clean up session
      delete callSessions[callSid];

      laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(text)}</Say>
  <Dial action="/api/transfer-complete" method="POST">
    <Number>${process.env.TRANSFER_NUMBER}</Number>
  </Dial>
</Response>`;
    } else {
      laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/api/respond" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">${escapeXml(text)}</Say>
  </Gather>
  <Redirect>/api/inbound</Redirect>
</Response>`;
    }
  } catch (err) {
    console.error('AI error:', err.message);
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, I'm having trouble right now. Let me transfer you to someone who can help.</Say>
  <Dial><Number>${process.env.TRANSFER_NUMBER}</Number></Dial>
</Response>`;
  }

  res.type('text/xml').send(laml);
});

// ─── Transfer Complete ─────────────────────────────────────────────────────────
app.post('/api/transfer-complete', (req, res) => {
  const callSid = req.body.CallSid;
  const dialStatus = req.body.DialCallStatus;
  console.log(`📲 Transfer complete [${callSid}] status: ${dialStatus}`);

  let laml;
  if (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed') {
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, no one is available right now. Please call back during business hours or leave a message after the tone.</Say>
  <Record maxLength="60" />
</Response>`;
  } else {
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;
  }

  res.type('text/xml').send(laml);
});

// ─── Outbound Call ────────────────────────────────────────────────────────────
app.post('/api/call', async (req, res) => {
  const { to } = req.body;
  console.log('📤 Outbound call to:', to);

  try {
    const call = await swClient.calls.create({
      url: `${process.env.SERVER_URL}/api/twiml`,
      to,
      from: process.env.SIGNALWIRE_PHONE_NUMBER
    });
    res.json({ success: true, callSid: call.sid, status: call.status });
  } catch (err) {
    console.error('Outbound call error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Outbound TwiML ───────────────────────────────────────────────────────────
app.all('/api/twiml', (req, res) => {
  const numberToDial = req.body.To || req.query.To;
  let laml;

  if (numberToDial) {
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${process.env.SIGNALWIRE_PHONE_NUMBER}">
    <Number>${escapeXml(numberToDial)}</Number>
  </Dial>
</Response>`;
  } else {
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling.</Say>
</Response>`;
  }

  res.type('text/xml').send(laml);
});

// ─── Call History ─────────────────────────────────────────────────────────────
app.get('/api/calls/:identity', async (req, res) => {
  console.log('📋 Call history requested');
  try {
    const calls = await swClient.calls.list({ limit: 50 });
    res.json({
      success: true,
      calls: calls.map(c => ({
        sid: c.sid,
        from: c.from,
        to: c.to,
        status: c.status,
        duration: c.duration,
        startTime: c.startTime,
        endTime: c.endTime,
        direction: c.direction
      }))
    });
  } catch (err) {
    console.error('Call history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Catch-all → Frontend ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AI Phone System running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`📞 Inbound webhook: http://localhost:${PORT}/api/inbound`);
});
