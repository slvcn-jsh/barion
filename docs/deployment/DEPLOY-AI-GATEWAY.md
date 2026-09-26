# AI Gateway Deployment Guide

**Last Updated:** 2026-09-20  
**Service:** `services/ai_gateway/`

## Quick Start (Development)

### 1. Install Dependencies

```bash
pip install -r services/ai_gateway/requirements.txt
```

### 2. Configure Environment

```powershell
$env:BARION_AI_AUTH_MODE='static'
$env:BARION_AI_GATEWAY_AUTH_TOKEN='dev-token-replace-with-random-string'
$env:GEMINI_API_KEY='AIzaSy...'
$env:PRIMARY_GENERATION_PROVIDER='gemini'
$env:PRIMARY_GENERATION_MODEL='gemini-2.5-flash'
$env:BARION_AI_ALLOWED_ORIGINS='http://localhost:8081,http://127.0.0.1:8081'
```

### 3. Start Gateway

```bash
npm run gateway
```

Or: `python -m uvicorn services.ai_gateway.main:app --host 127.0.0.1 --port 8790`

### 4. Verify Health

```bash
curl http://127.0.0.1:8790/v1/health
```

Expected: `{"status": "ok", "generationProvider": {"status": "configured"}}`

### 5. Configure Client

```powershell
$env:EXPO_PUBLIC_BARION_AI_GATEWAY_URL='http://127.0.0.1:8790'
$env:EXPO_PUBLIC_BARION_AI_MODEL='gemini-2.5-flash'
$env:EXPO_PUBLIC_BARION_AI_GATEWAY_TIMEOUT_MS='120000'
$env:EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN='dev-token-replace-with-random-string'
```

`127.0.0.1` works for Expo web on the gateway host. Android emulator/device testing requires either `adb reverse tcp:8790 tcp:8790` while retaining the localhost URL, or a configurable HTTPS gateway/tunnel. Physical iOS devices require a reachable HTTPS gateway/tunnel. Never hard-code a developer LAN IP into application source.

### 6. Start Client

```bash
npm run web
```

## Production Deployment

### Environment Variables

```bash
# Authentication (Supabase JWT)
BARION_AI_AUTH_MODE=supabase
SUPABASE_URL=https://yourproject.supabase.co
BARION_AI_JWT_AUDIENCE=authenticated
BARION_AI_MAX_ACCESS_TOKEN_LIFETIME_SECONDS=3600

# Generation Provider
PRIMARY_GENERATION_PROVIDER=gemini
PRIMARY_GENERATION_MODEL=gemini-2.5-flash
GEMINI_API_KEY=AIzaSy...

# CORS (production origins)
BARION_AI_ALLOWED_ORIGINS=https://app.example.com

# Limits
BARION_AI_PROVIDER_TIMEOUT_SECONDS=20
BARION_AI_PROVIDER_MAX_ATTEMPTS=3
BARION_AI_MAX_REQUEST_BYTES=300000
BARION_AI_MAX_INPUT_CHARACTERS=180000
```

### Client Configuration

```bash
EXPO_PUBLIC_BARION_AI_GATEWAY_URL=https://gateway.example.com
EXPO_PUBLIC_BARION_AI_MODEL=gemini-2.5-flash
EXPO_PUBLIC_BARION_AI_GATEWAY_TIMEOUT_MS=120000
EXPO_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
# ⚠️ NEVER set static token in production
```

### Deployment Options

**Cloud Run (Google):**
```bash
gcloud run deploy barion-ai-gateway \
  --source services/ai_gateway \
  --region us-central1 \
  --set-env-vars BARION_AI_AUTH_MODE=supabase \
  --set-secrets GEMINI_API_KEY=gemini-key:latest
```

**Railway/Render:**
- Build: `pip install -r services/ai_gateway/requirements.txt`
- Start: `uvicorn services.ai_gateway.main:app --host 0.0.0.0 --port $PORT`

## Testing

```bash
npm run test:gateway  # 19 tests
npm run check         # TypeScript + Jest (89 tests)
```

## Monitoring

**Health:** `GET /v1/health`  
**Watch logs for:** `authentication_error`, `rate_limited`, `provider_unavailable`

## Security Checklist

- [ ] `BARION_AI_AUTH_MODE=supabase` in production
- [ ] HTTPS only (TLS 1.2+)
- [ ] `GEMINI_API_KEY` in secret manager
- [ ] Rate limiting enabled (30 req/min default)
- [ ] CORS restricted to production domains

## Cost Estimate

**Gemini 2.5 Flash:** ~$0.00034 per source  
**5K sources/month:** ~$1.70 + infrastructure (~$5-20)  
**Total:** ~$7-22/month

---

**See:** `services/ai_gateway/README.md`, `docs/architecture/ai-gateway-integration-status.md`
