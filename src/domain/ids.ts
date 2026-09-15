import * as Crypto from 'expo-crypto';

export function createId(prefix: string) {
  return `${prefix}_${Crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}
