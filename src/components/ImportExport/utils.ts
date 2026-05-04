import { Connection } from '../../types/connection/connection';
import { generateId } from '../../utils/core/id';

export const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim().replace(/\r$/, ''));
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim().replace(/\r$/, ''));
  return values;
};

const getDefaultPort = (protocol: string): number => {
  const defaults: Record<string, number> = {
    RDP: 3389,
    SSH1: 22,
    SSH2: 22,
    SSH: 22,
    TELNET: 23,
    RLOGIN: 513,
    VNC: 5900,
    HTTP: 80,
    HTTPS: 443,
    FTP: 21,
    SFTP: 22,
  };

  return defaults[String(protocol).trim().toUpperCase()] || 3389;
};

const parsePortOrDefault = (portValue: unknown, protocol: string): number => {
  if (typeof portValue === 'number') {
    return Number.isFinite(portValue) && portValue > 0
      ? portValue
      : getDefaultPort(protocol);
  }

  const normalizedPort = String(portValue ?? '').trim();
  if (!normalizedPort) return getDefaultPort(protocol);

  const parsedPort = Number.parseInt(normalizedPort, 10);
  return Number.isFinite(parsedPort) && parsedPort > 0
    ? parsedPort
    : getDefaultPort(protocol);
};

export const importFromCSV = async (content: string): Promise<Connection[]> => {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('CSV file must have headers and at least one data row');

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const connections: Connection[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const conn: any = {};
    headers.forEach((header, index) => {
      conn[header] = values[index];
    });

    const protocol = (conn.Protocol?.toLowerCase() || 'rdp') as Connection['protocol'];

    connections.push({
      id: conn.ID || generateId(),
      name: conn.Name || 'Imported Connection',
      protocol,
      hostname: conn.Hostname || '',
      port: parsePortOrDefault(conn.Port, protocol),
      username: conn.Username || undefined,
      domain: conn.Domain || undefined,
      description: conn.Description || undefined,
      parentId: conn.ParentId || undefined,
      isGroup: conn.IsGroup === 'true',
      tags: conn.Tags?.split(';').filter((t: string) => t.trim()) || [],
      createdAt: new Date(conn.CreatedAt || Date.now()).toISOString(),
      updatedAt: new Date(conn.UpdatedAt || Date.now()).toISOString()
    });
  }

  return connections;
};

/**
 * Supported import formats
 */
export type ImportFormat = 
  | 'mremoteng'      // mRemoteNG XML format
  | 'rdcman'         // Remote Desktop Connection Manager
  | 'royalts'        // Royal TS/TSX JSON format
  | 'mobaxterm'      // MobaXterm INI format
  | 'putty'          // PuTTY registry export
  | 'securecrt'      // SecureCRT XML sessions
  | 'termius'        // Termius JSON export
  | 'csv'            // Generic CSV
  | 'json';          // Generic JSON

/**
 * Detect import format from file content
 */
export const detectImportFormat = (content: string, filename?: string): ImportFormat => {
  // Strip BOM and whitespace.
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  let extIsXml = false;

  // Check filename extension first
  if (filename) {
    const lower = filename.toLowerCase();
    const ext = lower.split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'rtsz' || ext === 'rtsx' || lower.includes('royalts')) return 'royalts';
    if (lower.includes('termius')) return 'termius';
    if (ext === 'rdg') return 'rdcman';
    if (ext === 'reg') return 'putty';
    if (ext === 'ini' && lower.includes('moba')) return 'mobaxterm';
    if (ext === 'xml') extIsXml = true;
  }

  // mRemoteNG detection - the <Connections> root tag is distinctive.
  // ConfVersion is usually present but absent in some encrypted exports,
  // so we accept either marker.
  if (
    trimmed.includes('<Connections') &&
    (trimmed.includes('ConfVersion') ||
      trimmed.includes('FullFileEncryption') ||
      trimmed.includes('Protected='))
  ) {
    return 'mremoteng';
  }
  
  // RDCMan detection
  if (trimmed.includes('<RDCMan') || (trimmed.includes('<file') && trimmed.includes('<group'))) {
    return 'rdcman';
  }
  
  // Royal TS JSON format
  if (trimmed.startsWith('{') && (trimmed.includes('"Objects"') || trimmed.includes('"RoyalFolder"'))) {
    return 'royalts';
  }
  
  // MobaXterm INI format
  if (trimmed.includes('[Bookmarks') || trimmed.includes('SubRep=')) {
    return 'mobaxterm';
  }
  
  // PuTTY registry format
  if (trimmed.includes('REGEDIT') || trimmed.includes('[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY')) {
    return 'putty';
  }
  
  // SecureCRT XML sessions
  if (trimmed.includes('<VanDyke') || trimmed.includes('S:"Protocol Name"')) {
    return 'securecrt';
  }
  
  // Termius JSON
  if (trimmed.startsWith('{') && trimmed.includes('"hosts"')) {
    return 'termius';
  }

  // Generic XML check
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) {
    // Could be mRemoteNG without the standard header
    if (trimmed.includes('Node') && (trimmed.includes('Protocol=') || trimmed.includes('Hostname='))) {
      return 'mremoteng';
    }
    // A bare <Connections>…</Connections> wrapper (e.g. fully-encrypted body
    // with no plaintext ConfVersion) is still mRemoteNG.
    if (trimmed.includes('<Connections')) {
      return 'mremoteng';
    }
  }

  // Generic JSON check
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }

  // .xml filename without a matched signature: assume mRemoteNG rather than
  // falling through to CSV (which would otherwise eat encrypted XML blobs).
  if (extIsXml) return 'mremoteng';

  // Default to CSV
  return 'csv';
};

