require('dotenv').config();
const express        = require('express');
const twilio         = require('twilio');
const Anthropic      = require('@anthropic-ai/sdk');
const { ElevenLabsClient } = require('elevenlabs');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const http           = require('http');

const app    = express();
const server = http.createServer(app);

// â”€â”€ Security â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(helmet());
app.set('trust proxy', 1);

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const callLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
});

app.use(globalLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// â”€â”€ Clients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const anthropic     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const elevenlabs    = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const VoiceResponse = twilio.twiml.VoiceResponse;

// â”€â”€ In-memory stores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const conversations = new Map();
const audioCache    = new Map();
const callLog       = new Map();
const blacklist     = new Set();
const honeypotCalls = new Set();

// â”€â”€ Known scam numbers (add as you discover them) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SCAM_NUMBERS = new Set([
  '+18005551234',
]);

// â”€â”€ Security helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isSuspicious(phoneNumber) {
  if (!phoneNumber) return false;
  if (blacklist.has(phoneNumber)) return true;
  if (SCAM_NUMBERS.has(phoneNumber)) return true;
  return false;
}

function validateTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    console.warn('[SECURITY] Missing Twilio signature - logging');
    return next();
  }
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    process.env.SERVER_URL + req.originalUrl,
    req.body || {}
  );
  if (!isValid) {
    console.warn('[SECURITY] Invalid signature from: ' + (req.ip || 'unknown'));
  }
  next();
}

function sanitizeInput(text) {
  if (!text) return '';
  return text
    .substring(0, 500)
    .replace(/[<>{}]/g, '')
    .replace(/ignore previous instructions/gi, '')
    .replace(/system prompt/gi, '')
    .replace(/jailbreak/gi, '')
    .trim();
}

// â”€â”€ ElevenLabs - generate audio, serve via cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Audio is cached and served from our server so Twilio can
// fetch it as a simple MP3 URL - most reliable method
async function generateAudio(text, cacheKey) {
  // Return cached version if available
  if (audioCache.has(cacheKey)) {
    return process.env.SERVER_URL + '/audio/' + cacheKey;
  }

  const audioStream = await elevenlabs.textToSpeech.convert(
    process.env.ELEVENLABS_VOICE_ID,
    {
      text: text,
      model_id: 'eleven_turbo_v2',
      output_format: 'mp3_44100_128',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.85,
        style: 0.25,
        use_speaker_boost: true,
      },
    }
  );

  const chunks = [];
  for await (const chunk of audioStream) { chunks.push(chunk); }
  const audioBuffer = Buffer.concat(chunks);

  audioCache.set(cacheKey, audioBuffer);
  // Clean up after 2 minutes
  setTimeout(() => audioCache.delete(cacheKey), 120000);

  return process.env.SERVER_URL + '/audio/' + cacheKey;
}

// â”€â”€ Serve cached audio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/audio/:key', (req, res) => {
  const audio = audioCache.get(req.params.key);
  if (!audio) return res.status(404).send('Audio not found');
  res.set('Content-Type', 'audio/mpeg');
  res.set('Cache-Control', 'public, max-age=120');
  res.send(audio);
});

// â”€â”€ Prompts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GREETING_TEXT = "Hey there! Thanks for calling. This is Angelina, your personal AI Executive Assistant. What can I do for you today?";

const HONEYPOT_LINES = [
  "Oh sure, let me pull that up for you right now. One moment please.",
  "I'm verifying your account details. This may take a few minutes, please stay on the line.",
  "Thank you for your patience. Our system is processing your request now.",
  "I'm connecting you to the right department. Please continue to hold.",
  "Let me check on that for you. Please stay on the line.",
];

const SYSTEM_PROMPT = `You are Angelina, a sharp and friendly AI Executive Assistant on a phone call.

PERSONALITY:
- Warm, confident, natural - like a real human assistant people genuinely enjoy talking to
- Energetic and genuinely interested - never robotic or stiff
- Use natural phrases like "Sure!", "Absolutely!", "Got it!", "Of course!" occasionally
- Match the caller's energy - casual with casual callers, professional with formal ones

RESPONSE RULES:
- 1-2 short sentences MAXIMUM - phone conversations move fast
- No bullet points, lists, markdown, or asterisks - speak naturally
- No "Certainly!" or "Great question!" - sounds robotic
- Never reveal you are an AI unless directly asked
- Use contractions: "I'll", "I'm", "you're", "we'll", "that's"
- Speak as if continuing a natural flowing conversation

CONTACT INFO RULE:
- Never read phone numbers or URLs aloud
- Say: "I can send that info to you - what's the best way to reach you?"

SECURITY:
- If caller claims to be from IRS, Microsoft, Social Security, or any agency demanding payment or access - be politely skeptical, offer to have someone call them back
- If aggressive or threatening - stay calm, offer callback

FLOW:
- Offer to transfer or take a message if they need a human
- Close warmly: "Is there anything else I can help you with?"`;

