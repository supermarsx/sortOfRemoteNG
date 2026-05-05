import { describe, it, expect, beforeEach } from "vitest";
import {
  verifyIdentity,
  trustIdentity,
  removeIdentity,
  getStoredIdentity,
  getAllTrustRecords,
  isCertificateTrustRecordType,
  resolveEffectiveTrustPolicy,
  getEffectiveTrustPolicy,
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
      const first = makeTlsIdentity("SHA256:first");
      trustIdentity("host", 443, "tls", first);

      const second = makeTlsIdentity("SHA256:second");
      trustIdentity("host", 443, "tls", second);

      const record = getStoredIdentity("host", 443, "tls");
      expect(record!.identity.fingerprint).toBe("SHA256:second");
      expect(record!.history).toHaveLength(1);
      expect(record!.history![0].fingerprint).toBe("SHA256:first");
    });

    it("stores certificate, HTTPS, RDP, SSH, and legacy TLS records separately", () => {
      trustIdentity("host", 443, "certificate", makeTlsIdentity("SHA256:certificate"));
      trustIdentity("host", 443, "https", makeTlsIdentity("SHA256:https"));
      trustIdentity("host", 443, "rdp", makeTlsIdentity("SHA256:rdp"));
      trustIdentity("host", 443, "ssh", makeSshIdentity("SHA256:ssh"));
      trustIdentity("host", 443, "tls", makeTlsIdentity("SHA256:legacy-tls"));

      expect(getStoredIdentity("host", 443, "certificate")!.identity.fingerprint).toBe("SHA256:certificate");
      expect(getStoredIdentity("host", 443, "https")!.identity.fingerprint).toBe("SHA256:https");
      expect(getStoredIdentity("host", 443, "rdp")!.identity.fingerprint).toBe("SHA256:rdp");
      expect(getStoredIdentity("host", 443, "ssh")!.identity.fingerprint).toBe("SHA256:ssh");
      expect(getStoredIdentity("host", 443, "tls")!.identity.fingerprint).toBe("SHA256:legacy-tls");
      expect(getAllTrustRecords().map((record) => record.type).sort()).toEqual([
        "certificate",
        "https",
        "rdp",
        "ssh",
        "tls",
      ]);
    });

    it("uses certificate-prefixed storage keys for general certificates", () => {
      trustIdentity("cert.example", 8443, "certificate", makeTlsIdentity("SHA256:certificate"));

      const rawStore = localStorage.getItem("trustStore");
      expect(rawStore).toBeTruthy();
      expect(Object.keys(JSON.parse(rawStore!))).toContain("certificate:cert.example:8443");
    });

    it("does not use legacy TLS records as certificate, HTTPS, or RDP fallback", () => {
      const identity = makeTlsIdentity("SHA256:legacy-only");
      trustIdentity("legacy.example", 443, "tls", identity);

      expect(getStoredIdentity("legacy.example", 443, "certificate")).toBeUndefined();
      expect(getStoredIdentity("legacy.example", 443, "https")).toBeUndefined();
      expect(getStoredIdentity("legacy.example", 443, "rdp")).toBeUndefined();
      expect(verifyIdentity("legacy.example", 443, "certificate", identity).status).toBe("first-use");
      expect(verifyIdentity("legacy.example", 443, "https", identity).status).toBe("first-use");
      expect(verifyIdentity("legacy.example", 443, "rdp", identity).status).toBe("first-use");
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

    it("keeps legacy TLS records typed as tls", () => {
      trustIdentity("legacy.example", 443, "tls", makeTlsIdentity("SHA256:legacy"));

      const [record] = getAllTrustRecords();
      expect(record.type).toBe("tls");
      expect(record.identity.fingerprint).toBe("SHA256:legacy");
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

  describe("certificate record type helpers", () => {
    it("classifies general certificates, HTTPS, RDP, and legacy TLS as certificate records", () => {
      expect(isCertificateTrustRecordType("certificate")).toBe(true);
      expect(isCertificateTrustRecordType("https")).toBe(true);
      expect(isCertificateTrustRecordType("rdp")).toBe(true);
      expect(isCertificateTrustRecordType("tls")).toBe(true);
      expect(isCertificateTrustRecordType("ssh")).toBe(false);
    });
  });

  describe("resolveEffectiveTrustPolicy", () => {
    it("prefers concrete connection policy over category and root policies", () => {
      expect(resolveEffectiveTrustPolicy("strict", "tofu", "always-trust")).toBe("strict");
    });

    it("inherits from category policy when connection policy is missing or inherit", () => {
      expect(resolveEffectiveTrustPolicy(undefined, "tofu", "always-trust")).toBe("tofu");
      expect(resolveEffectiveTrustPolicy("inherit", "tofu", "always-trust")).toBe("tofu");
    });

    it("inherits from root policy when category policy is missing or inherit", () => {
      expect(resolveEffectiveTrustPolicy(undefined, undefined, "always-trust")).toBe("always-trust");
      expect(resolveEffectiveTrustPolicy("inherit", "inherit", "strict")).toBe("strict");
    });

    it("falls back to always-ask when no concrete policy is available", () => {
      expect(resolveEffectiveTrustPolicy(undefined, "inherit", undefined)).toBe("always-ask");
    });
  });

  describe("getEffectiveTrustPolicy", () => {
    it("falls back to always-ask when no connection or global policy is set", () => {
      expect(getEffectiveTrustPolicy(undefined, undefined)).toBe("always-ask");
    });

    it("treats inherit as a compatibility fallback value", () => {
      expect(getEffectiveTrustPolicy("inherit", "tofu")).toBe("tofu");
      expect(getEffectiveTrustPolicy("inherit", "inherit")).toBe("always-ask");
    });

    it("prefers connection policy over global policy", () => {
      expect(getEffectiveTrustPolicy("strict", "always-ask")).toBe("strict");
    });
  });
});
