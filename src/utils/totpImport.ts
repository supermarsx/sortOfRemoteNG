/**
 * TOTP Import Parsers
 *
 * Supports importing 2FA/TOTP entries from various authenticator apps:
 * - otpauth:// URIs (plain text, one per line)
 * - Aegis Authenticator (JSON, plain export)
 * - andOTP (JSON, plain export)
 * - 2FAS Authenticator (JSON .2fas, schema v1/v3/v4)
 * - Bitwarden (JSON and CSV exports)
 * - FreeOTP+ (JSON export)
 * - Stratum / WinAuth (JSON, plain export)
 * - Proton Authenticator (JSON)
 * - Duo Mobile (JSON)
 * - Authy (SharedPreferences XML)
 * - Google Authenticator (key URI export)
 * - Ente Auth (plain text)
 */

import { TOTPConfig } from '../types/settings';

export type ImportSource =
  | 'auto'
  | 'otpauth-uri'
  | 'aegis'
  | 'andotp'
  | '2fas'
  | 'bitwarden-json'
  | 'bitwarden-csv'
  | 'freeotp-plus'
  | 'stratum'
  | 'proton'
  | 'duo'
  | 'authy'
  | 'ente'
  | 'json';

export interface ImportSourceInfo {
  id: ImportSource;
  label: string;
  extensions: string[];
  description: string;
}

export const IMPORT_SOURCES: ImportSourceInfo[] = [
  { id: 'auto', label: 'Auto-detect', extensions: ['.json', '.csv', '.txt', '.2fas', '.xml'], description: 'Automatically detect the format' },
  { id: 'otpauth-uri', label: 'otpauth:// URIs', extensions: ['.txt'], description: 'Plain text file with one otpauth:// URI per line' },
  { id: 'aegis', label: 'Aegis Authenticator', extensions: ['.json'], description: 'Aegis plain JSON export' },
  { id: 'andotp', label: 'andOTP', extensions: ['.json'], description: 'andOTP plain JSON export' },
  { id: '2fas', label: '2FAS Authenticator', extensions: ['.2fas', '.json'], description: '2FAS export (schema v1/v3/v4)' },
  { id: 'bitwarden-json', label: 'Bitwarden (JSON)', extensions: ['.json'], description: 'Bitwarden JSON export' },
  { id: 'bitwarden-csv', label: 'Bitwarden (CSV)', extensions: ['.csv'], description: 'Bitwarden CSV export' },
  { id: 'freeotp-plus', label: 'FreeOTP+', extensions: ['.json'], description: 'FreeOTP+ JSON export' },
  { id: 'stratum', label: 'Stratum / WinAuth', extensions: ['.json'], description: 'Stratum plain JSON export' },
  { id: 'proton', label: 'Proton Authenticator', extensions: ['.json'], description: 'Proton Authenticator JSON export' },
  { id: 'duo', label: 'Duo Mobile', extensions: ['.json'], description: 'Duo Mobile JSON export' },
  { id: 'authy', label: 'Authy', extensions: ['.xml'], description: 'Authy SharedPreferences XML' },
  { id: 'ente', label: 'Ente Auth', extensions: ['.txt'], description: 'Ente Auth plain text export' },
  { id: 'json', label: 'sortOfRemoteNG JSON', extensions: ['.json'], description: 'Native TOTPConfig JSON array' },
];

export interface ImportResult {
  entries: TOTPConfig[];
  source: ImportSource;
  errors: string[];
}

// ─── Main Entry Point ──────────────────────────────────────────────

