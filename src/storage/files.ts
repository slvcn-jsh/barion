import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

type PersistableAsset = {
  name: string;
  uri: string;
  mimeType?: string | null;
  size?: number | null;
  file?: Blob | null;
};

export async function persistImportedSource(sourceId: string, asset: PersistableAsset) {
  if (Platform.OS === 'web') {
    const bytes = await readWebBytes(asset);

    return {
      localUri: asset.uri,
      sha256: bytes ? await hashBytes(bytes) : await fallbackFingerprint(asset),
      sizeBytes: asset.size ?? bytes?.byteLength ?? null,
    };
  }

  const directory = new Directory(Paths.document, 'medstudy-sources');
  directory.create({ idempotent: true, intermediates: true });

  const safeName = sanitizeFilename(asset.name);
  const destination = new File(directory, `${sourceId}-${safeName}`);
  const source = new File(asset.uri);

  let localUri = asset.uri;
  let sha256 = await fallbackFingerprint(asset);

  try {
    if (source.exists) {
      await source.copy(destination, { overwrite: true });
      localUri = destination.uri;
      sha256 = await hashFile(destination);
    }
  } catch {
    localUri = asset.uri;
  }

  return {
    localUri,
    sha256,
    sizeBytes: asset.size ?? null,
  };
}

export function discardPersistedSource(localUri: string) {
  if (Platform.OS === 'web' || localUri.startsWith('seed:')) return;

  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // Duplicate database records are still prevented if a cache file cannot be removed.
  }
}

async function hashFile(file: File) {
  const bytes = await file.arrayBuffer();
  return hashBytes(bytes);
}

async function hashBytes(bytes: ArrayBuffer) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return arrayBufferToHex(digest);
}

async function readWebBytes(asset: PersistableAsset) {
  try {
    if (asset.file) {
      return asset.file.arrayBuffer();
    }

    const response = await fetch(asset.uri);
    if (response.ok) {
      return response.arrayBuffer();
    }
  } catch {
    // Browser blob URLs are temporary. The source processor still receives the picker File.
  }

  return null;
}

async function fallbackFingerprint(asset: PersistableAsset) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${asset.name}:${asset.mimeType ?? 'unknown'}:${asset.size ?? 0}:${asset.uri}`,
  );
}

function arrayBufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function sanitizeFilename(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'source-file';
}
