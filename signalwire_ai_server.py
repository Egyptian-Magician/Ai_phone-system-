"""
SignalWire + ElevenLabs AI Calling Server
Enhanced version with proper audio handling and streaming
Compatible with latest ElevenLabs API
"""
from flask import Flask, request, Response, send_file
from signalwire.rest import Client as SignalWireClient
from signalwire.voice_response import VoiceResponse, Gather
from elevenlabs import ElevenLabs
from anthropic import Anthropic
import os
from dotenv import load_dotenv
import tempfile
import uuid
from pathlib import Path

# Load environment variables - explicit path
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)
print(f"Loading .env from: {env_path}")
print(f".env file exists: {env_path.exists()}")

# Configuration - SignalWire credentials
SIGNALWIRE_PROJECT_ID = os.getenv("SIGNALWIRE_PROJECT_ID")
SIGNALWIRE_API_TOKEN = os.getenv("SIGNALWIRE_API_TOKEN")
SIGNALWIRE_SPACE_URL = os.getenv("SIGNALWIRE_SPACE_URL")
SIGNALWIRE_PHONE_NUMBER = os.getenv("SIGNALWIRE_PHONE_NUMBER")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

# Debug prints
print(f"DEBUG - Project ID loaded: {SIGNALWIRE_PROJECT_ID[:10] + '...' if SIGNALWIRE_PROJECT_ID else 'None'}")
print(f"DEBUG - Space URL loaded: {SIGNALWIRE_SPACE_URL}")
print(f"DEBUG - Phone loaded: {SIGNALWIRE_PHONE_NUMBER}")
print(f"DEBUG - ElevenLabs loaded: {ELEVENLABS_API_KEY[:10] + '...' if ELEVENLABS_API_KEY else 'None'}")

# Validate configuration
if not all([SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN, SIGNALWIRE_SPACE_URL, SIGNALWIRE_PHONE_NUMBER, ELEVENLABS_API_KEY]):
    print("⚠️  WARNING: Missing environment variables! Check your .env file")

# Initialize clients
signalwire_client = SignalWireClient(
    SIGNALWIRE_PROJECT_ID,
    SIGNALWIRE_API_TOKEN,
    signalwire_space_url=SIGNALWIRE_SPACE_URL
)
elevenlabs_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

# Flask app
app = Flask(__name__)

# Storage for audio files (in production, use cloud storage)
AUDIO_DIR = Path(tempfile.gettempdir()) / "signalwire_audio"
AUDIO_DIR.mkdir(exist_ok=True)

