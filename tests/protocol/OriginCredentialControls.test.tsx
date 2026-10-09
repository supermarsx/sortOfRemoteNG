import React, { useRef, useState } from "react";
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
import type { CredentialTypingTarget } from "../../src/utils/security/credentialTyping";
import type {
  OriginCredentialInputRequest,
  OriginCredentialInputReply,
} from "../../src/types/protocols/originCredentialTyping";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";

const mock = vi.hoisted(() => ({
  copy: vi.fn(),
  type: vi.fn(),
  code: vi.fn(),
  unmount: vi.fn(),
  info: vi.fn(),
  loading: vi.fn<(message: string) => string>(),
  update: vi.fn<(id: string, patch: ToastUpdate) => void>(),
  remove: vi.fn<(id: string) => void>(),
}));
vi.mock("../../src/contexts/ToastContext", () => {
  const toast = {
    info: mock.info,
    loading: mock.loading,
    update: mock.update,
    remove: mock.remove,
  };
  return { useToastContext: () => ({ toast }) };
});
vi.mock("../../src/hooks/security/useCredentialCopy", () => ({
  useCredentialCopy: (
    _session: unknown,
    _connection: unknown,
    target?: CredentialTypingTarget | null,
  ) => ({
    available: true,
    typingAvailable: !!target,
    busy: false,
    message: "",
    copy: mock.copy,
    type: async (field: string) => {
      mock.type(field);
      await target!.type("selected-value", () => {});
    },
    typeCode: async (selection: unknown) => {
      mock.code(selection);
      await target!.type("123456", () => {}, {
        starts: Date.now() - 100,
        expires: Date.now() + 30000,
      });
    },
  }),
}));
vi.mock("../../src/hooks/security/useRuntimeVaultTotp", () => ({
  useRuntimeVaultTotp: () => ({}),
}));
vi.mock("../../src/components/protocol/webBrowser/WebTotpPanel", () => ({
  default: (props: Record<string, any>) => <Panel {...props} index={0} />,
}));
vi.mock("../../src/components/security/RuntimeVaultTotpPanel", () => ({
  default: (props: Record<string, any>) => (
    <Panel {...props} index="vault-code" />
  ),
}));
function Panel(props: Record<string, any>) {
  React.useEffect(() => () => mock.unmount(), []);
  return (
    <PopoverSurface
      isOpen
      anchorRef={props.anchorRef}
      onClose={props.onClose}
      className={props.className}
    >
      <section aria-label="Credentials & 2FA" ref={props.typingRef}>
        <button onClick={props.onClose}>Close Credentials &amp; 2FA</button>
        {props.credentialActions}
        {props.renderTypeCode?.(props.index)}
      </section>
    </PopoverSurface>
  );
}
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
function Harness({
  transport,
  vault = false,
}: {
  transport: (
    request: OriginCredentialInputRequest,
  ) => Promise<OriginCredentialInputReply>;
  vault?: boolean;
}) {
  const [overlay, setOverlay] = useState(false);
  const connection = useRef({
    id: "connection",
    name: "Test",
    protocol: "https",
    hostname: "example.test",
    ...(vault
      ? { credentialSource: { kind: "vault", credentialId: "credential" } }
      : {}),
  } as Connection);
  return (
    <>
      <output data-testid="overlay">{String(overlay)}</output>
      <OriginCredentialControls
        session={session}
        connection={connection.current}
        eligible
        canOpen={!overlay}
        assertOwner={() => {}}
        onOverlayChange={setOverlay}
        typingOptions={{
          identity,
          viewId: "child",
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
    </>
  );
}
function transport() {
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
beforeEach(() => {
  vi.clearAllMocks();
  mock.loading.mockReturnValue("typing-toast");
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function open() {
  const trigger = screen.getByRole("button", { name: "Credentials & 2FA" });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  if (vi.isFakeTimers()) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(
      screen.getByRole("region", { name: "Credentials & 2FA" }),
    ).toBeTruthy();
    return;
  }
  await screen.findByRole("region", { name: "Credentials & 2FA" });
}

function cancelNotification() {
  const updates = mock.update.mock.calls.filter(([, patch]) => patch.action);
  const action = updates[updates.length - 1]?.[1].action;
  expect(action?.label).toBe("Cancel typing");
  act(() => action!.onClick());
}

describe("native credential toolbar parity", () => {
  it.each([false, true])(
    "opens, copies and reopens silently without native capture (vault: %s)",
    async (vault) => {
      const request = transport();
      request.mockRejectedValue(new Error("sensitive backend text"));
      render(
        <React.StrictMode>
          <Harness transport={request} vault={vault} />
        </React.StrictMode>,
      );
      await open();
      expect(
        screen.getByRole("button", { name: "Type password" }),
      ).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
      expect(mock.copy).toHaveBeenCalledWith("password");
      fireEvent.click(
        screen.getByRole("button", { name: "Close Credentials & 2FA" }),
      );
      // Keyboard opening needs no field focus or capture either.
      fireEvent.click(
        screen.getByRole("button", { name: "Credentials & 2FA" }),
      );
      await screen.findByRole("region", { name: "Credentials & 2FA" });
      fireEvent.click(screen.getByRole("button", { name: "Copy username" }));
      expect(mock.copy).toHaveBeenCalledWith("username");
      expect(request).not.toHaveBeenCalled();
      expect(mock.info).not.toHaveBeenCalled();
      expect(mock.loading).not.toHaveBeenCalled();
      expect(mock.update).not.toHaveBeenCalled();
      expect(screen.queryByText(/reopen|sensitive backend text/)).toBeNull();
    },
  );
  it("releases the overlay before capture and waits with one cancellable toast, never a bar line", async () => {
    vi.useFakeTimers();
    const request = transport();
    request.mockImplementation(async (r) => {
      expect(screen.getByTestId("overlay")).toHaveTextContent("false");
      return { status: "waiting", captureId: "" };
    });
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(mock.loading).toHaveBeenCalledTimes(1);
    expect(mock.loading).toHaveBeenCalledWith(
      "Click an empty website field to type (30s).",
    );
    expect(mock.update).toHaveBeenLastCalledWith(
      "typing-toast",
      expect.objectContaining({
        message: "Click an empty website field to type (30s).",
        action: { label: "Cancel typing", onClick: expect.any(Function) },
      }),
    );
    expect(screen.queryByText(/Click an empty website field/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel typing" })).toBeNull();
    expect(document.querySelector(".sor-popover-surface")).toHaveClass(
      "hidden",
    );
    expect(mock.unmount).not.toHaveBeenCalled();
    // Clicking into the website/body must not close the hidden disclosure owner.
    fireEvent.mouseDown(document.body);
    fireEvent.focusIn(document.body);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(request).toHaveBeenCalledTimes(5);
    expect(mock.type).not.toHaveBeenCalled();
    expect(mock.code).not.toHaveBeenCalled();
    expect(mock.unmount).not.toHaveBeenCalled();
    expect(mock.loading).toHaveBeenCalledTimes(1);
    expect(mock.update.mock.calls.every(([id]) => id === "typing-toast")).toBe(
      true,
    );
    expect(mock.update).toHaveBeenLastCalledWith(
      "typing-toast",
      expect.objectContaining({
        message: "Click an empty website field to type (29s).",
      }),
    );
    cancelNotification();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(request).toHaveBeenCalledTimes(5);
    expect(mock.type).not.toHaveBeenCalled();
    expect(mock.update).toHaveBeenLastCalledWith(
      "typing-toast",
      expect.objectContaining({
        type: "info",
        message: "Typing stopped.",
        action: undefined,
      }),
    );
    expect(
      screen.queryByRole("region", { name: "Credentials & 2FA" }),
    ).toBeNull();
  });
  it("uses the same toast for a delayed start and focus waiting, with no bar progress", async () => {
    vi.useFakeTimers();
    const request = transport();
    request.mockResolvedValue({ status: "waiting", captureId: "" });
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Credential typing start delay" }),
    );
    fireEvent.mouseDown(screen.getByRole("option", { name: "3 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Type username" }));
    await act(async () => {});
    expect(mock.loading).toHaveBeenCalledExactlyOnceWith(
      "Ready to select a field in 3s",
    );
    expect(screen.queryByText(/Ready to select/)).toBeNull();
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mock.loading).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenLastCalledWith(
      "typing-toast",
      expect.objectContaining({
        message: "Click an empty website field to type (30s).",
      }),
    );
    expect(mock.type).not.toHaveBeenCalled();
    cancelNotification();
  });
  it("reports one bounded waiting timeout in the same toast, without automatic retry", async () => {
    vi.useFakeTimers();
    const request = transport();
    request.mockResolvedValue({ status: "waiting", captureId: "" });
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Type password" }));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(mock.loading).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenLastCalledWith(
      "typing-toast",
      expect.objectContaining({
        type: "warning",
        message:
          "Typing timed out waiting for an empty website field. Choose Type to try again.",
        action: undefined,
      }),
    );
    expect(mock.type).not.toHaveBeenCalled();
    expect(mock.info).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(100);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(request).toHaveBeenCalledTimes(100);
  });
  it("does not focus the toolbar after successful native typing and completes its existing toast", async () => {
    const request = transport();
    render(<Harness transport={request} />);
    await open();
    const trigger = screen.getByRole("button", { name: "Credentials & 2FA" });
    const type = screen.getByRole("button", { name: "Type password" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Close Credentials & 2FA" }),
      ).toHaveFocus(),
    );
    act(() => type.focus());
    const focus = vi.spyOn(trigger, "focus");
    fireEvent.click(type);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Credentials & 2FA" }),
      ).toBeNull(),
    );
    expect(focus).not.toHaveBeenCalled();
    expect(mock.info).not.toHaveBeenCalled();
    expect(mock.loading).toHaveBeenCalledTimes(1);
    expect(mock.update).toHaveBeenLastCalledWith(
      "typing-toast",
      expect.objectContaining({
        type: "success",
        message: "Typing completed.",
        action: undefined,
      }),
    );
  });
  it.each(["capture", "type"])(
    "stops a hard %s failure without retrying or echoing errors",
    async (kind) => {
      const request = transport();
      request.mockImplementation(async (r) => {
        if (r.action.kind === kind) throw new Error("sensitive backend text");
        return {
          status: r.action.kind === "capture" ? "captured" : "cancelled",
          captureId: "receipt",
        };
      });
      render(<Harness transport={request} />);
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Type password" }));
      await waitFor(() =>
        expect(mock.update).toHaveBeenLastCalledWith(
          "typing-toast",
          expect.objectContaining({
            type: "warning",
            action: undefined,
          }),
        ),
      );
      expect(JSON.stringify(mock.update.mock.calls)).not.toContain(
        "sensitive backend text",
      );
      expect(mock.loading).toHaveBeenCalledTimes(1);
      expect(mock.info).not.toHaveBeenCalled();
      expect(
        request.mock.calls.filter(([r]) => r.action.kind === kind),
      ).toHaveLength(1);
      if (kind === "capture") expect(mock.type).not.toHaveBeenCalled();
      else
        expect(mock.update).toHaveBeenLastCalledWith(
          "typing-toast",
          expect.objectContaining({
            message: expect.stringContaining(
              "Some characters may have been entered",
            ),
          }),
        );
    },
  );
  it.each([false, true])(
    "waits for focus before resolving the selected authenticator (vault: %s) and keeps toast cancellation active",
    async (vault) => {
      vi.useFakeTimers();
      const request = transport();
      let resolve!: (reply: OriginCredentialInputReply) => void;
      request.mockImplementation(async (r) =>
        r.action.kind === "type"
          ? new Promise((finish) => {
              resolve = finish;
            })
          : {
              status: r.action.kind === "capture" ? "captured" : "cancelled",
              captureId: "receipt",
            },
      );
      request.mockResolvedValueOnce({ status: "waiting", captureId: "" });
      render(<Harness transport={request} vault={vault} />);
      await open();
      fireEvent.click(screen.getByRole("button", { name: "Type code" }));
      await act(async () => {});
      expect(mock.code).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(mock.code).toHaveBeenCalledWith(
        vault ? { vaultId: "vault-code" } : { localIndex: 0 },
      );
      expect(mock.unmount).not.toHaveBeenCalled();
      expect(screen.getByTestId("overlay")).toHaveTextContent("false");
      expect(document.querySelector(".sor-popover-surface")).toHaveClass(
        "hidden",
      );
      expect(mock.update).toHaveBeenLastCalledWith(
        "typing-toast",
        expect.objectContaining({
          message: "Typing into website…",
          action: { label: "Cancel typing", onClick: expect.any(Function) },
        }),
      );
      cancelNotification();
      expect(
        request.mock.calls[request.mock.calls.length - 1]?.[0].action.kind,
      ).toBe("cancel");
      await act(async () => {
        resolve({ status: "complete", captureId: "receipt" });
      });
      expect(
        screen.queryByRole("region", { name: "Credentials & 2FA" }),
      ).toBeNull();
      expect(
        mock.update.mock.calls.some(([, patch]) => patch.type === "success"),
      ).toBe(false);
    },
  );
  it("removes an active notification on unmount and revokes a late receipt", async () => {
    const request = transport();
    let resolve!: (reply: OriginCredentialInputReply) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<Harness transport={request} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Type username" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith("typing-toast");
    await act(async () => {
      resolve({ status: "captured", captureId: "receipt" });
    });
    expect(mock.type).not.toHaveBeenCalled();
    expect(
      request.mock.calls[request.mock.calls.length - 1]?.[0].action.kind,
    ).toBe("cancel");
  });
  it("keeps themed typing settings inside the owning popup focus boundary", async () => {
    const request = transport();
    render(<Harness transport={request} />);
    await open();
    fireEvent.click(
      screen.getByRole("combobox", { name: "Credential typing mode" }),
    );
    const choice = await screen.findByRole("option", { name: "Fast keys" });
    act(() => choice.focus());
    expect(
      screen.getByRole("region", { name: "Credentials & 2FA" }),
    ).toContainElement(choice);
    fireEvent.mouseDown(choice);
    fireEvent.click(screen.getByRole("button", { name: "Type username" }));
    await waitFor(() =>
      expect(
        request.mock.calls.find(([r]) => r.action.kind === "type")?.[0].action,
      ).toMatchObject({ typingMode: "instant" }),
    );
  });
});
