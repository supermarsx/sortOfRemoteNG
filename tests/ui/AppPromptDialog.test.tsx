import { readFileSync } from "node:fs";
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
import { AppPromptDialog } from "../../src/components/ui/dialogs/AppPromptDialog";
import styles from "../../src/components/ui/dialogs/AppPromptDialog.module.css";
import type { PromptRequest } from "../../src/utils/prompts/promptQueue";
import {
  remoteDeletePrompt,
  sshScriptRunPrompt,
} from "../../src/utils/prompts/runPromptRequests";
import { trustedClick } from "../helpers/trustedClick";

const TSX_PATH = "src/components/ui/dialogs/AppPromptDialog.tsx";
const CSS_PATH = "src/components/ui/dialogs/AppPromptDialog.module.css";

const TITLE = 'Run "Disk usage" on web-01?';
const MESSAGE = "This runs the commands below in this SSH session.";
const COMMAND = "df -h\n  uptime\t# keep";

const request = (overrides: Partial<PromptRequest> = {}): PromptRequest => ({
  title: TITLE,
  message: MESSAGE,
  confirmLabel: "Run script",
  preview: { label: "Commands to run", text: COMMAND },
  ...overrides,
});

const open = (overrides: Partial<PromptRequest> = {}, queued = 0) => {
  const onDecision = vi.fn();
  const view = render(
    <AppPromptDialog
      request={request(overrides)}
      queued={queued}
      onDecision={onDecision}
    />,
  );
  return { onDecision, ...view };
};

const confirmButton = () => screen.getByTestId("app-prompt-confirm");
const cancelButton = () => screen.getByTestId("app-prompt-cancel");
const backdrop = () => screen.getByTestId("app-prompt");
const preview = () => screen.getByTestId("app-prompt-preview");

/**
 * A click as the browser itself delivers it: trusted, with `detail` 0 when it
 * was made from Enter, Space or an assistive action and 1 for a pointer.
 * Everything a test dispatches is untrusted, so this goes through jsdom's own
 * dispatch; the checks at the end fail loudly if jsdom stops allowing that.
 */
const browserClick = (target: HTMLElement, detail: 0 | 1) => {
  const implOf = (wrapper: object) => {
    const symbol = Object.getOwnPropertySymbols(wrapper).find(
      (candidate) => candidate.description === "impl",
    );
    return (wrapper as Record<symbol, any>)[symbol!];
  };
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail,
  });
  implOf(event).isTrusted = true;
  act(() => {
    implOf(target)._dispatch(implOf(event));
  });
  expect(event.isTrusted).toBe(true);
  expect(event.detail).toBe(detail);
};