@app.route("/")
def home():
    """Server status page"""
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Twilio AI Calling Server</title>
        <style>
            body { 
                font-family: 'Segoe UI', Arial, sans-serif; 
                padding: 50px; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }
            .container {
                background: rgba(255,255,255,0.95);
                color: #333;
                padding: 40px;
                border-radius: 15px;
                max-width: 800px;
                margin: 0 auto;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            }
            h1 { color: #667eea; margin-top: 0; }
            .status { 
                background: #10b981; 
                color: white; 
                padding: 10px 20px; 
                border-radius: 5px; 
                display: inline-block;
                font-weight: bold;
            }
            .endpoint {
                background: #f3f4f6;
                padding: 15px;
                margin: 10px 0;
                border-radius: 8px;
                border-left: 4px solid #667eea;
            }
            code {
                background: #1f2937;
                color: #10b981;
                padding: 2px 8px;
                border-radius: 4px;
                font-family: 'Courier New', monospace;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 SignalWire AI Calling Server</h1>
            <p class="status">✅ ONLINE</p>
            
            <h2>📋 Available Endpoints</h2>
            
            <div class="endpoint">
                <strong>POST /make-call</strong><br>
                Initiate outbound calls<br>
                <code>{"to": "+1234567890"}</code>
            </div>
            
            <div class="endpoint">
                <strong>POST /voice-webhook</strong><br>
                Handle incoming/outgoing calls (TwiML)
            </div>
            
            <div class="endpoint">
                <strong>POST /gather</strong><br>
                Process user speech input
            </div>
            
            <div class="endpoint">
                <strong>GET /audio/&lt;filename&gt;</strong><br>
                Serve generated audio files
            </div>
            
            <h2>⚙️ Configuration</h2>
            <p><strong>SignalWire Number:</strong> """ + str(SIGNALWIRE_PHONE_NUMBER) + """</p>
            <p><strong>Server:</strong> Running on port 5000</p>
            
            <h2>🔧 Setup Instructions</h2>
            <ol>
                <li>Configure SignalWire webhook to: <code>[your-url]/voice-webhook</code></li>
                <li>Set environment variables in Railway</li>
                <li>Test by calling your SignalWire number</li>
            </ol>
        </div>
    </body>
    </html>
    """

@app.route("/make-call", methods=["POST"])
def make_call():
    """API endpoint to initiate outbound calls"""
    try:
        data = request.get_json()
        to_number = data.get("to")
        
        if not to_number:
            return {"error": "Phone number required in 'to' field"}, 400
        
        # Get the base URL (ngrok URL in production)
        base_url = request.host_url.rstrip('/')
        
        # Make call via SignalWire
        call = signalwire_client.calls.create(
            to=to_number,
            from_=SIGNALWIRE_PHONE_NUMBER,
            url=f"{base_url}/voice-webhook",
            method="POST",
            status_callback=f"{base_url}/call-status",
            status_callback_event=["initiated", "ringing", "answered", "completed"]
        )
        
        return {
            "success": True,
            "call_sid": call.sid,
            "status": call.status,
            "to": to_number,
            "from": SIGNALWIRE_PHONE_NUMBER
        }
        
    except Exception as e:
        print(f"Error making call: {e}")
        return {"error": str(e)}, 500

@app.route("/voice-webhook", methods=["POST"])
def voice_webhook():
    """Handle incoming/outgoing calls with AI"""
    response = VoiceResponse()
    
    # Get call information
    call_sid = request.form.get("CallSid", "unknown")
    from_number = request.form.get("From", "unknown")
    to_number = request.form.get("To", "unknown")
    
    print(f"📞 Call received: {call_sid} from {from_number} to {to_number}")
    
    # AI greeting
    greeting = "Hello! This is an AI assistant powered by Eleven Labs. How can I help you today?"
    
    # Generate AI voice with ElevenLabs
    try:
        print("🎤 Generating AI greeting with ElevenLabs...")
        # Use the new API: text_to_speech.convert()
        audio_generator = elevenlabs_client.text_to_speech.convert(
            voice_id="IKne3meq5aSn9XLyUdCD",  # Charlie - Deep, Confident, Energetic
            text=greeting,
            model_id="eleven_monolingual_v1"
        )
        
        # Save audio with unique filename
        audio_filename = f"greeting_{call_sid}.mp3"
        audio_path = AUDIO_DIR / audio_filename
        
        with open(audio_path, "wb") as f:
            for chunk in audio_generator:
                if chunk:
                    f.write(chunk)
        
        # Play the AI greeting
        base_url = request.host_url.rstrip('/')
        response.play(f"{base_url}/audio/{audio_filename}")
        
        print("✅ AI greeting generated and queued")
        
    except Exception as e:
        print(f"❌ ElevenLabs error: {e}")
        # Fallback to Twilio TTS
        response.say(greeting, voice="Polly.Joanna")
    
    # Gather user input
    gather = Gather(
        input="speech",
        action="/gather",
        method="POST",
        timeout=5,
        speech_timeout="auto",
        language="en-US"
    )
    response.append(gather)
    
    # If no input, prompt again
    response.say("I didn't hear anything. Please speak after the tone.", voice="Polly.Joanna")
    response.redirect("/voice-webhook")
    
    return Response(str(response), mimetype="text/xml")

@app.route("/gather", methods=["POST"])
def gather():
    """Process user speech input and generate AI response"""
    response = VoiceResponse()
    
    # Get call information
    call_sid = request.form.get("CallSid", "unknown")
    user_speech = request.form.get("SpeechResult", "")
    confidence = request.form.get("Confidence", "0")
    
    print(f"🗣️  User said: '{user_speech}' (confidence: {confidence})")
    
    if user_speech:
        # Generate AI response
        ai_response = generate_ai_response(user_speech)
        print(f"🤖 AI response: {ai_response}")
        
        # Check if call should end
        if "goodbye" in user_speech.lower() or "bye" in user_speech.lower():
            try:
                audio_generator = elevenlabs_client.text_to_speech.convert(
                    voice_id="IKne3meq5aSn9XLyUdCD",  # Charlie - Deep, Confident, Energetic
                    text=ai_response,
                    model_id="eleven_monolingual_v1"
                )
                
                audio_filename = f"goodbye_{call_sid}.mp3"
                audio_path = AUDIO_DIR / audio_filename
                
                with open(audio_path, "wb") as f:
                    for chunk in audio_generator:
                        if chunk:
                            f.write(chunk)
                
                base_url = request.host_url.rstrip('/')
                response.play(f"{base_url}/audio/{audio_filename}")
                
            except Exception as e:
                print(f"Error: {e}")
                response.say(ai_response, voice="Polly.Joanna")
            
            # End the call
            response.hangup()
            return Response(str(response), mimetype="text/xml")
        
        # Generate voice with ElevenLabs for continuing conversation
        try:
            audio_generator = elevenlabs_client.text_to_speech.convert(
                voice_id="IKne3meq5aSn9XLyUdCD",  # Charlie - Deep, Confident, Energetic
                text=ai_response,
                model_id="eleven_monolingual_v1"
            )
            
            audio_filename = f"response_{call_sid}_{uuid.uuid4().hex[:8]}.mp3"
            audio_path = AUDIO_DIR / audio_filename
            
            with open(audio_path, "wb") as f:
                for chunk in audio_generator:
                    if chunk:
                        f.write(chunk)
            
            base_url = request.host_url.rstrip('/')
            response.play(f"{base_url}/audio/{audio_filename}")
            
        except Exception as e:
            print(f"Error generating audio: {e}")
            response.say(ai_response, voice="Polly.Joanna")
        
        # Continue gathering input
        gather = Gather(
            input="speech",
            action="/gather",
            method="POST",
            timeout=5,
            speech_timeout="auto",
            language="en-US"
        )
        response.append(gather)
        
        # Timeout message
        response.say("Are you still there?", voice="Polly.Joanna")
        response.redirect("/gather")
        
    else:
        response.say("I didn't catch that. Could you please repeat?", voice="Polly.Joanna")
        response.redirect("/voice-webhook")
    
    return Response(str(response), mimetype="text/xml")

@app.route("/call-status", methods=["POST"])
def call_status():
    """Handle call status callbacks"""
    call_sid = request.form.get("CallSid")
    call_status = request.form.get("CallStatus")
    print(f"📊 Call {call_sid} status: {call_status}")
    return "", 200

@app.route("/audio/<filename>")
def serve_audio(filename):
    """Serve generated audio files"""
    try:
        audio_path = AUDIO_DIR / filename
        if audio_path.exists():
            return send_file(audio_path, mimetype="audio/mpeg")
        else:
            print(f"❌ Audio file not found: {filename}")
            return "Audio not found", 404
    except Exception as e:
        print(f"Error serving audio: {e}")
        return "Error serving audio", 500

def generate_ai_response(user_input, conversation_history=None):
    """
    Generate intelligent AI response using Claude (Anthropic)
    Falls back to simple responses if API fails
    """
    # Try to use Claude for intelligent responses
    try:
        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        if anthropic_api_key:
            # Initialize Anthropic client without any extra parameters
            # to avoid proxy configuration issues
            import anthropic
            client = anthropic.Anthropic(
                api_key=anthropic_api_key
            )
            
            # Build system prompt
            system_prompt = """You are a helpful, friendly AI phone assistant. 
            Keep responses VERY concise - maximum 2-3 sentences since this is a phone call.
            Be conversational, warm, and natural.
            If asked about yourself, say you're an AI assistant powered by SignalWire, Claude, and ElevenLabs.
            Always be helpful and professional."""
            
            # Get Claude response
            response = client.messages.create(
                model="claude-3-haiku-20240307",  # Fast and affordable!
                max_tokens=150,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": user_input
                    }
                ]
            )
            
            ai_response = response.content[0].text
            print(f"🤖 Claude response: {ai_response}")
            return ai_response
            
    except Exception as e:
        print(f"⚠️ Claude error: {e}, falling back to simple responses")
    
    # Fallback to simple keyword matching if Claude fails
    user_lower = user_input.lower()
    
    if "hello" in user_lower or "hi" in user_lower:
        return "Hello! It's wonderful to hear from you. How can I assist you today?"
    
    elif "help" in user_lower or "assist" in user_lower:
        return "I'm here to help! I can answer questions, provide information, or connect you with the right person. What would you like to know?"
    
    elif "bye" in user_lower or "goodbye" in user_lower:
        return "Thank you so much for calling. Have a fantastic day! Goodbye."
    
    elif "name" in user_lower or "who are you" in user_lower:
        return "I'm an AI assistant powered by SignalWire, Claude, and ElevenLabs voice technology. I'm here to help you with whatever you need."
    
    elif "time" in user_lower or "date" in user_lower:
        from datetime import datetime
        now = datetime.now()
        return f"The current time is {now.strftime('%I:%M %p')} on {now.strftime('%A, %B %d, %Y')}."
    
    elif "weather" in user_lower:
        return "I don't have real-time weather data at the moment, but I'd be happy to help you with something else!"
    
    else:
        return f"I heard you say: {user_input}. I'm processing that. Could you tell me more about what you need help with?"

def cleanup_old_audio():
    """Clean up old audio files (call this periodically)"""
    import time
    max_age = 3600  # 1 hour
    current_time = time.time()
    
    for audio_file in AUDIO_DIR.glob("*.mp3"):
        if current_time - audio_file.stat().st_mtime > max_age:
            audio_file.unlink()
            print(f"🗑️  Cleaned up old audio: {audio_file.name}")

if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("🤖 SIGNALWIRE + ELEVENLABS AI CALLING SERVER")
    print("=" * 70)
    print(f"📱 SignalWire Number: {SIGNALWIRE_PHONE_NUMBER}")
    print(f"🌐 Server: http://localhost:5000")
    print(f"📁 Audio Directory: {AUDIO_DIR}")
    print("=" * 70)
    print("\n✅ Server ready! Next steps:")
    print("   1. Configure SignalWire webhook")
    print("   2. Set webhook to: [your-url]/voice-webhook")
    print("   3. Test by calling your SignalWire number!")
    print("\n" + "=" * 70 + "\n")
    
    # Start cleanup scheduler (in production, use proper task scheduler)
    import threading
    def periodic_cleanup():
        while True:
            import time
            time.sleep(1800)  # Run every 30 minutes
            cleanup_old_audio()
    
    cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
    cleanup_thread.start()
    
    # Get port from environment variable (Railway sets this automatically)
    port = int(os.getenv("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)
