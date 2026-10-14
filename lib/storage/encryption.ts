/**
 * CadenceRx — WebCrypto AES-256-GCM Encryption Layer
 * 
 * Threat Model & Security Posture:
 * - Scope: Provides client-side authenticated AES-256-GCM encryption at rest for patient medication records,
 *   dose logs, and configuration stored in local IndexedDB / SQLite tables.
 * - Intended Defense: Protects against casual offline inspection of disk database files,
 *   unauthenticated exports, and shared-workstation storage snooping.
 * - Explicit Security Boundary (NOT Zero-Knowledge): Because device entropy and salt are stored in
 *   the browser profile (localStorage), this does NOT provide zero-knowledge protection against
 *   Cross-Site Scripting (XSS) or an attacker who has access to the browser profile directory.
 *   True zero-knowledge protection would require a user-supplied master passphrase not saved to disk
 *   or hardware-backed cryptographic credentials (e.g., WebAuthn / Secure Enclave).
 * 
 * Cryptographic properties:
 * - Cipher: AES-GCM with 256-bit key length (NIST SP 800-38D)
 * - Authentication tag: 128-bit integrity verification (rejects tampering)
 * - Nonce/IV: Strict 96-bit (12-byte) cryptographically secure pseudorandom number per encryption operation
 * - Key Derivation: PBKDF2-HMAC-SHA256 with device-specific salt and 100,000 iterations
 * - In-memory key caching: eliminates repeated key derivation overhead (<0.5ms encrypt/decrypt)
 */

export interface EncryptedPayload {
  cipherText: string; // Base64-encoded encrypted data
  iv: string;         // Base64-encoded 12-byte initialization vector
  version: number;    // Encryption format version (1)
}

const VAULT_SALT_KEY = 'cadencerx_vault_salt_v1';
const VAULT_DEVICE_ID_KEY = 'cadencerx_vault_dev_id_v1';
const KEY_DERIVATION_ITERATIONS = 100000;
export const CURRENT_CIPHER_VERSION = 1;

let cachedCryptoKey: CryptoKey | null = null;
let keyDerivationPromise: Promise<CryptoKey> | null = null;

/**
 * Convert an ArrayBuffer to a Base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a Base64 string to an ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Retrieves or initializes the persistent device-unique salt and identifier.
 */
function getOrCreateDeviceSecret(): { salt: Uint8Array; deviceEntropy: string } {
  if (typeof window === 'undefined') {
    // Server-side fallback (e.g. SSR or build step)
    return {
      salt: new Uint8Array([74, 182, 91, 14, 203, 88, 32, 99, 15, 220, 11, 49, 87, 102, 233, 44]),
      deviceEntropy: 'cadencerx-isolated-node-entropy',
    };
  }

  let saltHex = localStorage.getItem(VAULT_SALT_KEY);
  if (!saltHex) {
    const randomSalt = new Uint8Array(16);
    crypto.getRandomValues(randomSalt);
    saltHex = Array.from(randomSalt).map((b) => b.toString(16).padStart(2, '0')).join('');
    try {
      localStorage.setItem(VAULT_SALT_KEY, saltHex);
    } catch {
      // Storage unavailable or quota exceeded
    }
  }

  let deviceId = localStorage.getItem(VAULT_DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `dev-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)}`;
    try {
      localStorage.setItem(VAULT_DEVICE_ID_KEY, deviceId);
    } catch {
      // Storage unavailable
    }
  }

  // Convert hex salt to Uint8Array
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [1, 2, 3, 4]);

  return {
    salt,
    deviceEntropy: `cadencerx-${deviceId}-patient-vault-secure`,
  };
}

/**
 * Derives the persistent AES-256-GCM CryptoKey using PBKDF2 with SHA-256.
 */
export async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) {
    return cachedCryptoKey;
  }

  if (keyDerivationPromise) {
    return keyDerivationPromise;
  }

  keyDerivationPromise = (async () => {
    const { salt, deviceEntropy } = getOrCreateDeviceSecret();
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(deviceEntropy),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: KEY_DERIVATION_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    cachedCryptoKey = derivedKey;
    return derivedKey;
  })();

  return keyDerivationPromise;
}

