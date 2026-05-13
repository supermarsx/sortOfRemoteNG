// Format-aware encryption dispatcher for exports.
//
// Each export format gets the encryption envelope that's most useful
// for its consumption story:
//
//   * Native sortOfRemoteNG formats (JSON / XML / CSV): full AES-GCM +
//     PBKDF2 envelope produced by webCryptoAes.encryptWithPassword.
//   * Readable text formats (TXT / Markdown / HTML): a simpler AES-CBC
//     + PBKDF2 envelope wrapped in JSON. Imports back via decrypt below.
//   * Excel (.xlsx OOXML): tries the Tauri `crypto_xlsx_encrypt` IPC
//     so the file opens with Excel's native password prompt. Falls back
//     to AES-GCM with a warning when the IPC isn't registered.
//   * mRemoteNG (foreign XML): tries the Tauri `mrng_encrypt_document`
//     IPC so the file imports back into mRemoteNG using its native
//     scheme. Falls back to AES-GCM with a warning when missing.

import { encryptWithPassword, fromBase64, normalizePbkdf2Iterations, toBase64 } from './webCryptoAes';

export type ExportFormat =
  | 'json'
  | 'xml'
  | 'csv'
  | 'txt'
  | 'markdown'
  | 'html'
  | 'excel'
  | 'mremoteng';

export type ExportEncryptionScheme = 'aes-gcm' | 'aes-cbc' | 'office' | 'mremoteng';

export interface EncryptExportInput {
  /** Raw payload bytes from the serializer. */
  payload: Uint8Array;
  /** Optional UTF-8 source for envelopes that prefer strings. */
  payloadString?: string;
  /** User-chosen password. */
  password: string;
  /** PBKDF2 iterations from the export config. */
  iterations?: number;
}

export interface EncryptExportResult {
  /** Encrypted bytes ready to write to the user's chosen destination. */
  bytes: Uint8Array;
  /** Scheme that actually ran (after any fallback). */
  scheme: ExportEncryptionScheme;
  /** Non-fatal warning the UI can surface if the requested scheme had to
   *  fall back (e.g. OOXML / mRemoteNG IPC missing in this build). */
  warning?: string;
  /** Suggested filename extension. Format-aware schemes may add an
   *  extra `.enc` suffix; native paths keep the format's own extension. */
  extension?: string;
  /** Suggested mime-type, mainly for the download dialog. */
  mimeType?: string;
}

const FORMAT_SCHEMES: Record<ExportFormat, ExportEncryptionScheme> = {
  json: 'aes-gcm',
  xml: 'aes-gcm',
  csv: 'aes-gcm',
  txt: 'aes-cbc',
  markdown: 'aes-cbc',
  html: 'aes-cbc',
  excel: 'office',
  mremoteng: 'mremoteng',
};

export const schemeForFormat = (format: ExportFormat): ExportEncryptionScheme =>
  FORMAT_SCHEMES[format];

const getInvoke = (): ((command: string, args?: any) => Promise<any>) | null => {
  const inv = (globalThis as any).__TAURI__?.core?.invoke;
  return typeof inv === 'function' ? inv : null;
};

const getCrypto = (): Crypto => globalThis.crypto as Crypto;

const asBufferSource = (bytes: Uint8Array): BufferSource => bytes as Uint8Array<ArrayBuffer>;

const utf8Encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const utf8Decode = (bytes: Uint8Array | ArrayBuffer): string =>
  new TextDecoder().decode(bytes);

/**
 * Simple AES-CBC envelope used by the readable text formats. Stored as
 * UTF-8 JSON so importing back is just a JSON parse + decrypt step.
 */
interface AesCbcEnvelope {
  version: 1;
  algorithm: 'AES-256-CBC';
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  iv: string;
  ciphertext: string;
}

