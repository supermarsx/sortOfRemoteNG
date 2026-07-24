import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionFullscreenExitControl } from "../../src/components/session/SessionFullscreenExitControl";
import { SessionFullscreenProvider } from "../../src/contexts/SessionFullscreenProvider";
import { useSessionFullscreen } from "../../src/hooks/session/useSessionFullscreen";
import capability from "../../src-tauri/capabilities/default.json";

const nativeWindow = vi.hoisted(() => {
  let fullscreen = false;
  return {
    isFullscreen: vi.fn(async () => fullscreen),
    setFullscreen: vi.fn(async (next: boolean) => {
      fullscreen = next;
    }),
    setFocus: vi.fn(async () => undefined),
    reset(next = false) {
      fullscreen = next;
    },
  };
});

const getCurrentWindow = vi.hoisted(() => vi.fn(() => nativeWindow));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
}));

function SessionHarness({
  sessionId,
  label,
  onEnter,
  onExit,
}: {
  sessionId: string;
  label: string;
  onEnter?: () => void;
  onExit?: () => void;
}) {
  const fullscreen = useSessionFullscreen(sessionId, { onEnter, onExit });
  return (
    <>
      <button
        type="button"
        onClick={fullscreen.toggleFullscreen}
        aria-label={`Toggle ${label}`}
        aria-pressed={fullscreen.isFullscreen}
      >
        Toggle
      </button>
      <button
        type="button"
        onClick={() => {
          fullscreen.toggleFullscreen();
          fullscreen.toggleFullscreen();
        }}
        aria-label={`Double toggle ${label}`}
      >
        Double toggle
      </button>
      <div
        data-session-fullscreen-root={sessionId}
        data-testid={`surface-${sessionId}`}
        tabIndex={-1}
      >
        <button type="button" data-session-focus-target>
          {label} surface
        </button>
        <SessionFullscreenExitControl
          sessionId={sessionId}
          sessionName={label}
          isFullscreen={fullscreen.isFullscreen}
          onExit={fullscreen.toggleFullscreen}
        />
      </div>
    </>
  );
}