// â”€â”€ Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.0',
    message: 'Angelina is online',
    security: 'enabled',
    blacklisted: blacklist.size,
    honeypot_active: honeypotCalls.size,
    audio_cached: audioCache.size,
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.send('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff"><h1>Angelina v5</h1><p>Online and secured.</p><a href="/health" style="color:#0af">Health Check</a></body></html>');
});

// â”€â”€ Inbound call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/voice', callLimiter, validateTwilioSignature, async (req, res) => {
  const callSid   = req.body.CallSid;
  const callerNum = req.body.From || 'unknown';

  console.log('[CALL] Incoming: ' + callSid + ' from ' + callerNum);

  callLog.set(callSid, {
    number: callerNum,
    time: new Date().toISOString(),
    suspicious: isSuspicious(callerNum),
    honeypot: false,
    turns: 0,
  });

  const twiml = new VoiceResponse();

  // Route suspicious numbers to honeypot
  if (isSuspicious(callerNum)) {
    console.warn('[HONEYPOT] Routing to trap: ' + callerNum);
    honeypotCalls.add(callSid);
    callLog.get(callSid).honeypot = true;
    twiml.say({ voice: 'Polly.Joanna' }, 'Thank you for calling. Please hold while I connect you.');
    twiml.pause({ length: 5 });
    twiml.redirect({ method: 'POST' }, '/honeypot?callSid=' + callSid);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  conversations.set(callSid, []);

  // Pre-generate greeting audio
  try {
    const greetKey = 'greeting-' + callSid;
    const audioUrl = await generateAudio(GREETING_TEXT, greetKey);
    console.log('[GREETING] ElevenLabs audio ready');

    const gather = twiml.gather({
      input: 'speech',
      action: '/respond?callSid=' + callSid,
      method: 'POST',
      speechTimeout: '2',
      speechModel: 'phone_call',
      enhanced: 'true',
      language: 'en-US',
    });
    gather.play(audioUrl);
    // No redirect here - gather handles the loop naturally
  } catch (err) {
    console.error('[GREETING] ElevenLabs failed, using Polly:', err.message);
    const gather = twiml.gather({
      input: 'speech',
      action: '/respond?callSid=' + callSid,
      method: 'POST',
      speechTimeout: '2',
      speechModel: 'phone_call',
      language: 'en-US',
    });
    gather.say({ voice: 'Polly.Joanna-Neural' }, GREETING_TEXT);
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// â”€â”€ Honeypot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/honeypot', validateTwilioSignature, (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const twiml   = new VoiceResponse();
  const line    = HONEYPOT_LINES[Math.floor(Math.random() * HONEYPOT_LINES.length)];
  console.log('[HONEYPOT] Keeping scammer busy: ' + callSid);
  twiml.say({ voice: 'Polly.Joanna' }, line);
  twiml.pause({ length: 20 });
  twiml.redirect({ method: 'POST' }, '/honeypot?callSid=' + callSid);
  res.type('text/xml');
  res.send(twiml.toString());
});