async function deriveKeyCbc(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const subtle = getCrypto().subtle;
  const baseKey = await subtle.importKey(
    'raw',
    utf8Encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: asBufferSource(salt),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-CBC', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptAesCbc(input: EncryptExportInput): Promise<EncryptExportResult> {
  const iterations = normalizePbkdf2Iterations(input.iterations);
  const crypto = getCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyCbc(input.password, salt, iterations);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: asBufferSource(iv) },
    key,
    asBufferSource(input.payload),
  );
  const envelope: AesCbcEnvelope = {
    version: 1,
    algorithm: 'AES-256-CBC',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(cipher)),
  };
  return {
    bytes: utf8Encode(JSON.stringify(envelope)),
    scheme: 'aes-cbc',
    mimeType: 'application/json',
  };
}

export async function decryptAesCbcEnvelope(
  envelopeBytes: Uint8Array | string,
  password: string,
): Promise<Uint8Array> {
  const text =
    typeof envelopeBytes === 'string' ? envelopeBytes : utf8Decode(envelopeBytes);
  const parsed = JSON.parse(text) as AesCbcEnvelope;
  if (parsed.algorithm !== 'AES-256-CBC') {
    throw new Error('Not an AES-CBC envelope');
  }
  const salt = fromBase64(parsed.kdf.salt);
  const iv = fromBase64(parsed.iv);
  const ciphertext = fromBase64(parsed.ciphertext);
  const key = await deriveKeyCbc(password, salt, parsed.kdf.iterations);
  const plain = await getCrypto().subtle.decrypt(
    { name: 'AES-CBC', iv: asBufferSource(iv) },
    key,
    asBufferSource(ciphertext),
  );
  return new Uint8Array(plain);
}

async function encryptAesGcm(input: EncryptExportInput): Promise<EncryptExportResult> {
  const plaintext = input.payloadString ?? utf8Decode(input.payload);
  const wrapped = await encryptWithPassword(plaintext, input.password, {
    iterations: input.iterations,
  });
  return {
    bytes: utf8Encode(wrapped),
    scheme: 'aes-gcm',
    mimeType: 'application/json',
  };
}

async function encryptOoxml(input: EncryptExportInput): Promise<EncryptExportResult> {
  const invoke = getInvoke();
  if (invoke) {
    try {
      const base64 = await invoke('crypto_xlsx_encrypt', {
        payloadBase64: toBase64(input.payload),
        password: input.password,
      });
      if (typeof base64 === 'string' && base64.length > 0) {
        return {
          bytes: fromBase64(base64),
          scheme: 'office',
          extension: '.xlsx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      }
    } catch {
      // fall through to AES-GCM fallback
    }
  }
  const fallback = await encryptAesGcm(input);
  return {
    ...fallback,
    warning:
      'OOXML password protection is not available in this build; the file was wrapped with AES-GCM instead. Open the .enc.json file with sortOfRemoteNG to decrypt.',
    extension: '.xlsx.enc.json',
    mimeType: 'application/json',
  };
}

async function encryptMremoteng(input: EncryptExportInput): Promise<EncryptExportResult> {
  const invoke = getInvoke();
  const plaintext = input.payloadString ?? utf8Decode(input.payload);
  if (invoke) {
    try {
      const encrypted = await invoke('mrng_encrypt_document', {
        plaintext,
        password: input.password,
        iterations: normalizePbkdf2Iterations(input.iterations),
      });
      if (typeof encrypted === 'string' && encrypted.length > 0) {
        return {
          bytes: utf8Encode(encrypted),
          scheme: 'mremoteng',
          extension: '.xml',
          mimeType: 'application/xml',
        };
      }
    } catch {
      // fall through
    }
  }
  const fallback = await encryptAesGcm({ ...input, payloadString: plaintext });
  return {
    ...fallback,
    warning:
      'mRemoteNG-native encryption is not available in this build; the file was wrapped with AES-GCM instead. mRemoteNG will not be able to open this file directly — open it with sortOfRemoteNG.',
    extension: '.xml.enc.json',
    mimeType: 'application/json',
  };
}

export async function encryptExport(
  format: ExportFormat,
  input: EncryptExportInput,
): Promise<EncryptExportResult> {
  switch (schemeForFormat(format)) {
    case 'aes-gcm':
      return encryptAesGcm(input);
    case 'aes-cbc':
      return encryptAesCbc(input);
    case 'office':
      return encryptOoxml(input);
    case 'mremoteng':
      return encryptMremoteng(input);
  }
}
