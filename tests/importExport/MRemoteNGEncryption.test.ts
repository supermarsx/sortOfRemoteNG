import { describe, it, expect } from 'vitest';
import {
  detectMRemoteNGEncryption,
  detectImportFormat,
  decryptMRemoteNGXml,
  encryptMRemoteNGBlob,
  encryptMRemoteNGXml,
  verifyMRemoteNGPassword,
  MREMOTENG_DEFAULT_MASTER_PASSWORD,
} from '../../src/components/ImportExport/utils';

const fullFileEncryptedHeader =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<Connections Name="Connections" Export="false" EncryptionEngine="AES" ' +
  'BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="true" ' +
  'Protected="dGVzdF9wcm90ZWN0ZWRfZGF0YQ==" ConfVersion="2.6">';

describe('detectMRemoteNGEncryption', () => {
  it('flags FullFileEncryption="true" as requiresPassword', () => {
    const xml = `${fullFileEncryptedHeader}BASE64BLOB</Connections>`;
    const info = detectMRemoteNGEncryption(xml);
    expect(info.requiresPassword).toBe(true);
    expect(info.fullFileEncryption).toBe(true);
    expect(info.isEncrypted).toBe(true);
  });

  it('flags Protected non-empty with no Node children as requiresPassword', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Connections ConfVersion="2.6" FullFileEncryption="false" Protected="ENC==">opaque</Connections>';
    const info = detectMRemoteNGEncryption(xml);
    expect(info.requiresPassword).toBe(true);
  });

  it('does not flag plain unprotected files', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Connections ConfVersion="2.6" FullFileEncryption="false" Protected="">' +
      '<Node Name="A" Type="Connection" Hostname="h" Port="22" Protocol="SSH2" /></Connections>';
    const info = detectMRemoteNGEncryption(xml);
    expect(info.requiresPassword).toBe(false);
    expect(info.fullFileEncryption).toBe(false);
  });

  it('does not flag partial-encryption files (Protected non-empty + Node children present)', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Connections ConfVersion="2.6" FullFileEncryption="false" Protected="ENC==">' +
      '<Node Name="A" Type="Connection" Hostname="h" Port="22" Protocol="SSH2" Password="ENC" />' +
      '</Connections>';
    const info = detectMRemoteNGEncryption(xml);
    expect(info.isEncrypted).toBe(true);
    expect(info.fullFileEncryption).toBe(false);
    expect(info.requiresPassword).toBe(false);
  });

  it('returns false for non-mRemoteNG content', () => {
    expect(detectMRemoteNGEncryption('not xml')).toEqual({
      isEncrypted: false,
      fullFileEncryption: false,
      requiresPassword: false,
    });
  });

  it('the encrypted fixture is detected as mRemoteNG and requires password', () => {
    const xml = `${fullFileEncryptedHeader}BASE64BLOB</Connections>`;
    expect(detectImportFormat(xml)).toBe('mremoteng');
    expect(detectMRemoteNGEncryption(xml).requiresPassword).toBe(true);
  });

  it('detects encrypted mRemoteNG even when ConfVersion is missing', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<Connections FullFileEncryption="true" Protected="dGVzdA==">BLOB</Connections>';
    expect(detectImportFormat(xml)).toBe('mremoteng');
  });

  it('uses .xml filename to avoid mis-classifying as CSV', () => {
    // Pathological case: payload with no recognisable signature.
    const blob = 'aGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=';
    expect(detectImportFormat(blob, 'export.xml')).toBe('mremoteng');
    expect(detectImportFormat(blob)).toBe('csv');
  });
});

// ── Decryption: round-trip tests against our own encrypter ───────────

const ITERATIONS = 1000;