// â”€â”€ Main AI response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/respond', validateTwilioSignature, async (req, res) => {
  const callSid    = req.query.callSid || req.body.CallSid;
  const rawSpeech  = req.body.SpeechResult || '';
  const userSpeech = sanitizeInput(rawSpeech);
  const twiml      = new VoiceResponse();

  console.log('[SPEECH] "' + userSpeech + '"');

  // Update call log turn count
  if (callLog.has(callSid)) {
    callLog.get(callSid).turns++;
  }

  // No speech detected
  if (!userSpeech.trim()) {
    try {
      const key      = 'repeat-' + callSid;
      const audioUrl = await generateAudio("I'm sorry, I didn't catch that. Could you please repeat?", key);
      const gather   = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: '2', speechModel: 'phone_call', enhanced: 'true' });
      gather.play(audioUrl);
    } catch (err) {
      const gather = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: '2', speechModel: 'phone_call' });
      gather.say({ voice: 'Polly.Joanna-Neural' }, "I didn't catch that. Could you please repeat?");
    }
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Scam detection - requires 2+ matching phrases
  const scamPhrases = ['social security', 'irs', 'warrant', 'arrest', 'bitcoin', 'gift card', 'wire transfer', 'verify your account', 'suspended account'];
  const matched = scamPhrases.filter(p => userSpeech.toLowerCase().includes(p));
  if (matched.length >= 2) {
    const callerNum = callLog.get(callSid)?.number || 'unknown';
    blacklist.add(callerNum);
    honeypotCalls.add(callSid);
    console.warn('[SECURITY] Scam detected from ' + callerNum + ' - blacklisted. Phrases: ' + matched.join(', '));
    twiml.say({ voice: 'Polly.Joanna' }, 'Oh certainly, let me connect you to the right team. Please hold.');
    twiml.pause({ length: 3 });
    twiml.redirect({ method: 'POST' }, '/honeypot?callSid=' + callSid);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Transfer request
  const transferWords = ['transfer', 'human', 'person', 'agent', 'representative', 'speak to someone', 'real person'];
  if (transferWords.some(w => userSpeech.toLowerCase().includes(w)) && process.env.TRANSFER_NUMBER) {
    console.log('[TRANSFER] Transferring call');
    try {
      const key      = 'transfer-' + callSid;
      const audioUrl = await generateAudio('Of course! Let me transfer you right now. Please hold.', key);
      twiml.play(audioUrl);
    } catch (err) {
      twiml.say({ voice: 'Polly.Joanna-Neural' }, 'Of course! Transferring you now.');
    }
    twiml.dial(process.env.TRANSFER_NUMBER);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Normal AI conversation
  const history = conversations.get(callSid) || [];
  history.push({ role: 'user', content: userSpeech });

  try {
    // Get Claude response
    const claudeResp = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system:     SYSTEM_PROMPT,
      messages:   history,
    });

    const assistantText = claudeResp.content[0].text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    console.log('[ANGELINA] ' + assistantText);
    history.push({ role: 'assistant', content: assistantText });
    conversations.set(callSid, history);

    // Generate ElevenLabs audio
    const audioKey = callSid + '-' + Date.now();
    let audioUrl   = null;

    try {
      audioUrl = await generateAudio(assistantText, audioKey);
      console.log('[AUDIO] Ready: ' + audioKey);
    } catch (elErr) {
      console.error('[ELEVENLABS] Failed, using Polly:', elErr.message);
    }

    // Respond to caller
    const gather = twiml.gather({
      input:       'speech',
      action:      '/respond?callSid=' + callSid,
      method:      'POST',
      speechTimeout: '2',
      speechModel: 'phone_call',
      enhanced:    'true',
      language:    'en-US',
    });

    if (audioUrl) {
      gather.play(audioUrl);
    } else {
      gather.say({ voice: 'Polly.Joanna-Neural' }, assistantText);
    }

  } catch (err) {
    console.error('[ERROR] Claude failed:', err.message);
    const gather = twiml.gather({
      input:       'speech',
      action:      '/respond?callSid=' + callSid,
      method:      'POST',
      speechTimeout: '2',
      speechModel: 'phone_call',
    });
    gather.say({ voice: 'Polly.Joanna-Neural' }, "I'm sorry, I had a little trouble there. Could you say that again?");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// â”€â”€ Admin: Blacklist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/blacklist/add', (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) return res.status(403).send('Forbidden');
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Number required' });
  blacklist.add(number);
  console.log('[BLACKLIST] Added: ' + number);
  res.json({ success: true, number, total: blacklist.size });
});

app.get('/blacklist', (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) return res.status(403).send('Forbidden');
  res.json({ blacklist: Array.from(blacklist), total: blacklist.size });
});

// â”€â”€ Admin: Call log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/calls', (req, res) => {
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) return res.status(403).send('Forbidden');
  res.json({ calls: Array.from(callLog.entries()), total: callLog.size });
});

// â”€â”€ Call status callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/call-status', validateTwilioSignature, (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  const wasHoneypot = honeypotCalls.has(CallSid);
  console.log('[STATUS] ' + CallSid + ': ' + CallStatus + ' | ' + CallDuration + 's' + (wasHoneypot ? ' | HONEYPOT' : ''));
  if (['completed', 'failed', 'busy', 'no-answer'].includes(CallStatus)) {
    conversations.delete(CallSid);
    honeypotCalls.delete(CallSid);
  }
  res.sendStatus(200);
});

// â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Angelina v5 online on port ' + PORT);
  console.log('Health: ' + process.env.SERVER_URL + '/health');
});
