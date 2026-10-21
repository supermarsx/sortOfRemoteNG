import { describe, expect, it } from "vitest";
import { connectionEndpointHost } from "../../src/utils/connection/connectionEndpointHost";

describe("protocol-scoped session endpoints", () => {
  it.each(["ssh", "rdp", "https", "vnc"] as const)(
    "uses the saved hostname for fresh and restored %s sessions",
    (protocol) => {
      expect(
        connectionEndpointHost({
          protocol,
          hostname: "saved.example.test",
          integration: {
            descriptorKey: "nginxProxyMgr",
            instanceId: "panel",
            host: "stale-panel.example.test",
          },
        }),
      ).toBe("saved.example.test");
    },
  );
  it("retains the configured panel endpoint for integration protocols", () => {
    expect(
      connectionEndpointHost({
        protocol: "integration:nginxProxyMgr",
        hostname: "legacy.example.test",
        integration: {
          descriptorKey: "nginxProxyMgr",
          instanceId: "panel",
          host: "panel.example.test",
        },
      }),
    ).toBe("panel.example.test");
    expect(
      connectionEndpointHost({
        protocol: "integration:nginxProxyMgr",
        hostname: "legacy.example.test",
        integration: {
          descriptorKey: "nginxProxyMgr",
          instanceId: "panel",
          host: "",
        },
      }),
    ).toBe("legacy.example.test");
  });
});