/**
 * Map mRemoteNG protocol names to our format
 */
const mapMRemoteNGProtocol = (protocol: string): Connection['protocol'] => {
  const protocolMap: Record<string, Connection['protocol']> = {
    'RDP': 'rdp',
    'SSH1': 'ssh',
    'SSH2': 'ssh',
    'Telnet': 'telnet',
    'Rlogin': 'rlogin',
    'VNC': 'vnc',
    'HTTP': 'http',
    'HTTPS': 'https',
    'ICA': 'rdp',           // Citrix ICA mapped to RDP
    'RAW': 'telnet',
    'IntApp': 'rdp',
    'PowerShell': 'ssh',    // mRemoteNG PowerShell remoting → ssh
    'Winbox': 'rdp',        // MikroTik Winbox → rdp
  };
  return protocolMap[protocol] || 'rdp';
};

/**
 * Inspect an mRemoteNG XML payload for encryption metadata on the
 * `<Connections>` root element.
 *
 * - `fullFileEncryption`: the body of `<Connections>` is a single encrypted
 *   blob — children cannot be parsed without the password.
 * - `protected`: a non-empty `Protected` attribute means a password is
 *   recorded; per-attribute encryption is in use even without full-file
 *   encryption.
 */
export interface MRemoteNGEncryptionInfo {
  isEncrypted: boolean;
  fullFileEncryption: boolean;
  requiresPassword: boolean;
}

// mRemoteNG's hardcoded master password used when the user never sets one.
// See upstream `Runtime.EncryptionKey` / cryptography provider.
export const MREMOTENG_DEFAULT_MASTER_PASSWORD = 'mR3m';

// Plaintext stored in the `Protected` attribute. Decrypts to one of these
// strings depending on whether a custom master password was set:
//   - "ThisIsNotProtected"  → no master password set; default `mR3m` works
//   - "ThisIsProtected"     → user set a custom master password
const PROTECTED_PLAINTEXT_NO_PASSWORD = 'ThisIsNotProtected';
const PROTECTED_PLAINTEXT_PASSWORD = 'ThisIsProtected';

// Wire format constants for AES-256-GCM (the only cipher implemented here).
// Layout per upstream `AeadCryptographyProvider.cs`:
//   [ salt (16) ] [ nonce (16) ] [ ciphertext ‖ tag (16) ]   then base64
const MRNG_SALT_SIZE = 16;
const MRNG_NONCE_SIZE = 16;
const MRNG_TAG_SIZE = 16;

const asBufferSource = (bytes: Uint8Array): BufferSource =>
  bytes as Uint8Array<ArrayBuffer>;

const decodeBase64 = (b64: string): Uint8Array => {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

/**
 * Convert a password to bytes the way BouncyCastle's
 * `PbeParametersGenerator.Pkcs5PasswordToBytes` does: take the low byte of
 * each UTF-16 code unit. mRemoteNG's `Pkcs5S2KeyGenerator` calls this before
 * feeding the bytes to PBKDF2, so we MUST match it exactly — not UTF-8 — or
 * non-ASCII passwords (e.g. "passwört") will derive a different key.
 *
 * For any pure-ASCII password this is identical to UTF-8; for Latin-1 the
 * low-byte truncation is the same as ISO-8859-1; for code points > 0xFF
 * BouncyCastle silently loses the high bits and so do we.
 */
function pkcs5PasswordToBytes(password: string): Uint8Array {
  const out = new Uint8Array(password.length);
  for (let i = 0; i < password.length; i++) {
    out[i] = password.charCodeAt(i) & 0xff;
  }
  return out;
}

async function deriveMRemoteNGKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[] = ['decrypt'],
): Promise<CryptoKey> {
  const passKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(pkcs5PasswordToBytes(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-1', salt: asBufferSource(salt), iterations },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/**
 * Decrypt a single base64-encoded mRemoteNG ciphertext (Protected attribute,
 * per-field Password, or full-file body). The output is the raw plaintext
 * bytes — caller decides whether to UTF-8 decode.
 */
async function decryptMRemoteNGBlob(
  payloadB64: string,
  password: string,
  iterations: number,
): Promise<Uint8Array> {
  const data = decodeBase64(payloadB64);
  const minLen = MRNG_SALT_SIZE + MRNG_NONCE_SIZE + MRNG_TAG_SIZE;
  if (data.length < minLen) {
    throw new Error(
      `mRemoteNG ciphertext is too short (${data.length} bytes; need ≥ ${minLen})`,
    );
  }
  const salt = data.slice(0, MRNG_SALT_SIZE);
  const nonce = data.slice(MRNG_SALT_SIZE, MRNG_SALT_SIZE + MRNG_NONCE_SIZE);
  const ciphertext = data.slice(MRNG_SALT_SIZE + MRNG_NONCE_SIZE);
  const key = await deriveMRemoteNGKey(password, salt, iterations);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBufferSource(nonce), tagLength: MRNG_TAG_SIZE * 8 },
    key,
    asBufferSource(ciphertext),
  );
  return new Uint8Array(plain);
}

/**
 * Encrypt a plaintext buffer in mRemoteNG's wire format. Used by tests
 * (and potentially future export) to round-trip our own implementation.
 */
export async function encryptMRemoteNGBlob(
  plaintext: Uint8Array | string,
  password: string,
  iterations: number,
): Promise<string> {
  const bytes =
    typeof plaintext === 'string'
      ? new TextEncoder().encode(plaintext)
      : plaintext;
  const salt = crypto.getRandomValues(new Uint8Array(MRNG_SALT_SIZE));
  const nonce = crypto.getRandomValues(new Uint8Array(MRNG_NONCE_SIZE));
  const key = await deriveMRemoteNGKey(password, salt, iterations, ['encrypt']);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBufferSource(nonce), tagLength: MRNG_TAG_SIZE * 8 },
      key,
      asBufferSource(bytes),
    ),
  );
  const out = new Uint8Array(salt.length + nonce.length + ct.length);
  out.set(salt, 0);
  out.set(nonce, salt.length);
  out.set(ct, salt.length + nonce.length);
  return encodeBase64(out);
}

