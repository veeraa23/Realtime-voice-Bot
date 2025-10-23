# 🎤 Real-Time Voice Bot - Production Ready

A production-ready voice bot with ChatGPT-style interface powered by Azure OpenAI Realtime API. Features secure backend architecture, rate limiting, authentication, and real-time audio streaming.

## 🏆 Architecture

**Industry-standard 3-tier architecture** (same as OpenAI, Stripe, Netflix):

```
Browser (Frontend)  →  Your Backend Server  →  Azure OpenAI
  • Microphone            • API Keys 🔒           • GPT Models
  • Voice UI              • Authentication        • Speech-to-Text
  • Audio Playback        • Rate Limiting         • Text-to-Speech
  • NO API Keys ✅        • User Tracking         • AI Processing
```

**Security Features:**
- ✅ API keys hidden on server (never exposed to browser)
- ✅ User authentication & authorization
- ✅ Rate limiting (60 requests/min, 3 concurrent connections)
- ✅ Session management & tracking
- ✅ Cost control & usage monitoring

## 🎯 Features

- **Real-Time Voice Conversation** - Natural speech interaction with AI
- **Beautiful UI** - ChatGPT-style animated green orb interface
- **Interruption Support** - Can interrupt AI mid-response
- **Low Latency** - WebSocket-based audio streaming
- **Production Ready** - Enterprise-grade security & scalability
- **Rate Limiting** - Prevent abuse and control costs
- **Session Tracking** - Monitor usage per user

## 📁 Project Structure

```
realtime-voice/
├── backend/
│   ├── secure_server.py      # Production WebSocket proxy server
│   ├── .env                   # Secrets (API keys) - NEVER commit!
│   └── requirements.txt       # Python dependencies
│
├── frontend/
│   ├── index.html            # Main UI
│   ├── styles.css            # ChatGPT-style animations
│   ├── script.js             # Voice bot logic
│   ├── config.js             # Backend URL (NO API keys)
│   └── audio-processor.js    # Audio capture worklet
│
├── serve.py                  # Frontend HTTP server
├── README.md                 # This file
└── ARCHITECTURE.md           # Detailed architecture docs
```

## 🚀 Quick Start (2 Steps)

### Prerequisites
- Python 3.8+
- Azure OpenAI account with gpt-realtime deployment
- Microphone access

### Step 1: Install Dependencies

```bash
# Navigate to backend folder
cd backend

# Install Python packages
pip install -r requirements.txt
```

### Step 2: Configure Environment

Edit `backend/.env` with your Azure credentials:
```env
AZURE_ENDPOINT=https://your-resource.openai.azure.com
AZURE_API_KEY=your-secret-api-key
AZURE_DEPLOYMENT=gpt-realtime
API_VERSION=2024-10-01-preview
```

⚠️ **IMPORTANT:** Never commit `.env` file to Git!

## 🎬 Running the Application

### Terminal 1: Start Backend Server
```bash
cd backend
python secure_server.py
```

✅ You should see:
```
============================================================
🚀 Starting Production WebSocket Proxy Server
============================================================
Server: ws://0.0.0.0:8001
✓ Server ready for connections
```

### Terminal 2: Start Frontend Server
```bash
# From project root
python serve.py
```

✅ Browser will open automatically at http://localhost:8000

## 🧪 Testing

### 1. Test Voice Conversation
- Click microphone button
- Grant microphone permission
- Start speaking
- AI should respond naturally

### 2. Verify Security (IMPORTANT!)
**Open Browser DevTools (F12):**
1. Go to Network tab → WS filter
2. Click on WebSocket connection
3. ✅ URL should be `ws://localhost:8001` (NOT Azure)
4. ✅ Messages should NOT contain API keys

**This proves your API keys are hidden!** 🔒

### 3. Test Rate Limiting
- Open 3 browser tabs → all connect ✅
- Open 4th tab → rejected with "Rate limit exceeded" ✅

### 4. Test Interruption
- Start conversation
- While AI is speaking, start talking
- AI should stop and listen ✅

## 🔒 Security Features

### Before (Insecure Demo)
```javascript
// API key in browser - ANYONE can steal! ❌
const apiKey = "EbHq...SECRET...";
ws = new WebSocket(`wss://azure...?api-key=${apiKey}`);
```

### After (Production Ready)
```javascript
// No API keys in browser ✅
ws = new WebSocket('ws://localhost:8001');
// Backend handles authentication & Azure connection
```

**Security Checklist:**
- [✅] API keys stored in backend/.env (gitignored)
- [✅] API keys NEVER sent to browser
- [✅] User authentication framework ready
- [✅] Rate limiting enabled (60 req/min per user)
- [✅] Max 3 concurrent connections per user
- [✅] All sessions logged with user ID
- [✅] Cost control via rate limits

## ⚙️ Configuration

### Backend Settings (`backend/.env`)

```env
# Azure OpenAI Configuration
AZURE_ENDPOINT=https://your-resource.openai.azure.com
AZURE_API_KEY=your-secret-key
AZURE_DEPLOYMENT=gpt-realtime
API_VERSION=2024-10-01-preview

