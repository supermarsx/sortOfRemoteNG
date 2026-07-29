import { describe, expect, it, vi } from "vitest";
import {
  builtInManagementRuntimeRegistry,
  claimIdracRuntime,
  findBuiltInManagementRuntime,
  idracRuntimeDescriptor,
  resetIdracRuntimeLeaseForTests,
  teardownIdracRuntime,
} from "../../src/utils/session/builtInManagementRuntimeRegistry";
import {
  getProtocolAvailability,
} from "../../src/utils/session/protocolAvailability";
import { PROTOCOL_OPTIONS } from "../../src/hooks/connection/useConnectionEditor";

describe("iDRAC built-in management runtime descriptor", () => {
  it("registers a selectable, client-owned lights-out runtime", () => {
    expect(builtInManagementRuntimeRegistry).toContain(
      idracRuntimeDescriptor,
    );
    expect(findBuiltInManagementRuntime("idrac")).toBe(
      idracRuntimeDescriptor,
    );
    expect(idracRuntimeDescriptor.category).toBe("lights-out");
    expect(PROTOCOL_OPTIONS).toContainEqual(
      expect.objectContaining({
        value: "idrac",
        category: "lights-out",
      }),
    );
    expect(getProtocolAvailability("idrac")).toEqual(
      expect.objectContaining({
        classification: "fully-interactive",
        sessionEntry: "client-owned",
        frontendPath: idracRuntimeDescriptor.frontendPath,
        backendPath: idracRuntimeDescriptor.backendPath,
        testPath: idracRuntimeDescriptor.testPath,
      }),
    );
  });

  it("lazy-loads a concrete saved-connection panel", async () => {
    const module = await idracRuntimeDescriptor.importPanel();
    expect(module.default).toBeTypeOf("function");
  });

  it("keeps the lease occupied until its idempotent teardown settles", async () => {
    resetIdracRuntimeLeaseForTests();
    expect(claimIdracRuntime("first")).toBe(true);

    let finish: (() => void) | undefined;
    const disconnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const firstTeardown = teardownIdracRuntime("first", disconnect);
    const joinedTeardown = teardownIdracRuntime("first", disconnect);

    expect(firstTeardown).toBe(joinedTeardown);
    expect(claimIdracRuntime("second")).toBe(false);
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledTimes(1);
    finish?.();
    await firstTeardown;

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(claimIdracRuntime("second")).toBe(true);
    await teardownIdracRuntime("second", async () => undefined);
    resetIdracRuntimeLeaseForTests();
  });
});
