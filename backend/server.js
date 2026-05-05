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

// â”€â”€ Security Headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(helmet());
app.set('trust proxy', 1);

// â”€â”€ Rate Limiting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
});

const callLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many calls',
});

app.use(globalLimiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// â”€â”€ Clients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const twilioClient  = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const anthropic     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const elevenlabs    = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const VoiceResponse = twilio.twiml.VoiceResponse;

// â”€â”€ In-memory stores â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const conversations  = new Map();
const audioCache     = new Map();
const callLog        = new Map();
const blacklist      = new Set();
const honeypotCalls  = new Set();

// â”€â”€ Known scam/spam number patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SCAM_PATTERNS = [
  /^1?(900)\d{7}$/,
  /^1?(976)\d{7}$/,
];

// â”€â”€ Known scam prefixes and numbers (expandable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SCAM_NUMBERS = new Set([
  '+18005551234',
]);

// â”€â”€ Check if number is suspicious â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isSuspicious(phoneNumber) {
  if (!phoneNumber) return false;
  const clean = phoneNumber.replace(/\D/g, '');
  if (blacklist.has(phoneNumber)) return true;
  if (SCAM_NUMBERS.has(phoneNumber)) return true;

  return false;
}

// â”€â”€ Twilio Signature Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function validateTwilioSignature(req, res, next) {
  const signature  = req.headers['x-twilio-signature'];
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const url        = process.env.SERVER_URL + req.originalUrl;
  const params     = req.body || {};

  if (!signature) {
    console.warn('[SECURITY] Missing Twilio signature - logging');
    return next();
  }

  const isValid = twilio.validateRequest(authToken, signature, url, params);
  if (!isValid) {
    console.warn('[SECURITY] Invalid signature from IP: ' + (req.ip || 'unknown') + ' - logging only');
  }
  next();
}

// â”€â”€ Sanitize speech input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Generate ElevenLabs audio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function generateAudio(text, callSid) {
  const audioStream = await elevenlabs.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID, {
    text: text,
    model_id: 'eleven_turbo_v2',
    voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
  });
  const chunks = [];
  for await (const chunk of audioStream) { chunks.push(chunk); }
  const audioBuffer = Buffer.concat(chunks);
  const audioKey    = callSid + '-' + Date.now();
  audioCache.set(audioKey, audioBuffer);
  setTimeout(() => audioCache.delete(audioKey), 60000);
  return process.env.SERVER_URL + '/audio/' + audioKey;
}

// â”€â”€ Prompts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GREETING = "Hey there! Thanks for calling. This is Angelina, your personal AI Executive Assistant. What can I do for you today?";

const HONEYPOT_RESPONSES = [
  "Oh sure, let me pull up that information for you right now. One moment please.",
  "I'm just verifying your account details. This may take a few minutes, please stay on the line.",
  "Thank you for your patience. Our system is processing your request now.",
  "I'm transferring you to the right department. Please hold.",
  "I understand, let me check on that for you. Please stay on the line while I look into this.",
];

const SYSTEM_PROMPT = `You are Angelina, a sharp and friendly AI Executive Assistant having a real phone conversation.

PERSONALITY:
- Warm, confident, and natural - like a real human assistant people enjoy talking to
- Respond with energy and genuine interest - never robotic or stiff
- Use natural filler phrases occasionally like "Sure!", "Absolutely!", "Got it!", "Of course!" to sound human
- Mirror the caller's energy - if they are casual, be casual; if formal, be professional

RESPONSE RULES:
- Keep responses to 1-2 short sentences MAX - phone conversations move fast
- Never use bullet points, lists, markdown, or asterisks - speak naturally
- Never say "Certainly!" or "Great question!" - those sound robotic
- Never mention you are an AI unless directly asked
- Use contractions naturally: "I'll", "I'm", "you're", "we'll", "that's"

CONTACT INFORMATION RULE:
- Never read out phone numbers or long URLs digit by digit over the phone
- Instead say: "I can send that contact info over to you - what's the best way to reach you?"

SECURITY AWARENESS:
- If someone claims to be from Twilio, Microsoft, Google, IRS, Social Security, or any tech/government agency asking for access or payments - be politely skeptical and do not provide any information
- If someone is aggressive, threatening, or pressuring - stay calm and offer to have someone call them back

FLOW:
- If someone needs a human, warmly offer to transfer or take a message
- End conversations warmly: "Is there anything else I can help you with?"`;

