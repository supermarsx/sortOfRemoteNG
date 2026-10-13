import React, { Profiler, StrictMode } from "react";
import { renderToString } from "react-dom/server";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../src/components/ui/dialogs/ConfirmDialog";
import { PromptHost } from "../../src/components/ui/dialogs/PromptHost";
import { Modal } from "../../src/components/ui/overlays/Modal";
import {
  PromptHostUnavailableError,
  getPromptSnapshot,
  requestPrompt,
  resetPromptQueueForTests,
  type PromptDecision,
  type PromptRequest,
} from "../../src/utils/prompts/promptQueue";

const dialogFailure = vi.hoisted(() => ({ title: null as string | null }));

vi.mock("../../src/components/ui/dialogs/AppPromptDialog", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/components/ui/dialogs/AppPromptDialog")
  >("../../src/components/ui/dialogs/AppPromptDialog");
  const Real = actual.AppPromptDialog;
  const AppPromptDialog: typeof Real = (props) => {
    if (dialogFailure.title && props.request.title === dialogFailure.title)
      throw new Error("dialog failed to render");
    return <Real {...props} />;
  };
  return { ...actual, AppPromptDialog, default: AppPromptDialog };
});

const CANCELLED: PromptDecision = { confirmed: false, remember: false };
const CONFIRMED: PromptDecision = { confirmed: true, remember: false };

const request = (overrides: Partial<PromptRequest> = {}): PromptRequest => ({
  title: 'Run "Disk usage" on web-01?',
  message: "This runs the commands below in this SSH session.",
  confirmLabel: "Run script",
  preview: { label: "Commands to run", text: "df -h" },
  ...overrides,
});

/** Requests a prompt and lets React show it. */
const ask = (
  overrides: Partial<PromptRequest> = {},
  options?: { signal?: AbortSignal },
) => {
  let outcome!: Promise<PromptDecision>;
  act(() => {
    outcome = requestPrompt(request(overrides), options);
  });
  return outcome;
};

const stateOf = async (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 0)),
  ]);

const dialogs = () => screen.queryAllByTestId("app-prompt");
const confirmButton = () => screen.getByTestId("app-prompt-confirm");
const cancelButton = () => screen.getByTestId("app-prompt-cancel");
const promptDialog = (title: string) =>
  screen.getByRole("dialog", { name: title });

