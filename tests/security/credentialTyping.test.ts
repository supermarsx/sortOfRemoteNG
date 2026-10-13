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
    await expect(target.type("password", () => {})).rejects.toMatchObject({
      code: "typing-target-lost",
      partial: false,
    });
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
    "does not fall back to ordinary input on an older %s runtime, and names the refusal without native text",
    async (protocol) => {
      session.protocol = protocol;
      invoke.mockRejectedValueOnce(new Error("SYNTHETIC command not found"));
      const error = await capture()
        .type("secret", () => {})
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "typing-rejected", partial: false });
      expect((error as Error).message).toBe(
        "The session did not accept the input. Review the field before trying again.",
      );
      expect(invoke).toHaveBeenCalledTimes(1);
      expect((invoke.mock.calls[0] as unknown as [string])[0]).toContain(
        "credential_input",
      );
    },
  );
  it.each([
    [
      "rdp-credential-input-not-sent: the session did not accept the input and nothing was typed",
      "typing-rejected",
      false,
    ],
    [
      "rdp-credential-input-incomplete: typing stopped after 127 of 300 UTF-16 units and will not be resumed or repeated",
      "typing-not-confirmed",
      true,
    ],
    ["rdp-credential-input-incomplete", "typing-not-confirmed", true],
    // Only the exact code counts: a look-alike is an ordinary refusal.
    ["rdp-credential-input-incomplete-ish: 1 of 2", "typing-rejected", false],
    ["RDP session not found", "typing-rejected", false],
  ] as const)(
    "reads only the code of the RDP refusal %j",
    async (rejection, code, partial) => {
      session.protocol = "rdp";
      invoke.mockRejectedValueOnce(rejection);
      const error = await capture()
        .type("secret", () => {})
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code, partial });
      expect((error as Error).message).not.toMatch(/127|300|UTF-16|not found/);
      expect((error as Error).message.includes("may have been entered")).toBe(
        partial,
      );
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["ssh", "rdp"] as const)(
    "reports %s input as sent, not typed: the queue accepted it, the remote did not confirm it",
    (protocol) => {
      session.protocol = protocol;
      expect(capture().confirmation).toBe("sent");
    },
  );
  it.each(["ssh", "rdp"] as const)(
    "stops waiting for a %s queue that never answers and warns about partial input",
    async (protocol) => {
      session.protocol = protocol;
      const target = capture();
      vi.useFakeTimers();
      try {
        invoke.mockReturnValueOnce(new Promise<undefined>(() => {}));
        const settled = vi.fn();
        const outcome = target
          .type("secret", () => {})
          .catch((caught: unknown) => caught)
          .finally(settled);
        // Well above the two seconds the RDP session has to pick the input
        // up, so the engine's exact answer always arrives first.
        await vi.advanceTimersByTimeAsync(9_999);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        const error = await outcome;
        expect(error).toMatchObject({
          code: "typing-not-confirmed",
          partial: true,
        });
        expect((error as Error).message).toContain(
          "Some characters may have been entered",
        );
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it.each([
    ["a tab", "pass\tword", "text-control-character", "tab, line break"],
    ["a line break", "pass\nword", "text-control-character", "tab, line break"],
    ["1025 characters", "a".repeat(1025), "text-too-long", "1024 characters"],
    ["nothing", "", "text-empty", "nothing to type"],
  ])(
    "names %s as its own cause without dispatch",
    async (_name, value, code, sentence) => {
      const error = await capture()
        .type(value, () => {})
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code });
      expect((error as Error).message).toContain(sentence);
      expect(invoke).not.toHaveBeenCalled();
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
