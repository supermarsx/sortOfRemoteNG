import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  invokeManagement,
  toSafeManagementError,
} from "../../src/utils/security/managementInvoke";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("managementInvoke", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("passes bounded JSON-compatible requests and responses through", async () => {
    mocks.invoke.mockResolvedValue({ ok: true, rows: [1, 2, 3] });

    await expect(
      invokeManagement("bmc_get_status", {
        connectionId: "connection-1",
        options: { includeHealth: true },
      }),
    ).resolves.toEqual({ ok: true, rows: [1, 2, 3] });
    expect(mocks.invoke).toHaveBeenCalledWith("bmc_get_status", {
      connectionId: "connection-1",
      options: { includeHealth: true },
    });
  });

  it("rejects invalid command names before invoking the backend", async () => {
    await expect(invokeManagement("BMC status")).rejects.toThrow(
      "Management command name is invalid.",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects oversized request strings before invoking the backend", async () => {
    await expect(
      invokeManagement("bmc_update", {
        value: "x".repeat(1024 * 1024 + 1),
      }),
    ).rejects.toThrow("exceeded the size limit");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects oversized backend collections before returning them", async () => {
    mocks.invoke.mockResolvedValue(new Array(10_001).fill(null));

    await expect(invokeManagement("bmc_list_items")).rejects.toThrow(
      "exceeded the item limit",
    );
  });

  it.each([
    ["non-finite numbers", Number.POSITIVE_INFINITY],
    ["big integers", BigInt(1)],
    ["class instances", new Date("2026-07-31T00:00:00.000Z")],
  ])("rejects %s in request envelopes", async (_label, value) => {
    await expect(invokeManagement("bmc_update", { value })).rejects.toThrow(
      /must be finite|unsupported value|plain objects/,
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects cyclic request envelopes", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(invokeManagement("bmc_update", { cyclic })).rejects.toThrow(
      "contains a cycle",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("redacts labelled, header, cookie, URL, query, and PEM secrets", () => {
    const safe = toSafeManagementError(
      new Error(
        'password="secret value" pwd=short Authorization: Bearer bearer-secret Cookie: sid=cookie-secret https://user:url-secret@example.test/path?refresh_token=query-secret -----BEGIN PRIVATE KEY-----pem-secret',
      ),
    );

    for (const secret of [
      "secret value",
      "short",
      "bearer-secret",
      "cookie-secret",
      "url-secret",
      "query-secret",
      "pem-secret",
    ]) {
      expect(safe).not.toContain(secret);
    }
    expect(safe).toContain("[REDACTED");
    expect(safe.length).toBeLessThanOrEqual(512);
  });

  it("sanitizes backend failures before rethrowing them", async () => {
    mocks.invoke.mockRejectedValue(
      new Error("request failed with client_secret=backend-secret"),
    );

    try {
      await invokeManagement("bmc_get_status");
      throw new Error("expected invokeManagement to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("backend-secret");
      expect((error as Error).message).toContain("[REDACTED]");
    }
  });
});
