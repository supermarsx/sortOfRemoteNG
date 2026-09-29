import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCredentialText,
  captureNativeCredentialTarget,
  type NativeCredentialSession,
} from "../../src/utils/security/credentialTyping";

describe("captured native credential input", () => {
  let session: NativeCredentialSession;
  let field: HTMLInputElement;
  let popup: HTMLButtonElement;
  const invoke = vi.fn(async () => undefined);
  const targets: ReturnType<typeof captureNativeCredentialTarget>[] = [];
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.body.innerHTML =
      '<div id="surface"><input /></div><button id="popup">Type</button><input id="other" />';
    field = document.querySelector("input")!;
    popup = document.querySelector("button")!;
    field.focus();
    session = {
      sessionId: "tab",
      backendSessionId: "native-exact",
      shellId: "shell-exact",
      ownerDatabaseId: "owner",
      generation: 1,
      protocol: "ssh",
      connected: true,
      surface: field.parentElement!,
    };
    invoke.mockClear();
  });
  afterEach(() => {
    targets.splice(0).forEach((target) => target.dispose());
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
  const capture = () => {
    const target = captureNativeCredentialTarget(
      () => session,
      (element) => element === popup,
      invoke,
    );
    targets.push(target);
    popup.focus();
    return target;
  };
  it("sends SSH text only to the captured native session with no newline", async () => {
    await capture().type("User päss🔒", () => {});
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "send_ssh_credential_input",
      {
        sessionId: "native-exact",
        data: "User päss🔒",
        expectedShellId: "shell-exact",
      },
    );
  });
  it("sends intact RDP Unicode text for native conversion without using the clipboard", async () => {
    session.protocol = "rdp";
    await capture().type("a!🔒", () => {});
    const [command, args] = invoke.mock.calls[0] as unknown as [
      string,
      {
        sessionId: string;
        data: string;
      },
    ];
    expect(command).toBe("rdp_send_credential_input");
    expect(args.sessionId).toBe("native-exact");
    expect(args.data).toBe("a!🔒");
  });
  it.each([
    "\r",
    "\n",
    "\t",
    "\x1b",
    "\x03",
    "\x7f",
    "\u0085",
    "\u2028",
    "\ud800",
  ])(
    "rejects control or malformed value %j without dispatch",
    async (value) => {
      await expect(capture().type(`pass${value}`, () => {})).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it.each([
    "sessionId",
    "backendSessionId",
    "shellId",
    "ownerDatabaseId",
    "generation",
    "surface",
    "connected",
    "disabled",
    "disconnected",
    "focus",
    "away-back",
    "window-blur",
    "disposed",
  ])("revokes for %s", async (reason) => {
    const target = capture();
    if (reason === "sessionId") session.sessionId = "other";
    if (reason === "backendSessionId") session.backendSessionId = "replacement";
    if (reason === "shellId") session.shellId = "replacement";
    if (reason === "ownerDatabaseId") session.ownerDatabaseId = "other";
    if (reason === "generation") session.generation = 2;
    if (reason === "surface") session.surface = document.createElement("div");
    if (reason === "connected") session.connected = false;
    if (reason === "disabled") field.disabled = true;
    if (reason === "disconnected") field.remove();
    if (reason === "focus" || reason === "away-back")
      document.querySelector<HTMLInputElement>("#other")!.focus();
    if (reason === "away-back") popup.focus();
    if (reason === "window-blur") window.dispatchEvent(new Event("blur"));
    if (reason === "disposed") target.dispose();
    await expect(target.type("password", () => {})).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("fails absent focus before resolving or sending anything", () => {
    popup.focus();
    expect(capture).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("checks disclosure immediately before invoking native input", async () => {
    await expect(
      capture().type("password", () => {
        throw new Error("owner changed");
      }),
    ).rejects.toThrow("owner changed");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["ssh", "rdp"] as const)(
    "does not fall back to ordinary input on an older %s runtime",
    async (protocol) => {
      session.protocol = protocol;
      invoke.mockRejectedValueOnce(new Error("command not found"));
      await expect(capture().type("secret", () => {})).rejects.toThrow(
        "command not found",
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      expect((invoke.mock.calls[0] as unknown as [string])[0]).toContain(
        "credential_input",
      );
    },
  );
  it.each(["ssh", "rdp"] as const)(
    "forwards TOTP validity to the %s native queue boundary",
    async (protocol) => {
      session.protocol = protocol;
      const validity = {
        starts: Date.now() - 1000,
        expires: Date.now() + 20000,
      };
      await capture().type("123456", () => {}, validity);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(
        protocol === "ssh"
          ? "send_ssh_credential_input"
          : "rdp_send_credential_input",
        expect.objectContaining({ validity }),
      );
    },
  );
  it("bounds input before creating native batches", () => {
    expect(() => assertCredentialText("a".repeat(1025))).toThrow();
    expect(() => assertCredentialText("")).toThrow();
  });
  it("sends the maximum RDP text as one bounded batch and rejects oversize without partial input", async () => {
    session.protocol = "rdp";
    const target = capture();
    await target.type("a".repeat(1024), () => {});
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "rdp_send_credential_input",
      { sessionId: "native-exact", data: "a".repeat(1024) },
    );
    invoke.mockClear();
    await expect(target.type("a".repeat(1025), () => {})).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
