require('dotenv').config();
const express        = require('express');
const twilio         = require('twilio');
const Anthropic      = require('@anthropic-ai/sdk');
const { ElevenLabsClient } = require('elevenlabs');
const http           = require('http');
const path           = require('path');

const app    = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const VoiceResponse = twilio.twiml.VoiceResponse;
const conversations = new Map();
const audioCache    = new Map();

const SYSTEM_PROMPT = `You are Angelina, a friendly and professional AI receptionist.
You answer calls on behalf of small businesses, greet callers warmly,
answer common questions, take messages, and transfer calls when needed.
Keep responses concise and natural - this is a phone conversation.
Never mention that you are an AI unless directly asked.
If someone needs to speak with a human, offer to transfer them or take a message.`;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Angelina is online', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff"><h1>Angelina AI Phone System</h1><p>Online and ready.</p><p>Twilio webhook: ' + process.env.SERVER_URL + '/voice</p><p><a href="/health" style="color:#0af">Health Check</a></p></body></html>');
});

app.post('/voice', async (req, res) => {
  const callSid = req.body.CallSid;
  console.log('[CALL] Incoming: ' + callSid + ' from ' + req.body.From);
  conversations.set(callSid, []);
  const twiml  = new VoiceResponse();
  const gather = twiml.gather({
    input: 'speech',
    action: '/respond?callSid=' + callSid,
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-US',
  });
  gather.say({ voice: 'Polly.Joanna' }, 'Hello! Thank you for calling. This is Angelina. How can I help you today?');
  twiml.redirect('/voice');
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/respond', async (req, res) => {
  const callSid    = req.query.callSid || req.body.CallSid;
  const userSpeech = req.body.SpeechResult || '';
  console.log('[SPEECH] ' + callSid + ': "' + userSpeech + '"');
  const twiml = new VoiceResponse();

  if (!userSpeech.trim()) {
    const gather = twiml.gather({ input: 'speech', action: '/respond?callSid=' + callSid, method: 'POST', speechTimeout: 'auto' });
    gather.say({ voice: 'Polly.Joanna' }, "I didn't catch that. Could you please repeat?");
    twiml.redirect('/voice');
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const transferKeywords = ['transfer', 'human', 'person', 'agent', 'representative', 'speak to someone'];
  if (transferKeywords.some(kw => userSpeech.toLowerCase().includes(kw)) && process.env.TRANSFER_NUMBER) {
    console.log('[TRANSFER] Transferring to ' + process.env.TRANSFER_NUMBER);
    twiml.say({ voice: 'Polly.Joanna' }, 'Of course! Let me transfer you now. Please hold.');
    twiml.dial(process.env.TRANSFER_NUMBER);
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  const history = conversations.get(callSid) || [];
  history.push({ role: 'user', content: userSpeech });

  try {
    const claudeResp = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: history,
    });
    const assistantText = claudeResp.content[0].text;
    console.log('[ANGELINA] ' + assistantText);
    history.push({ role: 'assistant', content: assistantText });
    conversations.set(callSid, history);

    let audioUrl = null;
    try {
      const audioStream = await elevenlabs.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID, {
        text: assistantText,
        model_id: 'eleven_turbo_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      });
      const chunks = [];
      for await (const chunk of audioStream) { chunks.push(chunk); }
      const audioBuffer = Buffer.concat(chunks);
      const audioKey    = callSid + '-' + Date.now();
      audioCache.set(audioKey, audioBuffer);
      audioUrl = process.env.SERVER_URL + '/audio/' + audioKey;
    } catch (elErr) {
      console.error('[ELEVENLABS] Fallback to Twilio TTS:', elErr.message);
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
  setTimeout(() => audioCache.delete(req.params.key), 30000);
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