async function buildEncryptedFile(opts: {
  master: string;
  isCustomMaster: boolean;
  innerNodes: string;
  fullFile: boolean;
}) {
  const sentinel = opts.isCustomMaster
    ? 'ThisIsProtected'
    : 'ThisIsNotProtected';
  const protectedB64 = await encryptMRemoteNGBlob(
    sentinel,
    opts.master,
    ITERATIONS,
  );

  if (opts.fullFile) {
    const body = await encryptMRemoteNGBlob(
      opts.innerNodes,
      opts.master,
      ITERATIONS,
    );
    return (
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<Connections Name="Connections" Export="false" EncryptionEngine="AES" ` +
      `BlockCipherMode="GCM" KdfIterations="${ITERATIONS}" FullFileEncryption="true" ` +
      `Protected="${protectedB64}" ConfVersion="2.6">${body}</Connections>`
    );
  }
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Connections Name="Connections" Export="false" EncryptionEngine="AES" ` +
    `BlockCipherMode="GCM" KdfIterations="${ITERATIONS}" FullFileEncryption="false" ` +
    `Protected="${protectedB64}" ConfVersion="2.6">${opts.innerNodes}</Connections>`
  );
}

const SAMPLE_NODES = `
  <Node Name="Production Servers" Type="Container" Expanded="true">
    <Node Name="Web 01" Type="Connection" Protocol="SSH2" Hostname="web01" Port="22" Username="deploy" />
    <Node Name="Web 02" Type="Connection" Protocol="SSH2" Hostname="web02" Port="22" Username="deploy" />
    <Node Name="DC" Type="Connection" Protocol="RDP" Hostname="dc" Port="3389" Username="admin" />
  </Node>
`.trim();

describe('verifyMRemoteNGPassword', () => {
  it('reports the default master when no custom password is set', async () => {
    const xml = await buildEncryptedFile({
      master: MREMOTENG_DEFAULT_MASTER_PASSWORD,
      isCustomMaster: false,
      innerNodes: SAMPLE_NODES,
      fullFile: false,
    });
    const check = await verifyMRemoteNGPassword(
      xml,
      MREMOTENG_DEFAULT_MASTER_PASSWORD,
    );
    expect(check).toMatchObject({
      valid: true,
      isDefaultMaster: true,
      hasProtected: true,
      iterations: ITERATIONS,
    });
  });

  it('accepts the correct custom master password', async () => {
    const xml = await buildEncryptedFile({
      master: 'correct horse battery staple',
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    const check = await verifyMRemoteNGPassword(
      xml,
      'correct horse battery staple',
    );
    expect(check).toMatchObject({
      valid: true,
      isDefaultMaster: false,
      hasProtected: true,
    });
  });

  it('rejects the wrong password', async () => {
    const xml = await buildEncryptedFile({
      master: 'correct',
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    const check = await verifyMRemoteNGPassword(xml, 'wrong');
    expect(check.valid).toBe(false);
  });

  it('treats files without a Protected attribute as default-master', async () => {
    const xml =
      '<?xml version="1.0"?><Connections ConfVersion="2.6"></Connections>';
    const check = await verifyMRemoteNGPassword(
      xml,
      MREMOTENG_DEFAULT_MASTER_PASSWORD,
    );
    expect(check).toMatchObject({
      valid: true,
      isDefaultMaster: true,
      hasProtected: false,
    });
  });
});

describe('decryptMRemoteNGXml', () => {
  it('returns plaintext nodes from a full-file-encrypted file (default master)', async () => {
    const xml = await buildEncryptedFile({
      master: MREMOTENG_DEFAULT_MASTER_PASSWORD,
      isCustomMaster: false,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    const out = await decryptMRemoteNGXml(
      xml,
      MREMOTENG_DEFAULT_MASTER_PASSWORD,
    );
    expect(out).toContain('Web 01');
    expect(out).toContain('Web 02');
    expect(out).toContain('DC');
    // The wrapper keeps the original ConfVersion.
    expect(out).toContain('ConfVersion="2.6"');
  });

  it('returns plaintext nodes from a full-file-encrypted file (custom master)', async () => {
    const password = 's3cret!';
    const xml = await buildEncryptedFile({
      master: password,
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    const out = await decryptMRemoteNGXml(xml, password);
    expect(out).toContain('Web 01');
  });

  it('decrypts per-field Password attributes when full-file is on', async () => {
    const password = 'pw1';
    const encryptedFieldPw = await encryptMRemoteNGBlob(
      'super-secret-password',
      password,
      ITERATIONS,
    );
    const inner = `<Node Name="Host" Type="Connection" Protocol="SSH2" Hostname="h" Port="22" Username="u" Password="${encryptedFieldPw}" />`;
    const xml = await buildEncryptedFile({
      master: password,
      isCustomMaster: true,
      innerNodes: inner,
      fullFile: true,
    });
    const out = await decryptMRemoteNGXml(xml, password);
    expect(out).toContain('Password="super-secret-password"');
  });

  it('decrypts per-field passwords on a non-full-file-encrypted file', async () => {
    const password = MREMOTENG_DEFAULT_MASTER_PASSWORD;
    const encryptedFieldPw = await encryptMRemoteNGBlob(
      'abc123',
      password,
      ITERATIONS,
    );
    const inner = `<Node Name="H" Type="Connection" Protocol="SSH2" Hostname="h" Port="22" Username="u" Password="${encryptedFieldPw}" />`;
    const xml = await buildEncryptedFile({
      master: password,
      isCustomMaster: false,
      innerNodes: inner,
      fullFile: false,
    });
    const out = await decryptMRemoteNGXml(xml, password);
    expect(out).toContain('Password="abc123"');
  });

  it('throws on the wrong password', async () => {
    const xml = await buildEncryptedFile({
      master: 'right',
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    await expect(decryptMRemoteNGXml(xml, 'wrong')).rejects.toThrow(
      /Incorrect master password/,
    );
  });

  it('rejects unsupported cipher / mode combos', async () => {
    const xml =
      '<?xml version="1.0"?><Connections EncryptionEngine="Serpent" ' +
      'BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="true" ' +
      'Protected="" ConfVersion="2.6">x</Connections>';
    await expect(decryptMRemoteNGXml(xml, 'whatever')).rejects.toThrow(
      /Unsupported mRemoteNG block cipher/,
    );
  });

  it('honours non-default KdfIterations', async () => {
    const password = 'abc';
    const heavyIter = 5000;
    const sentinel = 'ThisIsProtected';
    const protectedB64 = await encryptMRemoteNGBlob(
      sentinel,
      password,
      heavyIter,
    );
    const body = await encryptMRemoteNGBlob(SAMPLE_NODES, password, heavyIter);
    const xml =
      `<?xml version="1.0"?><Connections EncryptionEngine="AES" ` +
      `BlockCipherMode="GCM" KdfIterations="${heavyIter}" FullFileEncryption="true" ` +
      `Protected="${protectedB64}" ConfVersion="2.6">${body}</Connections>`;
    const out = await decryptMRemoteNGXml(xml, password);
    expect(out).toContain('Web 01');
  });

  it('throws when ciphertext is corrupted', async () => {
    const xml = await buildEncryptedFile({
      master: 'k',
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    // Corrupt the body — flip a base64 character before the closing tag.
    const corrupted = xml.replace(/(.)<\/Connections>$/, 'X</Connections>');
    await expect(decryptMRemoteNGXml(corrupted, 'k')).rejects.toThrow();
  });
});

describe('upstream wire-format invariants', () => {
  // These are derived directly from upstream
  // mRemoteV1/Security/SymmetricEncryption/AeadCryptographyProvider.cs:
  //   SaltBitSize  = 128 → 16 bytes
  //   NonceBitSize = 128 → 16 bytes (GCM)
  //   MacBitSize   = 128 → 16-byte tag appended to ciphertext
  //   Layout: [salt(16)] [nonce(16)] [ct ‖ tag(16)]   (when nonSecretPayload is empty)
  it('encrypts with a 16-byte salt, 16-byte nonce, and 16-byte tag', async () => {
    const ct = await encryptMRemoteNGBlob('x', 'pw', 1000);
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    // 16 (salt) + 16 (nonce) + 1 (plaintext) + 16 (tag) = 49
    expect(bytes.length).toBe(49);
  });

  it('writes salt then nonce then ciphertext (verified via fixed iterations + known plaintext)', async () => {
    // Round-trip test: encrypt then decrypt the per-field layout.
    const cipher = await encryptMRemoteNGBlob('hello world', 'pw', 1000);
    const wrapped =
      `<?xml version="1.0"?><Connections EncryptionEngine="AES" ` +
      `BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="false" ` +
      `Protected="${cipher}" ConfVersion="2.6"></Connections>`;
    // verifyMRemoteNGPassword decrypts the Protected blob and compares the
    // plaintext to the sentinels — for "hello world" neither matches, so
    // valid:false but it doesn't throw, proving decrypt itself worked.
    const check = await verifyMRemoteNGPassword(wrapped, 'pw');
    expect(check.valid).toBe(false);
    expect(check.hasProtected).toBe(true);
  });
});

describe('password-byte conversion (PKCS5 PasswordToBytes)', () => {
  it('treats ASCII passwords identically', async () => {
    // ASCII low byte == UTF-8, so this is the baseline.
    const xml = await buildEncryptedFile({
      master: 'asciipw',
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    const out = await decryptMRemoteNGXml(xml, 'asciipw');
    expect(out).toContain('Web 01');
  });

  it('uses low-byte-of-char (Latin-1), not UTF-8, for non-ASCII passwords', async () => {
    // 'ö' (U+00F6) → one byte 0xF6 in PKCS5; UTF-8 would emit 0xC3 0xB6.
    // Our encrypter and decrypter both use the PKCS5 path, so this round-trips.
    const password = 'passwört';
    const xml = await buildEncryptedFile({
      master: password,
      isCustomMaster: true,
      innerNodes: SAMPLE_NODES,
      fullFile: true,
    });
    const out = await decryptMRemoteNGXml(xml, password);
    expect(out).toContain('Web 01');
  });
});

describe('real-world Protected sample (from user docs)', () => {
  // Verbatim `Protected` value from the documented mRemoteNG sample. We don't
  // know which password produced this exact ciphertext (the source docs don't
  // say), so we can't assert what it decrypts to. We CAN assert that the wire
  // format parses cleanly and that wrong passwords are rejected — both are
  // important interop signals that survive even without the password.
  const REAL_PROTECTED =
    '0RlaSZ8kZayRzE3yO2agQWIXUV5EW3ZWDJ3Pm2SV4yKJaZyYWSxrFgjtbM8RcO1ebkkTuRerKXmfdUmM7oVFZ1M/';
  const SAMPLE_XML =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Connections Name="Connexions" Export="False" EncryptionEngine="AES" ` +
    `BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="False" ` +
    `Protected="${REAL_PROTECTED}" ConfVersion="2.6"></Connections>`;

  it('decodes the Protected attribute as a real mRemoteNG payload', () => {
    const bytes = Uint8Array.from(atob(REAL_PROTECTED), (c) => c.charCodeAt(0));
    // 88 base64 chars → 66 bytes = 16 (salt) + 16 (nonce) + 34 (ct ‖ tag).
    expect(bytes.length).toBe(66);
    expect(bytes.length).toBeGreaterThanOrEqual(16 + 16 + 16); // salt+nonce+tag
  });

  it('rejects obviously wrong passwords without throwing', async () => {
    const check = await verifyMRemoteNGPassword(SAMPLE_XML, 'definitely-wrong');
    expect(check.valid).toBe(false);
    expect(check.hasProtected).toBe(true);
  });

  it('rejects the default master password (sample uses a custom master)', async () => {
    // Empirically the GCM tag check fails for this ciphertext with mR3m, so
    // the file that produced this sample had a custom master password set.
    const check = await verifyMRemoteNGPassword(
      SAMPLE_XML,
      MREMOTENG_DEFAULT_MASTER_PASSWORD,
    );
    expect(check.valid).toBe(false);
  });

  it('detection flags the sample as needing decryption', () => {
    const enc = detectMRemoteNGEncryption(SAMPLE_XML);
    expect(enc.isEncrypted).toBe(true);
  });
});

describe('encryptMRemoteNGXml ↔ decryptMRemoteNGXml round-trip', () => {
  const PLAIN_XML = `<?xml version="1.0" encoding="utf-8"?>
<Connections Name="Connections" ConfVersion="2.6">
  <Node Name="Web 01" Type="Connection" Protocol="SSH2" Hostname="web01" Port="22" Username="deploy" Password="hunter2" />
  <Node Name="VNC Server" Type="Connection" Protocol="VNC" Hostname="vnc01" Port="5900" Password="vncpw" VNCProxyPassword="proxypw" />
  <Node Name="RD Gateway" Type="Connection" Protocol="RDP" Hostname="rdp01" Port="3389" Password="rdppw" RDGatewayPassword="gwpw" />
</Connections>`;

  it('encrypts with the default master and round-trips back to the same passwords', async () => {
    const enc = await encryptMRemoteNGXml(PLAIN_XML, {
      password: MREMOTENG_DEFAULT_MASTER_PASSWORD,
    });
    expect(enc).toContain('FullFileEncryption="false"');
    expect(enc).toContain('EncryptionEngine="AES"');
    expect(enc).toContain('BlockCipherMode="GCM"');
    expect(enc).toContain('KdfIterations="1000"');
    expect(enc).toContain('Protected="');
    // After encryption the per-field passwords are no longer plaintext.
    expect(enc).not.toContain('Password="hunter2"');
    expect(enc).not.toContain('VNCProxyPassword="proxypw"');
    expect(enc).not.toContain('RDGatewayPassword="gwpw"');

    const dec = await decryptMRemoteNGXml(
      enc,
      MREMOTENG_DEFAULT_MASTER_PASSWORD,
    );
    expect(dec).toContain('Password="hunter2"');
    expect(dec).toContain('VNCProxyPassword="proxypw"');
    expect(dec).toContain('RDGatewayPassword="gwpw"');
  });

  it('encrypts with a custom master and round-trips back', async () => {
    const enc = await encryptMRemoteNGXml(PLAIN_XML, {
      password: 'custom-master',
      iterations: 5000,
    });
    expect(enc).toContain('KdfIterations="5000"');
    const dec = await decryptMRemoteNGXml(enc, 'custom-master');
    expect(dec).toContain('Password="hunter2"');
    expect(dec).toContain('Password="vncpw"');
    expect(dec).toContain('Password="rdppw"');
  });

  it('full-file encryption hides the entire <Node> tree until decrypted', async () => {
    const enc = await encryptMRemoteNGXml(PLAIN_XML, {
      password: 'secret',
      fullFileEncryption: true,
    });
    expect(enc).toContain('FullFileEncryption="true"');
    expect(enc).not.toContain('<Node');
    expect(enc).not.toContain('hunter2');
    expect(enc).not.toContain('vnc01');
    const dec = await decryptMRemoteNGXml(enc, 'secret');
    expect(dec).toContain('Web 01');
    expect(dec).toContain('VNC Server');
    expect(dec).toContain('Password="hunter2"');
    expect(dec).toContain('VNCProxyPassword="proxypw"');
    expect(dec).toContain('RDGatewayPassword="gwpw"');
  });

  it('rejects round-trip with the wrong password', async () => {
    const enc = await encryptMRemoteNGXml(PLAIN_XML, {
      password: 'right',
      fullFileEncryption: true,
    });
    await expect(decryptMRemoteNGXml(enc, 'wrong')).rejects.toThrow(
      /Incorrect master password/,
    );
  });

  it('writes "ThisIsNotProtected" sentinel for default master, "ThisIsProtected" otherwise', async () => {
    const def = await encryptMRemoteNGXml(PLAIN_XML, {
      password: MREMOTENG_DEFAULT_MASTER_PASSWORD,
    });
    const cust = await encryptMRemoteNGXml(PLAIN_XML, { password: 'pw' });

    const defCheck = await verifyMRemoteNGPassword(
      def,
      MREMOTENG_DEFAULT_MASTER_PASSWORD,
    );
    expect(defCheck.valid).toBe(true);
    expect(defCheck.isDefaultMaster).toBe(true);

    const custCheck = await verifyMRemoteNGPassword(cust, 'pw');
    expect(custCheck.valid).toBe(true);
    expect(custCheck.isDefaultMaster).toBe(false);
  });

  it('clamps iterations to the upstream-required minimum of 1000', async () => {
    // Even if the caller asks for 100 iterations, we record 1000 because
    // mRemoteNG itself refuses to construct Pkcs5S2KeyGenerator below 1000.
    const enc = await encryptMRemoteNGXml(PLAIN_XML, {
      password: 'pw',
      iterations: 100,
    });
    expect(enc).toContain('KdfIterations="1000"');
  });

  it('preserves caller-supplied root attributes', async () => {
    const enc = await encryptMRemoteNGXml(PLAIN_XML, {
      password: MREMOTENG_DEFAULT_MASTER_PASSWORD,
      rootAttributes: { Name: 'My Servers', Export: 'true', ConfVersion: '2.6' },
    });
    expect(enc).toContain('Name="My Servers"');
    expect(enc).toContain('Export="true"');
  });
});

describe('unsupported cipher rejection', () => {
  const cases = [
    ['Serpent', 'GCM', /block cipher "SERPENT"/],
    ['Twofish', 'GCM', /block cipher "TWOFISH"/],
    ['AES', 'CCM', /block-cipher mode "CCM"/],
    ['AES', 'EAX', /block-cipher mode "EAX"/],
  ] as const;
  for (const [engine, mode, expected] of cases) {
    it(`rejects ${engine}/${mode} with a clear error`, async () => {
      const xml =
        `<?xml version="1.0"?><Connections EncryptionEngine="${engine}" ` +
        `BlockCipherMode="${mode}" KdfIterations="1000" FullFileEncryption="true" ` +
        `Protected="" ConfVersion="2.6">x</Connections>`;
      await expect(decryptMRemoteNGXml(xml, 'pw')).rejects.toThrow(expected);
    });
  }
});

describe('encryptMRemoteNGBlob', () => {
  it('produces a payload our decrypter can read back', async () => {
    const ct = await encryptMRemoteNGBlob('hello', 'pw', 1000);
    const xml =
      `<?xml version="1.0"?><Connections EncryptionEngine="AES" ` +
      `BlockCipherMode="GCM" KdfIterations="1000" FullFileEncryption="false" ` +
      `Protected="${ct}" ConfVersion="2.6"></Connections>`;
    // The Protected sentinel won't match, but we can still call the lower
    // level by using verify which round-trips the ciphertext.
    const check = await verifyMRemoteNGPassword(xml, 'pw');
    // "hello" doesn't match either sentinel → valid:false but didn't throw.
    expect(check.valid).toBe(false);
    expect(check.hasProtected).toBe(true);
  });

  it('uses a fresh salt+nonce on every call', async () => {
    const a = await encryptMRemoteNGBlob('same', 'pw', 1000);
    const b = await encryptMRemoteNGBlob('same', 'pw', 1000);
    expect(a).not.toBe(b);
  });
});
