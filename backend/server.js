require('dotenv').config();
const express        = require('express');
const twilio         = require('twilio');
const Anthropic      = require('@anthropic-ai/sdk');
const { ElevenLabsClient } = require('elevenlabs');
const http           = require('http');

const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const VoiceResponse = twilio.twiml.VoiceResponse;
const conversations = new Map();
const audioCache    = new Map();

const GREETING = "Hey there! Thanks for calling. This is Angelina, your personal AI Executive Assistant. What can I do for you today?";

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
- Never mention you are an AI unless directly asked directly
- Use contractions naturally: "I'll", "I'm", "you're", "we'll", "that's"

CONTACT INFORMATION RULE - VERY IMPORTANT:
- Never read out phone numbers or long URLs digit by digit over the phone
- Instead say something like: "I can send that contact info over to you in a text - would that work?"
- This applies to any business phone number, address, or website link

FLOW:
- If someone asks for a human, warmly offer to transfer or take a message
- If you do not know something specific about the business, say "Let me check on that for you" or offer to take a message
- End conversations warmly: "Is there anything else I can help you with?"`;

// Generate ElevenLabs audio and cache it, return URL
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Angelina is online', voice: 'ElevenLabs Angelina', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff"><h1>Angelina AI Phone System</h1><p>Online and ready.</p><a href="/health" style="color:#0af">Health Check</a></body></html>');
});

// Inbound call - generate ElevenLabs greeting immediately
app.post('/voice', async (req, res) => {
  const callSid = req.body.CallSid;
  console.log('[CALL] Incoming: ' + callSid + ' from ' + req.body.From);
  conversations.set(callSid, []);

  const twiml = new VoiceResponse();

  try {
    const audioUrl = await generateAudio(GREETING, callSid);
    console.log('[GREETING] ElevenLabs audio ready');
    const gather = twiml.gather({
      input: 'speech',
      action: '/respond?callSid=' + callSid,
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
    });
    gather.play(audioUrl);
  } catch (err) {
    console.error('[GREETING] ElevenLabs failed, using Polly:', err.message);
    const gather = twiml.gather({
      input: 'speech',
      action: '/respond?callSid=' + callSid,
      method: 'POST',
      speechTimeout: 'auto',
      language: 'en-US',
    });
    gather.say({ voice: 'Polly.Joanna' }, GREETING);
  }

  twiml.redirect('/voice');
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/respond', async (req, res) => {
  const callSid    = req.query.callSid || req.body.CallSid;
  const userSpeech = req.body.SpeechResult || '';
  console.log('[SPEECH] "' + userSpeech + '"');
  const twiml = new VoiceResponse();

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

  const transferKeywords = ['transfer', 'human', 'person', 'agent', 'representative', 'speak to someone'];
  if (transferKeywords.some(kw => userSpeech.toLowerCase().includes(kw)) && process.env.TRANSFER_NUMBER) {
    console.log('[TRANSFER] Transferring to ' + process.env.TRANSFER_NUMBER);
    try {
      const audioUrl = await generateAudio('Of course! Let me transfer you now. Please hold.', callSid);
      twiml.play(audioUrl);
    } catch (err) {
      twiml.say({ voice: 'Polly.Joanna' }, 'Of course! Let me transfer you now. Please hold.');
    }
    twiml.dial(process.env.TRANSFER_NUMBER);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const history = conversations.get(callSid) || [];
  history.push({ role: 'user', content: userSpeech });

  try {
    // Run Claude and ElevenLabs concurrently for speed
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
      console.log('[ELEVENLABS] Audio ready');
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

app.get('/audio/:key', (req, res) => {
  const audio = audioCache.get(req.params.key);
  if (!audio) return res.status(404).send('Not found');
  res.set('Content-Type', 'audio/mpeg');
  res.send(audio);
});

app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  console.log('[STATUS] ' + CallSid + ': ' + CallStatus);
  if (['completed', 'failed', 'busy', 'no-answer'].includes(CallStatus)) {
    conversations.delete(CallSid);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Angelina online on port ' + PORT);
});
