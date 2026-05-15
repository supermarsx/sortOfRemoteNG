import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  decryptAesCbcEnvelope,
  decryptMremotengDocument,
  encryptExport,
  isAesCbcEnvelope,
  isMremotengEncryptedXml,
  schemeForFormat,
  DecryptError,
  DECRYPT_ERROR_I18N_KEYS,
  DECRYPT_ERROR_DEFAULT_MESSAGES,
  type ExportFormat,
} from '../../src/utils/crypto/exportEncryption';
import { decryptWithPassword } from '../../src/utils/crypto/webCryptoAes';

const utf8Decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const utf8Encode = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('exportEncryption', () => {
  describe('schemeForFormat', () => {
    it.each([
      ['json', 'aes-gcm'],
      ['xml', 'aes-gcm'],
      ['csv', 'aes-gcm'],
      ['txt', 'aes-cbc'],
      ['markdown', 'aes-cbc'],
      ['html', 'aes-cbc'],
      ['excel', 'office'],
      ['mremoteng', 'mremoteng'],
    ] as Array<[ExportFormat, string]>)('routes %s to %s', (format, scheme) => {
      expect(schemeForFormat(format)).toBe(scheme);
    });
  });

  describe('AES-GCM path (native formats)', () => {
    it('round-trips through encryptWithPassword for json', async () => {
      const payload = '{"connections":[{"id":"abc","name":"server-01"}]}';
      const result = await encryptExport('json', {
        payload: utf8Encode(payload),
        payloadString: payload,
        password: 'correct-horse-battery-staple',
        iterations: 50_000,
      });
      expect(result.scheme).toBe('aes-gcm');
      expect(result.warning).toBeUndefined();
      const envelopeText = utf8Decode(result.bytes);
      const decrypted = await decryptWithPassword(envelopeText, 'correct-horse-battery-staple');
      expect(decrypted).toBe(payload);
    });

    it('fails on wrong password', async () => {
      const payload = 'sentinel';
      const result = await encryptExport('json', {
        payload: utf8Encode(payload),
        payloadString: payload,
        password: 'right',
        iterations: 50_000,
      });
      const envelopeText = utf8Decode(result.bytes);
      await expect(
        decryptWithPassword(envelopeText, 'wrong'),
      ).rejects.toBeTruthy();
    });
  });

  describe('AES-CBC path (readable formats)', () => {
    it('round-trips for txt', async () => {
      const payload = 'Just some plain inventory text\nrow 1\nrow 2\n';
      const result = await encryptExport('txt', {
        payload: utf8Encode(payload),
        password: 'pw-1234',
        iterations: 25_000,
      });
      expect(result.scheme).toBe('aes-cbc');
      expect(result.warning).toBeUndefined();
      expect(isAesCbcEnvelope(utf8Decode(result.bytes))).toBe(true);
      const decryptedBytes = await decryptAesCbcEnvelope(
        result.bytes,
        'pw-1234',
      );
      expect(utf8Decode(decryptedBytes)).toBe(payload);
    });

    it('round-trips for markdown', async () => {
      const payload = '# Connections\n\n- one\n- two';
      const result = await encryptExport('markdown', {
        payload: utf8Encode(payload),
        password: 'mdpass',
      });
      const back = await decryptAesCbcEnvelope(result.bytes, 'mdpass');
      expect(utf8Decode(back)).toBe(payload);
    });

    it('round-trips for html', async () => {
      const payload = '<html><body><h1>Inventory</h1></body></html>';
      const result = await encryptExport('html', {
        payload: utf8Encode(payload),
        password: 'htmlpass',
      });
      const back = await decryptAesCbcEnvelope(result.bytes, 'htmlpass');
      expect(utf8Decode(back)).toBe(payload);
    });

    it('rejects wrong password', async () => {
      const payload = 'secret';
      const result = await encryptExport('txt', {
        payload: utf8Encode(payload),
        password: 'real',
      });
      await expect(
        decryptAesCbcEnvelope(result.bytes, 'fake'),
      ).rejects.toBeTruthy();
    });
  });

  describe('Office (Excel) fallback', () => {
    beforeEach(() => {
      // Ensure no Tauri global is present so the IPC try fails and we
      // exercise the fallback path.
      (globalThis as any).__TAURI__ = undefined;
    });

    it('falls back to AES-GCM with a warning when IPC is missing', async () => {
      const payload = utf8Encode('PKexcel-bytes');
      const result = await encryptExport('excel', {
        payload,
        password: 'xlsxpass',
      });
      expect(result.scheme).toBe('aes-gcm');
      expect(result.warning).toBeTruthy();
      expect(result.extension).toBe('.xlsx.enc.json');
    });
  });

  describe('mRemoteNG fallback', () => {
    beforeEach(() => {
      (globalThis as any).__TAURI__ = undefined;
    });

    it('falls back to AES-GCM with a warning when IPC is missing', async () => {
      const payload = '<?xml version="1.0"?><Connections><Node Name="srv"/></Connections>';
      const result = await encryptExport('mremoteng', {
        payload: utf8Encode(payload),
        payloadString: payload,
        password: 'mrngpass',
      });
      expect(result.scheme).toBe('aes-gcm');
      expect(result.warning).toBeTruthy();
      expect(result.extension).toBe('.xml.enc.json');
    });
  });

  describe('detection helpers', () => {
    it('isAesCbcEnvelope detects a real envelope', async () => {
      const result = await encryptExport('txt', {
        payload: utf8Encode('hello'),
        password: 'pw',
      });
      expect(isAesCbcEnvelope(utf8Decode(result.bytes))).toBe(true);
    });

    it('isAesCbcEnvelope rejects plain text', () => {
      expect(isAesCbcEnvelope('hello world')).toBe(false);
      expect(isAesCbcEnvelope('{ "foo": "bar" }')).toBe(false);
    });

    it('isMremotengEncryptedXml detects the encrypted header', () => {
      const sample =
        '<?xml version="1.0" encoding="utf-8"?>\n<Connections Name="root" Confidential="True" EncryptionEngine="AES" BlockCipherMode="GCM" KdfIterations="1000">…</Connections>';
      expect(isMremotengEncryptedXml(sample)).toBe(true);
    });

    it('isMremotengEncryptedXml rejects regular XML', () => {
      expect(
        isMremotengEncryptedXml(
          '<?xml version="1.0"?><Connections><Node Name="srv"/></Connections>',
        ),
      ).toBe(false);
    });
  });

  describe('DecryptError classification', () => {
    afterEach(() => {
      (globalThis as any).__TAURI__ = undefined;
    });

    it('throws wrong-password DecryptError on AES-CBC bad password', async () => {
      const result = await encryptExport('txt', {
        payload: utf8Encode('payload'),
        password: 'real',
      });
      let caught: unknown;
      try {
        await decryptAesCbcEnvelope(result.bytes, 'fake');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DecryptError);
      expect((caught as DecryptError).kind).toBe('wrong-password');
    });

    it('throws corrupted DecryptError on AES-CBC envelope with garbage JSON', async () => {
      let caught: unknown;
      try {
        await decryptAesCbcEnvelope('not even json {{{', 'pw');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DecryptError);
      expect((caught as DecryptError).kind).toBe('corrupted');
    });

    it('throws corrupted DecryptError on AES-CBC envelope with missing fields', async () => {
      let caught: unknown;
      try {
        await decryptAesCbcEnvelope(
          JSON.stringify({ algorithm: 'AES-256-CBC' }),
          'pw',
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DecryptError);
      expect((caught as DecryptError).kind).toBe('corrupted');
    });

    it('throws unsupported DecryptError when mRemoteNG IPC is missing', async () => {
      (globalThis as any).__TAURI__ = undefined;
      let caught: unknown;
      try {
        await decryptMremotengDocument('<xml/>', 'pw');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DecryptError);
      expect((caught as DecryptError).kind).toBe('unsupported');
    });

    it('throws wrong-password DecryptError when mRemoteNG IPC rejects', async () => {
      (globalThis as any).__TAURI__ = {
        core: {
          invoke: vi.fn().mockRejectedValue(new Error('tag mismatch')),
        },
      };
      let caught: unknown;
      try {
        await decryptMremotengDocument('<xml/>', 'pw');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DecryptError);
      expect((caught as DecryptError).kind).toBe('wrong-password');
    });

    it('exposes localized i18n keys and English defaults for every kind', () => {
      for (const kind of [
        'wrong-password',
        'corrupted',
        'unsupported',
        'unknown',
      ] as const) {
        expect(DECRYPT_ERROR_I18N_KEYS[kind]).toMatch(
          /^exportEncryption\.decryptErrors\./,
        );
        expect(DECRYPT_ERROR_DEFAULT_MESSAGES[kind]).toBeTruthy();
      }
    });
  });

  describe('Full export → decrypt round-trip', () => {
    beforeEach(() => {
      (globalThis as any).__TAURI__ = undefined;
    });

    it.each([
      ['json'],
      ['xml'],
      ['csv'],
    ] as Array<[ExportFormat]>)(
      'native %s format round-trips through AES-GCM',
      async (format) => {
        const payload = `{"format":"${format}","items":["one","two"]}`;
        const result = await encryptExport(format, {
          payload: utf8Encode(payload),
          payloadString: payload,
          password: 'roundtrip-pw',
          iterations: 25_000,
        });
        expect(result.scheme).toBe('aes-gcm');
        const back = await decryptWithPassword(
          utf8Decode(result.bytes),
          'roundtrip-pw',
        );
        expect(back).toBe(payload);
      },
    );

    it.each([
      ['txt'],
      ['markdown'],
      ['html'],
    ] as Array<[ExportFormat]>)(
      'readable %s format round-trips through AES-CBC',
      async (format) => {
        const payload = `payload for ${format}\nline two`;
        const result = await encryptExport(format, {
          payload: utf8Encode(payload),
          password: 'pw',
          iterations: 25_000,
        });
        expect(result.scheme).toBe('aes-cbc');
        const back = await decryptAesCbcEnvelope(result.bytes, 'pw');
        expect(utf8Decode(back)).toBe(payload);
      },
    );

    it('excel fallback round-trips back through AES-GCM (no IPC available)', async () => {
      const payload = '<xlsx-blob/>';
      const result = await encryptExport('excel', {
        payload: utf8Encode(payload),
        payloadString: payload,
        password: 'excel-pw',
      });
      expect(result.scheme).toBe('aes-gcm');
      expect(result.warning).toBeTruthy();
      const back = await decryptWithPassword(
        utf8Decode(result.bytes),
        'excel-pw',
      );
      expect(back).toBe(payload);
    });

    it('mremoteng fallback round-trips back through AES-GCM (no IPC available)', async () => {
      const payload = '<?xml version="1.0"?><Connections/>';
      const result = await encryptExport('mremoteng', {
        payload: utf8Encode(payload),
        payloadString: payload,
        password: 'mrng-pw',
      });
      expect(result.scheme).toBe('aes-gcm');
      expect(result.warning).toBeTruthy();
      const back = await decryptWithPassword(
        utf8Decode(result.bytes),
        'mrng-pw',
      );
      expect(back).toBe(payload);
    });
  });
});