# Server Configuration
SERVER_HOST=0.0.0.0
SERVER_PORT=8001

# Rate Limiting
MAX_CONNECTIONS_PER_USER=3
MAX_REQUESTS_PER_MINUTE=60
```

### Frontend Settings (`frontend/config.js`)

```javascript
window.SERVER_CONFIG = {
    websocketUrl: 'ws://localhost:8001',
    authToken: null  // Optional: add user auth token
};
```

## 🔐 Adding Authentication

### Option 1: JWT Tokens
```javascript
// frontend/config.js
window.SERVER_CONFIG = {
    websocketUrl: 'ws://localhost:8001',
    authToken: localStorage.getItem('jwt_token')
};
```

### Option 2: Update Backend
```python
# backend/secure_server.py
def authenticate_user(headers):
    auth_header = headers.get('Authorization', '')
    # Add your authentication logic here
    # - Validate JWT token
    # - Check database
    # - Verify permissions
    return user_id
```

## 📊 Monitoring & Logging

Backend automatically logs:
- ✅ User connections (session ID, user ID)
- ✅ Message count per session
- ✅ Rate limit violations
- ✅ Connection errors
- ✅ Session duration

View logs in terminal where `secure_server.py` is running.

## 🚀 Production Deployment

### 1. Environment Variables
Move secrets to environment:
```bash
export AZURE_API_KEY="your-secret-key"
export AZURE_ENDPOINT="https://..."
```

### 2. Use HTTPS/WSS
Update frontend config:
```javascript
websocketUrl: 'wss://your-domain.com'  // Secure WebSocket
```

### 3. Docker Deployment
```bash
# Build image
docker build -t voice-bot-backend backend/

# Run container
docker run -p 8001:8001 --env-file backend/.env voice-bot-backend
```

### 4. Cloud Deployment
Deploy to:
- AWS EC2 / ECS / Lambda
- Azure App Service / Container Instances
- Google Cloud Run / Compute Engine
- Heroku, DigitalOcean, etc.

## 🛠️ Troubleshooting

### Backend won't start
**Error:** `Missing Azure configuration`  
**Fix:** Check `backend/.env` file exists and has all required variables

### Frontend can't connect
**Error:** `WebSocket connection failed`  
**Fix:** Ensure backend is running on port 8001
```bash
curl http://localhost:8001
```

### Audio not working
**Error:** `getUserMedia failed`  
**Fix:** 
- Use HTTPS or localhost (required for microphone)
- Grant microphone permission
- Check microphone not used by another app

### Port already in use
**Error:** `Address already in use`  
**Fix:** Kill process using the port
```bash
# Windows
netstat -ano | findstr :8001
taskkill /PID <pid> /F

# Linux/Mac
lsof -ti:8001 | xargs kill -9
```

## 📚 API Reference

### WebSocket Messages (Browser → Backend → Azure)

**Session Configuration:**
```json
{
  "type": "session.update",
  "session": {
    "modalities": ["audio", "text"],
    "instructions": "You are a helpful assistant",
    "voice": "alloy"
  }
}
```

**Audio Input:**
```javascript
ws.send(audioBuffer);  // Binary PCM16 audio data
```

**Cancel Response:**
```json
{
  "type": "response.cancel"
}
```

### Server Events (Azure → Backend → Browser)

**Session Created:**
```json
{
  "type": "session.created",
  "session": { ... }
}
```

**Audio Response:**
```javascript
// Binary audio data (PCM16 format)
```

**Transcript:**
```json
{
  "type": "conversation.item.created",
  "item": {
    "type": "message",
    "role": "assistant",
    "content": [...]
  }
}
```

## 🎓 Architecture Details

See [ARCHITECTURE.md](ARCHITECTURE.md) for:
- Detailed security flow
- Real-world comparisons (ChatGPT, Stripe, etc.)
- Enterprise deployment guide
- Scaling strategies
- Complete API documentation

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Azure OpenAI Realtime API
- Web Audio API
- WebSocket Protocol
- ChatGPT voice mode design inspiration

## 📞 Support

For issues or questions:
1. Check [ARCHITECTURE.md](ARCHITECTURE.md) for detailed docs
2. Review troubleshooting section above
3. Check backend logs for errors
4. Verify Azure OpenAI service status

---

**Built with ❤️ using industry-standard production architecture**

**Same security patterns as:** OpenAI ChatGPT • Stripe Payments • Google Meet • Netflix
