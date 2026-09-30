import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { ardUnsupportedNetworkPath } from "../../src/hooks/protocol/ardRuntime";
import { getUnsupportedFtpRouteReason } from "../../src/hooks/protocol/useFTPSession";
import { getUnsupportedMongoRouteReason } from "../../src/hooks/protocol/useMongoDBClient";
import { getUnsupportedPostgreSQLRouteReason } from "../../src/hooks/protocol/usePostgreSQLClient";
import { getUnsupportedNxRouteReason } from "../../src/hooks/protocol/useNxNativeSession";
import { getUnsupportedX2goRouteReason } from "../../src/hooks/protocol/useX2goNativeSession";
import { getUnsupportedScpRouteReason } from "../../src/hooks/protocol/useScpClient";
import { getUnsupportedSpiceRouteReason } from "../../src/hooks/protocol/useSpiceClient";
import { getUnsupportedXdmcpRouteReason } from "../../src/hooks/protocol/useXdmcpClient";
import { getUnsupportedMysqlRouteReason } from "../../src/utils/services/mysqlService";
import { hasConfiguredNetworkPath } from "../../src/utils/network/networkPathConfig";
import { assertSynologyNativeRoute } from "../../src/types/protocols/synology";

const direct = {
  id: "destination",
  name: "Destination",
  hostname: "destination.test",
  protocol: "ssh",
  port: 22,
  isGroup: false,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
} as Connection;

describe.each([
  ["ARD", ardUnsupportedNetworkPath],
  ["FTP", getUnsupportedFtpRouteReason],
  ["MongoDB", getUnsupportedMongoRouteReason],
  ["PostgreSQL", getUnsupportedPostgreSQLRouteReason],
  ["NX", getUnsupportedNxRouteReason],
  ["X2Go", getUnsupportedX2goRouteReason],
  ["SCP", getUnsupportedScpRouteReason],
  ["SPICE", getUnsupportedSpiceRouteReason],
  ["XDMCP", getUnsupportedXdmcpRouteReason],
  ["MySQL/MariaDB", getUnsupportedMysqlRouteReason],
] as const)("%s route guard", (_name, guard) => {
  it("still permits a direct connection", () => {
    expect(guard(direct)).toBeNull();
  });

  it.each([
    "proxyProfileId",
    "tunnelProfileId",
    "proxyChainId",
    "tunnelChainId",
    "connectionChainId",
  ] as const)(
    "refuses %s without requiring the referenced profile to exist",
    (field) => {
      expect(
        guard({ ...direct, [field]: "missing-or-disabled-profile" }),
      ).toEqual(expect.any(String));
    },
  );

  it("preserves the existing enabled inline-route guard", () => {
    expect(
      guard({
        ...direct,
        security: {
          tunnelChain: [{ id: "inline", type: "ssh-tunnel", enabled: true }],
        },
      }),
    ).toEqual(expect.any(String));
  });

  it.each(["proxyProfileId", "tunnelProfileId"] as const)(
    "does not treat an invalid empty %s as permission to connect directly",
    (field) => {
      expect(guard({ ...direct, [field]: "" })).toEqual(expect.any(String));
    },
  );
});

describe("web route-presence gate", () => {
  it.each(["proxyProfileId", "tunnelProfileId"] as const)(
    "requires runtime resolution for %s",
    (field) => {
      expect(
        hasConfiguredNetworkPath({ ...direct, [field]: "saved-profile" }),
      ).toBe(true);
    },
  );
  it("keeps a direct connection free of catalog resolution", () => {
    expect(hasConfiguredNetworkPath(direct)).toBe(false);
  });
});

describe("native Synology route guard", () => {
  it.each(["proxyProfileId", "tunnelProfileId"] as const)(
    "rejects %s",
    (field) => {
      expect(() =>
        assertSynologyNativeRoute({ ...direct, [field]: "saved-profile" }),
      ).toThrow(/does not support per-connection/);
    },
  );
  it("keeps the existing direct-route allowance", () => {
    expect(() => assertSynologyNativeRoute(direct)).not.toThrow();
  });
});