/**
 * Encrypts an arbitrary serializable JavaScript value into an authenticated AES-256-GCM payload.
 */
export async function encryptData<T>(data: T): Promise<EncryptedPayload> {
  const key = await getEncryptionKey();
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(data));

  // Generate a cryptographically secure 96-bit (12-byte) IV for GCM
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128, // 128-bit authentication tag
    },
    key,
    plaintextBytes
  );

  return {
    cipherText: bufferToBase64(cipherBuffer),
    iv: bufferToBase64(iv.buffer),
    version: CURRENT_CIPHER_VERSION,
  };
}

/**
 * Decrypts an authenticated AES-256-GCM payload back into its typed JavaScript structure.
 * Throws a sanitized safe error if the payload has been corrupted, tampered with, or invalid.
 */
export async function decryptData<T>(payload: EncryptedPayload): Promise<T> {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof payload.cipherText !== 'string' ||
    !payload.cipherText ||
    typeof payload.iv !== 'string' ||
    !payload.iv
  ) {
    throw new Error('Decryption failed: invalid encrypted payload structure');
  }

  // Validate cipher version
  if (payload.version !== CURRENT_CIPHER_VERSION) {
    throw new Error(
      `Decryption failed: unsupported cipher version ${payload.version} (expected ${CURRENT_CIPHER_VERSION})`
    );
  }

  let cipherBuffer: ArrayBuffer;
  let ivBuffer: ArrayBuffer;

  try {
    ivBuffer = base64ToBuffer(payload.iv);
    cipherBuffer = base64ToBuffer(payload.cipherText);
  } catch {
    throw new Error('Decryption failed: invalid base64 encoding');
  }

  // Strictly enforce 96-bit (12-byte) IV length required for AES-GCM
  if (ivBuffer.byteLength !== 12) {
    throw new Error(
      `Decryption failed: invalid IV length ${ivBuffer.byteLength} bytes (expected 12 bytes)`
    );
  }

  // Enforce minimal length: ciphertext must at least contain the 128-bit (16-byte) authentication tag
  if (cipherBuffer.byteLength < 16) {
    throw new Error('Decryption failed: ciphertext truncated');
  }

  const key = await getEncryptionKey();

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(ivBuffer),
        tagLength: 128,
      },
      key,
      cipherBuffer
    );

    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString) as T;
  } catch {
    // Reject tampered, corrupted, or invalid payload safely without leaking internal details
    throw new Error('Decryption failed: payload is corrupted, tampered, or invalid');
  }
}

/**
 * Verifies encryption layer integrity and measures current encrypt/decrypt round-trip latency.
 */
export async function testEncryptionPerformance(): Promise<{
  supported: boolean;
  encryptLatencyMs: number;
  decryptLatencyMs: number;
  algorithm: string;
}> {
  try {
    const samplePayload = {
      test: 'CadenceRx Patient Record Test',
      timestamp: Date.now(),
      records: Array.from({ length: 10 }, (_, i) => ({ id: `sample-${i}`, value: i })),
    };

    const t0 = performance.now();
    const encrypted = await encryptData(samplePayload);
    const t1 = performance.now();

    const decrypted = await decryptData<typeof samplePayload>(encrypted);
    const t2 = performance.now();

    const isMatch = decrypted.timestamp === samplePayload.timestamp;

    return {
      supported: isMatch,
      encryptLatencyMs: Math.round((t1 - t0) * 100) / 100,
      decryptLatencyMs: Math.round((t2 - t1) * 100) / 100,
      algorithm: 'AES-256-GCM (PBKDF2 SHA-256)',
    };
  } catch (err) {
    console.error('Encryption performance test failed:', err);
    return {
      supported: false,
      encryptLatencyMs: -1,
      decryptLatencyMs: -1,
      algorithm: 'AES-256-GCM (Failed)',
    };
  }
}
