// backend/server.js - AI Phone System for Render.com
// Stack: SignalWire + Claude AI + ElevenLabs (Angelina voice)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// ─── Audio Cache Directory ────────────────────────────────────────────────────
const AUDIO_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/audio', express.static(AUDIO_DIR)); // Serve audio files
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── In-Memory State ─────────────────────────────────────────────────────────
const users = {
  'kimo@pyramidrepairs.com': {
    password: process.env.ADMIN_PASSWORD || 'pyramid2024',
    identity: 'kimo_admin',
    name: 'Kimo - Pyramid Repairs'
  }
};

const callSessions = {};

// ─── AI System Prompt ────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Angelina, a friendly and professional AI receptionist.
Your job is to answer calls, understand what the caller needs, and help them or transfer them to the right person.

Business context: You work for a local business in San Diego. Be warm, concise, and helpful.

Rules:
- Keep responses SHORT (1-3 sentences). This is a phone call, not a chat.
- If the caller needs urgent help or asks to speak to a human, say you will transfer them now.
- To trigger a transfer, end your response with exactly: [TRANSFER]
- Never say you are an AI unless directly asked.
- Do not use bullet points, markdown, or special characters — speak naturally.`;

// ─── Helper: Generate ElevenLabs Audio ───────────────────────────────────────
async function generateAudio(text) {
  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'e3SQYxMM1v1apbaHnt8w';
    
    const audioStream = await elevenlabs.generate({
      voice: voiceId,
      text: text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    });

    // Save to file with unique name
    const filename = `${crypto.randomUUID()}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);
    const writeStream = fs.createWriteStream(filepath);

    for await (const chunk of audioStream) {
      writeStream.write(chunk);
    }
    
    await new Promise((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Clean up old files (keep last 50)
    cleanupAudioFiles();

    const audioUrl = `${process.env.SERVER_URL}/audio/${filename}`;
    console.log(`🎙️ ElevenLabs audio generated: ${audioUrl}`);
    return audioUrl;

  } catch (err) {
    console.error('❌ ElevenLabs error:', err.message);
    return null;
  }
}

// ─── Helper: Cleanup old audio files ─────────────────────────────────────────
function cleanupAudioFiles() {
  try {
    const files = fs.readdirSync(AUDIO_DIR)
      .map(f => ({ name: f, time: fs.statSync(path.join(AUDIO_DIR, f)).mtime }))
      .sort((a, b) => b.time - a.time);
    
    if (files.length > 50) {
      files.slice(50).forEach(f => {
        fs.unlinkSync(path.join(AUDIO_DIR, f.name));
      });
    }
  } catch (err) {
    console.error('Cleanup error:', err.message);
  }
}

// ─── Helper: Build LaML with ElevenLabs audio ────────────────────────────────
async function buildVoiceResponse(text, action, shouldTransfer = false) {
  const audioUrl = await generateAudio(text);

  if (shouldTransfer) {
    if (audioUrl) {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Dial action="/api/transfer-complete" method="POST">
    <Number>${process.env.TRANSFER_NUMBER}</Number>
  </Dial>
</Response>`;
    } else {
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(text)}</Say>
  <Dial action="/api/transfer-complete" method="POST">
    <Number>${process.env.TRANSFER_NUMBER}</Number>
  </Dial>
</Response>`;
    }
  }

  if (audioUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US">
    <Play>${audioUrl}</Play>
  </Gather>
  <Redirect>${action}</Redirect>
</Response>`;
  } else {
    // Fallback to Polly if ElevenLabs fails
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${action}" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Polly.Joanna">${escapeXml(text)}</Say>
  </Gather>
  <Redirect>${action}</Redirect>
</Response>`;
  }
}

// ─── Helper: Claude AI Response ──────────────────────────────────────────────
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

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Phone System is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    voice: 'ElevenLabs Angelina'
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

// ─── Inbound Call Webhook ─────────────────────────────────────────────────────
app.post('/api/inbound', async (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From || 'Unknown';
  console.log(`📞 Inbound call from ${from} | SID: ${callSid}`);

  const greeting = `Hello! Thank you for calling. How can I help you today?`;
  const laml = await buildVoiceResponse(greeting, '/api/respond');
  res.type('text/xml').send(laml);
});

// ─── Conversation Loop ────────────────────────────────────────────────────────
app.post('/api/respond', async (req, res) => {
  const callSid = req.body.CallSid;
  const speechResult = req.body.SpeechResult || '';
  console.log(`🗣️ [${callSid}] Caller said: "${speechResult}"`);

  let laml;

  try {
    const { text, shouldTransfer } = await getAIResponse(callSid, speechResult);
    console.log(`🤖 [${callSid}] AI: "${text}" | Transfer: ${shouldTransfer}`);

    if (shouldTransfer) {
      delete callSessions[callSid];
    }

    laml = await buildVoiceResponse(text, '/api/respond', shouldTransfer);

  } catch (err) {
    console.error('AI error:', err.message);
    const errorText = `I'm sorry, I'm having trouble right now. Let me transfer you to someone who can help.`;
    const audioUrl = await generateAudio(errorText);
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${audioUrl ? `<Play>${audioUrl}</Play>` : `<Say voice="Polly.Joanna">${escapeXml(errorText)}</Say>`}
  <Dial><Number>${process.env.TRANSFER_NUMBER}</Number></Dial>
</Response>`;
  }

  res.type('text/xml').send(laml);
});

// ─── Transfer Complete ─────────────────────────────────────────────────────────
app.post('/api/transfer-complete', async (req, res) => {
  const callSid = req.body.CallSid;
  const dialStatus = req.body.DialCallStatus;
  console.log(`📲 Transfer complete [${callSid}] status: ${dialStatus}`);

  let laml;
  if (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed') {
    const text = `I'm sorry, no one is available right now. Please call back during business hours or leave a message after the tone.`;
    const audioUrl = await generateAudio(text);
    laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${audioUrl ? `<Play>${audioUrl}</Play>` : `<Say voice="Polly.Joanna">${escapeXml(text)}</Say>`}
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
  console.log(`🎙️ Voice: ElevenLabs Angelina`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`📞 Inbound webhook: http://localhost:${PORT}/api/inbound`);
});
