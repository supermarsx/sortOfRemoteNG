import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptWithPassword,
  encryptWithPassword,
} from "../../src/utils/crypto/webCryptoAes";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("password decryption byte budgets", () => {
  it.each([false, true])(
    "honors the caller budget for authenticated data (legacy: %s)",
    async (legacy) => {
      const password = "test-sync-password";
      const plaintext = "cloud snapshot";
      const encrypted = await encryptWithPassword(plaintext, password);
      const envelope = JSON.parse(encrypted);
      const payload = legacy
        ? `${envelope.kdf.salt}.${envelope.iv}.${envelope.ciphertext}`
        : encrypted;
      const bytes = Buffer.from(envelope.ciphertext, "base64").length;
      await expect(decryptWithPassword(payload, password)).resolves.toBe(
        plaintext,
      );
      await expect(
        decryptWithPassword(payload, password, {
          maxCiphertextBytes: 100 * 1024 * 1024,
        }),
      ).resolves.toBe(plaintext);
      await expect(
        decryptWithPassword(payload, password, { maxCiphertextBytes: bytes }),
      ).resolves.toBe(plaintext);
      await expect(
        decryptWithPassword(payload, password, {
          maxCiphertextBytes: bytes - 1,
        }),
      ).rejects.toThrow("Invalid encrypted payload dimensions");
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, 100 * 1024 * 1024 + 1])(
    "rejects invalid byte budget %s before processing ciphertext",
    async (maxCiphertextBytes) => {
      await expect(
        decryptWithPassword("not parsed", "test", { maxCiphertextBytes }),
      ).rejects.toThrow("Invalid encrypted payload size limit");
    },
  );
});