/**
 * Reject mRemoteNG files using cipher/mode combinations we can't decrypt in
 * the browser. WebCrypto only exposes AES-GCM; CCM/EAX would need a JS-side
 * implementation, and Serpent/Twofish would need a full block-cipher polyfill.
 *
 * Throws with a descriptive error on anything other than AES/GCM.
 */
function assertSupportedMRemoteNGCipher(root: Element): void {
  const engine = (root.getAttribute('EncryptionEngine') || 'AES').toUpperCase();
  const mode = (root.getAttribute('BlockCipherMode') || 'GCM').toUpperCase();
  if (engine === 'AES' && mode === 'GCM') return;
  if (engine !== 'AES') {
    throw new Error(
      `Unsupported mRemoteNG block cipher "${engine}". Only AES is implemented in this build (Serpent and Twofish would require a JS polyfill).`,
    );
  }
  throw new Error(
    `Unsupported mRemoteNG block-cipher mode "${mode}". Only GCM is implemented in this build (CCM and EAX would require a JS polyfill).`,
  );
}

/**
 * Verify a candidate master password by decrypting the file's `Protected`
 * attribute and checking it matches one of the known plaintext sentinels.
 *
 * Returns:
 *   - `valid: true, isDefaultMaster: true`  → user never set a master, the
 *     literal "mR3m" decrypts everything in the file.
 *   - `valid: true, isDefaultMaster: false` → user set a custom master and
 *     `password` is correct.
 *   - `valid: false` → wrong password (or file uses an unsupported cipher).
 */
export interface MRemoteNGPasswordCheck {
  valid: boolean;
  isDefaultMaster: boolean;
  iterations: number;
  hasProtected: boolean;
}

export async function verifyMRemoteNGPassword(
  content: string,
  password: string,
): Promise<MRemoteNGPasswordCheck> {
  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const root = doc.querySelector('Connections');
  if (!root) throw new Error('Not an mRemoteNG file (no <Connections> root)');
  const iterations = Math.max(
    1,
    parseInt(root.getAttribute('KdfIterations') || '1000', 10),
  );
  const protectedB64 = (root.getAttribute('Protected') || '').trim();
  if (!protectedB64) {
    return { valid: true, isDefaultMaster: true, iterations, hasProtected: false };
  }
  try {
    const plain = await decryptMRemoteNGBlob(protectedB64, password, iterations);
    const text = new TextDecoder().decode(plain);
    if (text === PROTECTED_PLAINTEXT_NO_PASSWORD) {
      return { valid: true, isDefaultMaster: true, iterations, hasProtected: true };
    }
    if (text === PROTECTED_PLAINTEXT_PASSWORD) {
      return { valid: true, isDefaultMaster: false, iterations, hasProtected: true };
    }
    // Decryption succeeded but plaintext is unrecognised — that's still a
    // wrong password unless the sentinel changes upstream.
    return { valid: false, isDefaultMaster: false, iterations, hasProtected: true };
  } catch {
    return { valid: false, isDefaultMaster: false, iterations, hasProtected: true };
  }
}

// All per-field encrypted attributes on `<Node>` in mRemoteNG (per upstream
// `XmlConnectionsDeserializer`):
//   - `Password`           — added in ConfVersion ≥ 0.2 (always)
//   - `VNCProxyPassword`   — added in ConfVersion ≥ 1.7
//   - `RDGatewayPassword`  — added in ConfVersion ≥ 2.2
const MRNG_PER_FIELD_PASSWORD_ATTRS = [
  'Password',
  'VNCProxyPassword',
  'RDGatewayPassword',
];

/**
 * Decrypt every per-field encrypted attribute on `<Node>` elements in the
 * given XML document, mutating it in place. Empty values are left as-is.
 * Decryption failures on individual fields are swallowed (the attribute is
 * left untouched) so a partial parse still yields useful structure.
 */
