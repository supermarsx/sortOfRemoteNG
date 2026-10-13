import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OriginCredentialControls from "../../src/components/protocol/webBrowser/OriginCredentialControls";
import { PopoverSurface } from "../../src/components/ui/overlays/PopoverSurface";
import type { ToastUpdate } from "../../src/components/ui/dialogs/Toast";
import type {
  OriginCredentialInputRequest,
  OriginCredentialInputReply,
} from "../../src/types/protocols/originCredentialTyping";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseDataTarget } from "../../src/utils/connection/databaseManager";

// The real useCredentialCopy and useOriginCredentialTyping run here: only the
// database, the clipboard bridge, the toast sink and the code-list shells are
// replaced. Every value is synthetic and no OS clipboard is touched.
const mock = vi.hoisted(() => ({
  connections: [] as unknown[],
  target: undefined as unknown,
  nativeInvoke: vi.fn(),
  native: false,
  loading: vi.fn<(message: string) => string>(),
  update: vi.fn<(id: string, patch: unknown) => void>(),
  remove: vi.fn<(id: string) => void>(),
}));
vi.mock("../../src/contexts/ToastContext", () => {
  const toast = {
    info: vi.fn(),
    loading: mock.loading,
    update: mock.update,
    remove: mock.remove,
  };
  return { useToastContext: () => ({ toast }) };
});
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: mock.connections, sessions: [] },
    databaseAvailability: { status: "ready", databaseId: "db", generation: 1 },
    credentialVault: undefined,
    getCurrentConnections: () => mock.connections,
  }),
}));
vi.mock("../../src/contexts/SessionRenderActivityContext", () => ({
  useSessionRenderActivity: () => ({ isActive: true }),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      captureCurrentDatabaseDataTarget: () => mock.target,
      getCurrentDatabase: () => ({ id: "db" }),
      onCurrentDatabaseChange: () => () => {},
    }),
  },
  onDatabaseAccessChange: () => () => {},
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (mock.native ? mock.nativeInvoke : null),
}));
vi.mock("../../src/components/protocol/webBrowser/WebTotpPanel", () => ({
  default: (props: Record<string, any>) => (
    <PopoverSurface
      isOpen
      anchorRef={props.anchorRef}
      onClose={props.onClose}
      className={props.className}
    >
      <section aria-label="Credentials & 2FA" ref={props.typingRef}>
        <button onClick={props.onClose}>Close Credentials &amp; 2FA</button>
        {props.credentialActions}
      </section>
    </PopoverSurface>
  ),
}));

const identity = {
  ownerDatabaseId: "db",
  connectionId: "connection",
  sessionId: "tab",
  attemptId: "attempt",
};
const session = {
  id: "tab",
  connectionId: "connection",
  ownerDatabaseId: "db",
  protocol: "https",
  hostname: "example.test",
  status: "connected",
} as ConnectionSession;
const webWrite = vi.fn();
let connection: Connection;
let persisted: Connection;
let target: DatabaseDataTarget;

function Harness({
  transport,
}: {
  transport: (
    request: OriginCredentialInputRequest,
  ) => Promise<OriginCredentialInputReply>;
}) {
  const [overlay, setOverlay] = useState(false);
  return (
    <OriginCredentialControls
      session={session}
      connection={connection}
      eligible
      canOpen={!overlay}
      assertOwner={() => {}}
      onOverlayChange={setOverlay}
      typingOptions={{
        identity,
        viewId: null,
        documentKey: "page",
        enabled: true,
        interactive: !overlay,
        transport,
        runInteractive: async (_identity, _view, check, mutate) => {
          check();
          return mutate(2);
        },
      }}
    />
  );
}
function engine() {
  return vi.fn(
    async (
      request: OriginCredentialInputRequest,
    ): Promise<OriginCredentialInputReply> => ({
      status:
        request.action.kind === "capture"
          ? "captured"
          : request.action.kind === "type"
            ? "complete"
            : "cancelled",
      captureId: "receipt",
    }),
  );
}
const lastToast = () =>
  mock.update.mock.calls[mock.update.mock.calls.length - 1]?.[1] as ToastUpdate;
const typedText = (request: ReturnType<typeof engine>) =>
  request.mock.calls
    .map(([r]) => r.action)
    .filter((action) => action.kind === "type")
    .map((action) => (action.kind === "type" ? action.text : ""));
