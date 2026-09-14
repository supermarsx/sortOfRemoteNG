import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  invokeManagement,
  toSafeManagementError,
} from "../../src/utils/security/managementInvoke";
import {
  parseSynologyApiFailure,
  SYNOLOGY_DIAGNOSTIC_MARKER,
} from "../../src/utils/synology/apiFailureDiagnostic";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("managementInvoke", () => {
  it("preserves a closed long first-authentication failure through real error wrapping without raising the limit", async () => {
    const metadata = {
      stage: "authenticated_file_station",
      category: "dsm_api",
      httpStatus: 200,
      contentType: "json",
      bytesRead: 43,
      dsmCode: 119,
    };
    mocks.invoke.mockRejectedValueOnce(
      `Password=private-secret The NAS rejected the API session ID. ${"Check that the requests reach the same DSM server. ".repeat(15)}${SYNOLOGY_DIAGNOSTIC_MARKER}${JSON.stringify(metadata)}`,
    );
    let caught: unknown;
    try {
      await invokeManagement("syn_fs_connect", {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const text = (caught as Error).message;
    expect(text.length).toBeLessThanOrEqual(512);
    expect(text).not.toContain("private-secret");
    expect(parseSynologyApiFailure(text)).toEqual(metadata);
    const repeated = toSafeManagementError(text);
    expect(repeated.length).toBeLessThanOrEqual(512);
    expect(repeated).not.toContain("private-secret");
    expect(parseSynologyApiFailure(repeated)).toEqual(metadata);
  });
  it.each(["v2", "extra", "multiple"])(
    "does not preserve unsupported %s diagnostic payloads",
    (variant) => {
      const data = {
        stage: "api_login",
        category: "html",
        httpStatus: 200,
        contentType: "html",
        bytesRead: 4,
        ...(variant === "extra" ? { body: "private-secret" } : {}),
      };
      const line = SYNOLOGY_DIAGNOSTIC_MARKER + JSON.stringify(data);
      const raw =
        variant === "v2"
          ? line.replace(":v1:", ":v2:")
          : variant === "multiple"
            ? line + line
            : line;
      const safe = toSafeManagementError(raw);
      expect(safe).not.toMatch(/private-secret|synology-diagnostic/);
      expect(parseSynologyApiFailure(safe)).toBeNull();
    },
  );
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
