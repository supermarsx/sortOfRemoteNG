import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import {
  containsExportSecrets,
  stripExportSecrets,
} from "../../src/components/ImportExport/exportSecurity";
import {
  prepareConnectionForExport,
  stripConnectionCredentials,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import { stripStructuredSecrets } from "../../src/utils/services/backupPayload";
import { diffConnection } from "../../src/utils/connection/diffConnection";

const connection = {
  id: "web",
  protocol: "https",
  hostname: "example.test",
  port: 443,
  name: "Web",
  isGroup: false,
  httpProxyPolicy: {
    ...DEFAULT_HTTP_PROXY_POLICY,
    httpsOnly: true,
    queryParameters: [{ name: "tenant", value: "synthetic-query-secret" }],
  },
  httpFormAutomation: {
    version: 1,
    fillDelayMs: 50,
    submitDelayMs: 100,
    detectionTimeoutMs: 8000,
    submit: true,
    fields: [
      { selector: "input[name=tenant]", value: "synthetic-form-secret" },
    ],
  },
} as Connection;

describe("HTTP option secret boundaries", () => {
  it.each([
    [
      "portable export",
      (value: Connection) => prepareConnectionForExport(value, false),
    ],
    ["credential-free clone", stripConnectionCredentials],
    ["final export scrub", stripExportSecrets<Connection>],
    ["password-free backup", stripStructuredSecrets<Connection>],
  ])(
    "strips literal values at %s while preserving proxy restrictions",
    (_, scrub) => {
      const result = scrub(connection)!;
      expect(JSON.stringify(result)).not.toContain("synthetic-query-secret");
      expect(JSON.stringify(result)).not.toContain("synthetic-form-secret");
      expect(result.httpProxyPolicy?.httpsOnly).toBe(true);
      expect(result.httpProxyPolicy?.queryParameters).toEqual([]);
      expect(result.httpFormAutomation?.fields).toEqual([]);
      expect(result.httpFormAutomation?.submit).toBe(false);
      expect(containsExportSecrets(result)).toBe(false);
      expect(connection.httpFormAutomation?.fields).toHaveLength(1);
    },
  );
  it("detects innocently named values and preserves explicit credential-inclusive exports", () => {
    expect(containsExportSecrets(connection)).toBe(true);
    expect(
      prepareConnectionForExport(connection, true).httpProxyPolicy,
    ).toEqual(connection.httpProxyPolicy);
  });
  it("never prints the changed options or header values in connection audit deltas", () => {
    const changes = diffConnection(
      {
        ...connection,
        httpProxyPolicy: undefined,
        httpFormAutomation: undefined,
      },
      {
        ...connection,
        httpHeaders: { "X-Context": "synthetic-header-secret" },
      },
    );
    expect(changes.length).toBe(3);
    expect(
      changes.every(
        (change) =>
          change.secret && change.before === null && change.after === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(changes)).not.toContain("synthetic-");
  });
  it("does not export unknown extensions from malformed imported options", () => {
    const value = {
      httpProxyPolicy: {
        ...connection.httpProxyPolicy,
        extension: "synthetic-hidden-secret",
      },
    };
    expect(containsExportSecrets(value)).toBe(true);
    expect(stripExportSecrets(value)).toEqual({});
  });
});
