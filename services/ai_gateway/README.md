# Barion AI gateway

Server-only boundary for model credentials and source-grounded AI operations. Current provider adapter: Gemini. Expo receives no provider key.

## Configure

Copy values into a local `.env` or set them in deployment secret management. Never prefix server secrets with `EXPO_PUBLIC_`.

```powershell
$env:BARION_AI_GATEWAY_AUTH_TOKEN='replace-with-long-random-token'
$env:GEMINI_API_KEY='replace-with-provider-key'
$env:PRIMARY_GENERATION_PROVIDER='gemini'
$env:PRIMARY_GENERATION_MODEL='gemini-2.5-flash'
$env:BARION_AI_ALLOWED_ORIGINS='http://localhost:8081,http://127.0.0.1:8081'
python -m uvicorn services.ai_gateway.main:app --host 127.0.0.1 --port 8790
```

Client development values:

```powershell
$env:EXPO_PUBLIC_BARION_AI_GATEWAY_URL='http://127.0.0.1:8790'
$env:EXPO_PUBLIC_BARION_AI_MODEL='gemini-2.5-flash'
$env:EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN='same-development-token'
npm run web
```

`EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN` is only acceptable as a local/shared-client gateway credential. Expo embeds it in compiled bundles, so it is not a secret and must never be a provider API key. Public deployment requires user authentication issuing short-lived access tokens; static client tokens are not production authorization.

Physical devices must use gateway machine's LAN address. Production gateway URL must use HTTPS.

## API

- `GET /v1/health`: dependency status without credentials.
- `POST /v1/card-generation`: authenticated structured generation; gateway revalidates segment IDs, verbatim evidence, limits, and duplicates.
- `POST /v1/bari/chat`: authenticated source-strict foundation. AI chat generation intentionally deferred to Bari sprint.

All retrieved document content remains reference data. Prompt instructions from source material must not be executed. Logs include metadata only, never prompts or source text.

## Verify

```powershell
python -m pytest services/ai_gateway/tests -q
```
