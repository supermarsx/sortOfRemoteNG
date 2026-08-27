import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

import {
  filterProtocolOptionsByRuntimeCapabilities,
  getRuntimeProtocolUnavailableMessage,
  loadRuntimeCapabilities,
  resetRuntimeCapabilitiesCacheForTests,
  type RuntimeCapabilities,
} from "../../src/utils/runtime/runtimeCapabilities";

const leanCapabilities: RuntimeCapabilities = {
  cloud: false,
  ops: false,
  rdp: false,
  serial: true,
  mysql: false,
  postgresql: false,
  mongodb: false,
  source: "native",
};

describe("runtime capabilities", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    resetRuntimeCapabilitiesCacheForTests();
  });

  it("loads and caches the always-on native capability contract", async () => {
    tauriMocks.invoke.mockResolvedValue({
      cloud: true,
      ops: true,
      rdp: true,
      serial: true,
      mysql: true,
      postgresql: true,
      mongodb: true,
    });

    const first = await loadRuntimeCapabilities();
    const second = await loadRuntimeCapabilities();

    expect(first).toMatchObject({ cloud: true, source: "native" });
    expect(second).toBe(first);
    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("get_runtime_capabilities");
  });

  it("filters only compile-time-gated picker families in a lean build", () => {
    const options = [
      { value: "ssh" },
      { value: "serial" },
      { value: "rdp" },
      { value: "mysql" },
      { value: "postgresql" },
      { value: "mongodb" },
      { value: "winrm" },
      { value: "gcp" },
      { value: "idrac" },
    ];

    expect(
      filterProtocolOptionsByRuntimeCapabilities(options, leanCapabilities).map(
        ({ value }) => value,
      ),
    ).toEqual(["ssh", "serial", "idrac"]);
    expect(
      getRuntimeProtocolUnavailableMessage("rdp", leanCapabilities),
    ).toContain('"rdp" feature');
    expect(
      getRuntimeProtocolUnavailableMessage("mongodb", leanCapabilities),
    ).toContain('"db-mongo" feature');
  });

  it("fails closed with an actionable message when capability IPC is absent", async () => {
    tauriMocks.invoke.mockRejectedValue(
      new Error("Command get_runtime_capabilities not found"),
    );

    const capabilities = await loadRuntimeCapabilities();

    expect(capabilities.source).toBe("unavailable");
    expect(
      getRuntimeProtocolUnavailableMessage("azure", capabilities),
    ).toContain("Update or reinstall");
    expect(
      filterProtocolOptionsByRuntimeCapabilities(
        [{ value: "ssh" }, { value: "azure" }],
        capabilities,
      ),
    ).toEqual([{ value: "ssh" }]);
  });
});
