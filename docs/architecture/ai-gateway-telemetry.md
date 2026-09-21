# AI Gateway Telemetry Integration

**Last Updated:** 2026-09-20  
**Status:** Ready for implementation

## Overview

Telemetry tracks AI card generation performance, fallback patterns, and quality metrics. Currently logs to console; production needs monitoring service integration.

## Data Model

### AITelemetryEvent

```typescript
type AITelemetryEvent = {
  operation: 'card-generation';
  providerId: string;           // 'gemini', 'local-extractive'
  modelId: string;              // 'gemini-2.5-flash', 'barion-extractive-rules'
  promptVersion?: string;       // 'v1', 'medical-v2'
  success: boolean;
  durationMs: number;
  candidateCount: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;           // BarionAIErrorCode when success=false
  metadata?: Record<string, unknown>;
};

type AITelemetrySink = (event: AITelemetryEvent) => void;
```

## Integration Points

### Generate Function

```typescript
// src/ai/generate.ts
export async function generateGroundedCardsWithFallback(
  provider: CardGenerationProvider | null,
  input: CardGenerationInput,
  createLocalCandidates: () => GroundedCardCandidate[],
  telemetry?: AITelemetrySink,  // <-- Optional sink
  initialFallbackReason?: string
): Promise<GroundedCardGenerationResult>
```

### Repository Integration

```typescript
// src/storage/repository.ts:1745
const generation = await generateGroundedCardsWithFallback(
  provider,
  input,
  createLocalCandidates,
  telemetrySink,  // <-- Currently undefined, ready for wiring
  gatewayConfigError,
);
```

## Event Examples

### Gateway Success
```json
{
  "operation": "card-generation",
  "providerId": "gemini",
  "modelId": "gemini-2.5-flash",
  "success": true,
  "durationMs": 2341,
  "candidateCount": 12,
  "inputTokens": 4523,
  "outputTokens": 987
}
```

### Fallback (Auth Error)
```json
{
  "operation": "card-generation",
  "providerId": "local-extractive",
  "success": true,
  "durationMs": 124,
  "candidateCount": 8,
  "errorCode": "authentication_error"
}
```

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `configuration_error` | Missing gateway config | Check env vars |
| `authentication_error` | JWT invalid/expired | Check Supabase session |
| `rate_limited` | Gateway quota exceeded | Retry later |
| `model_unavailable` | Gateway 503/504 | Check gateway health |
| `timeout_error` | Request timeout | Check network |
| `request_too_large` | Payload >10MB | Split source |
| `invalid_provider_response` | Schema validation failed | Check gateway version |

## Database Storage

Events persist in `generation_jobs` table:

```sql
SELECT
  provider_id,
  model_id,
  fallback_reason,
  input_tokens,
  output_tokens,
  created_at
FROM generation_jobs;
```

**Fallback rate query:**
```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN fallback_reason IS NOT NULL THEN 1 ELSE 0 END) AS fallbacks,
  ROUND(100.0 * SUM(CASE WHEN fallback_reason IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) AS rate
FROM generation_jobs
WHERE created_at >= datetime('now', '-7 days');
```

## Production Implementation

### Step 1: Create Sink

```typescript
// src/monitoring/telemetry.ts
export function createProductionTelemetrySink(): AITelemetrySink {
  return (event) => {
    fetch('https://monitoring.example.com/events', {
      method: 'POST',
      body: JSON.stringify({
        ...event,
        timestamp: new Date().toISOString(),
      }),
    }).catch(console.error);
  };
}
```

### Step 2: Wire In

```typescript
// src/storage/repository.ts
import { createProductionTelemetrySink } from '@/monitoring/telemetry';

const telemetry = createProductionTelemetrySink();
const generation = await generateGroundedCardsWithFallback(
  provider,
  input,
  createLocalCandidates,
  telemetry,  // <-- Add here
  gatewayConfigError,
);
```

## Key Metrics

**Track:**
1. Fallback rate: `(fallbacks / total) * 100`
2. Error distribution by `errorCode`
3. Generation latency: P50, P95, P99
4. Token usage per user/day
5. Average candidates per source

**Alert when:**
- Fallback rate >30% for 5min
- Auth errors >10%
- Rate limit errors >5%
- P95 latency >10s

## Next Steps

- [ ] Implement production sink (Datadog/CloudWatch/etc)
- [ ] Create monitoring dashboard
- [ ] Set up alerting rules
- [ ] Document cost budgets
- [ ] Add user-facing generation history

---

**See:** `src/ai/types.ts`, `src/ai/generate.ts`, `src/storage/repository.ts:1745`