async function open() {
  const trigger = screen.getByRole("button", { name: "Credentials & 2FA" });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  if (vi.isFakeTimers())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
  else await screen.findByRole("region", { name: "Credentials & 2FA" });
}
/** The toast's closing update is the only one that sets a dismissal time. */
async function settled() {
  await waitFor(() => expect(lastToast()?.duration).toBe(5000));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.loading.mockReturnValue("typing-toast");
  mock.native = false;
  mock.nativeInvoke.mockReset().mockResolvedValue({});
  vi.stubGlobal("PointerEvent", MouseEvent);
  connection = {
    id: "connection",
    name: "Test",
    protocol: "https",
    hostname: "example.test",
    port: 443,
    isGroup: false,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    username: "STALE_USER",
    password: "STALE_VALUE",
  } as Connection;
  persisted = {
    ...connection,
    username: "SYNTHETIC_USER",
    password: "SYNTHETIC_VALUE",
  };
  target = {
    databaseId: "db",
    assertAccessible: vi.fn(),
    verifyCurrent: vi.fn(async () => {}),
    readCurrent: vi.fn(async () => ({ connections: [persisted] })),
  } as unknown as DatabaseDataTarget;
  mock.connections = [connection];
  mock.target = target;
  webWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: webWrite },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("native credential toolbar with the real credential resolver", () => {
  it("resolves the saved value only after capture, types it and reports completion", async () => {
    const request = engine();
    render(<Harness transport={request} />);
    await open();
    expect(target.readCurrent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await settled();
    expect(request.mock.calls[0][0].action).toEqual({ kind: "capture" });
    expect(typedText(request)).toEqual(["SYNTHETIC_VALUE"]);
    expect(lastToast()).toMatchObject({
      type: "success",
      message: "Typing completed.",
    });
    expect(JSON.stringify(mock.update.mock.calls)).not.toContain("SYNTHETIC");
    expect(document.body.textContent).not.toContain("SYNTHETIC");
    expect(webWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["empty-password", "No password is saved for this credential."],
    [
      "database-locked",
      "The owning database is closed or locked. Open and unlock it, then try again.",
    ],
    [
      "tab-character",
      "This value contains a tab, line break or another control character, so it cannot be typed. Copy it instead.",
    ],
    [
      "saved-row-changed",
      "The saved connection changed while its credential was being read. Reopen Credentials & 2FA and try again.",
    ],
  ])(
    "reports a pre-typing %s failure as a warning with its cause, never as Typing stopped",
    async (cause, sentence) => {
      const request = engine();
      if (cause === "empty-password") persisted.password = "";
      if (cause === "tab-character") persisted.password = "SYN\tTHETIC";
      if (cause === "saved-row-changed") persisted.hostname = "changed.test";
      render(<Harness transport={request} />);
      await open();
      if (cause === "database-locked")
        request.mockImplementationOnce(async () => {
          // The database locks while the user is choosing a field.
          vi.mocked(target.assertAccessible!).mockImplementation(() => {
            throw new Error("SYNTHETIC_LOCK_DETAIL");
          });
          return { status: "captured", captureId: "receipt" };
        });
      fireEvent.click(screen.getByRole("button", { name: "Type password" }));
      await settled();
      expect(lastToast()).toMatchObject({ type: "warning", message: sentence });
      expect(typedText(request)).toEqual([]);
      // The captured field is released rather than left armed.
      expect(
        request.mock.calls.filter(([r]) => r.action.kind === "cancel"),
      ).toHaveLength(1);
      expect(JSON.stringify(mock.update.mock.calls)).not.toMatch(
        /Typing stopped|SYNTHETIC/,
      );
      // The popup returns with the same cause and working controls.
      expect(await screen.findByText(sentence)).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Type username" }),
      ).toBeEnabled();
    },
  );

  it("still says Typing stopped when the user cancels while choosing a field", async () => {
    const request = engine();
    request.mockResolvedValue({ status: "waiting", captureId: "" });
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await waitFor(() => expect(lastToast()?.action).toBeDefined());
    act(() => lastToast().action!.onClick());
    await settled();
    expect(lastToast()).toMatchObject({
      type: "info",
      message: "Typing stopped.",
    });
    expect(target.readCurrent).not.toHaveBeenCalled();
  });

  it("names the engine's reason when the website field is no longer empty", async () => {
    const request = engine();
    request.mockImplementation(async (r) => {
      if (r.action.kind === "type") throw "field-not-empty";
      return {
        status: r.action.kind === "capture" ? "captured" : "cancelled",
        captureId: "receipt",
      };
    });
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Type username" }));
    await settled();
    expect(lastToast()).toMatchObject({
      type: "warning",
      message:
        "The selected website field already contains text. Clear it, then choose Type again.",
    });
  });

  it("copies through the injected clipboard and names a native refusal", async () => {
    const request = engine();
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    expect(await screen.findByText("Password copied.")).toBeVisible();
    expect(webWrite).toHaveBeenCalledExactlyOnceWith("SYNTHETIC_VALUE");
    mock.native = true;
    mock.nativeInvoke.mockRejectedValue("locked");
    fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
    expect(
      await screen.findByText(
        "Nothing was copied because the app is locked. Unlock it and try again.",
      ),
    ).toBeVisible();
    expect(webWrite).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(mock.loading).not.toHaveBeenCalled();
  });

  it("stops a credential read that never answers and lets the next Type work", async () => {
    vi.useFakeTimers();
    const request = engine();
    vi.mocked(target.readCurrent!).mockReturnValueOnce(new Promise(() => {}));
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(lastToast().message).toBe("Preparing credential…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(lastToast()).toMatchObject({
      type: "warning",
      message:
        "Reading the credential took too long and was stopped. Check the owning database, then try again.",
    });
    expect(typedText(request)).toEqual([]);
    const type = screen.getByRole("button", { name: "Type password" });
    expect(type).toBeEnabled();
    fireEvent.click(type);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(typedText(request)).toEqual(["SYNTHETIC_VALUE"]);
    expect(lastToast()).toMatchObject({
      type: "success",
      message: "Typing completed.",
    });
  });
});
