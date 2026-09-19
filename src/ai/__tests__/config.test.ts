import { parsePublicGatewayConfig, readExpoPublicGatewayConfig } from '@/ai/config';
import { BarionAIError } from '@/ai/errors';

describe('parsePublicGatewayConfig', () => {
  it('accepts public gateway metadata without provider credentials', () => {
    expect(parsePublicGatewayConfig({
      gatewayUrl: 'https://ai.barion.example/',
      model: 'medical-cards-v1',
    })).toEqual({
      gatewayUrl: 'https://ai.barion.example',
      model: 'medical-cards-v1',
      timeoutMs: 30_000,
    });
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
    const url = process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_URL;
    const model = process.env.EXPO_PUBLIC_BARION_AI_MODEL;
    const accessToken = process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN;
    delete process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_URL;
    process.env.EXPO_PUBLIC_BARION_AI_MODEL = 'medical-cards-v1';
    try {
      expect(readExpoPublicGatewayConfig()).toBeNull();
    } finally {
      if (url !== undefined) process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_URL = url;
      else delete process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_URL;
      if (model !== undefined) process.env.EXPO_PUBLIC_BARION_AI_MODEL = model;
      else delete process.env.EXPO_PUBLIC_BARION_AI_MODEL;
      if (accessToken !== undefined) process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN = accessToken;
      else delete process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN;
    }
  });
});