import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { DEFAULT_HTTP_PROXY_POLICY } from "../../src/types/connection/httpProxyPolicy";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";
import {
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForClone,
  prepareConnectionForExport,
  redactConnectionSecretsForExport,
  stripConnectionCredentials,
} from "../../src/components/ImportExport/advancedProtocolPortability";

const fixture = (): Connection => ({
  id: "nas",
  name: "NAS",
  protocol: "https",
  hostname: "nas.fr3.quickconnect.to",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-11",
  updatedAt: "2026-09-11",
  synologySettings: {
    version: 1,
    useHttps: true,
    useDefaultRedirectDestinations: false,
  },
  httpProxyPolicy: { ...DEFAULT_HTTP_PROXY_POLICY },
});
const runtime = {
  version: 1,
  originalOrigin: "https://private-nas.fr3.quickconnect.to",
};
const forged = (): Connection =>
  ({
    ...fixture(),
    synologyQuickConnectDefaults: runtime,
    httpProxyPolicy: {
      ...DEFAULT_HTTP_PROXY_POLICY,
      synologyQuickConnectDefaults: runtime,
    },
  }) as Connection;

describe("Synology redirect defaults portability boundary", () => {
  it.each([
    [
      "connection load/edit normalization",
      (value: Connection) => normalizeAdvancedProtocolConnection(value),
    ],
    ["import", normalizeImportedAdvancedProtocolConnection],
    [
      "export with credentials",
      (value: Connection) => prepareConnectionForExport(value, true),
    ],
    [
      "export without credentials",
      (value: Connection) => prepareConnectionForExport(value, false),
    ],
    [
      "clone with credentials",
      (value: Connection) => prepareConnectionForClone(value, true),
    ],
    [
      "clone without credentials",
      (value: Connection) => prepareConnectionForClone(value, false),
    ],
    ["redacted export", redactConnectionSecretsForExport],
    ["credential stripping", stripConnectionCredentials],
  ] as const)(
    "strips transient context in %s without mutating the source or opt-out",
    (_name, normalize) => {
      const input = forged(),
        before = JSON.stringify(input);
      const output = normalize(input);
      expect(output.synologySettings?.useDefaultRedirectDestinations).toBe(
        false,
      );
      expect(output.httpProxyPolicy).toEqual(DEFAULT_HTTP_PROXY_POLICY);
      expect(JSON.stringify(output)).not.toContain(
        "synologyQuickConnectDefaults",
      );
      expect(JSON.stringify(output)).not.toContain(runtime.originalOrigin);
      expect(JSON.stringify(input)).toBe(before);
    },
  );
  it("preserves explicit opt-out over JSON export/import and does not materialize a default grant", () => {
    for (const includeCredentials of [true, false]) {
      const serialized = JSON.stringify(
        prepareConnectionForExport(fixture(), includeCredentials),
      );
      const loaded = normalizeImportedAdvancedProtocolConnection(
        JSON.parse(serialized),
      );
      expect(loaded.synologySettings).toEqual(fixture().synologySettings);
      expect(serialized).not.toContain("synologyQuickConnectDefaults");
    }
    const legacy = fixture();
    delete legacy.synologySettings;
    expect(
      prepareConnectionForExport(legacy, true).synologySettings,
    ).toBeUndefined();
  });
});