async function decryptPerFieldPasswords(
  doc: Document,
  password: string,
  iterations: number,
): Promise<void> {
  const nodes = Array.from(doc.querySelectorAll('Node'));
  for (const node of nodes) {
    for (const attr of MRNG_PER_FIELD_PASSWORD_ATTRS) {
      const enc = node.getAttribute(attr);
      if (!enc) continue;
      try {
        const plain = await decryptMRemoteNGBlob(enc, password, iterations);
        node.setAttribute(attr, new TextDecoder().decode(plain));
      } catch {
        // Leave the attribute untouched on failure.
      }
    }
  }
}

/**
 * Decrypt an mRemoteNG XML using the supplied master password. Handles both
 * full-file encryption (entire `<Connections>` body is one blob) and
 * per-field-only encryption (individual `Password` attributes are blobs).
 *
 * Returns XML where `<Node>` elements are plaintext and (where possible)
 * `Password` attributes are decrypted. Verifies the password against the
 * `Protected` attribute first; throws on mismatch with a clear error.
 *
 * Only AES-256-GCM is implemented — Serpent / Twofish / CCM / EAX variants
 * fall through with an explicit error so callers can surface "unsupported".
 */
export async function decryptMRemoteNGXml(
  content: string,
  password: string,
): Promise<string> {
  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const root = doc.querySelector('Connections');
  if (!root) throw new Error('Not an mRemoteNG file (no <Connections> root)');

  assertSupportedMRemoteNGCipher(root);
  const iterations = Math.max(
    1,
    parseInt(root.getAttribute('KdfIterations') || '1000', 10),
  );
  const fullFileAttr = (root.getAttribute('FullFileEncryption') || '').toLowerCase();
  const fullFileEncryption = fullFileAttr === 'true' || fullFileAttr === '1';

  // Validate password against the Protected sentinel before doing any work.
  const protectedB64 = (root.getAttribute('Protected') || '').trim();
  if (protectedB64) {
    const check = await verifyMRemoteNGPassword(content, password);
    if (!check.valid) {
      throw new Error('Incorrect master password');
    }
  }

  if (fullFileEncryption) {
    const body = (root.textContent || '').trim();
    if (!body) throw new Error('FullFileEncryption is on but body is empty');
    const innerBytes = await decryptMRemoteNGBlob(body, password, iterations);
    const innerXml = new TextDecoder().decode(innerBytes);
    // Rebuild a parseable document, preserving the original root attributes
    // so any post-processing can still see them.
    const wrapped = `<?xml version="1.0" encoding="utf-8"?><Connections ConfVersion="${root.getAttribute('ConfVersion') || '2.6'}">${innerXml}</Connections>`;
    const innerDoc = new DOMParser().parseFromString(wrapped, 'text/xml');
    const parseError = innerDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error(
        'Decrypted body is not valid XML — file may be from an unsupported mRemoteNG version',
      );
    }
    await decryptPerFieldPasswords(innerDoc, password, iterations);
    return new XMLSerializer().serializeToString(innerDoc);
  }

  // No full-file encryption — just decrypt per-field Password attributes.
  await decryptPerFieldPasswords(doc, password, iterations);
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Encrypt every per-field password attribute on `<Node>` elements in the
 * given XML document, mutating it in place. Empty values are left as-is.
 */
async function encryptPerFieldPasswords(
  doc: Document,
  password: string,
  iterations: number,
): Promise<void> {
  const nodes = Array.from(doc.querySelectorAll('Node'));
  for (const node of nodes) {
    for (const attr of MRNG_PER_FIELD_PASSWORD_ATTRS) {
      const plain = node.getAttribute(attr);
      if (!plain) continue;
      const ct = await encryptMRemoteNGBlob(plain, password, iterations);
      node.setAttribute(attr, ct);
    }
  }
}

export interface EncryptMRemoteNGOptions {
  /** Master password to encrypt with. Use `mR3m` for the no-master case. */
  password: string;
  /** PBKDF2 iterations to record in the file header. mRemoteNG's minimum is 1000. */
  iterations?: number;
  /** When true, encrypt the entire `<Node>` tree as one blob. */
  fullFileEncryption?: boolean;
  /** Existing root attributes to preserve (Name, Export, etc.). */
  rootAttributes?: Record<string, string>;
}

/**
 * Build an mRemoteNG-format encrypted XML file from a plaintext `<Connections>`
 * document. Produces output that round-trips through `decryptMRemoteNGXml`,
 * including:
 *   - `Protected` attribute set to the canonical sentinel (`ThisIsNotProtected`
 *     for `mR3m`, `ThisIsProtected` for any other password).
 *   - All `EncryptionEngine`, `BlockCipherMode`, `KdfIterations`,
 *     `FullFileEncryption` headers populated to match upstream conventions.
 *   - Every per-field `Password` / `VNCProxyPassword` / `RDGatewayPassword`
 *     attribute encrypted before serialization.
 *   - When `fullFileEncryption` is set, the entire `<Node>` tree is replaced
 *     by one base64 blob inside the root.
 *
 * The input must be a `<Connections>…</Connections>` XML string with `<Node>`
 * children; attributes other than the encryption headers are preserved.
 */
