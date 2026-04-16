# 📞 AI Phone System - AI Executive Assistant

A professional web-based softphone interface integrated with Twilio and ElevenLabs AI. Make and receive calls directly from your browser - no app store approval needed!

## ✨ Features

- 🌐 **Web-based** - Works on any device (desktop, tablet, mobile)
- 📞 **VoIP Calling** - Make/receive calls via Twilio WebRTC
- 🤖 **AI Integration** - Connected to ElevenLabs AI Executive Assistant
- 📊 **Call History** - Track all your calls
- 🎨 **Beautiful UI** - Modern, responsive interface
- 🔐 **Secure Login** - User authentication system
- 🔇 **Call Controls** - Mute, hang up, dialpad
- 🚀 **No App Store** - Deploy instantly, no approval needed

## 🏗️ Tech Stack

- **Frontend:** HTML, CSS, JavaScript, Twilio Client SDK
- **Backend:** Node.js, Express, Twilio SDK
- **Deployment:** Render.com
- **Voice AI:** ElevenLabs Conversational AI

## 📋 Prerequisites

Before deploying, you need:

1. **Twilio Account** (https://twilio.com)
   - Account SID
   - Auth Token
   - Phone Number
   - API Key + Secret (we'll create these)
   - TwiML App SID (we'll create this)

2. **Render.com Account** (https://render.com) - Free!

3. **GitHub Account** (optional but recommended)

## 🚀 Deployment Guide

### Step 1: Prepare Twilio

1. **Get Basic Credentials:**
   - Go to https://console.twilio.com
   - Copy your **Account SID** and **Auth Token**

2. **Create API Key:**
   - Go to: https://console.twilio.com/us1/account/keys-credentials/api-keys
   - Click "Create API Key"
   - Give it a name: "Web Softphone"
   - Copy the **API Key SID** (SK...) and **Secret** (save this - you can't see it again!)

3. **Create TwiML App:**
   - Go to: https://console.twilio.com/us1/develop/voice/manage/twiml-apps
   - Click "Create new TwiML App"
   - Name: "Web Softphone"
   - Voice Request URL: `https://your-app-name.onrender.com/api/twiml` (update this after deploying)
   - Copy the **TwiML App SID** (AP...)

### Step 2: Deploy to Render.com

#### Option A: Deploy from GitHub (Recommended)

1. **Push this code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Web Softphone"
   git branch -M main
   git remote add origin https://github.com/yourusername/web-softphone.git
   git push -u origin main
   ```

2. **Connect to Render:**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - **Name:** `web-softphone` (or your choice)
     - **Region:** Choose closest to you
     - **Branch:** `main`
     - **Root Directory:** `backend`
     - **Environment:** `Node`
     - **Build Command:** `npm install`
     - **Start Command:** `npm start`
     - **Plan:** Free

3. **Add Environment Variables:**
   Click "Advanced" → Add these variables:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_PHONE_NUMBER=+18555182214
   PORT=10000
   NODE_ENV=production
   ```

4. **Deploy!**
   - Click "Create Web Service"
   - Wait 3-5 minutes for build
   - Your app will be live at: `https://your-app-name.onrender.com`

5. **Update Twilio TwiML App:**
   - Go back to Twilio Console → TwiML Apps
   - Edit your TwiML App
   - Update Voice Request URL: `https://your-app-name.onrender.com/api/twiml`
   - Save

6. **Add SERVER_URL to Render:**
   - Go to Render dashboard → Your service → Environment
   - Add: `SERVER_URL=https://your-app-name.onrender.com`
   - Save changes (will redeploy)

#### Option B: Manual Upload

1. Download this folder as ZIP
2. Go to Render.com → New Web Service
3. Choose "Public Git repository"
4. Follow steps 2-6 from Option A above

### Step 3: Test Your Softphone!

1. **Open your app:** `https://your-app-name.onrender.com`

2. **Login with demo credentials:**
   - Email: `demo@user.com`
   - Password: `demo123`

3. **Make a test call:**
   - Enter a phone number
   - Click "Call"
   - You should connect!

4. **Try the AI Assistant:**
   - Call your Twilio number: `+1 (855) 518-2214`
   - Your AI should answer!

## 👥 User Accounts

Default users (edit in `backend/server.js`):

```javascript
'demo@user.com' → password: 'demo123'
'admin@business.com' → password: 'admin123'
'kimo@pyramidrepairs.com' → password: 'pyramid2024'
```

To add more users, edit the `users` object in `backend/server.js`.

## 📱 Usage

1. **Login** - Use credentials above
2. **Enter phone number** - Type or use dialpad
3. **Click Call** - Connects via WebRTC
4. **Use controls:**
   - Mute button (mute/unmute)
   - Hang Up button (end call)
   - Dialpad (send DTMF tones)
5. **View History** - See all recent calls

## 🔧 Customization

### Add Users
Edit `backend/server.js`:
```javascript
const users = {
  'your@email.com': {
    password: 'yourpassword',
    identity: 'your_identity',
    name: 'Your Name'
  }
};
```

### Change Branding
Edit `frontend/index.html` and `frontend/styles.css`

### Add Features
- Real database (PostgreSQL on Render)
- Multiple simultaneous calls
- Call recording
- SMS integration
- Conference calling

## 🐛 Troubleshooting

**"Device not ready"**
- Check Twilio credentials are correct
- Verify TwiML App URL is set correctly

**"Call failed"**
- Check phone number format (+1234567890)
- Verify Twilio account has credits
- Check browser console for errors

**"Can't connect to API"**
- Verify Render service is running
- Check environment variables are set
- Look at Render logs for errors

**CORS errors:**
- Add your domain to CORS settings in server.js

## 📊 Monitoring

- **Render Logs:** https://dashboard.render.com → Your service → Logs
- **Twilio Logs:** https://console.twilio.com → Monitor → Logs → Calls
- **Browser Console:** F12 → Console tab

## 💰 Costs

- **Render.com:** Free tier (750 hours/month) or $7/month for no sleep
- **Twilio:** Pay-as-you-go
  - Outbound calls: ~$0.02/min
  - Inbound calls: ~$0.01/min
  - Phone number: ~$1/month

## 🔐 Security

- Never commit `.env` file
- Use strong passwords for production
- Enable HTTPS (Render does this automatically)
- Consider adding 2FA for production users
- Rate limit API endpoints for production

## 📞 Support

- **Render Docs:** https://render.com/docs
- **Twilio Docs:** https://www.twilio.com/docs
- **Issues:** Create an issue in this repo

## 📄 License

MIT License - Feel free to use this for your business!

## 🎉 Credits

Built by Kimo for Pyramid Repairs
Powered by Twilio + ElevenLabs AI
Deployed on Render.com

---

**Ready to launch your AI-powered phone system!** 🚀📞
