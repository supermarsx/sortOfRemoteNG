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
   *  fall back (e.g. OOXML / mRemoteNG IPC missing in this build).
   *  English copy; for i18n use {@link warningKey} alongside. */
  warning?: string;
  /** i18n key matching {@link warning}, e.g. exportEncryption.fallbackOoxml.
   *  Callers should run t(warningKey, { defaultValue: warning }) so the
   *  English fallback shows up when the key is missing in the locale. */
  warningKey?: string;
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
    asBufferSource(utf8Encode(password)),
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
  let parsed: AesCbcEnvelope;
  try {
    parsed = JSON.parse(text) as AesCbcEnvelope;
  } catch (e) {
    throw new DecryptError('corrupted', 'AES-CBC envelope is not valid JSON', e);
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    parsed.algorithm !== 'AES-256-CBC' ||
    !parsed.kdf ||
    typeof parsed.iv !== 'string' ||
    typeof parsed.ciphertext !== 'string'
  ) {
    throw new DecryptError('corrupted', 'Not a recognized AES-CBC envelope');
  }
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = fromBase64(parsed.kdf.salt);
    iv = fromBase64(parsed.iv);
    ciphertext = fromBase64(parsed.ciphertext);
  } catch (e) {
    throw new DecryptError(
      'corrupted',
      'AES-CBC envelope fields are not valid base64',
      e,
    );
  }
  const key = await deriveKeyCbc(password, salt, parsed.kdf.iterations);
  try {
    const plain = await getCrypto().subtle.decrypt(
      { name: 'AES-CBC', iv: asBufferSource(iv) },
      key,
      asBufferSource(ciphertext),
    );
    return new Uint8Array(plain);
  } catch (e) {
    // WebCrypto can't distinguish wrong key from corrupted ciphertext —
    // both surface as OperationError. Surface as wrong-password since
    // that's the most actionable category for the user.
    throw new DecryptError(
      'wrong-password',
      'AES-CBC decryption failed; password is likely incorrect',
      e,
    );
  }
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
    warningKey: 'exportEncryption.fallbackOoxml',
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
    warningKey: 'exportEncryption.fallbackMremoteng',
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

// ─── Detection / decryption on the import side ────────────────────────

/** Returns true when the text looks like the AES-CBC JSON envelope
 *  produced by encryptExport for TXT / Markdown / HTML formats. */
export function isAesCbcEnvelope(payload: string): boolean {
  try {
    const trimmed = payload.trimStart();
    if (!trimmed.startsWith('{')) return false;
    const parsed = JSON.parse(trimmed);
    return (
      parsed &&
      typeof parsed === 'object' &&
      parsed.algorithm === 'AES-256-CBC' &&
      parsed.kdf &&
      parsed.kdf.name === 'PBKDF2' &&
      typeof parsed.kdf.salt === 'string' &&
      typeof parsed.iv === 'string' &&
      typeof parsed.ciphertext === 'string'
    );
  } catch {
    return false;
  }
}

/** Returns true when the text matches mRemoteNG's encrypted XML envelope
 *  (the v2.6+ Confidential="...EncryptionEngine"... format). */
export function isMremotengEncryptedXml(payload: string): boolean {
  const head = payload.trimStart().slice(0, 1024);
  return (
    head.startsWith('<?xml') &&
    /Confidential\s*=\s*"True"/i.test(head) &&
    /EncryptionEngine\s*=/i.test(head)
  );
}

/** Decrypt an mRemoteNG-encrypted document via the Tauri IPC. The
 *  caller is responsible for extracting any required iterations from
 *  the envelope's XML header before invoking. */
export async function decryptMremotengDocument(
  ciphertext: string,
  password: string,
  iterations?: number,
): Promise<string> {
  const invoke = getInvoke();
  if (!invoke) {
    throw new DecryptError(
      'unsupported',
      'mRemoteNG decryption requires the desktop backend.',
    );
  }
  let result: unknown;
  try {
    result = await invoke('mrng_decrypt_document', {
      ciphertext,
      password,
      iterations:
        iterations != null ? normalizePbkdf2Iterations(iterations) : 1000,
    });
  } catch (e) {
    // The Rust side returns Err on auth-tag mismatch, malformed envelope,
    // or any IO failure. Most user-visible cases are wrong-password; we
    // can't reliably distinguish from corruption without parsing the
    // backend's error string, so default to wrong-password.
    throw new DecryptError(
      'wrong-password',
      `mRemoteNG decryption failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
  if (typeof result !== 'string') {
    throw new DecryptError(
      'corrupted',
      'mRemoteNG decryption returned an unexpected payload.',
    );
  }
  return result;
}

// ─── Classified decryption errors ────────────────────────────────────

export type DecryptErrorKind =
  | 'wrong-password'
  | 'corrupted'
  | 'unsupported'
  | 'unknown';

/**
 * Classified error thrown by the decrypt helpers in this module so the
 * import-side UI can pick a targeted message instead of the generic
 * "Failed to decrypt file" string.
 *
 * Categories:
 *   - 'wrong-password': decryption ran but the auth tag / padding check
 *     failed. Almost always a bad password; rarely corrupted ciphertext.
 *   - 'corrupted': envelope shape / encoding is wrong (JSON parse error,
 *     missing fields, base64 garbage). The password could not even be
 *     tested.
 *   - 'unsupported': detector recognized the envelope but no decoder is
 *     available in this build (e.g. mRemoteNG IPC missing in the web
 *     build, or an OOXML file landed without the Excel decryptor).
 *   - 'unknown': bucket for anything we can't classify.
 */
export class DecryptError extends Error {
  readonly kind: DecryptErrorKind;
  readonly cause?: unknown;
  constructor(kind: DecryptErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'DecryptError';
    this.kind = kind;
    this.cause = cause;
  }
}

/** i18n key matching the four DecryptError kinds, useful for callers
 *  that want to surface a localized message. The keys live under
 *  `exportEncryption.decryptErrors.*` in the locale JSON files. */
export const DECRYPT_ERROR_I18N_KEYS: Record<DecryptErrorKind, string> = {
  'wrong-password': 'exportEncryption.decryptErrors.wrongPassword',
  corrupted: 'exportEncryption.decryptErrors.corrupted',
  unsupported: 'exportEncryption.decryptErrors.unsupported',
  unknown: 'exportEncryption.decryptErrors.unknown',
};

/** Default English copy for each DecryptError kind. */
export const DECRYPT_ERROR_DEFAULT_MESSAGES: Record<DecryptErrorKind, string> = {
  'wrong-password':
    'Failed to decrypt file. The password is likely incorrect.',
  corrupted:
    'Failed to decrypt file. The encrypted envelope is corrupted or in an unrecognized shape.',
  unsupported:
    'This encrypted file uses a scheme that is not available in this build.',
  unknown: 'Failed to decrypt file.',
};

// ─── Excel OOXML Agile Encryption ────────────────────────────────────
//
// The `office` scheme is backed by the Tauri IPC `crypto_xlsx_encrypt`,
// implemented in `sorng-auth::xlsx_crypto` on top of the
// `ms-offcrypto-writer` crate. The dispatcher above prefers that IPC
// when running under Tauri and only falls back to the AES-GCM envelope
// (with the localized warning) when the IPC isn't reachable — e.g. in
// the browser dev shell or a build where the command wasn't registered.
//
// The companion `crypto_xlsx_decrypt` IPC is also exposed for import
// flows that need to read a password-protected `.xlsx` file produced
// by real Excel. The current import pipeline reads files as text and
// would need a separate binary read path before that command can be
// wired in; the IPC ships now so the Rust side is ready when the
// import refactor lands.
