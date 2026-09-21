const originalWarn = console.warn;

jest.mock('expo-crypto', () => {
  const { createHash } = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value, 'utf8').digest('hex'),
  };
});


console.warn = (...args) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes("while requiring the 'ExpoModulesCoreJSLogger' module")
  ) {
    return;
  }

  originalWarn(...args);
};