describe("AppPromptDialog", () => {
  let now = 10_000;
  beforeEach(() => {
    now = 10_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("yes");
  });
  afterEach(() => {
    // The cleanup runs whatever the checks say, so one failing case cannot
    // leave its spies, stubs or rendered dialog to fail the cases after it.
    // (A hook that throws keeps the library's own unmount, which is
    // registered outside this suite, from running.)
    try {
      expect(window.confirm).not.toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalled();
      expect(window.prompt).not.toHaveBeenCalled();
    } finally {
      cleanup();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  describe("content", () => {
    it("shows the title, message, targets, preview, facts and hint", () => {
      open({
        targets: {
          label: "Runs on",
          items: [
            { id: "s1", name: "web-01", detail: "10.0.0.1" },
            { id: "s2", name: "db-01", detail: "db.internal" },
            { id: "s3", name: "cache-01" },
          ],
        },
        facts: ["bash", "2 lines"],
        hint: "Settings, Macros: Confirm before running SSH scripts",
      });

      expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
      expect(screen.getByText(MESSAGE)).toBeInTheDocument();

      const rows = screen
        .getByTestId("app-prompt-targets")
        .querySelectorAll("li");
      expect(Array.from(rows, (row) => row.textContent)).toEqual([
        "web-01 10.0.0.1",
        "db-01 db.internal",
        "cache-01",
      ]);
      expect(rows[0]).toHaveTextContent("web-01");
      expect(rows[0]).toHaveTextContent("10.0.0.1");

      // Verbatim: leading spaces, the tab and the line break all survive.
      expect(preview().tagName).toBe("PRE");
      expect(preview().textContent).toBe(COMMAND);

      expect(screen.getByText("bash")).toBeInTheDocument();
      expect(screen.getByText("2 lines")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Settings, Macros: Confirm before running SSH scripts",
        ),
      ).toBeInTheDocument();
      expect(confirmButton()).toHaveTextContent("Run script");
      expect(cancelButton()).toHaveTextContent("Cancel");
    });

    it("renders only the parts that were supplied", () => {
      open({ message: undefined, preview: undefined, cancelLabel: "Keep" });
      expect(screen.queryByTestId("app-prompt-preview")).toBeNull();
      expect(screen.queryByTestId("app-prompt-targets")).toBeNull();
      expect(screen.queryByTestId("app-prompt-remember")).toBeNull();
      expect(screen.queryByTestId("app-prompt-queue")).toBeNull();
      expect(screen.getByRole("dialog")).not.toHaveAttribute(
        "aria-describedby",
      );
      expect(cancelButton()).toHaveTextContent("Keep");
    });

    it("shows untrusted text as text, never as markup", () => {
      const markup = '<img src=x onerror="alert(1)"><b>bold</b>';
      const { baseElement } = open({
        title: `Run "${markup}" on ${markup}?`,
        message: markup,
        preview: { label: markup, text: markup },
        targets: {
          label: markup,
          items: [{ id: "s1", name: markup, detail: markup }],
        },
        facts: [markup],
        hint: markup,
        remember: { label: markup, hint: markup },
        confirmLabel: markup,
        cancelLabel: markup,
      });
      expect(baseElement.querySelector("img")).toBeNull();
      expect(baseElement.querySelector("b")).toBeNull();
      expect(preview().textContent).toBe(markup);
      expect(confirmButton().textContent).toBe(markup);
    });

    it("puts Cancel before the action and keeps both as plain buttons", () => {
      open();
      const buttons = Array.from(
        cancelButton().parentElement!.querySelectorAll("button"),
      );
      expect(buttons).toEqual([cancelButton(), confirmButton()]);
      expect(cancelButton()).toHaveAttribute("type", "button");
      expect(confirmButton()).toHaveAttribute("type", "button");
      expect(cancelButton()).toHaveClass("sor-modal-cancel");
    });

    it("marks the tone with the button, the icon and never colour alone", () => {
      // The drawing inside the header icon, without its colour class.
      const iconShape = (root: HTMLElement) => {
        const shape = root.querySelector("svg")?.innerHTML;
        expect(shape).toBeTruthy();
        return shape;
      };

      const { unmount, baseElement } = open();
      expect(confirmButton()).toHaveClass("sor-modal-primary");
      expect(confirmButton()).toHaveAttribute("data-tone", "default");
      const defaultIcon = iconShape(baseElement);
      unmount();

      const warning = open({ tone: "warning" });
      expect(confirmButton()).toHaveClass("bg-warning");
      expect(confirmButton()).not.toHaveClass("sor-modal-primary");
      const warningIcon = iconShape(warning.baseElement);
      warning.unmount();

      const danger = open({ tone: "danger" });
      expect(confirmButton()).toHaveClass("bg-error");
      expect(confirmButton()).toHaveAttribute("data-tone", "danger");
      const dangerIcon = iconShape(danger.baseElement);

      expect(new Set([defaultIcon, warningIcon, dangerIcon]).size).toBe(3);
    });
  });

  describe("accessibility", () => {
    it("is a modal dialog named by its title and described by its message", () => {
      open();
      const dialog = screen.getByRole("dialog", { name: TITLE });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleDescription(MESSAGE);
      const describedBy = dialog.getAttribute("aria-describedby")!;
      expect(document.getElementById(describedBy)).toHaveTextContent(MESSAGE);
    });

    it("labels the scroll regions and lets the keyboard reach them", () => {
      open({
        targets: {
          label: "Runs on",
          items: [{ id: "s1", name: "web-01", detail: "10.0.0.1" }],
        },
      });
      const commands = screen.getByRole("region", { name: "Commands to run" });
      expect(commands).toBe(preview());
      expect(commands).toHaveAttribute("tabindex", "0");
      const targets = screen.getByRole("region", { name: "Runs on" });
      expect(targets).toBe(screen.getByTestId("app-prompt-targets"));
      expect(targets).toHaveAttribute("tabindex", "0");
    });

    it("labels the checkbox with its text and describes it with its hint", () => {
      open({
        remember: {
          label: "Don't ask again for this script in this session",
          hint: "You are asked again if the script changes or the session ends.",
        },
      });
      const checkbox = screen.getByRole("checkbox", {
        name: "Don't ask again for this script in this session",
      });
      expect(checkbox).toBe(screen.getByTestId("app-prompt-remember"));
      expect(checkbox.tagName).toBe("INPUT");
      expect(checkbox.closest("label")).not.toBeNull();
      expect(checkbox).not.toBeChecked();
      expect(checkbox).toHaveAccessibleDescription(
        "You are asked again if the script changes or the session ends.",
      );
    });

    it("announces the queue position and never the payload", () => {
      const { baseElement } = open(
        { preview: { label: "Commands to run", text: "export TOKEN=hunter2" } },
        2,
      );
      // The badge is for the eye; the status region says the same aloud, once.
      const badge = screen.getByTestId("app-prompt-queue");
      expect(badge.textContent).toBe("1 of 3");
      expect(badge).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Prompt 1 of 3");
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAccessibleDescription(`${MESSAGE} Prompt 1 of 3`);
      for (const live of baseElement.querySelectorAll(
        "[aria-live], [role='status'], [role='alert'], [role='log']",
      ))
        expect(live.textContent).not.toContain("hunter2");
      for (const id of dialog.getAttribute("aria-describedby")!.split(" "))
        expect(document.getElementById(id)?.textContent).not.toContain(
          "hunter2",
        );
      expect(dialog.getAttribute("aria-label")).not.toContain("hunter2");
    });

    it("keeps the status region in place, empty, while nothing waits", () => {
      const { rerender, onDecision } = open();
      const status = screen.getByRole("status");
      expect(status).toBeEmptyDOMElement();
      expect(status).toHaveAttribute("aria-live", "polite");
      rerender(
        <AppPromptDialog
          request={request()}
          queued={1}
          onDecision={onDecision}
        />,
      );
      expect(screen.getByRole("status")).toBe(status);
      expect(status).toHaveTextContent("Prompt 1 of 2");
    });
  });

  describe("focus and keyboard", () => {
    it("focuses the action by default", async () => {
      open();
      await waitFor(() => expect(confirmButton()).toHaveFocus());
    });

    it("focuses Cancel when the request says so", async () => {
      open({ defaultAction: "cancel", tone: "danger" });
      await waitFor(() => expect(cancelButton()).toHaveFocus());
    });

    it("opens a destructive request on Cancel unless it says otherwise", async () => {
      const unspecified = open({ tone: "danger" });
      await waitFor(() => expect(cancelButton()).toHaveFocus());
      unspecified.unmount();

      const explicit = open({ tone: "danger", defaultAction: "confirm" });
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      explicit.unmount();

      // Only danger changes the default: a warning still opens on the action.
      open({ tone: "warning" });
      await waitFor(() => expect(confirmButton()).toHaveFocus());
    });

    it("has no Enter or Space shortcut outside the focused button", async () => {
      const { onDecision } = open({
        defaultAction: "cancel",
        remember: { label: "Don't ask again" },
      });
      await waitFor(() => expect(cancelButton()).toHaveFocus());
      now += 5_000;
      for (const key of ["Enter", " "]) {
        fireEvent.keyDown(document, { key });
        fireEvent.keyUp(document, { key });
        fireEvent.keyDown(document.body, { key });
        for (const target of [
          cancelButton(),
          preview(),
          screen.getByTestId("app-prompt-remember"),
          screen.getByRole("dialog"),
        ]) {
          fireEvent.keyDown(target, { key });
          fireEvent.keyUp(target, { key });
        }
      }
      expect(onDecision).not.toHaveBeenCalled();
      // JSDOM does not synthesize the browser's native keyboard click.
      fireEvent.click(cancelButton());
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });

    it("leaves Escape to the host", () => {
      const { onDecision } = open();
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.keyDown(confirmButton(), { key: "Escape" });
      expect(onDecision).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("ignores a key that was already held or typed before the prompt could be read", () => {
      open();
      for (const button of [confirmButton(), cancelButton()]) {
        // Typed ahead: the prompt has been on screen for 100 ms.
        now = 10_100;
        expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(false);
        expect(fireEvent.keyDown(button, { key: " " })).toBe(false);
        now = 10_299;
        expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(false);
        // Readable: the same key now reaches the button.
        now = 10_300;
        expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
        expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
        // Auto-repeat of a key held since before never activates.
        expect(fireEvent.keyDown(button, { key: "Enter", repeat: true })).toBe(
          false,
        );
        expect(fireEvent.keyDown(button, { key: " ", repeat: true })).toBe(
          false,
        );
        // Other keys are never touched.
        now = 10_000;
        expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
        expect(fireEvent.keyDown(button, { key: "a", repeat: true })).toBe(
          true,
        );
      }
    });

    it("holds a click the browser makes from a key to the same delay as the key", () => {
      const { onDecision } = open();
      // Typed ahead: on screen for 100 ms, then for 299 ms.
      now = 10_100;
      browserClick(confirmButton(), 0);
      browserClick(cancelButton(), 0);
      now = 10_299;
      browserClick(confirmButton(), 0);
      browserClick(cancelButton(), 0);
      expect(onDecision).not.toHaveBeenCalled();
      // Readable: the same click now answers.
      now = 10_300;
      browserClick(confirmButton(), 0);
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: false,
      });
    });

    it("holds such a click on Cancel too, then lets it cancel", () => {
      const { onDecision } = open({ tone: "danger" });
      now = 10_299;
      browserClick(cancelButton(), 0);
      expect(onDecision).not.toHaveBeenCalled();
      now = 10_300;
      browserClick(cancelButton(), 0);
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });

    it("answers a pointer click at once", () => {
      const { onDecision } = open();
      now = 10_001;
      browserClick(confirmButton(), 1);
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: false,
      });
    });

    it("does not hold a click that a script dispatches, as tests do", () => {
      const { onDecision } = open();
      now = 10_001;
      // fireEvent.click: no pointer count and not trusted.
      fireEvent.click(confirmButton());
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: false,
      });
    });
  });

  describe("answers", () => {
    it("reports a confirm once", () => {
      const { onDecision } = open();
      fireEvent.click(confirmButton());
      fireEvent.click(confirmButton());
      fireEvent.click(cancelButton());
      fireEvent.click(backdrop());
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: false,
      });
    });

    it("reports a cancel once", () => {
      const { onDecision } = open();
      fireEvent.click(cancelButton());
      fireEvent.click(cancelButton());
      fireEvent.click(confirmButton());
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });

    it("cancels on a click on the backdrop, not on a click inside the panel", () => {
      const { onDecision } = open();
      fireEvent.click(screen.getByRole("dialog"));
      fireEvent.click(preview());
      fireEvent.click(screen.getByText(MESSAGE));
      expect(onDecision).not.toHaveBeenCalled();
      fireEvent.click(backdrop());
      fireEvent.click(backdrop());
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });

    it("cancels from the close button in the header", () => {
      const { onDecision } = open();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });

    it("reports the checkbox with a confirm and never with a cancel", () => {
      const remember = { label: "Don't ask again" };
      const ticked = open({ remember });
      fireEvent.click(screen.getByTestId("app-prompt-remember"));
      expect(screen.getByTestId("app-prompt-remember")).toBeChecked();
      fireEvent.click(confirmButton());
      expect(ticked.onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: true,
      });
      ticked.unmount();

      const unticked = open({ remember });
      fireEvent.click(confirmButton());
      expect(unticked.onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: false,
      });
      unticked.unmount();

      const cancelled = open({ remember });
      fireEvent.click(screen.getByTestId("app-prompt-remember"));
      fireEvent.click(cancelButton());
      expect(cancelled.onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });

    it("ignores the second click of a double click that opened the prompt", () => {
      const { onDecision } = open();
      fireEvent.click(confirmButton(), { detail: 2 });
      fireEvent.click(cancelButton(), { detail: 2 });
      fireEvent.click(backdrop(), { detail: 2 });
      fireEvent.click(confirmButton(), { detail: 3 });
      expect(onDecision).not.toHaveBeenCalled();
      fireEvent.click(confirmButton(), { detail: 1 });
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: true,
        remember: false,
      });
    });

    it("does not cancel when a text selection ends on the backdrop", () => {
      const { onDecision } = open();
      fireEvent.mouseDown(preview());
      fireEvent.mouseUp(backdrop());
      fireEvent.click(backdrop());
      expect(onDecision).not.toHaveBeenCalled();
      // A press that starts on the backdrop still cancels.
      fireEvent.mouseDown(backdrop());
      fireEvent.click(backdrop());
      expect(onDecision).toHaveBeenCalledExactlyOnceWith({
        confirmed: false,
        remember: false,
      });
    });
  });

  describe("long and hostile content", () => {
    it("shows 20,000 characters in full and says how many more there are", () => {
      const exact = "x".repeat(20_000);
      const fits = open({ preview: { label: "Text to paste", text: exact } });
      expect(preview().textContent).toBe(exact);
      expect(screen.queryByTestId("app-prompt-preview-more")).toBeNull();
      fits.unmount();

      const long = "abcde".repeat(5_000);
      open({ preview: { label: "Text to paste", text: long } });
      expect(preview().textContent).toBe(long.slice(0, 20_000));
      expect(screen.getByTestId("app-prompt-preview-more")).toHaveTextContent(
        `${(5_000).toLocaleString()} more characters are not shown`,
      );
    });

    it("bounds the number of lines and says how many more there are", () => {
      const lines = Array.from(
        { length: 1_600 },
        (_, index) => `echo ${index}`,
      );
      const text = lines.join("\n");
      open({ preview: { label: "Commands to run", text } });
      const shown = lines.slice(0, 1_000).join("\n");
      expect(preview().textContent).toBe(shown);
      expect(screen.getByTestId("app-prompt-preview-more")).toHaveTextContent(
        `and 600 more lines (${(text.length - shown.length).toLocaleString()} characters) are not shown`,
      );
    });

    it("stays small and quick for a multi-megabyte payload", () => {
      const huge = "echo line of pasted text\n".repeat(240_000); // about 6 MB
      const started = Date.now();
      const { rerender, onDecision } = open({
        preview: { label: "Text to paste", text: huge },
      });
      for (let pass = 0; pass < 20; pass += 1)
        rerender(
          <AppPromptDialog
            request={request({
              preview: { label: "Text to paste", text: huge },
            })}
            queued={pass}
            onDecision={onDecision}
          />,
        );
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(preview().textContent!.length).toBeLessThanOrEqual(20_000);
      expect(screen.getByRole("dialog").textContent!.length).toBeLessThan(
        21_000,
      );
      // 25 characters a line: 800 lines are shown, 239,200 are not.
      expect(screen.getByTestId("app-prompt-preview-more")).toHaveTextContent(
        `and ${(239_200).toLocaleString()} more lines (${(5_980_000).toLocaleString()} characters) are not shown`,
      );
    });

    it("makes hidden characters in the preview visible", () => {
      open({
        preview: {
          label: "Text to paste",
          text: "echo ok\rrm -rf /\r\nls\u001B[2K \u{202E}gnp\u0007\u007F",
        },
      });
      expect(preview().textContent).toBe(
        "echo ok␍\nrm -rf /\nls␛[2K ⟨U+202E⟩gnp␇␡",
      );
      expect(screen.getByTestId("app-prompt-preview-note")).toHaveTextContent(
        "Hidden control characters are shown as symbols.",
      );
    });

    it("adds no note for ordinary text", () => {
      open({ preview: { label: "Commands", text: "café 日本\n\tok" } });
      expect(preview().textContent).toBe("café 日本\n\tok");
      expect(screen.queryByTestId("app-prompt-preview-note")).toBeNull();
    });

    it("marks tags, fillers and stray selectors too, and leaves an emoji alone", () => {
      const tag = String.fromCodePoint(0xe0041);
      const filler = String.fromCodePoint(0x3164);
      const selector = String.fromCodePoint(0xfe0f);
      const heart = `${String.fromCodePoint(0x2764)}${selector}`;
      open({
        preview: {
          label: "Text to paste",
          text: `rm a${tag}b ${filler} c${selector} ${heart}`,
        },
      });
      expect(preview().textContent).toBe(
        `rm a⟨U+E0041⟩b ⟨U+3164⟩ c⟨U+FE0F⟩ ${heart}`,
      );
      expect(screen.getByTestId("app-prompt-preview-note")).toBeInTheDocument();
    });

    it("shows a line feed at the very end, without the note", () => {
      open({
        preview: { label: "Text to paste", text: "cd /srv\nrm -rf cache\n" },
      });
      expect(preview().textContent).toBe("cd /srv\nrm -rf cache␊");
      expect(screen.queryByTestId("app-prompt-preview-note")).toBeNull();
    });

    it("does not take the end of an excerpt for the end of the text", () => {
      const long = `${"x".repeat(19_999)}\n${"y".repeat(50)}\n`;
      open({ preview: { label: "Text to paste", text: long } });
      expect(preview().textContent).toBe(long.slice(0, 20_000));
      expect(preview().textContent!.endsWith("\n")).toBe(true);
      expect(screen.getByTestId("app-prompt-preview-more")).toBeInTheDocument();
    });

    it("keeps the preview left to right in a right-to-left layout", () => {
      document.documentElement.dir = "rtl";
      try {
        open();
        expect(preview()).toHaveAttribute("dir", "ltr");
      } finally {
        document.documentElement.removeAttribute("dir");
      }
    });

    it("shows the session's host beside its name, above what will run", () => {
      render(
        <AppPromptDialog
          request={sshScriptRunPrompt({
            script: { name: "Disk usage" },
            command: COMMAND,
            session: { name: "Production web", hostname: "10.0.0.5" },
          })}
          onDecision={vi.fn()}
        />,
      );
      const where = screen.getByRole("region", { name: "Session" });
      expect(where).toBe(screen.getByTestId("app-prompt-targets"));
      expect(within(where).getAllByRole("listitem")).toHaveLength(1);
      expect(where).toHaveTextContent("Production web 10.0.0.5");
      expect(
        where.compareDocumentPosition(preview()) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The title is the one the call sites and the e2e spec know.
      expect(
        screen.getByRole("heading", {
          name: 'Run "Disk usage" on Production web?',
        }),
      ).toBeInTheDocument();
    });

    it("keeps a hostile host on one line, with its hidden characters marked, and bounded", () => {
      const host = `10.0.0.5${String.fromCodePoint(0x200b)}\n${"x".repeat(500)}`;
      render(
        <AppPromptDialog
          request={sshScriptRunPrompt({
            script: { name: "Disk usage" },
            command: COMMAND,
            session: { name: "Production web", hostname: host },
          })}
          onDecision={vi.fn()}
        />,
      );
      const row = within(
        screen.getByRole("region", { name: "Session" }),
      ).getByRole("listitem");
      expect(
        row.textContent!.startsWith("Production web 10.0.0.5⟨U+200B⟩ x"),
      ).toBe(true);
      expect(row.textContent).not.toContain("\n");
      expect(row.textContent!.length).toBeLessThanOrEqual(
        "Production web ".length + 121,
      );
    });

    it("shows a remote path under the name, with its hidden characters marked", async () => {
      const path = `/srv/${String.fromCodePoint(0x202e)}txt.exe\r/notes.txt`;
      const onDecision = vi.fn();
      render(
        <AppPromptDialog
          request={remoteDeletePrompt({ name: "notes.txt", path })}
          onDecision={onDecision}
        />,
      );
      const region = screen.getByRole("region", { name: "Path" });
      expect(region).toBe(preview());
      expect(region.textContent).toBe("/srv/⟨U+202E⟩txt.exe␍\n/notes.txt");
      expect(region).toHaveAttribute("dir", "ltr");
      expect(
        screen.getByRole("heading", {
          name: 'Permanently delete "notes.txt"?',
        }),
      ).toBeInTheDocument();
      await waitFor(() => expect(cancelButton()).toHaveFocus());
    });

    it("bounds the list of targets and says how many more there are", () => {
      const items = Array.from({ length: 620 }, (_, index) => ({
        id: `s${index}`,
        name: `web-${index}`,
        detail: `10.0.${Math.floor(index / 250)}.${index % 250}`,
      }));
      open({ targets: { label: "Runs on", items } });
      const targets = screen.getByTestId("app-prompt-targets");
      expect(targets.querySelectorAll("li")).toHaveLength(500);
      expect(screen.getByTestId("app-prompt-targets-more")).toHaveTextContent(
        "and 120 more",
      );
    });

    it("keeps names on one line and bounded", () => {
      const hostile = `web\u{202E}-01\r\n${"y".repeat(4_000)}`;
      open({
        title: hostile,
        message: hostile,
        confirmLabel: hostile,
        targets: {
          label: "Runs on",
          items: [{ id: "s1", name: hostile, detail: hostile }],
        },
        facts: Array.from({ length: 30 }, () => hostile),
      });
      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-label")!.length).toBeLessThanOrEqual(
        301,
      );
      expect(confirmButton().textContent!.length).toBeLessThanOrEqual(61);
      expect(dialog.textContent).not.toMatch(/[\u{202A}-\u{202E}\r]/u);
      expect(dialog.textContent!.length).toBeLessThan(
        COMMAND.length + 301 + 601 + 61 + 2 * 121 + 8 * 61 + 200,
      );
    });
  });

  describe("motion", () => {
    it("enters with the house animation", () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: false })),
      );
      open();
      expect(screen.getByRole("dialog")).toHaveClass(styles.enter);
    });

    it("does not animate when reduced motion is requested", () => {
      const matchMedia = vi.fn(() => ({ matches: true }));
      vi.stubGlobal("matchMedia", matchMedia);
      open();
      expect(matchMedia).toHaveBeenCalledWith(
        "(prefers-reduced-motion: reduce)",
      );
      expect(screen.getByRole("dialog")).not.toHaveClass(styles.enter);
    });

    it("answers at once, with no exit delay", () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal(
          "matchMedia",
          vi.fn(() => ({ matches: false })),
        );
        const { onDecision } = open();
        const timersBefore = vi.getTimerCount();
        fireEvent.click(confirmButton());
        expect(onDecision).toHaveBeenCalledTimes(1);
        // Nothing was scheduled to delay the answer.
        expect(vi.getTimerCount()).toBe(timersBefore);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("stacking, theme and source rules", () => {
    const tsx = readFileSync(TSX_PATH, "utf8");
    const css = readFileSync(CSS_PATH, "utf8");
    const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");

    it("puts its backdrop above fullscreen sessions and below menus and toasts", () => {
      open();
      expect(backdrop()).toHaveClass("sor-modal-backdrop", styles.backdrop);
      const rule = cssRules.match(
        /:global\(\.sor-modal-backdrop\)\.backdrop\s*\{([^}]*)\}/,
      );
      expect(rule).not.toBeNull();
      const zIndex = Number(rule![1].match(/z-index:\s*(\d+)/)?.[1]);
      expect(zIndex).toBe(1500);
      // Fullscreen session root 1200, its exit control 1400; menus and toasts 9999.
      expect(zIndex).toBeGreaterThan(1400);
      expect(zIndex).toBeLessThan(9999);
    });

    it("keeps a fixed width and scrolls long content inside, so the footer stays put", () => {
      open({
        targets: {
          label: "Runs on",
          items: [{ id: "s1", name: "web-01", detail: "10.0.0.1" }],
        },
      });
      expect(screen.getByRole("dialog")).toHaveClass("max-w-xl");
      expect(preview()).toHaveClass(styles.scroll);
      expect(screen.getByTestId("app-prompt-targets")).toHaveClass(
        styles.scroll,
      );
      const scroll = cssRules.match(/\.scroll\s*\{([^}]*)\}/)?.[1] ?? "";
      expect(scroll).toMatch(/overflow(-y)?:\s*auto/);
      for (const name of ["preview", "targets"]) {
        const block =
          cssRules.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
        expect(block).toMatch(/max-height:\s*[\d.]+rem/);
      }
      // The footer is outside the scrolling body.
      const footer = cancelButton().parentElement!;
      expect(footer).toHaveClass("sor-modal-footer");
      expect(footer.closest(".sor-modal-body")).toBeNull();
    });

    it("uses the house entrance timing and switches it off for reduced motion", () => {
      const enter = cssRules.match(/\.enter\s*\{([^}]*)\}/)?.[1] ?? "";
      const duration = Number(enter.match(/animation:[^;]*?(\d+)ms/)?.[1]);
      expect(duration).toBeGreaterThanOrEqual(160);
      expect(duration).toBeLessThanOrEqual(180);
      expect(enter).toMatch(/ease-out/);
      expect(cssRules).toMatch(
        /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.enter\s*\{\s*animation:\s*none;?\s*\}\s*\}/,
      );
      expect(cssRules).not.toMatch(/exit/);
    });

    it("takes every colour from the theme", () => {
      for (const source of [tsx, cssRules]) {
        expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(source).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\(/);
        expect(source).not.toMatch(
          /\b(?:bg|text|border|ring|outline)-(?:white|black|gray|slate|zinc|neutral|red|green|blue|yellow|orange|amber)\b/,
        );
      }
      expect(cssRules).not.toMatch(
        /:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange)\s*[;}]/,
      );
    });

    it("never reaches for a native dialog, raw markup or the console", () => {
      expect(tsx).not.toMatch(/\b(?:alert|confirm|prompt)\s*\(/);
      expect(tsx).not.toContain("dangerouslySetInnerHTML");
      expect(tsx).not.toContain("innerHTML");
      expect(tsx).not.toMatch(/console\./);
      expect(tsx).not.toMatch(/localStorage|sessionStorage/);
    });
  });

  describe("a group of choices", () => {
    const LEGEND = "Next time this script is run";
    const NOTE =
      "A lasting choice covers this exact script. You are asked again when it changes.";
    const group = (
      overrides: Partial<NonNullable<PromptRequest["choices"]>> = {},
    ): NonNullable<PromptRequest["choices"]> => ({
      label: LEGEND,
      options: [
        { id: "ask", label: "Ask every time" },
        {
          id: "session",
          label: "Don't ask again in this session",
          hint: "Until the session ends or the script changes.",
        },
        {
          id: "connection",
          label: "Always run it without asking on this connection",
          hint: "Only this exact script, only on this saved connection.",
        },
        {
          id: "everywhere",
          label: "Always run it without asking on every connection",
          hint: "Only this exact script, in any SSH session.",
        },
      ],
      note: NOTE,
      ...overrides,
    });
    const openGroup = (overrides: Partial<PromptRequest> = {}) =>
      open({ choices: group(), ...overrides });
    const radios = () =>
      screen.getAllByTestId("app-prompt-choice") as HTMLInputElement[];
    const radio = (id: string) => radios().find((input) => input.value === id)!;
    const checked = () =>
      radios()
        .filter((input) => input.checked)
        .map((input) => input.value);
    const decisionOf = (onDecision: ReturnType<typeof vi.fn>) => {
      expect(onDecision).toHaveBeenCalledTimes(1);
      return onDecision.mock.calls[0][0];
    };

    it("is a group named by its legend, with one native radio per answer and its hint", () => {
      openGroup();
      const fieldset = screen.getByTestId("app-prompt-choices");
      expect(fieldset.tagName).toBe("FIELDSET");
      expect(screen.getByRole("group", { name: LEGEND })).toBe(fieldset);
      expect(fieldset.querySelector("legend")).toHaveTextContent(LEGEND);

      const inputs = radios();
      expect(inputs.map((input) => input.value)).toEqual([
        "ask",
        "session",
        "connection",
        "everywhere",
      ]);
      const names = new Set(inputs.map((input) => input.name));
      expect(names.size).toBe(1);
      expect([...names][0]).toBeTruthy();
      for (const input of inputs) {
        expect(input.tagName).toBe("INPUT");
        expect(input.type).toBe("radio");
        expect(input.closest("label")).not.toBeNull();
        expect(fieldset).toContainElement(input);
      }
      expect(
        screen.getByRole("radio", { name: "Ask every time" }),
      ).not.toHaveAttribute("aria-describedby");
      expect(
        screen.getByRole("radio", {
          name: "Always run it without asking on this connection",
        }),
      ).toHaveAccessibleDescription(
        "Only this exact script, only on this saved connection.",
      );
      expect(
        screen.getByRole("radio", {
          name: "Always run it without asking on every connection",
        }),
      ).toHaveAccessibleDescription(
        "Only this exact script, in any SSH session.",
      );
      const note = screen.getByTestId("app-prompt-choices-note");
      expect(note).toHaveTextContent(NOTE);
      expect(fieldset).toHaveAccessibleDescription(NOTE);
      expect(fieldset).toContainElement(note);
    });

    it("sits between the facts and the hint, and leaves the dialog's description alone", () => {
      openGroup({ facts: ["bash"], hint: "Settings, Macros" });
      const order = Array.from(
        document.querySelectorAll(
          "[data-testid='app-prompt-facts'], [data-testid='app-prompt-choices'], [data-testid='app-prompt-hint']",
        ),
        (element) => element.getAttribute("data-testid"),
      );
      expect(order).toEqual([
        "app-prompt-facts",
        "app-prompt-choices",
        "app-prompt-hint",
      ]);
      expect(screen.getByRole("dialog")).toHaveAccessibleDescription(MESSAGE);
    });

    it("G1: opens with the first answer selected, and only that one", () => {
      openGroup();
      expect(checked()).toEqual(["ask"]);
      cleanup();
      // Whatever the first answer is.
      openGroup({
        choices: group({ options: [...group().options].reverse() }),
      });
      expect(checked()).toEqual(["everywhere"]);
    });

    it("G2: a pointer click selects at once", () => {
      openGroup();
      now = 10_001;
      trustedClick(radio("connection"), 1);
      expect(checked()).toEqual(["connection"]);
      trustedClick(radio("session"), 1);
      expect(checked()).toEqual(["session"]);
    });

    it("G2: a click a script dispatches selects nothing, armed or not", () => {
      openGroup();
      fireEvent.click(radio("everywhere"));
      expect(checked()).toEqual(["ask"]);
      now = 20_000;
      fireEvent.click(radio("connection"));
      fireEvent.click(radio("everywhere"), { detail: 1 });
      expect(checked()).toEqual(["ask"]);
    });

    it("G2: a selection made from the keyboard waits until the prompt can be read", () => {
      openGroup();
      // Space or an arrow key makes the browser click the radio, with no pointer.
      now = 10_100;
      trustedClick(radio("everywhere"), 0);
      now = 10_299;
      trustedClick(radio("connection"), 0);
      expect(checked()).toEqual(["ask"]);
      now = 10_300;
      trustedClick(radio("connection"), 0);
      expect(checked()).toEqual(["connection"]);
    });

    it("G2: refuses the keys that select before the prompt can be read, and on repeat", () => {
      openGroup();
      const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", " "];
      for (const key of keys) {
        now = 10_100;
        expect(fireEvent.keyDown(radio("ask"), { key })).toBe(false);
        now = 10_299;
        expect(fireEvent.keyDown(radio("ask"), { key })).toBe(false);
        now = 10_300;
        expect(fireEvent.keyDown(radio("ask"), { key })).toBe(true);
        expect(fireEvent.keyDown(radio("ask"), { key, repeat: true })).toBe(
          false,
        );
      }
      // Moving on with Tab, and any other key, is never refused.
      now = 10_000;
      expect(fireEvent.keyDown(radio("ask"), { key: "Tab" })).toBe(true);
      expect(fireEvent.keyDown(radio("ask"), { key: "a", repeat: true })).toBe(
        true,
      );
      expect(checked()).toEqual(["ask"]);
    });

    it("G2: the second click of a double click changes nothing", () => {
      openGroup();
      now = 20_000;
      trustedClick(radio("everywhere"), 2);
      fireEvent.click(radio("everywhere"), { detail: 2 });
      expect(checked()).toEqual(["ask"]);
      trustedClick(radio("connection"), 1);
      trustedClick(radio("everywhere"), 2);
      expect(checked()).toEqual(["connection"]);
    });

    it("G3: a trusted click on the action, once the prompt can be read, reports the choice", () => {
      const { onDecision } = openGroup();
      now = 10_050;
      trustedClick(radio("connection"), 1);
      now = 10_300;
      trustedClick(confirmButton(), 1);
      expect(decisionOf(onDecision)).toStrictEqual({
        confirmed: true,
        remember: false,
        choice: "connection",
      });
    });

    it("G3: reports the first answer when nothing else was chosen", () => {
      const { onDecision } = openGroup();
      now = 10_300;
      trustedClick(confirmButton(), 1);
      expect(decisionOf(onDecision)).toStrictEqual({
        confirmed: true,
        remember: false,
        choice: "ask",
      });
    });

    it("G3: a click a script dispatches still confirms, but carries no choice", () => {
      const { onDecision } = openGroup();
      now = 10_050;
      trustedClick(radio("everywhere"), 1);
      now = 20_000;
      fireEvent.click(confirmButton());
      expect(decisionOf(onDecision)).toStrictEqual({
        confirmed: true,
        remember: false,
      });
    });

    it("G3: a confirm before the prompt can be read carries no choice", () => {
      const { onDecision } = openGroup();
      now = 10_050;
      trustedClick(radio("everywhere"), 1);
      now = 10_299;
      trustedClick(confirmButton(), 1);
      expect(decisionOf(onDecision)).toStrictEqual({
        confirmed: true,
        remember: false,
      });
    });

    it("G3: a confirm from the keyboard, once readable, reports the choice", () => {
      const { onDecision } = openGroup();
      now = 10_300;
      trustedClick(radio("everywhere"), 0);
      trustedClick(confirmButton(), 0);
      expect(decisionOf(onDecision)).toStrictEqual({
        confirmed: true,
        remember: false,
        choice: "everywhere",
      });
    });

    it.each([
      ["Cancel", () => trustedClick(cancelButton(), 1)],
      [
        "the close button",
        () => trustedClick(screen.getByRole("button", { name: "Close" }), 1),
      ],
      ["the backdrop", () => fireEvent.click(backdrop())],
      ["a script-dispatched Cancel", () => fireEvent.click(cancelButton())],
    ])(
      "G4: %s answers not confirmed, whatever is selected",
      (_what, dismiss) => {
        const { onDecision } = openGroup();
        now = 10_050;
        trustedClick(radio("everywhere"), 1);
        now = 20_000;
        dismiss();
        expect(decisionOf(onDecision)).toStrictEqual({
          confirmed: false,
          remember: false,
        });
      },
    );

    it("G5: Enter on a radio answers nothing", async () => {
      const { onDecision } = openGroup();
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      now = 20_000;
      trustedClick(radio("connection"), 1);
      radio("connection").focus();
      for (const target of [radio("connection"), radio("ask")]) {
        fireEvent.keyDown(target, { key: "Enter" });
        fireEvent.keyPress(target, { key: "Enter", charCode: 13 });
        fireEvent.keyUp(target, { key: "Enter" });
      }
      expect(onDecision).not.toHaveBeenCalled();
      expect(checked()).toEqual(["connection"]);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("G5: the focus still opens on the button the request names, and Tab reaches the group", async () => {
      const first = openGroup();
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      for (const input of radios()) {
        expect(input.tabIndex).toBe(0);
        expect(input).not.toBeDisabled();
      }
      first.unmount();
      openGroup({ tone: "danger" });
      await waitFor(() => expect(cancelButton()).toHaveFocus());
    });

    it("marks a danger note with the warning icon and the error colour, never colour alone", () => {
      const quiet = openGroup();
      const plain = screen.getByTestId("app-prompt-choices-note");
      expect(plain.querySelector("svg")).toBeNull();
      expect(plain).not.toHaveClass("text-error");
      quiet.unmount();

      openGroup({ choices: group({ noteTone: "danger" }) });
      const danger = screen.getByTestId("app-prompt-choices-note");
      const icon = danger.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(danger).toHaveClass("text-error");
      expect(danger).toHaveTextContent(NOTE);
      expect(
        screen.getByTestId("app-prompt-choices"),
      ).toHaveAccessibleDescription(NOTE);
    });

    it("adds no note when there is none", () => {
      openGroup({ choices: group({ note: undefined }) });
      expect(screen.queryByTestId("app-prompt-choices-note")).toBeNull();
      expect(screen.getByTestId("app-prompt-choices")).not.toHaveAttribute(
        "aria-describedby",
      );
    });

    it("shows untrusted text in the group as text, on one line and bounded", () => {
      const markup = '<img src=x onerror="alert(1)"><b>bold</b>';
      const long = `evil\u{202E}txt\r\n${"x".repeat(900)}`;
      const { baseElement } = openGroup({
        choices: {
          label: `${markup}${long}`,
          options: [
            { id: "ask", label: `${markup}${long}`, hint: `${markup}${long}` },
            { id: "b", label: markup },
          ],
          note: `${markup}${long}`,
        },
      });
      expect(baseElement.querySelector("img")).toBeNull();
      expect(baseElement.querySelector("b")).toBeNull();
      const fieldset = screen.getByTestId("app-prompt-choices");
      expect(fieldset.textContent).not.toMatch(/[\u{202A}-\u{202E}\r\n]/u);
      expect(
        fieldset.querySelector("legend")!.textContent!.length,
      ).toBeLessThanOrEqual(121);
      expect(radio("b").closest("label")).toHaveTextContent(markup);
      expect(fieldset.textContent!.length).toBeLessThan(121 * 3 + 601 * 2 + 60);
    });

    it("S15: a request without a group renders nothing of it and answers as before", () => {
      const { onDecision, baseElement } = open({
        remember: { label: "Don't ask again" },
        facts: ["bash"],
        hint: "Settings, Macros",
      });
      expect(
        baseElement.querySelectorAll(
          "fieldset, legend, input[type='radio'], [data-testid^='app-prompt-choice']",
        ),
      ).toHaveLength(0);
      now = 20_000;
      trustedClick(confirmButton(), 1);
      expect(decisionOf(onDecision)).toStrictEqual({
        confirmed: true,
        remember: false,
      });
    });
  });
});
