import { describe, it, expect, beforeEach } from "vitest";
import {
  verifyIdentity,
  trustIdentity,
  removeIdentity,
  getStoredIdentity,
  getAllTrustRecords,
} from "../../src/utils/auth/trustStore";
import type { SshHostKeyIdentity, CertIdentity } from "../../src/utils/auth/trustStore";

const makeSshIdentity = (fp: string): SshHostKeyIdentity => ({
  fingerprint: fp,
  keyType: "ssh-ed25519",
  firstSeen: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});

const makeTlsIdentity = (fp: string): CertIdentity => ({
  fingerprint: fp,
  subject: "example.com",
  issuer: "Let's Encrypt",
  firstSeen: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});

describe("trustStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("verifyIdentity", () => {
    it("returns first-use for unknown hosts", () => {
      const identity = makeSshIdentity("SHA256:abc123");
      const result = verifyIdentity("myhost", 22, "ssh", identity);
      expect(result.status).toBe("first-use");
    });

    it("returns trusted for matching fingerprints", () => {
      const identity = makeSshIdentity("SHA256:abc123");
      trustIdentity("myhost", 22, "ssh", identity);

      const result = verifyIdentity("myhost", 22, "ssh", identity);
      expect(result.status).toBe("trusted");
    });

    it("returns mismatch for changed fingerprints", () => {
      const original = makeSshIdentity("SHA256:original");
      trustIdentity("myhost", 22, "ssh", original);

      const changed = makeSshIdentity("SHA256:changed");
      const result = verifyIdentity("myhost", 22, "ssh", changed);
      expect(result.status).toBe("mismatch");
      if (result.status === "mismatch") {
        expect(result.stored.fingerprint).toBe("SHA256:original");
        expect(result.received.fingerprint).toBe("SHA256:changed");
      }
    });
  });

  describe("trustIdentity", () => {
    it("stores a new identity", () => {
      const identity = makeSshIdentity("SHA256:new");
      trustIdentity("newhost", 22, "ssh", identity);

      const record = getStoredIdentity("newhost", 22, "ssh");
      expect(record).toBeDefined();
      expect(record!.identity.fingerprint).toBe("SHA256:new");
    });

    it("moves previous identity to history on update", () => {
      const first = makeSshIdentity("SHA256:first");
      trustIdentity("host", 443, "tls", first);

      const second = makeTlsIdentity("SHA256:second");
      trustIdentity("host", 443, "tls", second);

      const record = getStoredIdentity("host", 443, "tls");
      expect(record!.identity.fingerprint).toBe("SHA256:second");
      expect(record!.history).toHaveLength(1);
      expect(record!.history![0].fingerprint).toBe("SHA256:first");
    });
  });

  describe("removeIdentity", () => {
    it("removes stored record", () => {
      const identity = makeSshIdentity("SHA256:remove-me");
      trustIdentity("host", 22, "ssh", identity);
      expect(getStoredIdentity("host", 22, "ssh")).toBeDefined();

      removeIdentity("host", 22, "ssh");
      expect(getStoredIdentity("host", 22, "ssh")).toBeUndefined();
    });
  });

  describe("getAllTrustRecords", () => {
    it("returns all stored records", () => {
      trustIdentity("host1", 22, "ssh", makeSshIdentity("SHA256:a"));
      trustIdentity("host2", 443, "tls", makeTlsIdentity("SHA256:b"));

      const records = getAllTrustRecords();
      expect(records).toHaveLength(2);
    });

    it("returns empty array when store is clean", () => {
      expect(getAllTrustRecords()).toHaveLength(0);
    });
  });

  describe("per-connection isolation", () => {
    it("isolates trust records by connectionId", () => {
      const identity = makeSshIdentity("SHA256:conn-specific");
      trustIdentity("host", 22, "ssh", identity, true, "conn-1");

      expect(getStoredIdentity("host", 22, "ssh")).toBeUndefined();
      expect(getStoredIdentity("host", 22, "ssh", "conn-1")).toBeDefined();
    });
  });
});
