import { generationRetryDelayMs } from '@/ai/retryPolicy';

describe('Smart Generation retry policy', () => {
  it('backs off recoverable retries and caps delay at one hour', () => {
    expect(generationRetryDelayMs(1)).toBe(60_000);
    expect(generationRetryDelayMs(2)).toBe(2 * 60_000);
    expect(generationRetryDelayMs(6)).toBe(32 * 60_000);
    expect(generationRetryDelayMs(7)).toBe(60 * 60_000);
    expect(generationRetryDelayMs(20)).toBe(60 * 60_000);
  });

  it('uses minimum delay for invalid persisted attempt counts', () => {
    expect(generationRetryDelayMs(0)).toBe(60_000);
    expect(generationRetryDelayMs(-5)).toBe(60_000);
  });
});
