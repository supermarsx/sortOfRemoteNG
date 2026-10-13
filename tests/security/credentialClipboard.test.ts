import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copySecretToClipboard,
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
    // A fixed clock: the lifetime is whole seconds of what is left, so a
    // stall between two wall-clock reads could otherwise change the answer.
    const now = 100_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const invoke = vi.fn();
      transport.getInvoke.mockResolvedValue(invoke);
      const write = await prepareCredentialClipboard();
      await write("123456", "totpCode", () => {}, { expires: now + 2500 });
      expect(invoke).toHaveBeenCalledWith("secure_clip_copy", {
        request: expect.objectContaining({ clearAfterSecs: 3 }),
      });
      invoke.mockClear();
      await expect(
        write("123456", "totpCode", () => {}, { expires: now - 1 }),
      ).rejects.toThrow("expired");
      // The instant of expiry is already too late.
      await expect(
        write("123456", "totpCode", () => {}, { expires: now }),
      ).rejects.toThrow("expired");
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
});

describe("typed clipboard outcomes", () => {
  const sentences = {
    locked: "Nothing was copied because the app is locked.",
    busy: "another program is using the clipboard",
    "too-large": "too large for the secure clipboard",
    unavailable: "Check the secure clipboard settings",
  } as const;
  it.each(Object.keys(sentences) as (keyof typeof sentences)[])(
    "names the native %s refusal, as a bare code or a coded object",
    async (code) => {
      for (const rejection of [code, { code }]) {
        const invoke = vi.fn().mockRejectedValue(rejection);
        transport.getInvoke.mockResolvedValue(invoke);
        const write = await prepareCredentialClipboard();
        const error = await write("SYNTHETIC", "password", () => {}).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(CredentialClipboardError);
        expect(error).toMatchObject({ code: `clipboard-${code}` });
        expect((error as Error).message).toContain(sentences[code]);
      }
      expect(webWrite).not.toHaveBeenCalled();
    },
  );
  it.each([
    "Secure clipboard is unavailable while the app is locked",
    "LOCKED",
    " locked",
    "toString",
    new Error("locked"),
    { code: "constructor" },
    { reason: "locked" },
    null,
  ])("treats the unrecognised rejection %j as unavailable", async (value) => {
    const invoke = vi.fn().mockRejectedValue(value);
    transport.getInvoke.mockResolvedValue(invoke);
    const write = await prepareCredentialClipboard();
    const error = await write("SYNTHETIC", "password", () => {}).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "clipboard-unavailable" });
    expect((error as Error).message).toBe(
      new CredentialClipboardError().message,
    );
  });
  it("types the expired-code and empty-value refusals without a write", async () => {
    const invoke = vi.fn();
    transport.getInvoke.mockResolvedValue(invoke);
    const write = await prepareCredentialClipboard();
    await expect(
      write("123456", "totpCode", () => {}, { expires: Date.now() - 1 }),
    ).rejects.toMatchObject({ code: "code-expired" });
    await expect(write("", "password", () => {})).rejects.toMatchObject({
      code: "clipboard-empty",
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(webWrite).not.toHaveBeenCalled();
  });
  it("stops waiting for a native write that never answers", async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn(() => new Promise(() => {}));
      transport.getInvoke.mockResolvedValue(invoke);
      const write = await prepareCredentialClipboard();
      const settled = vi.fn();
      const outcome = write("SYNTHETIC", "password", () => {})
        .catch((caught: unknown) => caught)
        .finally(settled);
      // The engine's own helpers may take seconds: it is not given up early.
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatchObject({ code: "clipboard-timed-out" });
      expect(vi.getTimerCount()).toBe(0);
      expect(webWrite).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops waiting for a desktop bridge that never answers", async () => {
    vi.useFakeTimers();
    try {
      transport.getInvoke.mockReturnValue(new Promise(() => {}));
      const settled = vi.fn();
      const outcome = prepareCredentialClipboard()
        .catch((caught: unknown) => caught)
        .finally(settled);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toMatchObject({ code: "clipboard-timed-out" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("one-call secret copy", () => {
  it.each([
    ["password", "password", "password"],
    ["username", "username", "username"],
    ["totpCode", "totpCode", "totpCode"],
    ["apiKey", "apiKey", "apiKey"],
    ["recoveryCode", "genericSecret", "recoveryCode"],
    ["secret", "genericSecret", "secret"],
  ] as const)(
    "copies a %s through the native clipboard as %s",
    async (kind, wireKind, field) => {
      const invoke = vi.fn().mockResolvedValue({});
      transport.getInvoke.mockResolvedValue(invoke);
      await expect(
        copySecretToClipboard("SYNTHETIC", kind, { connectionId: "c" }),
      ).resolves.toEqual({ ok: true });
      expect(invoke).toHaveBeenCalledExactlyOnceWith("secure_clip_copy", {
        request: {
          value: "SYNTHETIC",
          kind: wireKind,
          field,
          connectionId: "c",
          label: null,
          clearAfterSecs: null,
          maxPastes: null,
          oneTime: false,
        },
      });
      expect(webWrite).not.toHaveBeenCalled();
    },
  );
  it("bounds a one-time code's clipboard lifetime by its expiry", async () => {
    const now = 100_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const invoke = vi.fn().mockResolvedValue({});
      transport.getInvoke.mockResolvedValue(invoke);
      // 8.2 s left rounds up to 9; more than 30 s is capped at 30.
      await copySecretToClipboard("123456", "totpCode", {
        expires: now + 8200,
      });
      expect(invoke).toHaveBeenLastCalledWith("secure_clip_copy", {
        request: expect.objectContaining({ clearAfterSecs: 9 }),
      });
      await copySecretToClipboard("123456", "totpCode", {
        expires: now + 45_000,
      });
      expect(invoke).toHaveBeenLastCalledWith("secure_clip_copy", {
        request: expect.objectContaining({ clearAfterSecs: 30 }),
      });
    } finally {
      clock.mockRestore();
    }
  });
  it("reports a refusal as an outcome and never rejects or falls back", async () => {
    const invoke = vi.fn().mockRejectedValue("locked");
    transport.getInvoke.mockResolvedValue(invoke);
    const refused = await copySecretToClipboard("SYNTHETIC", "apiKey");
    expect(refused).toEqual({
      ok: false,
      code: "clipboard-locked",
      message: expect.stringContaining("the app is locked"),
    });
    transport.getInvoke.mockRejectedValue(new Error("SYNTHETIC_BRIDGE_DETAIL"));
    const unavailable = await copySecretToClipboard("SYNTHETIC", "apiKey");
    expect(unavailable).toMatchObject({
      ok: false,
      code: "clipboard-unavailable",
    });
    expect(JSON.stringify([refused, unavailable])).not.toContain("SYNTHETIC");
    expect(await copySecretToClipboard("", "recoveryCode")).toMatchObject({
      ok: false,
      code: "clipboard-empty",
    });
    expect(webWrite).not.toHaveBeenCalled();
  });
});
