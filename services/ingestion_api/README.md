# Barion ingestion service

This stateless service enables selectable-text PDF extraction for Barion iOS and Android builds. It does not generate cards, retain files, or call an AI provider. The app segments returned page text locally and requires human approval for every draft.

## Local development

```powershell
python -m pip install -r services/ingestion_api/requirements.txt
python -m uvicorn services.ingestion_api.main:app --host 0.0.0.0 --port 8787
```

Set the app URL before starting Expo. A physical device must use the development machine's LAN address rather than `localhost`.

```powershell
$env:EXPO_PUBLIC_BARION_INGESTION_URL='http://192.168.1.20:8787'
npm run start
```

For production, deploy behind HTTPS and authenticated application infrastructure. Restrict `BARION_ALLOWED_ORIGINS` to the expected web origins. Do not use the development server as a public upload endpoint.
