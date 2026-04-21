// WebCrypto-backed AES-GCM helpers for per-session/ephemeral encryption
// of exported files. Persistent encryption goes through the Rust backend
// via `invoke(...)`; this module covers the browser-side path only.
//
// Output format: `${base64(salt)}.${base64(iv)}.${base64(ciphertext)}`
// (same shape produced by CollectionManager so that encrypted JSON
// exports round-trip across both code paths.)

import { PBKDF2_ITERATIONS } from '../../config';

const getCrypto = (): Crypto => globalThis.crypto as Crypto;

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

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPassword(
  plaintext: string,
  password: string,
): Promise<string> {
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  return `${toBase64(salt)}.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decryptWithPassword(
  payload: string,
  password: string,
): Promise<string> {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [saltB64, ivB64, dataB64] = parts;
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const key = await deriveKey(password, salt);
  const crypto = getCrypto();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );
  return new TextDecoder().decode(decrypted);
}

/** Shape check for the WebCrypto payload format (`salt.iv.ciphertext`). */
export function isWebCryptoPayload(payload: string): boolean {
  return typeof payload === 'string' && payload.split('.').length === 3;
}