export async function encryptMRemoteNGXml(
  plainXml: string,
  opts: EncryptMRemoteNGOptions,
): Promise<string> {
  const password = opts.password;
  if (!password) throw new Error('encryptMRemoteNGXml requires a password');
  const iterations = Math.max(1000, opts.iterations ?? 1000);

  const doc = new DOMParser().parseFromString(plainXml, 'text/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Input is not valid XML');
  const root = doc.querySelector('Connections');
  if (!root) throw new Error('Input must have a <Connections> root');

  // Preserve any caller-supplied root attributes, then overwrite the
  // encryption headers so the file is self-describing.
  if (opts.rootAttributes) {
    for (const [k, v] of Object.entries(opts.rootAttributes)) {
      root.setAttribute(k, v);
    }
  }
  if (!root.hasAttribute('Name')) root.setAttribute('Name', 'Connections');
  if (!root.hasAttribute('Export')) root.setAttribute('Export', 'false');
  if (!root.hasAttribute('ConfVersion')) root.setAttribute('ConfVersion', '2.6');
  root.setAttribute('EncryptionEngine', 'AES');
  root.setAttribute('BlockCipherMode', 'GCM');
  root.setAttribute('KdfIterations', String(iterations));
  root.setAttribute(
    'FullFileEncryption',
    opts.fullFileEncryption ? 'true' : 'false',
  );

  // Generate the Protected sentinel for this master.
  const sentinel =
    password === MREMOTENG_DEFAULT_MASTER_PASSWORD
      ? 'ThisIsNotProtected'
      : 'ThisIsProtected';
  const protectedB64 = await encryptMRemoteNGBlob(sentinel, password, iterations);
  root.setAttribute('Protected', protectedB64);

  // Always encrypt per-field passwords, regardless of full-file mode (real
  // mRemoteNG files always do; the full-file mode just adds a wrapper on top).
  await encryptPerFieldPasswords(doc, password, iterations);

  if (opts.fullFileEncryption) {
    // Serialize the inner content (children of <Connections>) and replace it
    // with a single encrypted blob.
    const inner = Array.from(root.childNodes)
      .map((n) => new XMLSerializer().serializeToString(n))
      .join('');
    while (root.firstChild) root.removeChild(root.firstChild);
    const ct = await encryptMRemoteNGBlob(inner, password, iterations);
    root.appendChild(doc.createTextNode(ct));
  }

  return new XMLSerializer().serializeToString(doc);
}

export const detectMRemoteNGEncryption = (
  content: string,
): MRemoteNGEncryptionInfo => {
  const empty: MRemoteNGEncryptionInfo = {
    isEncrypted: false,
    fullFileEncryption: false,
    requiresPassword: false,
  };
  try {
    const doc = new DOMParser().parseFromString(content, 'text/xml');
    const root = doc.querySelector('Connections');
    if (!root) return empty;
    const fullFileAttr = (root.getAttribute('FullFileEncryption') || '').toLowerCase();
    const fullFileEncryption = fullFileAttr === 'true' || fullFileAttr === '1';
    const protectedAttr = (root.getAttribute('Protected') || '').trim();
    const hasProtected = protectedAttr.length > 0;
    const childNodeCount = root.querySelectorAll(':scope > Node').length;
    // Full-file encryption: body is one encrypted blob, no <Node> children present
    // (or the file explicitly advertises FullFileEncryption="true").
    const requiresPassword =
      fullFileEncryption || (hasProtected && childNodeCount === 0);
    return {
      isEncrypted: hasProtected || fullFileEncryption,
      fullFileEncryption: fullFileEncryption || requiresPassword,
      requiresPassword,
    };
  } catch {
    return empty;
  }
};

/**
 * Parse mRemoteNG XML format
 * mRemoteNG uses a nested Node structure with attributes for connection properties
 */
