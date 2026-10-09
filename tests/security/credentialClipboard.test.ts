import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CredentialClipboardError,
  prepareCredentialClipboard,
} from "../../src/utils/security/credentialClipboard";

const transport = vi.hoisted(() => ({ getInvoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: transport.getInvoke,
}));
const webWrite = vi.fn();
beforeEach(() => {
  transport.getInvoke.mockReset().mockResolvedValue(null);
  webWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: webWrite },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("credential clipboard transport", () => {
  it.each(["username", "password", "totpCode"] as const)(
    "uses the native clipboard for %s even when web clipboard access fails",
    async (kind) => {
      const invoke = vi.fn().mockResolvedValue({});
      transport.getInvoke.mockResolvedValue(invoke);
      webWrite.mockRejectedValue(
        new DOMException("Not focused", "NotAllowedError"),
      );
      const write = await prepareCredentialClipboard();
      const guard = vi.fn();
      await write("SYNTHETIC", kind, guard, { connectionId: "connection" });
      expect(guard).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenCalledExactlyOnceWith("secure_clip_copy", {
        request: {
          value: "SYNTHETIC",
          kind,
          field: kind,
          connectionId: "connection",
          label: null,
          clearAfterSecs: null,
          maxPastes: null,
          oneTime: false,
        },
      });
      expect(webWrite).not.toHaveBeenCalled();
    },
  );
  it("does not bypass native clipboard policy after a denial", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("PRIVATE_DENIAL"));
    transport.getInvoke.mockResolvedValue(invoke);
    const write = await prepareCredentialClipboard();
    await expect(write("SYNTHETIC", "password", () => {})).rejects.toThrow(
      CredentialClipboardError,
    );
    expect(webWrite).not.toHaveBeenCalled();
  });
  it.each(["__TAURI_INTERNALS__", "__TAURI__"])(
    "rejects missing native transport before requesting credentials (%s)",
    async (marker) => {
      vi.stubGlobal(marker, {});
      await expect(prepareCredentialClipboard()).rejects.toThrow(
        CredentialClipboardError,
      );
      expect(webWrite).not.toHaveBeenCalled();
    },
  );
  it("redacts bridge discovery errors as clipboard failures", async () => {
    transport.getInvoke.mockRejectedValue(new Error("SYNTHETIC_BRIDGE_DETAIL"));
    await expect(prepareCredentialClipboard()).rejects.toEqual(
      new CredentialClipboardError(),
    );
    expect(webWrite).not.toHaveBeenCalled();
  });
  it("rejects an unavailable web clipboard during preparation", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await expect(prepareCredentialClipboard()).rejects.toThrow(
      CredentialClipboardError,
    );
  });
  it("redacts a denied web clipboard getter before requesting credentials", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => {
        throw new DOMException("SYNTHETIC_SECURITY_DETAIL", "SecurityError");
      },
    });
    await expect(prepareCredentialClipboard()).rejects.toEqual(
      new CredentialClipboardError(),
    );
    expect(webWrite).not.toHaveBeenCalled();
  });
  it("keeps a prepared web writer from bypassing a newly detected desktop runtime", async () => {
    const write = await prepareCredentialClipboard();
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    await expect(write("SYNTHETIC", "username", () => {})).rejects.toThrow(
      CredentialClipboardError,
    );
    expect(webWrite).not.toHaveBeenCalled();
  });
  it("uses the browser clipboard in the ordinary web preview", async () => {
    const write = await prepareCredentialClipboard();
    await write("SYNTHETIC", "username", () => {});
    expect(webWrite).toHaveBeenCalledExactlyOnceWith("SYNTHETIC");
  });
  it("rechecks owner immediately before dispatch and blocks revoked access", async () => {
    const invoke = vi.fn();
    transport.getInvoke.mockResolvedValue(invoke);
    const write = await prepareCredentialClipboard();
    await expect(
      write("SYNTHETIC", "password", () => {
        throw new Error("revoked");
      }),
    ).rejects.toThrow("revoked");
    expect(invoke).not.toHaveBeenCalled();
    expect(webWrite).not.toHaveBeenCalled();
  });
  it("limits TOTP clipboard lifetime to the remaining code window", async () => {
    const invoke = vi.fn();
    transport.getInvoke.mockResolvedValue(invoke);
    const write = await prepareCredentialClipboard();
    await write("123456", "totpCode", () => {}, { expires: Date.now() + 2500 });
    expect(invoke).toHaveBeenCalledWith("secure_clip_copy", {
      request: expect.objectContaining({ clearAfterSecs: 3 }),
    });
    invoke.mockClear();
    await expect(
      write("123456", "totpCode", () => {}, { expires: Date.now() - 1 }),
    ).rejects.toThrow("expired");
    expect(invoke).not.toHaveBeenCalled();
  });
});
