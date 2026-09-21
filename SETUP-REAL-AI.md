# Complete Setup: Real AI Card Generation with Gemini

You're absolutely right - the current local extraction is just a basic PDF parser with zero intelligence. To get **real AI-powered card generation** (Quizlet quality), you need to set up the Gemini AI Gateway.

## What You're Missing

**Current (Local extraction):**
- ❌ Just copies text chunks - NO intelligence
- ❌ No understanding or reasoning
- ❌ Basic reformatting only
- ❌ Like a simple PDF parser

**With Gemini (Real AI):**
- ✅ Understands medical concepts
- ✅ Synthesizes information intelligently  
- ✅ Creates high-quality study cards
- ✅ Contextual reasoning
- ✅ Quizlet-level quality

---

## Step 1: Get Gemini API Key (5 minutes)

1. **Go to Google AI Studio:**
   - Direct link: https://aistudio.google.com/apikey
   - Sign in with your Google account

2. **Create API Key:**
   - Click **"Create API key"** button (top right)
   - Select **"Create API key in new project"** (if first time)
   - Click **"Create API key"**

3. **Copy Your Key:**
   - A popup shows your new key (starts with `AIza...`)
   - **Copy it immediately** - you won't see it again
   - Store it safely (you'll need it in Step 2)

**Free Tier: 15 requests/min, 1,500/day - more than enough for testing**

---

## Step 2: Set Up AI Gateway (10 minutes)

### Install Python (if needed)

Check version:
```powershell
python --version
```

If not installed: https://www.python.org/downloads/ (✅ Check "Add Python to PATH")

### Set Up Gateway

Open PowerShell:

```powershell
cd C:\Users\salva\ansel\services\ai_gateway
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Configure Gateway

Create `.env` file:

```powershell
notepad .env
```

**Paste this** (replace `YOUR_KEY` with key from Step 1):

```bash
GEMINI_API_KEY=AIzaSy...YOUR_ACTUAL_KEY_HERE...
BARION_AI_AUTH_MODE=static
BARION_AI_GATEWAY_AUTH_TOKEN=dev-local-token-12345
PRIMARY_GENERATION_PROVIDER=gemini
PRIMARY_GENERATION_MODEL=gemini-3.6-flash
BARION_AI_ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082
BARION_AI_PROVIDER_TIMEOUT_SECONDS=30
BARION_AI_MAX_REQUEST_BYTES=300000
BARION_AI_MAX_INPUT_CHARACTERS=180000
BARION_AI_JWT_AUDIENCE=authenticated
```

Save and close (Ctrl+S).

### Start Gateway

```powershell
python -m barion_gateway.main
```

Should see: `Uvicorn running on http://0.0.0.0:8790`

✅ **Gateway running!** Keep this window open.

---

## Step 3: Configure Client App

Open **NEW** PowerShell window (keep gateway running):

```powershell
cd C:\Users\salva\ansel
notepad .env
```

**Replace entire content:**

```bash
EXPO_PUBLIC_BARION_AI_GATEWAY_URL=http://127.0.0.1:8790
EXPO_PUBLIC_BARION_AI_MODEL=gemini-3.6-flash
EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN=dev-local-token-12345
```

Save and close (Ctrl+S).

---

## Step 4: Start Your App

```powershell
npx expo start --clear
```

When Metro starts, press **`w`** for web browser.

---

## Step 5: Test Real AI

1. Open app (http://localhost:8081)
2. Create/open a deck
3. Add source (upload PDF or paste text)
4. Generate cards
5. **Cards now use real Gemini AI!**

**The difference will be DRAMATIC - intelligent medical understanding vs basic text copying.**

---

## Troubleshooting

### Gateway won't start

**Port 8790 in use:**
```powershell
Get-NetTCPConnection -LocalPort 8790 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
python -m barion_gateway.main
```

**ModuleNotFoundError:**
```powershell
venv\Scripts\activate
pip install -r requirements.txt
```

### App not connecting

**Check gateway health:**
```powershell
curl http://127.0.0.1:8790/health
```
Should return: `{"status":"ok"}`

**Force restart:**
```powershell
# Stop both (Ctrl+C), then:

# Terminal 1 - Gateway:
cd C:\Users\salva\ansel\services\ai_gateway
venv\Scripts\activate
python -m barion_gateway.main

# Terminal 2 - App:
cd C:\Users\salva\ansel
npx expo start --clear
```

### Still looks like basic extraction?

- Gateway not running (check terminal)
- .env not configured correctly
- Metro not restarted after .env changes

---

## What You Need Running

**TWO terminal windows:**

**Window 1: AI Gateway**
```
C:\...\services\ai_gateway (venv) > python -m barion_gateway.main
INFO: Uvicorn running on http://0.0.0.0:8790
```

**Window 2: Your App**
```
C:\...\ansel > npx expo start
Metro waiting on http://localhost:8081
```

**Both must be running for AI to work.**

---

## Cost

**Free Tier:**
- 15 requests/min, 1,500/day
- 1 PDF = 2-3 requests
- **100+ documents per day FREE**

Paid (if needed): ~$0.01 per 100 cards

---

## Quick Commands Reference

**Start Gateway:**
```powershell
cd C:\Users\salva\ansel\services\ai_gateway
venv\Scripts\activate
python -m barion_gateway.main
```

**Start App:**
```powershell
cd C:\Users\salva\ansel
npx expo start --clear
```

**Check Health:**
```powershell
curl http://127.0.0.1:8790/health
```

---

**Now you'll get REAL AI card generation - not basic text extraction!**
