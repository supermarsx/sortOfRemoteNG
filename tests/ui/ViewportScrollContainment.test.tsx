import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "../../src/components/ui/forms/Select";
import { Modal } from "../../src/components/ui/overlays/Modal";
import { useSettingHighlight } from "../../src/components/SettingsDialog/useSettingHighlight";

function size(
  element: HTMLElement,
  top: number,
  bottom: number,
  height: number,
  content: number,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 200,
    width: 200,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: content },
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("owned UI scroll lanes", () => {
  it("highlights and scrolls only the settings pane, not its shell or document", () => {
    vi.useFakeTimers();
    const { container } = render(
      <div data-testid="shell">
        <div data-settings-scroll-container>
          <div data-setting-key="target">Target</div>
        </div>
      </div>,
    );
    const shell = screen.getByTestId("shell");
    const pane = container.querySelector<HTMLElement>(
      "[data-settings-scroll-container]",
    )!;
    const target = screen.getByText("Target");
    size(pane, 100, 300, 200, 1000);
    size(target, 700, 740, 40, 40);
    shell.scrollTop = 27;
    const ancestorScroll = vi.spyOn(target, "scrollIntoView");
    renderHook(() => useSettingHighlight("target"));
    act(() => vi.advanceTimersByTime(100));
    expect(pane.scrollTop).toBe(456);
    expect(shell.scrollTop).toBe(27);
    expect(ancestorScroll).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-testid", "settings-search-highlight");
  });

  it("still highlights anchors outside a settings pane without scrolling document ancestors", () => {
    vi.useFakeTimers();
    render(<div data-setting-key="standalone">Standalone</div>);
    const target = screen.getByText("Standalone");
    const scroll = vi.spyOn(target, "scrollIntoView");
    renderHook(() => useSettingHighlight("standalone"));
    act(() => vi.advanceTimersByTime(100));
    expect(scroll).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-testid", "settings-search-highlight");
  });

  it("reveals keyboard-highlighted options inside the list and restores focus without scrolling ancestors", () => {
    render(
      <Select
        value="a"
        onChange={vi.fn()}
        options={[
          { value: "a", label: "Alpha" },
          { value: "z", label: "Zulu" },
        ]}
      />,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: "Zulu" });
    const pane = option.parentElement!;
    size(pane, 100, 200, 100, 500);
    size(option, 400, 440, 40, 40);
    const scroll = vi.spyOn(option, "scrollIntoView");
    const focus = vi.spyOn(trigger, "focus");
    fireEvent.keyDown(trigger, { key: "End" });
    expect(pane.scrollTop).toBe(240);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("keeps modal focus trapping/restoration accessible without ancestor scrolling", async () => {
    const { rerender } = render(
      <>
        <button>Opener</button>
        <Modal isOpen={false}>
          <button>First</button>
          <button>Last</button>
        </Modal>
      </>,
    );
    const opener = screen.getByText("Opener");
    opener.focus();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    rerender(
      <>
        <button>Opener</button>
        <Modal isOpen>
          <button>First</button>
          <button>Last</button>
        </Modal>
      </>,
    );
    const first = screen.getByText("First");
    const last = screen.getByText("Last");
    await waitFor(() => expect(first).toHaveFocus());
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    rerender(
      <>
        <button>Opener</button>
        <Modal isOpen={false}>
          <button>First</button>
          <button>Last</button>
        </Modal>
      </>,
    );
    expect(opener).toHaveFocus();
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });
});
