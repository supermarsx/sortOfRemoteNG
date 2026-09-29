/** A captured destination, never a credential or a clipboard operation. */
export interface CredentialTypingTarget {
  readonly sessionId: string;
  assertCurrent: () => void;
  type: (
    value: string,
    assertDisclosure: () => void,
    validity?: CredentialCodeValidity,
  ) => Promise<void>;
  dispose: () => void;
}
export interface CredentialCodeValidity {
  starts: number;
  expires: number;
}

export const typingUnavailable =
  "The typing target changed or is unavailable. Focus the session field and reopen Credentials & 2FA.";

/** Reject terminal controls as well as line separators; never silently strip them. */
export function assertCredentialText(value: string): void {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1024 ||
    Array.from(value).some((character) => {
      const point = character.codePointAt(0)!;
      return (
        point <= 0x1f ||
        (point >= 0x7f && point <= 0x9f) ||
        point === 0x2028 ||
        point === 0x2029 ||
        (point >= 0xd800 && point <= 0xdfff)
      );
    })
  )
    throw new Error("This value cannot be typed safely without control keys.");
}

/** Capture synchronously on pointer-down, before opening/focusing the popup.
 * Only the captured surface and this popup may receive focus until disposal.
 * The caller supplies its own popup containment check, never a global selector. */
export function captureCredentialFocus(
  surface: HTMLElement,
  isPopupControl: (element: Element) => boolean,
) {
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  const element = doc.activeElement;
  let revoked = false;
  const usable = () =>
    surface.isConnected &&
    element instanceof Element &&
    element.isConnected &&
    surface.contains(element) &&
    !element.matches(":disabled,[aria-disabled=true],[readonly]");
  if (!win || !usable() || doc.hidden || !doc.hasFocus())
    throw new Error(typingUnavailable);
  const revoke = () => {
    revoked = true;
  };
  const focus = (event: FocusEvent) => {
    if (
      event.target !== element &&
      (!(event.target instanceof Element) || !isPopupControl(event.target))
    )
      revoke();
  };
  doc.addEventListener("focusin", focus, true);
  doc.addEventListener("visibilitychange", revoke);
  win.addEventListener("blur", revoke);
  const assertCurrent = () => {
    const active = doc.activeElement;
    if (
      revoked ||
      !usable() ||
      doc.hidden ||
      !doc.hasFocus() ||
      (active !== element && (!active || !isPopupControl(active)))
    )
      throw new Error(typingUnavailable);
  };
  return {
    assertCurrent,
    dispose: () => {
      revoke();
      doc.removeEventListener("focusin", focus, true);
      doc.removeEventListener("visibilitychange", revoke);
      win.removeEventListener("blur", revoke);
    },
  };
}

export interface NativeCredentialSession {
  sessionId: string;
  backendSessionId: string;
  shellId?: string;
  ownerDatabaseId: string;
  /** Include native lifecycle generation/shell identity, not just display IDs. */
  generation: string | number;
  protocol: "ssh" | "rdp";
  connected: boolean;
  surface: HTMLElement;
}

type NativeInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Uses credential-only native input commands. In particular, RDP uses Unicode input,
 * never the digits-only TOTP scancode handler or clipboard redirection. */
export function captureNativeCredentialTarget(
  current: () => NativeCredentialSession | null,
  isPopupControl: (element: Element) => boolean,
  invoke: NativeInvoke,
): CredentialTypingTarget {
  const initial = current();
  if (
    !initial?.connected ||
    !initial.backendSessionId ||
    !initial.ownerDatabaseId ||
    (initial.protocol === "ssh" && !initial.shellId)
  )
    throw new Error(typingUnavailable);
  const captured = { ...initial };
  const focus = captureCredentialFocus(captured.surface, isPopupControl);
  const assertCurrent = () => {
    focus.assertCurrent();
    const next = current();
    if (
      !next?.connected ||
      next.sessionId !== captured.sessionId ||
      next.backendSessionId !== captured.backendSessionId ||
      next.shellId !== captured.shellId ||
      next.ownerDatabaseId !== captured.ownerDatabaseId ||
      next.protocol !== captured.protocol ||
      next.generation !== captured.generation ||
      next.surface !== captured.surface
    )
      throw new Error(typingUnavailable);
  };
  return {
    sessionId: captured.sessionId,
    assertCurrent,
    dispose: focus.dispose,
    type: async (value, assertDisclosure, validity) => {
      assertCredentialText(value);
      // One bounded native dispatch. Unicode conversion happens in Rust; no
      // clipboard or frontend input queue retaining the value.
      const args =
        captured.protocol === "ssh"
          ? {
              sessionId: captured.backendSessionId,
              data: value,
              expectedShellId: captured.shellId,
              ...(validity ? { validity } : {}),
            }
          : {
              sessionId: captured.backendSessionId,
              data: value,
              ...(validity ? { validity } : {}),
            };
      assertDisclosure();
      assertCurrent();
      await invoke(
        captured.protocol === "ssh"
          ? "send_ssh_credential_input"
          : "rdp_send_credential_input",
        args,
      );
    },
  };
}
