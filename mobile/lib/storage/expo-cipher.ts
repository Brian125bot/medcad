import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import type { CipherPort } from './ports';
import { VaultIntegrityError } from './context';

/**
 * expo-crypto AES-256-GCM implementation of CipherPort.
 *
 * Wire format: base64(IV[12] || ciphertext || tag[16]) — identical to the
 * node:crypto test cipher, so rows sealed in tests decrypt on device and back.
 */
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

async function keyFromBytes(raw: Uint8Array): Promise<AESEncryptionKey> {
  return AESEncryptionKey.import(raw);
}

export function expoCipher(): CipherPort {
  return {
    async generateKey(): Promise<Uint8Array> {
      const key = await AESEncryptionKey.generate(AESKeySize.AES256);
      return new Uint8Array(await key.bytes());
    },
    async randomBytes(length: number): Promise<Uint8Array> {
      const key = await AESEncryptionKey.generate(AESKeySize.AES256);
      const bytes = new Uint8Array(await key.bytes());
      return bytes.subarray(0, length);
    },
    async seal(plaintext: Uint8Array, key: Uint8Array): Promise<string> {
      const sealed = await aesEncryptAsync(plaintext, await keyFromBytes(key));
      const combined = await sealed.combined('bytes');
      return bytesToBase64(combined);
    },
    async open(sealedBase64: string, key: Uint8Array): Promise<Uint8Array> {
      try {
        const combined = base64ToBytes(sealedBase64);
        if (combined.length < IV_LENGTH + TAG_LENGTH) throw new Error('truncated payload');
        const sealed = AESSealedData.fromCombined(combined, { ivLength: IV_LENGTH, tagLength: TAG_LENGTH });
        const out = await aesDecryptAsync(sealed, await keyFromBytes(key));
        return out instanceof Uint8Array ? out : new Uint8Array(out);
      } catch (error) {
        if (error instanceof VaultIntegrityError) throw error;
        throw new VaultIntegrityError();
      }
    },
  };
}

// Hermes-safe base64 (no Buffer in React Native). Duplicated from context.ts on
// purpose: this file must not import Node-only helpers.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out +=
      B64[(triple >> 18) & 63] +
      B64[(triple >> 12) & 63] +
      (i + 1 < binary.length ? B64[(triple >> 6) & 63] : '=') +
      (i + 2 < binary.length ? B64[triple & 63] : '=');
  }
  return out;
}

function base64ToBytes(base64: string): Uint8Array {
  const lookup = new Map<string, number>();
  for (let i = 0; i < B64.length; i += 1) lookup.set(B64[i], i);
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup.get(clean[i]) ?? 0;
    const b = lookup.get(clean[i + 1]) ?? 0;
    const c = clean[i + 2] === '=' ? 0 : (lookup.get(clean[i + 2]) ?? 0);
    const d = clean[i + 3] === '=' ? 0 : (lookup.get(clean[i + 3]) ?? 0);
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    bytes.push((triple >> 16) & 255);
    if (clean[i + 2] !== '=') bytes.push((triple >> 8) & 255);
    if (clean[i + 3] !== '=') bytes.push(triple & 255);
  }
  return Uint8Array.from(bytes);
}
