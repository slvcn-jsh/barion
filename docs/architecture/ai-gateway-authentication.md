# AI Gateway Authentication Contract

## Decision

Production uses Supabase Auth access tokens. Supabase owns sign-in, session creation, access-token issuance, and refresh-token rotation. Barion AI gateway verifies access tokens locally against project JWKS; it never receives or stores refresh tokens.

Static bearer token mode remains available only for local development and fallback E2E. Production deployment must set `BARION_AI_AUTH_MODE=supabase` and must not bundle `EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN`.

## Access Token Contract

Gateway accepts asymmetric Supabase user access tokens only (`RS256` or `ES256`). Verification requires:

- valid signature from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
- exact issuer `${SUPABASE_URL}/auth/v1`
- configured audience, default `authenticated`
- unexpired `exp`, valid `iat`, and lifetime no longer than `BARION_AI_MAX_ACCESS_TOKEN_LIFETIME_SECONDS`
- UUID `sub` identifying user
- UUID `session_id` identifying session
- `role=authenticated`
- `aal` equal to `aal1` or `aal2`
- `is_anonymous=false`

Default maximum token lifetime is 3600 seconds. Supabase project access-token expiry should be 5–60 minutes. Gateway permits 30 seconds clock skew. JWKS cache lasts five minutes; unknown signing key IDs trigger library refresh. HS256/shared-secret tokens are rejected.

## Client Session and Refresh

Supabase client stores refresh session state. Native builds use Expo SecureStore; web needs browser storage and normal XSS controls. Gateway requests obtain current access token at request time, never from an `EXPO_PUBLIC_*` token.

Request behavior:

1. Ask session provider for current access token. Supabase `getSession()` refreshes when necessary.
2. Send `Authorization: Bearer <access-token>` over HTTPS.
3. On one `401`, force one session refresh and retry once with new token.
4. If refresh fails or retry returns `401`, surface authentication failure and use existing local generation fallback.
5. Never retry `403`, malformed claims, or other failures as refresh loops.

Refresh tokens never go to AI gateway, logs, telemetry, SQLite backups, or Expo public variables.

## Authorization and Rate Limits

Authenticated AI routes accept normal signed-in, non-anonymous users. Application quota keys use verified `sub`, not source IP or caller-controlled headers. Current in-memory limiter is single-process only; production multi-instance rollout must replace it with shared atomic storage keyed by hashed user ID. Edge/IP abuse protection remains separate from per-user quota.

## Rollout

1. Configure Supabase asymmetric signing keys and 5–60 minute access-token expiry.
2. Deploy gateway with Supabase settings and verify auth contract tests.
3. Add Expo sign-in/session provider and secure native persistence.
4. Remove production `EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN`; retain static mode only in local/E2E configuration.
5. Run authenticated live Gemini upload-to-offline-study E2E.

Rollback: deploy gateway with `BARION_AI_AUTH_MODE=static` and matching local-only token. Never use rollback mode for public production traffic.
