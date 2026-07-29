import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimBuiltInCloudRuntime,
  connectBuiltInCloudRuntime,
  resetBuiltInCloudRuntimeLeasesForTests,
  teardownBuiltInCloudRuntime,
} from "../../src/utils/session/builtInCloudRuntimeRegistry";

afterEach(() => resetBuiltInCloudRuntimeLeasesForTests());

describe("built-in cloud lifecycle registry", () => {
  it("makes only Azure singleton while session-map providers remain independent", () => {
    expect(claimBuiltInCloudRuntime("azure", "azure-a")).toBe(true);
    expect(claimBuiltInCloudRuntime("azure", "azure-b")).toBe(false);
    expect(claimBuiltInCloudRuntime("gcp", "gcp-a")).toBe(true);
    expect(claimBuiltInCloudRuntime("gcp", "gcp-b")).toBe(true);
    expect(
      claimBuiltInCloudRuntime("digital-ocean", "digital-ocean-a"),
    ).toBe(true);
    expect(
      claimBuiltInCloudRuntime("digital-ocean", "digital-ocean-b"),
    ).toBe(true);
    for (const protocol of [
      "ibm-csp",
      "heroku",
      "scaleway",
      "linode",
      "ovhcloud",
    ] as const) {
      expect(claimBuiltInCloudRuntime(protocol, `${protocol}-a`)).toBe(true);
      expect(claimBuiltInCloudRuntime(protocol, `${protocol}-b`)).toBe(true);
    }
  });

  it("joins connect and teardown and holds ownership until cleanup settles", async () => {
    let finishConnect!: () => void;
    let finishDisconnect!: () => void;
    const connectGate = new Promise<{ backendSessionId: string }>((resolve) => {
      finishConnect = () => resolve({ backendSessionId: "backend-a" });
    });
    const disconnectGate = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    const connect = vi.fn(() => connectGate);
    const disconnect = vi.fn(() => disconnectGate);

    expect(claimBuiltInCloudRuntime("azure", "azure-a")).toBe(true);
    const firstConnect = connectBuiltInCloudRuntime(
      "azure",
      "azure-a",
      connect,
    );
    const secondConnect = connectBuiltInCloudRuntime(
      "azure",
      "azure-a",
      connect,
    );
    const firstClose = teardownBuiltInCloudRuntime(
      "azure",
      "azure-a",
      disconnect,
    );
    const secondClose = teardownBuiltInCloudRuntime(
      "azure",
      "azure-a",
      disconnect,
    );

    expect(firstConnect).toBe(secondConnect);
    expect(firstClose).toBe(secondClose);
    expect(claimBuiltInCloudRuntime("azure", "azure-b")).toBe(false);

    finishConnect();
    await firstConnect;
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledTimes(1);

    finishDisconnect();
    await firstClose;
    expect(claimBuiltInCloudRuntime("azure", "azure-b")).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
