import {
  parseExpoPublicGatewayEnvironment,
  parsePublicGatewayConfig,
} from '@/ai/config';
import { BarionAIError } from '@/ai/errors';

describe('parsePublicGatewayConfig', () => {
  it('accepts public gateway metadata without provider credentials', () => {
    expect(parsePublicGatewayConfig({
      gatewayUrl: 'https://ai.barion.example/',
      model: 'medical-cards-v1',
    })).toEqual({
      gatewayUrl: 'https://ai.barion.example',
      model: 'medical-cards-v1',
      timeoutMs: 120_000,
    });
  });

  it('reads a bounded public gateway timeout from Expo environment metadata', () => {
    expect(parseExpoPublicGatewayEnvironment({
      gatewayUrl: 'http://127.0.0.1:8790',
      model: 'medical-cards-v1',
      timeoutMs: '90000',
    })?.timeoutMs).toBe(90_000);
  });

  it('keeps static gateway authorization development-only', () => {
    const env = {
      gatewayUrl: 'https://ai.barion.example',
      model: 'medical-cards-v1',
      accessToken: 'development-only-token',
    };
    expect(parseExpoPublicGatewayEnvironment({
      ...env,
      nodeEnv: 'development',
    })?.accessToken).toBe('development-only-token');

    expect(parseExpoPublicGatewayEnvironment({
      ...env,
      nodeEnv: 'production',
    })).toEqual({
      gatewayUrl: 'https://ai.barion.example',
      model: 'medical-cards-v1',
      timeoutMs: 120_000,
    });
  });

  it('rejects malformed public gateway timeout metadata', () => {
    expect(() => parseExpoPublicGatewayEnvironment({
      gatewayUrl: 'http://127.0.0.1:8790',
      model: 'medical-cards-v1',
      timeoutMs: 'not-a-number',
    })).toThrow('AI gateway timeout must be between');
  });

  it.each(['apiKey', 'secret', 'providerToken', 'authorization'])('rejects provider credential field %s', (key) => {
    expect(() => parsePublicGatewayConfig({
      gatewayUrl: 'https://ai.barion.example',
      model: 'medical-cards-v1',
      [key]: 'do-not-bundle',
    })).toThrow(BarionAIError);
  });

  it('accepts a gateway access token as client-visible authorization metadata', () => {
    expect(parsePublicGatewayConfig({
      gatewayUrl: 'https://ai.barion.example',
      model: 'medical-cards-v1',
      accessToken: 'short-lived-user-token',
    }).accessToken).toBe('short-lived-user-token');
  });

  it('requires HTTPS except for local development', () => {
    expect(() => parsePublicGatewayConfig({
      gatewayUrl: 'http://ai.barion.example',
      model: 'medical-cards-v1',
    })).toThrow('AI gateway must use HTTPS');

    expect(parsePublicGatewayConfig({
      gatewayUrl: 'http://localhost:8787',
      model: 'medical-cards-v1',
    }).gatewayUrl).toBe('http://localhost:8787');
  });

  it('returns null when optional gateway URL is absent, even if model metadata remains', () => {
    expect(parseExpoPublicGatewayEnvironment({
      gatewayUrl: '',
      model: 'medical-cards-v1',
    })).toBeNull();
  });
});
