// WebCrypto-backed AES-GCM helpers for per-session/ephemeral encryption
// of exported files. Persistent encryption goes through the Rust backend
// via `invoke(...)`; this module covers the browser-side path only.
//
// Current output format: a JSON envelope carrying algorithm and KDF metadata.
// Legacy `${base64(salt)}.${base64(iv)}.${base64(ciphertext)}` payloads are
// still accepted by decryptWithPassword for existing exported files.

import { PBKDF2_ITERATIONS } from '../../config';

export interface PasswordEncryptionOptions {
  iterations?: number;
}

interface WebCryptoEnvelope {
  version: 2;
  algorithm: 'AES-256-GCM';
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  iv: string;
  ciphertext: string;
}

const MIN_PBKDF2_ITERATIONS = 10000;
const MAX_PBKDF2_ITERATIONS = 5000000;

const getCrypto = (): Crypto => globalThis.crypto as Crypto;

const asBufferSource = (bytes: Uint8Array): BufferSource =>
  bytes as Uint8Array<ArrayBuffer>;

export function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function fromBase64(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function normalizePbkdf2Iterations(iterations?: number): number {
  if (!Number.isFinite(iterations ?? NaN)) return PBKDF2_ITERATIONS;
  return Math.min(
    MAX_PBKDF2_ITERATIONS,
    Math.max(MIN_PBKDF2_ITERATIONS, Math.round(iterations as number)),
  );
}

function parseEnvelope(payload: string): WebCryptoEnvelope | null {
  try {
    const parsed = JSON.parse(payload) as Partial<WebCryptoEnvelope>;
    if (
      parsed?.version === 2 &&
      parsed.algorithm === 'AES-256-GCM' &&
      parsed.kdf?.name === 'PBKDF2' &&
      parsed.kdf.hash === 'SHA-256' &&
      typeof parsed.kdf.salt === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ciphertext === 'string'
    ) {
      return parsed as WebCryptoEnvelope;
    }
  } catch {
    return null;
  }
  return null;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: asBufferSource(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPassword(
  plaintext: string,
  password: string,
  options: PasswordEncryptionOptions = {},
): Promise<string> {
  const crypto = getCrypto();
  const iterations = normalizePbkdf2Iterations(options.iterations);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv) },
    key,
    asBufferSource(enc.encode(plaintext)),
  );
  const envelope: WebCryptoEnvelope = {
    version: 2,
    algorithm: 'AES-256-GCM',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: toBase64(salt),
    },
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
  return JSON.stringify(envelope);
}

export async function decryptWithPassword(
  payload: string,
  password: string,
): Promise<string> {
  const envelope = parseEnvelope(payload);
  if (envelope) {
    const salt = fromBase64(envelope.kdf.salt);
    const iv = fromBase64(envelope.iv);
    const data = fromBase64(envelope.ciphertext);
    const key = await deriveKey(
      password,
      salt,
      normalizePbkdf2Iterations(envelope.kdf.iterations),
    );
    const crypto = getCrypto();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(iv) },
      key,
      asBufferSource(data),
    );
    return new TextDecoder().decode(decrypted);
  }

  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [saltB64, ivB64, dataB64] = parts;
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const crypto = getCrypto();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv) },
    key,
    asBufferSource(data),
  );
  return new TextDecoder().decode(decrypted);
}

/** Shape check for current JSON envelopes or legacy `salt.iv.ciphertext` payloads. */
export function isWebCryptoPayload(payload: string): boolean {
  if (typeof payload !== 'string') return false;
  return Boolean(parseEnvelope(payload)) || payload.split('.').length === 3;
}
