import { BarionAIError } from '@/ai/errors';

export type PublicGatewayConfig = {
  gatewayUrl: string;
  model: string;
  accessToken?: string;
  timeoutMs: number;
};

const SENSITIVE_KEY = /api.?key|secret|token|authorization|credential/i;

export function readExpoPublicGatewayConfig(): PublicGatewayConfig | null {
  const gatewayUrl = process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_URL;
  const model = process.env.EXPO_PUBLIC_BARION_AI_MODEL;
  const accessToken = process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN;
  if (!gatewayUrl) return null;
  return parsePublicGatewayConfig({ gatewayUrl, model, accessToken });
}

export function parsePublicGatewayConfig(value: unknown): PublicGatewayConfig {
  if (!isRecord(value)) throw configurationError('AI gateway configuration must be an object.');

  const sensitiveKey = Object.keys(value).find(
    (key) => key !== 'accessToken' && SENSITIVE_KEY.test(key),
  );
  if (sensitiveKey) {
    throw configurationError('Provider credentials cannot be configured in the Expo client.');
  }

  const gatewayUrl = readRequiredString(value.gatewayUrl, 'AI gateway URL is required.');
  const model = readRequiredString(value.model, 'AI model identifier is required.');
  const accessToken = optionalString(value.accessToken);
  const timeoutMs = value.timeoutMs === undefined ? 30_000 : value.timeoutMs;
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 1_000 || Number(timeoutMs) > 120_000) {
    throw configurationError('AI gateway timeout must be between 1000 and 120000 milliseconds.');
  }

  let url: URL;
  try {
    url = new URL(gatewayUrl);
  } catch {
    throw configurationError('AI gateway URL is invalid.');
  }

  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(localHost && url.protocol === 'http:')) {
    throw configurationError('AI gateway must use HTTPS outside local development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw configurationError('AI gateway URL cannot contain credentials, query parameters, or fragments.');
  }

  return {
    gatewayUrl: url.toString().replace(/\/$/, ''),
    model,
    accessToken,
    timeoutMs: Number(timeoutMs),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) throw configurationError(message);
  return value.trim();
}

function optionalString(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw configurationError('AI gateway access token must be a non-empty string.');
  }
  return value.trim();
}

function configurationError(message: string) {
  return new BarionAIError('configuration_error', message);
}