export function importTotpEntries(content: string, source: ImportSource): ImportResult {
  const errors: string[] = [];

  if (source === 'auto') {
    source = detectFormat(content);
  }

  let entries: TOTPConfig[] = [];

  try {
    switch (source) {
      case 'otpauth-uri':
      case 'ente':
        entries = parseOtpauthUris(content, errors);
        break;
      case 'aegis':
        entries = parseAegis(content, errors);
        break;
      case 'andotp':
        entries = parseAndOtp(content, errors);
        break;
      case '2fas':
        entries = parse2FAS(content, errors);
        break;
      case 'bitwarden-json':
        entries = parseBitwardenJson(content, errors);
        break;
      case 'bitwarden-csv':
        entries = parseBitwardenCsv(content, errors);
        break;
      case 'freeotp-plus':
        entries = parseFreeOtpPlus(content, errors);
        break;
      case 'stratum':
        entries = parseStratum(content, errors);
        break;
      case 'proton':
        entries = parseProton(content, errors);
        break;
      case 'duo':
        entries = parseDuo(content, errors);
        break;
      case 'authy':
        entries = parseAuthy(content, errors);
        break;
      case 'json':
        entries = parseNativeJson(content, errors);
        break;
      default:
        errors.push(`Unknown import source: ${source}`);
    }
  } catch (err) {
    errors.push(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { entries, source, errors };
}

// ─── Format Detection ──────────────────────────────────────────────

function detectFormat(content: string): ImportSource {
  const trimmed = content.trim();

  // Check for otpauth:// URIs (plain text)
  if (trimmed.startsWith('otpauth://')) return 'otpauth-uri';

  // Check for XML
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<map>') || trimmed.startsWith('<map ')) {
    if (trimmed.includes('com.authy.storage')) return 'authy';
    return 'authy'; // Generic XML — try Authy parser
  }

  // Check for CSV (Bitwarden)
  if (trimmed.startsWith('folder,favorite,type,name,')) return 'bitwarden-csv';

  // Try JSON
  try {
    const data = JSON.parse(trimmed);

    // Array of objects
    if (Array.isArray(data)) {
      if (data.length > 0) {
        const first = data[0];
        // andOTP: has 'secret', 'type', 'algorithm' at top level
        if ('secret' in first && 'type' in first && 'algorithm' in first) return 'andotp';
        // Duo: has 'otpGenerator'
        if ('otpGenerator' in first) return 'duo';
        // Native JSON
        if ('secret' in first && 'account' in first) return 'json';
      }
      return 'andotp'; // Best guess for unknown arrays
    }

    // Object with specific structure
    if (typeof data === 'object' && data !== null) {
      // Aegis: has db.entries
      if (data.db?.entries) return 'aegis';
      // 2FAS: has services array
      if (data.services) return '2fas';
      // Bitwarden JSON: has items array
      if (data.items && !data.services) return 'bitwarden-json';
      // FreeOTP+: has tokens array
      if (data.tokens) return 'freeotp-plus';
      // Stratum: has Authenticators array
      if (data.Authenticators) return 'stratum';
      // Proton: has entries with content.uri
      if (data.entries?.[0]?.content?.uri) return 'proton';
    }
  } catch {
    // Not JSON — check if it's lines of URIs
    const lines = trimmed.split('\n').filter(l => l.trim());
    if (lines.some(l => l.trim().startsWith('otpauth://'))) return 'otpauth-uri';
  }

  return 'json'; // Fallback
}

// ─── otpauth:// URI Parser ─────────────────────────────────────────

export function parseOtpauthUri(uri: string): TOTPConfig | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith('otpauth://')) return null;

  try {
    const url = new URL(trimmed);
    const type = url.hostname; // 'totp', 'hotp', 'steam'
    if (type !== 'totp' && type !== 'steam') return null; // We only support TOTP

    // Path: /Issuer:Account or /Account
    const path = decodeURIComponent(url.pathname.slice(1));
    let issuer = url.searchParams.get('issuer') || '';
    let account = path;

    if (path.includes(':')) {
      const [pathIssuer, ...rest] = path.split(':');
      account = rest.join(':');
      if (!issuer) issuer = pathIssuer;
    }

    const secret = url.searchParams.get('secret') || '';
    if (!secret) return null;

    const algorithm = normalizeAlgorithm(url.searchParams.get('algorithm') || 'SHA1');
    const digits = parseInt(url.searchParams.get('digits') || '6', 10);
    const period = parseInt(url.searchParams.get('period') || '30', 10);

    return {
      secret: secret.replace(/=+$/, ''), // Strip padding
      issuer: issuer || 'Unknown',
      account: account || 'Unknown',
      digits: [6, 7, 8].includes(digits) ? digits : 6,
      period: period > 0 ? period : 30,
      algorithm,
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function parseOtpauthUris(content: string, errors: string[]): TOTPConfig[] {
  const results: TOTPConfig[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.startsWith('otpauth://')) continue;
    const entry = parseOtpauthUri(line);
    if (entry) {
      results.push(entry);
    } else {
      errors.push(`Line ${i + 1}: Failed to parse URI`);
    }
  }

  return results;
}

// ─── Aegis ─────────────────────────────────────────────────────────

function parseAegis(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const entries = data?.db?.entries;
  if (!Array.isArray(entries)) {
    errors.push('Invalid Aegis format: missing db.entries');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const entry of entries) {
    if (entry.type !== 'totp' && entry.type !== 'steam') continue;
    try {
      results.push({
        secret: (entry.info?.secret || '').replace(/=+$/, ''),
        issuer: entry.issuer || 'Unknown',
        account: entry.name || 'Unknown',
        digits: entry.info?.digits || 6,
        period: entry.info?.period || 30,
        algorithm: normalizeAlgorithm(entry.info?.algo || 'SHA1'),
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`Failed to parse Aegis entry: ${entry.name || 'unknown'}`);
    }
  }
  return results;
}

// ─── andOTP ────────────────────────────────────────────────────────

function parseAndOtp(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    errors.push('Invalid andOTP format: expected JSON array');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const entry of data) {
    if (entry.type !== 'TOTP' && entry.type !== 'STEAM') continue;
    try {
      results.push({
        secret: (entry.secret || '').replace(/=+$/, ''),
        issuer: entry.issuer || 'Unknown',
        account: entry.label || 'Unknown',
        digits: entry.digits || 6,
        period: entry.period || 30,
        algorithm: normalizeAlgorithm(entry.algorithm || 'SHA1'),
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`Failed to parse andOTP entry: ${entry.label || 'unknown'}`);
    }
  }
  return results;
}

// ─── 2FAS ──────────────────────────────────────────────────────────

function parse2FAS(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const services = data?.services;
  if (!Array.isArray(services)) {
    errors.push('Invalid 2FAS format: missing services array');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const svc of services) {
    try {
      const otp = svc.otp || {};
      const tokenType = otp.tokenType || otp.type || 'TOTP';
      if (tokenType !== 'TOTP' && tokenType !== 'STEAM' && tokenType !== 'Unknown') continue;

      // v4 may have otpauth URI in otp.link
      if (otp.link) {
        const parsed = parseOtpauthUri(otp.link);
        if (parsed) { results.push(parsed); continue; }
      }

      results.push({
        secret: (svc.secret || '').replace(/=+$/, ''),
        issuer: otp.issuer || svc.name || 'Unknown',
        account: otp.account || otp.label?.split(':').pop() || 'Unknown',
        digits: otp.digits || 6,
        period: otp.period || 30,
        algorithm: normalizeAlgorithm(otp.algorithm || 'SHA1'),
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`Failed to parse 2FAS entry: ${svc.name || 'unknown'}`);
    }
  }
  return results;
}

// ─── Bitwarden JSON ────────────────────────────────────────────────

function parseBitwardenJson(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const items = data?.items;
  if (!Array.isArray(items)) {
    errors.push('Invalid Bitwarden JSON: missing items array');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const item of items) {
    const totp = item?.login?.totp;
    if (!totp) continue;
    try {
      // TOTP field is an otpauth:// URI or steam:// URI or just a secret
      if (totp.startsWith('otpauth://') || totp.startsWith('steam://')) {
        const parsed = parseOtpauthUri(totp.replace('steam://', 'otpauth://totp/Steam?secret='));
        if (parsed) {
          if (!parsed.account || parsed.account === 'Unknown') parsed.account = item.name || 'Unknown';
          results.push(parsed);
        }
      } else {
        // Raw secret
        results.push({
          secret: totp.replace(/=+$/, ''),
          issuer: item.name || 'Unknown',
          account: item.login?.username || item.name || 'Unknown',
          digits: 6,
          period: 30,
          algorithm: 'sha1',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      errors.push(`Failed to parse Bitwarden entry: ${item.name || 'unknown'}`);
    }
  }
  return results;
}

// ─── Bitwarden CSV ─────────────────────────────────────────────────

function parseBitwardenCsv(content: string, errors: string[]): TOTPConfig[] {
  const lines = content.split('\n');
  if (lines.length < 2) {
    errors.push('Empty CSV file');
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const totpIdx = headers.indexOf('login_totp');
  const nameIdx = headers.indexOf('name');
  const usernameIdx = headers.indexOf('login_username');

  if (totpIdx < 0) {
    errors.push('No login_totp column found in CSV');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const totp = cols[totpIdx];
    if (!totp) continue;

    try {
      if (totp.startsWith('otpauth://') || totp.startsWith('steam://')) {
        const parsed = parseOtpauthUri(totp.replace('steam://', 'otpauth://totp/Steam?secret='));
        if (parsed) {
          if (!parsed.account || parsed.account === 'Unknown') {
            parsed.account = cols[usernameIdx] || cols[nameIdx] || 'Unknown';
          }
          results.push(parsed);
        }
      } else {
        results.push({
          secret: totp.replace(/=+$/, ''),
          issuer: cols[nameIdx] || 'Unknown',
          account: cols[usernameIdx] || cols[nameIdx] || 'Unknown',
          digits: 6,
          period: 30,
          algorithm: 'sha1',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      errors.push(`Line ${i + 1}: Failed to parse CSV entry`);
    }
  }
  return results;
}

// ─── FreeOTP+ ──────────────────────────────────────────────────────

function parseFreeOtpPlus(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const tokens = data?.tokens;
  if (!Array.isArray(tokens)) {
    errors.push('Invalid FreeOTP+ format: missing tokens array');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const token of tokens) {
    if (token.type !== 'TOTP') continue;
    try {
      // Secret is a signed byte array — convert to base32
      const secret = typeof token.secret === 'string'
        ? token.secret
        : byteArrayToBase32(token.secret);

      results.push({
        secret,
        issuer: token.issuerExt || token.issuerInt || 'Unknown',
        account: token.label || 'Unknown',
        digits: token.digits || 6,
        period: token.period || 30,
        algorithm: normalizeAlgorithm(token.algo || 'SHA1'),
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`Failed to parse FreeOTP+ entry: ${token.label || 'unknown'}`);
    }
  }
  return results;
}

// ─── Stratum / WinAuth ─────────────────────────────────────────────

function parseStratum(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const auths = data?.Authenticators;
  if (!Array.isArray(auths)) {
    errors.push('Invalid Stratum format: missing Authenticators array');
    return [];
  }

  const algoMap: Record<number, TOTPConfig['algorithm']> = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };
  const results: TOTPConfig[] = [];

  for (const auth of auths) {
    // Type: 1=HOTP, 2=TOTP, 4=Steam
    if (auth.Type !== 2 && auth.Type !== 4) continue;
    try {
      results.push({
        secret: (auth.Secret || '').replace(/=+$/, ''),
        issuer: auth.Issuer || 'Unknown',
        account: auth.Username || 'Unknown',
        digits: auth.Digits || 6,
        period: auth.Period || 30,
        algorithm: algoMap[auth.Algorithm] || 'sha1',
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`Failed to parse Stratum entry: ${auth.Issuer || 'unknown'}`);
    }
  }
  return results;
}

// ─── Proton Authenticator ──────────────────────────────────────────

function parseProton(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const entries = data?.entries;
  if (!Array.isArray(entries)) {
    errors.push('Invalid Proton format: missing entries array');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const entry of entries) {
    const uri = entry?.content?.uri;
    if (!uri) continue;
    try {
      const parsed = parseOtpauthUri(uri);
      if (parsed) {
        if (entry.content?.name) parsed.account = entry.content.name;
        results.push(parsed);
      }
    } catch {
      errors.push(`Failed to parse Proton entry: ${entry.content?.name || 'unknown'}`);
    }
  }
  return results;
}

// ─── Duo Mobile ────────────────────────────────────────────────────

function parseDuo(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  const accounts = Array.isArray(data) ? data : [data];
  const results: TOTPConfig[] = [];

  for (const acct of accounts) {
    if (acct.accountType !== 'OtpAccount' && !acct.otpGenerator) continue;
    try {
      const secret = acct.otpGenerator?.otpSecret || '';
      if (!secret) continue;

      results.push({
        secret: secret.replace(/=+$/, ''),
        issuer: acct.name || 'Duo',
        account: acct.name || 'Unknown',
        digits: 6,
        period: 30,
        algorithm: 'sha1',
        createdAt: new Date().toISOString(),
      });
    } catch {
      errors.push(`Failed to parse Duo entry: ${acct.name || 'unknown'}`);
    }
  }
  return results;
}

// ─── Authy (SharedPreferences XML) ─────────────────────────────────

function parseAuthy(content: string, errors: string[]): TOTPConfig[] {
  const results: TOTPConfig[] = [];

  // Extract the authenticator tokens JSON from the XML
  const match = content.match(
    /name="com\.authy\.storage\.tokens\.authenticator\.key"[^>]*>([^<]+)</,
  );
  if (!match) {
    errors.push('No Authy authenticator tokens found in XML');
    return [];
  }

  try {
    const tokens = JSON.parse(match[1]);
    if (!Array.isArray(tokens)) {
      errors.push('Authy tokens is not an array');
      return [];
    }

    for (const token of tokens) {
      const secret = token.decryptedSecret || '';
      if (!secret) continue;

      // Parse name — format is often "Issuer: Account" or "Issuer:Account"
      let issuer = token.originalIssuer || '';
      let account = '';
      const name = token.originalName || token.name || '';
      if (name.includes(':')) {
        const [nameIssuer, ...rest] = name.split(':');
        account = rest.join(':').trim();
        if (!issuer) issuer = nameIssuer.trim();
      } else {
        account = name;
      }

      results.push({
        secret: secret.replace(/=+$/, ''),
        issuer: issuer || 'Unknown',
        account: account || 'Unknown',
        digits: token.digits || 6,
        period: 30,
        algorithm: 'sha1', // Authy only supports SHA1
        createdAt: new Date().toISOString(),
      });
    }
  } catch {
    errors.push('Failed to parse Authy token JSON');
  }
  return results;
}

// ─── Native JSON (TOTPConfig[]) ────────────────────────────────────

function parseNativeJson(content: string, errors: string[]): TOTPConfig[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    errors.push('Expected JSON array of TOTPConfig objects');
    return [];
  }

  const results: TOTPConfig[] = [];
  for (const item of data) {
    if (!item.secret) {
      errors.push(`Entry missing secret field: ${item.account || 'unknown'}`);
      continue;
    }
    results.push({
      secret: (item.secret || '').replace(/=+$/, ''),
      issuer: item.issuer || 'Unknown',
      account: item.account || 'Unknown',
      digits: item.digits || 6,
      period: item.period || 30,
      algorithm: normalizeAlgorithm(item.algorithm || 'sha1'),
      backupCodes: item.backupCodes,
      createdAt: item.createdAt || new Date().toISOString(),
    });
  }
  return results;
}

// ─── Helpers ───────────────────────────────────────────────────────

function normalizeAlgorithm(algo: string): TOTPConfig['algorithm'] {
  const upper = algo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'SHA256' || upper === 'SHA2' || upper === 'HMACSHA256') return 'sha256';
  if (upper === 'SHA512' || upper === 'HMACSHA512') return 'sha512';
  return 'sha1';
}

/**
 * Convert a signed byte array (as used by FreeOTP/FreeOTP+) to base32.
 */
function byteArrayToBase32(bytes: number[]): string {
  // Convert signed bytes to unsigned
  const unsigned = bytes.map(b => (b < 0 ? b + 256 : b));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (const byte of unsigned) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
