import { afterEach, describe, expect, it, vi } from "vitest";

import {
  builtInManagementRuntimeRegistry,
  claimBuiltInManagementRuntime,
  findBuiltInManagementRuntime,
  resetBuiltInManagementRuntimeLeasesForTests,
  teardownBuiltInManagementRuntime,
} from "../../src/utils/session/builtInManagementRuntimeRegistry";

afterEach(() => resetBuiltInManagementRuntimeLeasesForTests());

describe("built-in management runtime registry", () => {
  it("registers all routed lights-out providers", () => {
    expect(
      builtInManagementRuntimeRegistry.map(({ protocol }) => protocol),
    ).toEqual(["idrac", "ilo", "lenovo", "supermicro"]);
    expect(findBuiltInManagementRuntime("ilo")?.label).toBe("HPE iLO");
    expect(findBuiltInManagementRuntime("unknown")).toBeUndefined();
  });

  it("lazy-loads every registered lights-out panel", async () => {
    for (const descriptor of builtInManagementRuntimeRegistry) {
      expect(descriptor.category).toBe("lights-out");
      const module = await descriptor.importPanel();
      expect(module.default, descriptor.protocol).toBeTypeOf("function");
    }
  });

  it("holds and serializes a provider lease through teardown", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const disconnect = vi.fn(() => gate);

    expect(claimBuiltInManagementRuntime("ilo", "a")).toBe(true);
    const first = teardownBuiltInManagementRuntime("ilo", "a", disconnect);
    const second = teardownBuiltInManagementRuntime("ilo", "a", disconnect);
    await Promise.resolve();

    expect(first).toBe(second);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(claimBuiltInManagementRuntime("ilo", "b")).toBe(false);
    expect(claimBuiltInManagementRuntime("lenovo", "b")).toBe(true);

    release();
    await first;
    expect(claimBuiltInManagementRuntime("ilo", "b")).toBe(true);
  });

  it("retains a lease after disconnect failure and releases it after retry", async () => {
    const disconnect = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);

    expect(claimBuiltInManagementRuntime("supermicro", "a")).toBe(true);
    await expect(
      teardownBuiltInManagementRuntime("supermicro", "a", disconnect),
    ).rejects.toThrow("offline");
    expect(claimBuiltInManagementRuntime("supermicro", "b")).toBe(false);

    await teardownBuiltInManagementRuntime("supermicro", "a", disconnect);
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(claimBuiltInManagementRuntime("supermicro", "b")).toBe(true);
  });
});