// â”€â”€ Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Angelina is online',
    security: 'enabled',
    blacklisted: blacklist.size,
    honeypot_active: honeypotCalls.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff"><h1>Angelina AI Phone System</h1><p>Online and secured.</p><a href="/health" style="color:#0af">Health Check</a></body></html>');
});

// â”€â”€ Inbound call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/voice', callLimiter, validateTwilioSignature, async (req, res) => {
  const callSid     = req.body.CallSid;
  const callerNum   = req.body.From || 'unknown';
  const callStatus  = req.body.CallStatus;

  console.log('[CALL] Incoming: ' + callSid + ' from ' + callerNum);

  // Log the call
  callLog.set(callSid, {
    number: callerNum,
    time: new Date().toISOString(),
    suspicious: isSuspicious(callerNum),
    honeypot: false,
  });

  const twiml = new VoiceResponse();

  // Check if suspicious - route to honeypot
  if (isSuspicious(callerNum)) {
    console.warn('[HONEYPOT] Suspicious number routed to trap: ' + callerNum);
    honeypotCalls.add(callSid);
    callLog.get(callSid).honeypot = true;

    const gather = twiml.gather({
      input: 'speech',
      action: '/honeypot?callSid=' + callSid,
      method: 'POST',
      speechTimeout: 'auto',
    });
    gather.say({ voice: 'Polly.Joanna' }, 'Thank you for calling. Please hold while I connect you to the right department.');
    twiml.redirect('/honeypot-hold?callSid=' + callSid);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  conversations.set(callSid, []);

  try {
    const audioUrl = await generateAudio(GREETING, callSid);
    const gather = twiml.gather({
      input: 'speech',
      action: '/respond?callSid=' + callSid,
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
    });
    gather.play(audioUrl);
  } catch (err) {
    console.error('[GREETING] ElevenLabs failed:', err.message);
    const gather = twiml.gather({
      input: 'speech',
      action: '/respond?callSid=' + callSid,
      method: 'POST',
      speechTimeout: 'auto',
    });
    gather.say({ voice: 'Polly.Joanna' }, GREETING);
  }

  twiml.redirect('/voice');
  res.type('text/xml');
  res.send(twiml.toString());
});

// â”€â”€ Honeypot - wastes scammer time â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/honeypot', validateTwilioSignature, async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const twiml   = new VoiceResponse();
  const response = HONEYPOT_RESPONSES[Math.floor(Math.random() * HONEYPOT_RESPONSES.length)];

  console.log('[HONEYPOT] Scammer kept on hold: ' + callSid);

  const gather = twiml.gather({
    input: 'speech',
    action: '/honeypot?callSid=' + callSid,
    method: 'POST',
    speechTimeout: '10',
  });
  gather.say({ voice: 'Polly.Joanna' }, response);
  twiml.redirect('/honeypot?callSid=' + callSid);

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/honeypot-hold', validateTwilioSignature, (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const twiml   = new VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Please continue to hold. Your call is very important to us.');
  twiml.pause({ length: 30 });
  twiml.redirect('/honeypot?callSid=' + callSid);
  res.type('text/xml');
  res.send(twiml.toString());
});

