/**
 * t62 / D6 — Trust Center records ride along in the backup payload.
 *
 * A backup that omitted them would restore a database that re-prompts for
 * every host it already trusted, so `buildBackupPayload` carries the document
 * through. Backups written before t62 have no `trustRecords` at all, and the
 * restore path must stay happy with that.
 */

import { describe, expect, it } from "vitest";
import { buildBackupPayload } from "../../src/utils/services/backupPayload";
import type { TrustExportDocument } from "../../src/utils/services/trustPortability";
import { defaultBackupConfig } from "../../src/types/settings/settings";

const config = {
  ...defaultBackupConfig,
  includeSettings: true,
  includePasswords: false,
};

const trustRecords: TrustExportDocument = {
  version: 1,
  records: [
    {
      host: "vault.example.test:443",
      record_type: "https",
      identity: {
        fingerprint: "AA:BB:CC",
        // A field the secret stripper would normally delete by name — trust
        // records must not be run through it.
        token: "not-a-secret-just-a-field-name",
        last_seen: "2026-05-01T00:00:00.000Z",
      },
      user_approved: true,
      nickname: "Prod vault",
      history: [{ reason: "Initial", at: "2026-01-01T00:00:00.000Z" }],
      revoked: false,
      tags: ["prod"],
    },
  ],
  policy: "tofu",
  policyConfig: { expiry_days: 90 },
};

describe("buildBackupPayload trust records", () => {
  it("carries the trust document verbatim", () => {
    const payload = buildBackupPayload(
      {
        connections: [{ id: "c1", name: "Host", password: "hunter2" }],
        settings: {},
        timestamp: 1_700_000_000_000,
        trustRecords,
      },
      config,
    );

    expect(payload.trustRecords).toEqual(trustRecords);
    // Nickname, history and revoked state survive; the secret stripper still
    // does its job on the connections beside them.
    expect(payload.trustRecords?.records[0].nickname).toBe("Prod vault");
    expect(payload.trustRecords?.records[0].history).toHaveLength(1);
    expect(payload.trustRecords?.records[0].identity.token).toBe(
      "not-a-secret-just-a-field-name",
    );
    expect(payload.connections[0]).not.toHaveProperty("password");
  });

  it("omits the key entirely when there is nothing to carry", () => {
    for (const value of [undefined, null]) {
      const payload = buildBackupPayload(
        { connections: [], settings: {}, trustRecords: value },
        config,
      );
      expect(payload).not.toHaveProperty("trustRecords");
    }
  });

  it("ignores a malformed document rather than writing it into the backup", () => {
    const payload = buildBackupPayload(
      {
        connections: [],
        settings: {},
        trustRecords: { version: 1 } as unknown as TrustExportDocument,
      },
      config,
    );
    expect(payload).not.toHaveProperty("trustRecords");
  });

  it("leaves the rest of the payload untouched", () => {
    const withTrust = buildBackupPayload(
      {
        connections: [],
        settings: { theme: "dark" },
        timestamp: 42,
        trustRecords,
      },
      config,
    );
    const withoutTrust = buildBackupPayload(
      { connections: [], settings: { theme: "dark" }, timestamp: 42 },
      config,
    );
    const { trustRecords: _dropped, ...rest } = withTrust;
    expect(rest).toEqual(withoutTrust);
  });
});