describe("session no-distraction fullscreen", () => {
  beforeEach(() => {
    nativeWindow.reset();
    nativeWindow.isFullscreen.mockClear();
    nativeWindow.setFullscreen.mockClear();
    nativeWindow.setFocus.mockClear();
    getCurrentWindow.mockClear();
  });

  it("enters native fullscreen, focuses the session, and restores trigger and window on Escape", async () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(
      <SessionFullscreenProvider>
        <SessionHarness
          sessionId="rdp-1"
          label="Production RDP"
          onEnter={onEnter}
          onExit={onExit}
        />
      </SessionFullscreenProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "Toggle Production RDP",
    });
    trigger.focus();
    fireEvent.click(trigger);
    expect(onEnter).toHaveBeenCalledTimes(1);

    expect(trigger).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", {
        name: "Exit no-distraction fullscreen for Production RDP",
      }),
    ).toHaveAttribute("aria-keyshortcuts", "Escape");
    await waitFor(() => {
      expect(nativeWindow.setFullscreen).toHaveBeenCalledWith(true);
      expect(nativeWindow.setFocus).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Production RDP surface" }),
      ).toHaveFocus();
    });

    const escapeWasNotCancelled = fireEvent.keyDown(window, {
      key: "Escape",
    });
    expect(escapeWasNotCancelled).toBe(false);
    expect(onExit).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(nativeWindow.setFullscreen).toHaveBeenLastCalledWith(false);
      expect(trigger).toHaveAttribute("aria-pressed", "false");
      expect(trigger).toHaveFocus();
    });
    expect(
      screen.queryByTestId("session-fullscreen-exit-control"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("surface-rdp-1")).toBeInTheDocument();

    const nativeCallsAfterExit = nativeWindow.setFullscreen.mock.calls.length;
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
    expect(nativeWindow.setFullscreen).toHaveBeenCalledTimes(
      nativeCallsAfterExit,
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("keeps one owner and restores the old owner before entering the next", async () => {
    const vncEnter = vi.fn();
    const vncExit = vi.fn();
    const httpEnter = vi.fn();
    const httpExit = vi.fn();
    render(
      <SessionFullscreenProvider>
        <SessionHarness
          sessionId="vnc-1"
          label="VNC"
          onEnter={vncEnter}
          onExit={vncExit}
        />
        <SessionHarness
          sessionId="http-1"
          label="HTTP"
          onEnter={httpEnter}
          onExit={httpExit}
        />
      </SessionFullscreenProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle VNC" }));
    await waitFor(() =>
      expect(nativeWindow.setFullscreen).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle HTTP" }));
    expect(vncEnter).toHaveBeenCalledTimes(1);
    expect(vncExit).toHaveBeenCalledTimes(1);
    expect(httpEnter).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Exit no-distraction fullscreen for HTTP",
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: "Exit no-distraction fullscreen for VNC",
        }),
      ).not.toBeInTheDocument();
      expect(nativeWindow.setFullscreen.mock.calls).toEqual([
        [true],
        [false],
        [true],
      ]);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Exit no-distraction fullscreen for HTTP",
      }),
    );
    expect(httpExit).toHaveBeenCalledTimes(1);
    expect(vncExit).toHaveBeenCalledTimes(1);
  });

  it("runs lifecycle cleanup once through the top-edge exit button", async () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(
      <SessionFullscreenProvider>
        <SessionHarness
          sessionId="button-1"
          label="Button"
          onEnter={onEnter}
          onExit={onExit}
        />
      </SessionFullscreenProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Button" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Exit no-distraction fullscreen for Button",
      }),
    );
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("cancels two synchronous functional toggles without leaving native fullscreen active", async () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(
      <SessionFullscreenProvider>
        <SessionHarness
          sessionId="rapid-1"
          label="Rapid"
          onEnter={onEnter}
          onExit={onExit}
        />
      </SessionFullscreenProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Double toggle Rapid" }),
    );

    expect(
      screen.getByRole("button", { name: "Toggle Rapid" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByTestId("session-fullscreen-exit-control"),
      ).not.toBeInTheDocument(),
    );
    expect(nativeWindow.setFullscreen).not.toHaveBeenCalledWith(true);
  });

  it("cannot leave stale native fullscreen after a delayed enter, owner switch, and exit", async () => {
    let resolveSetFullscreen: (() => void) | undefined;
    nativeWindow.setFullscreen.mockImplementationOnce(async (next) => {
      expect(next).toBe(true);
      nativeWindow.reset(true);
      await new Promise<void>((resolve) => {
        resolveSetFullscreen = resolve;
      });
    });
    const aExit = vi.fn();
    const bExit = vi.fn();
    render(
      <SessionFullscreenProvider>
        <SessionHarness
          sessionId="delayed-a"
          label="Delayed A"
          onExit={aExit}
        />
        <SessionHarness
          sessionId="delayed-b"
          label="Delayed B"
          onExit={bExit}
        />
      </SessionFullscreenProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Delayed A" }));
    await waitFor(() =>
      expect(nativeWindow.setFullscreen).toHaveBeenCalledWith(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle Delayed B" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle Delayed B" }));
    resolveSetFullscreen?.();

    await waitFor(() =>
      expect(nativeWindow.setFullscreen).toHaveBeenLastCalledWith(false),
    );
    expect(aExit).toHaveBeenCalledTimes(1);
    expect(bExit).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("session-fullscreen-exit-control"),
    ).not.toBeInTheDocument();
  });

  it("preserves a window that was already fullscreen and falls back quietly outside Tauri", async () => {
    nativeWindow.reset(true);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { unmount } = render(
      <SessionFullscreenProvider>
        <SessionHarness sessionId="ssh-1" label="SSH" />
      </SessionFullscreenProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle SSH" }));
    await waitFor(() => expect(nativeWindow.setFocus).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", {
        name: "Exit no-distraction fullscreen for SSH",
      }),
    );
    await waitFor(() => expect(nativeWindow.isFullscreen).toHaveBeenCalled());
    expect(nativeWindow.setFullscreen).not.toHaveBeenCalled();

    getCurrentWindow.mockImplementationOnce(() => {
      throw new Error("not running in Tauri");
    });
    fireEvent.click(screen.getByRole("button", { name: "Toggle SSH" }));
    expect(screen.getByTestId("session-fullscreen-exit-control")).toBeVisible();
    await waitFor(() => expect(getCurrentWindow).toHaveBeenCalled());
    expect(consoleError).not.toHaveBeenCalled();

    unmount();
    consoleError.mockRestore();
  });

  it("restores native fullscreen when the active session unmounts", async () => {
    const onExit = vi.fn();
    const { unmount } = render(
      <SessionFullscreenProvider>
        <SessionHarness
          sessionId="rustdesk-1"
          label="RustDesk"
          onExit={onExit}
        />
      </SessionFullscreenProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle RustDesk" }));
    await waitFor(() =>
      expect(nativeWindow.setFullscreen).toHaveBeenCalledWith(true),
    );
    unmount();
    expect(onExit).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(nativeWindow.setFullscreen).toHaveBeenLastCalledWith(false),
    );
  });

  it("grants the desktop permission required by setFullscreen", () => {
    expect(capability.permissions).toContain(
      "core:window:allow-set-fullscreen",
    );
  });
});
