import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureNativeCredentialTarget,
  type NativeCredentialSession,
} from "../../src/utils/security/credentialTyping";

// The native command types the whole value as one uninterrupted run and only
// then resolves (sorng-rdp `rdp_send_credential_input`). These tests pin the
// frontend half of that contract: one call, the whole value, no second attempt.

/** Obviously synthetic text of exactly `units` UTF-16 units. */
const alphabet = "synthetic-Pä55wörd-€字-";
const synthetic = (units: number) =>
  Array.from(
    { length: units },
    (_, index) => alphabet[index % alphabet.length],
  ).join("");

describe("RDP credential input", () => {
  let session: NativeCredentialSession;
  let popup: HTMLButtonElement;
  const invoke =
    vi.fn<
      (command: string, args: Record<string, unknown>) => Promise<unknown>
    >();
  const targets: ReturnType<typeof captureNativeCredentialTarget>[] = [];

  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.body.innerHTML =
      '<div id="surface"><canvas tabindex="0"></canvas></div><button id="popup">Type</button>';
    const canvas = document.querySelector("canvas")!;
    popup = document.querySelector("button")!;
    canvas.focus();
    // The shape `useRDPClient` hands to `captureNativeCredentialTarget`.
    session = {
      sessionId: "tab",
      backendSessionId: "rdp-backend-session",
      ownerDatabaseId: "owner",
      generation: "1:0:1",
      protocol: "rdp",
      connected: true,
      surface: canvas.parentElement!,
    };
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
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

  it.each([
    ["one unit", synthetic(1)],
    ["one PDU exactly (127 units)", synthetic(127)],
    ["one unit past a PDU (128 units)", synthetic(128)],
    ["129 units", synthetic(129)],
    ["two PDUs exactly (254 units)", synthetic(254)],
    ["500 units", synthetic(500)],
    ["the 1024-unit limit", synthetic(1024)],
    ["a surrogate pair across the PDU boundary", `${synthetic(126)}🔒tail`],
    ["512 surrogate pairs", "🔒".repeat(512)],
  ])("hands %s to the native command whole, in one call", async (_, value) => {
    await capture().type(value, () => {});
    // Splitting here would let other input land between the pieces.
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "rdp_send_credential_input",
      { sessionId: "rdp-backend-session", data: value },
    );
  });

  it("reports nothing until the native command has settled", async () => {
    let settle!: () => void;
    invoke.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    const done = vi.fn();
    const typing = capture()
      .type(synthetic(300), () => {})
      .then(done);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    settle();
    await typing;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each([
    "rdp-credential-input-not-sent: the session did not accept the input and nothing was typed",
    "rdp-credential-input-incomplete: typing stopped after 127 of 300 UTF-16 units and will not be resumed or repeated",
  ])(
    "fails without a second attempt when the session answers %j",
    async (reason) => {
      // Tauri rejects with the command's error string itself.
      invoke.mockRejectedValueOnce(reason);
      await expect(
        capture().type(synthetic(300), () => {}),
      ).rejects.toBeDefined();
      // A retry or an ordinary-input fallback could type half a password twice.
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0][0]).toBe("rdp_send_credential_input");
    },
  );

  it("is wired in useRDPClient straight to the native command, with no fallback and no swallowed failure", () => {
    const hook = readFileSync("src/hooks/rdp/useRDPClient.ts", "utf8");
    const start = hook.indexOf("const captureCredentialTarget = (");
    const end = hook.indexOf("// ─── SSH-tunnel", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const credentialPath = hook.slice(start, end);

    expect(credentialPath).toContain("captureNativeCredentialTarget(");
    expect(credentialPath).toContain('protocol: "rdp" as const');
    // The hook's own `invoke`, unwrapped: its rejection must reach the caller.
    expect(credentialPath).toMatch(/isPopupControl,\s*invoke,\s*\)/);
    expect(credentialPath).not.toMatch(/\.catch\(|rdp_send_input|sendInput\(/);
    // Typing is offered only to a live, rendered, keyboard-enabled session.
    for (const gate of ["isConnected", "isRenderActive", "keyboardEnabled"])
      expect(credentialPath).toContain(`credentialRuntimeRef.current.${gate}`);
  });
});