export const importFromMRemoteNG = async (content: string): Promise<Connection[]> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML format: ' + parseError.textContent);
  }

  const connections: Connection[] = [];
  const folderIdMap = new Map<Element, string>();

  // Recursive function to parse nodes
  const parseNode = (node: Element, parentId?: string): void => {
    const nodeType = node.getAttribute('Type') || 'Connection';
    const name = node.getAttribute('Name') || 'Unnamed';
    
    if (nodeType === 'Container') {
      // This is a folder
      const folderId = generateId();
      const expanded = (node.getAttribute('Expanded') || '').toLowerCase() === 'true';
      folderIdMap.set(node, folderId);
      
      connections.push({
        id: folderId,
        name: name,
        protocol: 'rdp',
        hostname: '',
        port: 0,
        isGroup: true,
        expanded,
        parentId: parentId,
        description: node.getAttribute('Descr') || undefined,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Parse child nodes
      const children = node.querySelectorAll(':scope > Node');
      children.forEach(child => parseNode(child, folderId));
    } else {
      // This is a connection
      const protocol = node.getAttribute('Protocol') || 'RDP';
      const hostname = node.getAttribute('Hostname') || '';
      const port = parsePortOrDefault(node.getAttribute('Port'), protocol);
      const username = node.getAttribute('Username') || undefined;
      const domain = node.getAttribute('Domain') || undefined;
      const description = node.getAttribute('Descr') || node.getAttribute('Description') || undefined;
      
      // mRemoteNG specific fields
      const resolution = node.getAttribute('Resolution') || undefined;
      const colors = node.getAttribute('Colors') || undefined;
      const useCredSsp = node.getAttribute('UseCredSsp') === 'True';
      const renderingEngine = node.getAttribute('RenderingEngine') || undefined;
      
      connections.push({
        id: generateId(),
        name: name,
        protocol: mapMRemoteNGProtocol(protocol),
        hostname: hostname,
        port: port,
        username: username,
        domain: domain,
        description: description,
        parentId: parentId,
        isGroup: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Store mRemoteNG-specific settings in custom fields
        ...(resolution && { resolution }),
        ...(colors && { colorDepth: colors }),
        ...(useCredSsp !== undefined && { useCredSsp }),
        ...(renderingEngine && { renderingEngine }),
      });
    }
  };

  // Get the root Connections element or find Node elements directly
  const rootConnections = doc.querySelector('Connections');
  const rootNodes = rootConnections 
    ? rootConnections.querySelectorAll(':scope > Node')
    : doc.querySelectorAll('Node');

  rootNodes.forEach(node => parseNode(node));

  return connections;
};

/**
 * Parse Remote Desktop Connection Manager (RDCMan) XML format
 */
export const importFromRDCMan = async (content: string): Promise<Connection[]> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML format: ' + parseError.textContent);
  }

  const connections: Connection[] = [];

  // Parse groups
  const parseGroup = (groupEl: Element, parentId?: string): void => {
    const properties = groupEl.querySelector(':scope > properties');
    const name = properties?.querySelector('name')?.textContent || 'Unnamed Group';
    const groupId = generateId();
    
    connections.push({
      id: groupId,
      name: name,
      protocol: 'rdp',
      hostname: '',
      port: 0,
      isGroup: true,
      parentId: parentId,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Parse servers in this group
    groupEl.querySelectorAll(':scope > server').forEach(serverEl => {
      parseRDCManServer(serverEl, connections, groupId);
    });

    // Recursively parse subgroups
    groupEl.querySelectorAll(':scope > group').forEach(subGroupEl => {
      parseGroup(subGroupEl, groupId);
    });
  };

  // Start parsing from file > group elements
  doc.querySelectorAll('file > group').forEach(groupEl => {
    parseGroup(groupEl);
  });

  // Also check for servers at root level
  doc.querySelectorAll('file > server').forEach(serverEl => {
    parseRDCManServer(serverEl, connections);
  });

  return connections;
};

/** Extract a single RDCMan server element into a Connection. */
const parseRDCManServer = (
  serverEl: Element,
  connections: Connection[],
  parentId?: string,
): void => {
  const props = serverEl.querySelector('properties');
  const displayName = props?.querySelector('displayName')?.textContent;
  const serverName = props?.querySelector('name')?.textContent || '';

  // RDCMan stores credentials in <logonCredentials> (group or server level)
  const creds = serverEl.querySelector('logonCredentials');
  const username = creds?.querySelector('userName')?.textContent || undefined;
  const domain = creds?.querySelector('domain')?.textContent || undefined;

  // Port lives in <connectionSettings>
  const connSettings = serverEl.querySelector('connectionSettings');
  const port = parseInt(connSettings?.querySelector('port')?.textContent || '3389') || 3389;

  // Comment/description
  const comment = props?.querySelector('comment')?.textContent || undefined;

  connections.push({
    id: generateId(),
    name: displayName || serverName,
    protocol: 'rdp',
    hostname: serverName,
    port,
    username,
    domain,
    description: comment,
    isGroup: false,
    parentId,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Parse MobaXterm bookmarks INI format
 */
export const importFromMobaXterm = async (content: string): Promise<Connection[]> => {
  const connections: Connection[] = [];
  const lines = content.split(/\r?\n/);
  let currentSection = '';
  let currentSubRep = '';
  const folderMap = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Section header
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }
    
    if (currentSection === 'Bookmarks' || currentSection.startsWith('Bookmarks_')) {
      // Parse SubRep (folder path)
      if (trimmed.startsWith('SubRep=')) {
        currentSubRep = trimmed.slice(7);
        if (currentSubRep && !folderMap.has(currentSubRep)) {
          const folderId = generateId();
          folderMap.set(currentSubRep, folderId);
          connections.push({
            id: folderId,
            name: currentSubRep.split('\\').pop() || currentSubRep,
            protocol: 'ssh',
            hostname: '',
            port: 0,
            isGroup: true,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        continue;
      }
      
      // Parse bookmark entry
      // Format: Name=#sessionType#hostname%port%username%...
      const match = trimmed.match(/^(.+?)=#(\d+)#(.+)/);
      if (match) {
        const [, name, typeNum, params] = match;
        const parts = params.split('%');
        const hostname = parts[0] || '';
        // Map MobaXterm session types
        const protocolMap: Record<string, Connection['protocol']> = {
          '0': 'ssh',    // SSH
          '1': 'telnet', // Telnet
          '2': 'rlogin', // Rlogin
          '4': 'rdp',    // RDP
          '5': 'vnc',    // VNC
          '3': 'rdp',    // XDMCP (remote display → rdp)
          '6': 'ftp',    // FTP
          '7': 'sftp',   // SFTP (map to SSH)
          '8': 'ssh',    // Mosh (→ ssh)
          '9': 'telnet', // Serial (→ telnet)
          '10': 'ssh',   // WSL
        };
        const protocol = protocolMap[typeNum] || 'ssh';
        const port = parsePortOrDefault(parts[1], protocol);
        const username = parts[2] || undefined;
        
        connections.push({
          id: generateId(),
          name: name,
          protocol,
          hostname: hostname,
          port: port,
          username: username,
          isGroup: false,
          parentId: currentSubRep ? folderMap.get(currentSubRep) : undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  return connections;
};

/**
 * Parse PuTTY registry export format
 */
export const importFromPuTTY = async (content: string): Promise<Connection[]> => {
  const connections: Connection[] = [];
  const lines = content.split(/\r?\n/);
  let currentSession: string | null = null;
  let currentProps: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Session header
    const sessionMatch = trimmed.match(/\[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\(.+)\]/);
    if (sessionMatch) {
      // Save previous session
      if (currentSession && currentProps.HostName) {
        connections.push(createPuTTYConnection(currentSession, currentProps));
      }
      currentSession = decodeURIComponent(sessionMatch[1].replace(/%([0-9A-F]{2})/gi, (_, hex) => 
        String.fromCharCode(parseInt(hex, 16))
      ));
      currentProps = {};
      continue;
    }
    
    // Property line
    const propMatch = trimmed.match(/"(.+?)"=(?:"(.*)"|dword:([0-9a-f]+))/);
    if (propMatch && currentSession) {
      const [, key, strValue, dwordValue] = propMatch;
      currentProps[key] = strValue ?? String(parseInt(dwordValue || '0', 16));
    }
  }

  // Save last session
  if (currentSession && currentProps.HostName) {
    connections.push(createPuTTYConnection(currentSession, currentProps));
  }

  return connections;
};

const createPuTTYConnection = (name: string, props: Record<string, string>): Connection => {
  const protocolMap: Record<string, Connection['protocol']> = {
    'ssh': 'ssh',
    'serial': 'telnet',
    'telnet': 'telnet',
    'rlogin': 'rlogin',
    'raw': 'telnet',
  };

  const protocol = protocolMap[props.Protocol?.toLowerCase() || 'ssh'] || 'ssh';
  
  return {
    id: generateId(),
    name: name,
    protocol,
    hostname: props.HostName,
    port: parsePortOrDefault(props.PortNumber, protocol),
    username: props.UserName || undefined,
    isGroup: false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Parse Termius JSON export format
 */
export const importFromTermius = async (content: string): Promise<Connection[]> => {
  const data = JSON.parse(content);
  const connections: Connection[] = [];
  const groupMap = new Map<string, string>();

  // Parse groups first
  if (data.groups) {
    for (const group of data.groups) {
      const groupId = generateId();
      groupMap.set(group.id || group.label, groupId);
      connections.push({
        id: groupId,
        name: group.label || 'Unnamed Group',
        protocol: 'ssh',
        hostname: '',
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Parse hosts
  if (data.hosts) {
    for (const host of data.hosts) {
      // Termius stores username either at top-level or inside ssh_config
      const username = host.username
        || host.ssh_config?.username
        || undefined;

      connections.push({
        id: generateId(),
        name: host.label || host.address || 'Unnamed',
        protocol: 'ssh',
        hostname: host.address || '',
        port: parsePortOrDefault(host.port, 'ssh'),
        username,
        isGroup: false,
        parentId: host.group_id ? groupMap.get(host.group_id) : undefined,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return connections;
};

/**
 * Parse Royal TS/TSX JSON export format.
 * Royal TS exports nested Objects arrays with Type indicating the object kind.
 */
export const importFromRoyalTS = async (content: string): Promise<Connection[]> => {
  const data = JSON.parse(content);
  const connections: Connection[] = [];

  const mapRoyalType = (type: string): Connection['protocol'] => {
    const map: Record<string, Connection['protocol']> = {
      'RoyalRDSConnection': 'rdp',
      'RoyalSSHConnection': 'ssh',
      'RoyalVNCConnection': 'vnc',
      'RoyalSFTPConnection': 'ssh',
      'RoyalFTPConnection': 'ftp',
      'RoyalTelnetConnection': 'telnet',
      'RoyalWebConnection': 'https',
    };
    return map[type] || 'rdp';
  };

  const parseObjects = (objects: any[], parentId?: string): void => {
    for (const obj of objects) {
      if (obj.Type === 'RoyalFolder') {
        const folderId = generateId();
        connections.push({
          id: folderId,
          name: obj.Name || 'Unnamed Folder',
          protocol: 'rdp',
          hostname: '',
          port: 0,
          isGroup: true,
          parentId,
          description: obj.Description || undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        if (obj.Objects && Array.isArray(obj.Objects)) {
          parseObjects(obj.Objects, folderId);
        }
      } else {
        const protocol = mapRoyalType(obj.Type || '');
        connections.push({
          id: generateId(),
          name: obj.Name || obj.URI || 'Unnamed',
          protocol,
          hostname: obj.URI || obj.ComputerName || '',
          port: parsePortOrDefault(obj.Port, protocol),
          username: obj.CredentialUsername || obj.Username || undefined,
          domain: obj.CredentialDomain || undefined,
          description: obj.Description || undefined,
          isGroup: false,
          parentId,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  };

  const objects = data.Objects || (Array.isArray(data) ? data : []);
  parseObjects(objects);
  return connections;
};

/**
 * Parse SecureCRT XML session export format.
 * SecureCRT uses non-standard XML tag names like <S:"Hostname"> which DOMParser
 * cannot handle, so we use regex-based parsing instead.
 */
export const importFromSecureCRT = async (content: string): Promise<Connection[]> => {
  const connections: Connection[] = [];

  // Match each <Session Name="...">...</Session> block
  const sessionRegex = /<Session\s+Name="([^"]*)">([\s\S]*?)<\/Session>/g;
  let match;

  while ((match = sessionRegex.exec(content)) !== null) {
    const nameAttr = match[1];
    const body = match[2];

    const nameParts = nameAttr.split('/');
    const name = nameParts[nameParts.length - 1] || nameAttr;

    let hostname = '';
    let rawPort: string | undefined;
    let username = '';
    let protocol: Connection['protocol'] = 'ssh';

    // Extract string values: <S:"Key">value</S:"Key">
    const strRegex = /<S:"([^"]+)">([^<]*)<\/S:"[^"]+">/g;
    let strMatch;
    while ((strMatch = strRegex.exec(body)) !== null) {
      const key = strMatch[1];
      const value = strMatch[2];
      if (key === 'Hostname') hostname = value;
      else if (key === 'Username') username = value;
      else if (key === 'Protocol Name') {
        const lower = value.toLowerCase();
        if (lower.includes('ssh')) protocol = 'ssh';
        else if (lower.includes('telnet')) protocol = 'telnet';
        else if (lower.includes('rlogin')) protocol = 'rlogin';
      }
    }

    // Extract integer values: <D:"Key">value</D:"Key">
    const intRegex = /<D:"([^"]+)">([^<]*)<\/D:"[^"]+">/g;
    let intMatch;
    while ((intMatch = intRegex.exec(body)) !== null) {
      const key = intMatch[1];
      const value = intMatch[2];
      if (key === '[SSH2] Port' || key === 'Port') {
        rawPort = value;
      }
    }

    const port = parsePortOrDefault(rawPort, protocol);

    if (hostname || name) {
      connections.push({
        id: generateId(),
        name: name || hostname,
        protocol,
        hostname,
        port,
        username: username || undefined,
        isGroup: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return connections;
};

/**
 * Parse generic JSON format
 */
export const importFromJSON = async (content: string): Promise<Connection[]> => {
  const data = JSON.parse(content);
  
  // Handle array format
  if (Array.isArray(data)) {
    return data.map(conn => {
      const protocol = (conn.protocol?.toLowerCase() || 'rdp') as Connection['protocol'];

      return {
        ...conn,
        protocol,
        id: conn.id || generateId(),
        name: conn.name || 'Imported Connection',
        hostname: conn.hostname || conn.host || '',
        port: parsePortOrDefault(conn.port, protocol),
        username: conn.username || undefined,
        password: conn.password || undefined,
        domain: conn.domain || undefined,
        description: conn.description || undefined,
        parentId: conn.parentId || undefined,
        isGroup: conn.isGroup || conn.isFolder || false,
        tags: conn.tags || [],
        createdAt: new Date(conn.createdAt || Date.now()).toISOString(),
        updatedAt: new Date(conn.updatedAt || Date.now()).toISOString(),
      } as Connection;
    });
  }
  
  // Handle object with connections array
  if (data.connections && Array.isArray(data.connections)) {
    return importFromJSON(JSON.stringify(data.connections));
  }

  throw new Error('Invalid JSON format: expected array or object with connections array');
};

/**
 * Main import function that auto-detects format
 */
export const importConnections = async (
  content: string, 
  filename?: string,
  format?: ImportFormat
): Promise<Connection[]> => {
  const detectedFormat = format || detectImportFormat(content, filename);
  
  switch (detectedFormat) {
    case 'mremoteng':
      return importFromMRemoteNG(content);
    case 'rdcman':
      return importFromRDCMan(content);
    case 'mobaxterm':
      return importFromMobaXterm(content);
    case 'putty':
      return importFromPuTTY(content);
    case 'termius':
      return importFromTermius(content);
    case 'royalts':
      return importFromRoyalTS(content);
    case 'securecrt':
      return importFromSecureCRT(content);
    case 'json':
      return importFromJSON(content);
    case 'csv':
    default:
      return importFromCSV(content);
  }
};

/**
 * Get human-readable format name
 */
export const getFormatName = (format: ImportFormat): string => {
  const names: Record<ImportFormat, string> = {
    'mremoteng': 'mRemoteNG',
    'rdcman': 'Remote Desktop Connection Manager',
    'royalts': 'Royal TS/TSX',
    'mobaxterm': 'MobaXterm',
    'putty': 'PuTTY',
    'securecrt': 'SecureCRT',
    'termius': 'Termius',
    'csv': 'CSV',
    'json': 'JSON',
  };
  return names[format] || format;
};
