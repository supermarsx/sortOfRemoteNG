import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppPromptDialog } from "../../src/components/ui/dialogs/AppPromptDialog";
import styles from "../../src/components/ui/dialogs/AppPromptDialog.module.css";
import type { PromptRequest } from "../../src/utils/prompts/promptQueue";

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
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
});