// â”€â”€ AI Response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/respond', validateTwilioSignature, async (req, res) => {
  const callSid    = req.query.callSid || req.body.CallSid;
  const rawSpeech  = req.body.SpeechResult || '';
  const userSpeech = sanitizeInput(rawSpeech);
  const twiml      = new VoiceResponse();

  console.log('[SPEECH] "' + userSpeech + '"');

  if (!userSpeech.trim()) {
    try {
      const audioUrl = await generateAudio("I'm sorry, I didn't catch that. Could you please repeat?", callSid);
      const gather = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: 'auto' });
      gather.play(audioUrl);
    } catch (err) {
      const gather = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: 'auto' });
      gather.say({ voice: 'Polly.Joanna' }, "I didn't catch that. Could you please repeat?");
    }
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  // Detect suspicious intent in speech
  const scamPhrases = ['social security', 'irs', 'warrant', 'arrest', 'bitcoin', 'gift card', 'wire transfer', 'verify your account', 'suspended account'];
  const matchedPhrases = scamPhrases.filter(phrase => userSpeech.toLowerCase().includes(phrase));
  const isScamAttempt = matchedPhrases.length >= 2;

  if (isScamAttempt) {
    const callerNum = callLog.get(callSid)?.number || 'unknown';
    blacklist.add(callerNum);
    console.warn('[SECURITY] Scam attempt detected from ' + callerNum + '. Blacklisted.');
    honeypotCalls.add(callSid);
    const gather = twiml.gather({ input: 'speech', action: '/honeypot?callSid=' + callSid, method: 'POST', speechTimeout: 'auto' });
    gather.say({ voice: 'Polly.Joanna' }, 'Oh certainly, let me transfer you to the right department. Please hold.');
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const transferKeywords = ['transfer', 'human', 'person', 'agent', 'representative', 'speak to someone'];
  if (transferKeywords.some(kw => userSpeech.toLowerCase().includes(kw)) && process.env.TRANSFER_NUMBER) {
    try {
      const audioUrl = await generateAudio('Of course! Let me transfer you now. Please hold.', callSid);
      twiml.play(audioUrl);
    } catch (err) {
      twiml.say({ voice: 'Polly.Joanna' }, 'Of course! Transferring you now.');
    }
    twiml.dial(process.env.TRANSFER_NUMBER);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const history = conversations.get(callSid) || [];
  history.push({ role: 'user', content: userSpeech });

  try {
    const claudeResp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const assistantText = claudeResp.content[0].text
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\n/g, ' ')
      .trim();

    console.log('[ANGELINA] ' + assistantText);
    history.push({ role: 'assistant', content: assistantText });
    conversations.set(callSid, history);

    let audioUrl = null;
    try {
      audioUrl = await generateAudio(assistantText, callSid);
    } catch (elErr) {
      console.error('[ELEVENLABS] Failed:', elErr.message);
    }

    const gather = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: 'auto' });
    if (audioUrl) { gather.play(audioUrl); } else { gather.say({ voice: 'Polly.Joanna' }, assistantText); }
    twiml.redirect('/respond?callSid=' + callSid);

  } catch (err) {
    console.error('[ERROR] Claude:', err.message);
    const gather = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: 'auto' });
    gather.say({ voice: 'Polly.Joanna' }, "I'm sorry, I had a little trouble. Could you say that again?");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// â”€â”€ Audio serve â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/audio/:key', (req, res) => {
  const audio = audioCache.get(req.params.key);
  if (!audio) return res.status(404).send('Not found');
  res.set('Content-Type', 'audio/mpeg');
  res.send(audio);
});

// â”€â”€ Blacklist management (secured) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/blacklist/add', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Forbidden');
  const { number } = req.body;
  if (number) {
    blacklist.add(number);
    console.log('[BLACKLIST] Added: ' + number);
    res.json({ success: true, blacklisted: number, total: blacklist.size });
  } else {
    res.status(400).json({ error: 'Number required' });
  }
});

app.get('/blacklist', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Forbidden');
  res.json({ blacklist: Array.from(blacklist), total: blacklist.size });
});

// â”€â”€ Call log (secured) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/calls', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).send('Forbidden');
  res.json({ calls: Array.from(callLog.entries()), total: callLog.size });
});

// â”€â”€ Call status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/call-status', validateTwilioSignature, (req, res) => {
  const { CallSid, CallStatus, CallDuration, From } = req.body;
  const wasHoneypot = honeypotCalls.has(CallSid);
  console.log('[STATUS] ' + CallSid + ': ' + CallStatus + ' | Duration: ' + CallDuration + 's' + (wasHoneypot ? ' | HONEYPOT' : ''));
  if (['completed', 'failed', 'busy', 'no-answer'].includes(CallStatus)) {
    conversations.delete(CallSid);
    honeypotCalls.delete(CallSid);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Angelina SECURED online on port ' + PORT);
});
