import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  decryptAesCbcEnvelope,
  encryptExport,
  isAesCbcEnvelope,
  isMremotengEncryptedXml,
  schemeForFormat,
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
});