describe("PromptHost", () => {
  beforeEach(() => {
    resetPromptQueueForTests();
    dialogFailure.title = null;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("yes");
  });
  afterEach(() => {
    // The cleanup runs whatever the checks say, so one failing case cannot
    // leave its spies, timers, prompts or rendered dialog to fail the cases
    // after it. (A hook that throws keeps the library's own unmount, which is
    // registered outside this suite, from running.)
    try {
      expect(window.confirm).not.toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalled();
      expect(window.prompt).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.restoreAllMocks();
      vi.useRealTimers();
      resetPromptQueueForTests();
    }
  });

  describe("as the window's host", () => {
    it("draws nothing while no prompt is pending", () => {
      const { container } = render(<PromptHost />);
      expect(container).toBeEmptyDOMElement();
      expect(dialogs()).toHaveLength(0);
    });

    it("makes requests possible while mounted and cancels them when it goes", async () => {
      await expect(requestPrompt(request())).rejects.toBeInstanceOf(
        PromptHostUnavailableError,
      );
      const { unmount } = render(<PromptHost />);
      const pending = ask();
      expect(dialogs()).toHaveLength(1);

      unmount();

      await expect(pending).resolves.toEqual(CANCELLED);
      expect(dialogs()).toHaveLength(0);
      await expect(requestPrompt(request())).rejects.toBeInstanceOf(
        PromptHostUnavailableError,
      );
    });

    it("works under StrictMode's double mount", async () => {
      render(
        <StrictMode>
          <PromptHost />
        </StrictMode>,
      );
      const outcome = ask();
      expect(dialogs()).toHaveLength(1);
      fireEvent.click(confirmButton());
      await expect(outcome).resolves.toEqual(CONFIRMED);
      expect(dialogs()).toHaveLength(0);
    });

    it("renders on the server without a prompt and without throwing", () => {
      expect(renderToString(<PromptHost />)).toBe("");
    });

    it("cancels everything when the window is going away", async () => {
      render(<PromptHost />);
      const first = ask({ title: "first" });
      const second = ask({ title: "second" });
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      await expect(first).resolves.toEqual(CANCELLED);
      await expect(second).resolves.toEqual(CANCELLED);
      expect(dialogs()).toHaveLength(0);
    });

    it("answers not confirmed when the dialog itself fails, and carries on", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      render(<PromptHost />);
      dialogFailure.title = "broken";
      const broken = ask({ title: "broken" });
      const next = ask({ title: "next" });

      await expect(broken).resolves.toEqual(CANCELLED);
      await waitFor(() => expect(promptDialog("next")).toBeInTheDocument());
      fireEvent.click(confirmButton());
      await expect(next).resolves.toEqual(CONFIRMED);
    });
  });

  describe("answers", () => {
    it("resolves the request with the button that was used", async () => {
      render(<PromptHost />);
      const confirmed = ask();
      fireEvent.click(confirmButton());
      await expect(confirmed).resolves.toEqual(CONFIRMED);
      expect(dialogs()).toHaveLength(0);

      const cancelled = ask();
      fireEvent.click(cancelButton());
      await expect(cancelled).resolves.toEqual(CANCELLED);

      const dismissed = ask();
      fireEvent.click(screen.getByTestId("app-prompt"));
      await expect(dismissed).resolves.toEqual(CANCELLED);
      expect(getPromptSnapshot()).toHaveLength(0);
    });

    it("passes the checkbox on", async () => {
      render(<PromptHost />);
      const outcome = ask({ remember: { label: "Don't ask again" } });
      fireEvent.click(screen.getByTestId("app-prompt-remember"));
      fireEvent.click(confirmButton());
      await expect(outcome).resolves.toEqual({
        confirmed: true,
        remember: true,
      });
    });

    it("closes the visible prompt when its request is aborted", async () => {
      render(<PromptHost />);
      const controller = new AbortController();
      const outcome = ask({}, { signal: controller.signal });
      expect(dialogs()).toHaveLength(1);

      act(() => controller.abort());

      await expect(outcome).resolves.toEqual(CANCELLED);
      expect(dialogs()).toHaveLength(0);
    });

    it("is described and named for assistive technology", () => {
      render(<PromptHost />);
      void ask();
      const dialog = promptDialog('Run "Disk usage" on web-01?');
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleDescription(
        "This runs the commands below in this SSH session.",
      );
      expect(
        screen.getByRole("region", { name: "Commands to run" }),
      ).toHaveTextContent("df -h");
    });
  });

  describe("several requests at once", () => {
    it("shows one dialog at a time, in order, with the position in the queue", async () => {
      const commits: number[] = [];
      render(
        <Profiler id="host" onRender={() => commits.push(dialogs().length)}>
          <PromptHost />
        </Profiler>,
      );
      const first = ask({ title: "first" });
      const second = ask({ title: "second" });

      expect(dialogs()).toHaveLength(1);
      expect(promptDialog("first")).toBeInTheDocument();
      expect(screen.getByTestId("app-prompt-queue")).toHaveTextContent(
        "1 of 2",
      );
      expect(await stateOf(second)).toBe("pending");

      commits.length = 0;
      fireEvent.click(confirmButton());

      // The next prompt is on screen in the same commit: no gap without one.
      expect(dialogs()).toHaveLength(1);
      expect(promptDialog("second")).toBeInTheDocument();
      expect(commits.length).toBeGreaterThan(0);
      expect(commits.every((count) => count === 1)).toBe(true);
      expect(screen.queryByTestId("app-prompt-queue")).toBeNull();
      await expect(first).resolves.toEqual(CONFIRMED);
      expect(await stateOf(second)).toBe("pending");

      fireEvent.click(cancelButton());
      await expect(second).resolves.toEqual(CANCELLED);
      expect(dialogs()).toHaveLength(0);
    });

    it("starts each prompt fresh: its own focus, checkbox and single answer", async () => {
      render(<PromptHost />);
      const first = ask({
        title: "first",
        remember: { label: "Don't ask again" },
      });
      const second = ask({
        title: "second",
        defaultAction: "cancel",
        remember: { label: "Don't ask again" },
      });
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      const firstPanel = promptDialog("first");
      const firstConfirm = confirmButton();
      fireEvent.click(screen.getByTestId("app-prompt-remember"));

      fireEvent.click(firstConfirm);
      // A second activation of the old button cannot answer the new prompt.
      fireEvent.click(firstConfirm);

      await expect(first).resolves.toEqual({
        confirmed: true,
        remember: true,
      });
      expect(promptDialog("second")).not.toBe(firstPanel);
      expect(screen.getByTestId("app-prompt-remember")).not.toBeChecked();
      await waitFor(() => expect(cancelButton()).toHaveFocus());
      expect(await stateOf(second)).toBe("pending");
    });

    it("updates the position without restarting the visible prompt", async () => {
      render(<PromptHost />);
      void ask({ title: "first" });
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      const panel = promptDialog("first");
      expect(screen.queryByTestId("app-prompt-queue")).toBeNull();

      void ask({ title: "second" });
      void ask({ title: "third" });

      expect(promptDialog("first")).toBe(panel);
      expect(confirmButton()).toHaveFocus();
      expect(screen.getByTestId("app-prompt-queue")).toHaveTextContent(
        "1 of 3",
      );
    });

    it("draws identical requests once and answers them together", async () => {
      render(<PromptHost />);
      const first = ask({ dedupeKey: "script:1:session-1" });
      const second = ask({ dedupeKey: "script:1:session-1" });
      expect(dialogs()).toHaveLength(1);
      expect(screen.queryByTestId("app-prompt-queue")).toBeNull();
      fireEvent.click(confirmButton());
      await expect(first).resolves.toEqual(CONFIRMED);
      await expect(second).resolves.toEqual(CONFIRMED);
      expect(dialogs()).toHaveLength(0);
    });
  });

  describe("Escape", () => {
    it("cancels the prompt and leaves the dialog underneath open", async () => {
      const parentClose = vi.fn();
      render(
        <>
          <Modal isOpen onClose={parentClose} ariaLabel="Run Script">
            <button>Disk usage</button>
          </Modal>
          <PromptHost />
        </>,
      );
      const outcome = ask();
      await waitFor(() => expect(confirmButton()).toHaveFocus());

      const delivered = fireEvent.keyDown(document.activeElement!, {
        key: "Escape",
      });

      await expect(outcome).resolves.toEqual(CANCELLED);
      expect(delivered).toBe(false);
      expect(parentClose).not.toHaveBeenCalled();
      expect(dialogs()).toHaveLength(0);
      expect(
        screen.getByRole("dialog", { name: "Run Script" }),
      ).toBeInTheDocument();

      // With no prompt open the same key reaches the dialog underneath again.
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(parentClose).toHaveBeenCalledTimes(1);
    });

    it("is not shared with a window listener added after the host mounted", async () => {
      render(<PromptHost />);
      // Like SessionFullscreenProvider: added on entering fullscreen, capture phase.
      const exitFullscreen = vi.fn();
      window.addEventListener("keydown", exitFullscreen, true);
      try {
        const first = ask({ title: "first" });
        fireEvent.keyDown(document, { key: "Escape" });
        await expect(first).resolves.toEqual(CANCELLED);
        expect(exitFullscreen).not.toHaveBeenCalled();

        // The same holds for every later prompt, not just the first.
        const second = ask({ title: "second" });
        fireEvent.keyDown(document, { key: "Escape" });
        await expect(second).resolves.toEqual(CANCELLED);
        expect(exitFullscreen).not.toHaveBeenCalled();

        fireEvent.keyDown(document, { key: "Escape" });
        expect(exitFullscreen).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener("keydown", exitFullscreen, true);
      }
    });

    it("held down cancels one prompt, not the whole queue", async () => {
      const parentClose = vi.fn();
      render(
        <>
          <Modal isOpen onClose={parentClose}>
            <button>Underneath</button>
          </Modal>
          <PromptHost />
        </>,
      );
      const first = ask({ title: "first" });
      const second = ask({ title: "second" });

      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(document, { key: "Escape", repeat: true });
      fireEvent.keyDown(document, { key: "Escape", repeat: true });

      await expect(first).resolves.toEqual(CANCELLED);
      expect(await stateOf(second)).toBe("pending");
      expect(promptDialog("second")).toBeInTheDocument();
      expect(parentClose).not.toHaveBeenCalled();
    });

    it("leaves every other key alone", () => {
      render(<PromptHost />);
      const seen = vi.fn();
      document.addEventListener("keydown", seen);
      try {
        void ask();
        for (const key of ["Tab", "a", "ArrowDown", "Shift"])
          for (const target of [
            document,
            screen.getByTestId("app-prompt-preview"),
          ])
            expect(fireEvent.keyDown(target, { key })).toBe(true);
        expect(seen).toHaveBeenCalledTimes(8);
        expect(dialogs()).toHaveLength(1);
      } finally {
        document.removeEventListener("keydown", seen);
      }
    });
  });

  describe("Enter and Space", () => {
    const KEYS = ["Enter", " "];
    const TYPES = ["keydown", "keypress", "keyup"] as const;
    const press = (target: Element | Document, key: string) =>
      TYPES.map((type) =>
        fireEvent(
          target,
          new KeyboardEvent(type, { key, bubbles: true, cancelable: true }),
        ),
      );

    /** Counts what gets out of the prompt to listeners on the document. */
    const listenOutside = () => {
      const seen = vi.fn();
      for (const type of TYPES) document.addEventListener(type, seen);
      return {
        seen,
        stop: () => {
          for (const type of TYPES) document.removeEventListener(type, seen);
        },
      };
    };

    it("on the preview confirm neither the prompt nor a dialog underneath", async () => {
      const closeTab = vi.fn();
      const keepTab = vi.fn();
      render(
        <>
          <ConfirmDialog
            isOpen
            title="Close tab?"
            message="Disconnect the session?"
            onConfirm={closeTab}
            onCancel={keepTab}
          />
          <PromptHost />
        </>,
      );
      // The dialog underneath does confirm on Enter while it is alone.
      fireEvent.keyDown(document.body, { key: "Enter" });
      expect(closeTab).toHaveBeenCalledTimes(1);
      closeTab.mockClear();

      const outcome = ask({ remember: { label: "Don't ask again" } });
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      const region = screen.getByTestId("app-prompt-preview");
      region.focus();
      for (const key of KEYS)
        for (const target of [
          region,
          promptDialog('Run "Disk usage" on web-01?'),
          screen.getByText("This runs the commands below in this SSH session."),
          screen.getByTestId("app-prompt-remember"),
          document.body,
          document.documentElement,
          document,
        ])
          press(target, key);

      expect(closeTab).not.toHaveBeenCalled();
      expect(keepTab).not.toHaveBeenCalled();
      expect(await stateOf(outcome)).toBe("pending");
      expect(dialogs()).toHaveLength(1);
      expect(
        screen.getByRole("dialog", { name: "Close tab?" }),
      ).toBeInTheDocument();
    });

    it("from inside the prompt reach nothing outside it, and keep their own effect", () => {
      render(<PromptHost />);
      void ask({
        remember: { label: "Don't ask again" },
        targets: {
          label: "Runs on",
          items: [{ id: "s1", name: "web-01", detail: "10.0.0.1" }],
        },
      });
      const outside = listenOutside();
      try {
        const checkbox = screen.getByTestId("app-prompt-remember");
        for (const key of KEYS)
          for (const target of [
            screen.getByTestId("app-prompt-preview"),
            screen.getByTestId("app-prompt-targets"),
            checkbox,
          ])
            // Not cancelled: Space still ticks the box and scrolls a region.
            expect(press(target, key)).toEqual([true, true, true]);
        expect(outside.seen).not.toHaveBeenCalled();
        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();
      } finally {
        outside.stop();
      }
    });

    it("with nothing focused are taken by the prompt and do nothing", () => {
      render(<PromptHost />);
      void ask();
      const outside = listenOutside();
      try {
        for (const key of KEYS)
          for (const target of [
            document.body,
            document.documentElement,
            document,
          ])
            expect(press(target, key)).toEqual([false, false, false]);
        expect(outside.seen).not.toHaveBeenCalled();
        expect(dialogs()).toHaveLength(1);
      } finally {
        outside.stop();
      }
    });

    it("on the prompt's own buttons are left to those buttons", async () => {
      const closeTab = vi.fn();
      render(
        <>
          <ConfirmDialog
            isOpen
            message="Disconnect the session?"
            onConfirm={closeTab}
            onCancel={() => {}}
          />
          <PromptHost />
        </>,
      );
      const outcome = ask();
      const outside = listenOutside();
      try {
        const buttons = [
          confirmButton(),
          cancelButton(),
          within(promptDialog('Run "Disk usage" on web-01?')).getByRole(
            "button",
            { name: "Close" },
          ),
        ];
        for (const key of KEYS)
          for (const button of buttons) press(button, key);
        // They pass: the button's own handling, and the browser's click, need them.
        expect(outside.seen).toHaveBeenCalledTimes(
          KEYS.length * buttons.length * TYPES.length,
        );
        // The dialog underneath ignores keys that come from a button.
        expect(closeTab).not.toHaveBeenCalled();
        expect(await stateOf(outcome)).toBe("pending");
      } finally {
        outside.stop();
      }
    });

    it("in a control outside the prompt, such as the unlock screen above it, are not touched", () => {
      render(
        <>
          <input aria-label="Master password" />
          <PromptHost />
        </>,
      );
      void ask();
      const outside = listenOutside();
      try {
        const password = screen.getByLabelText("Master password");
        for (const key of KEYS)
          expect(press(password, key)).toEqual([true, true, true]);
        expect(outside.seen).toHaveBeenCalledTimes(KEYS.length * TYPES.length);
      } finally {
        outside.stop();
      }
    });

    it("are not touched at all while no prompt is showing", () => {
      render(<PromptHost />);
      const outside = listenOutside();
      try {
        for (const key of KEYS)
          expect(press(document.body, key)).toEqual([true, true, true]);
        expect(outside.seen).toHaveBeenCalledTimes(KEYS.length * TYPES.length);
      } finally {
        outside.stop();
      }
    });
  });

  describe("focus", () => {
    it("stays inside the prompt and returns to what had it", async () => {
      render(
        <>
          <textarea aria-label="Terminal input" />
          <PromptHost />
        </>,
      );
      const terminal = screen.getByLabelText("Terminal input");
      terminal.focus();
      const outcome = ask({ remember: { label: "Don't ask again" } });
      await waitFor(() => expect(confirmButton()).toHaveFocus());

      // Tab from the last control wraps to the first, and back.
      fireEvent.keyDown(document, { key: "Tab" });
      const first = screen.getByRole("button", { name: "Close" });
      expect(first).toHaveFocus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(confirmButton()).toHaveFocus();

      fireEvent.click(cancelButton());
      await expect(outcome).resolves.toEqual(CANCELLED);
      expect(terminal).toHaveFocus();
    });

    it("returns to the opener after Escape and after an abort", async () => {
      render(
        <>
          <button>Run Script</button>
          <PromptHost />
        </>,
      );
      const opener = screen.getByText("Run Script");
      opener.focus();
      void ask();
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(opener).toHaveFocus();

      const controller = new AbortController();
      void ask({}, { signal: controller.signal });
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      act(() => controller.abort());
      expect(opener).toHaveFocus();
    });
  });

  describe("does not block the window", () => {
    it("lets timers fire and session events arrive while a prompt is open", async () => {
      vi.useFakeTimers();
      render(<PromptHost />);
      const tick = vi.fn();
      const output: string[] = [];
      const onOutput = (event: Event) =>
        output.push((event as CustomEvent<string>).detail);
      window.addEventListener("ssh-output", onOutput);
      try {
        // Scheduled before the prompt, as a streaming session would have.
        setTimeout(tick, 1_000);
        const interval = setInterval(tick, 400);

        const outcome = ask();
        expect(dialogs()).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(1_000);
        });
        window.dispatchEvent(new CustomEvent("ssh-output", { detail: "a" }));
        window.dispatchEvent(new CustomEvent("ssh-output", { detail: "b" }));

        expect(tick).toHaveBeenCalledTimes(3);
        expect(output).toEqual(["a", "b"]);
        // Still open, still unanswered.
        expect(dialogs()).toHaveLength(1);
        clearInterval(interval);

        fireEvent.click(cancelButton());
        vi.useRealTimers();
        await expect(outcome).resolves.toEqual(CANCELLED);
      } finally {
        window.removeEventListener("ssh-output", onOutput);
      }
    });
  });
});
