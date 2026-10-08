import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OriginPageTools from "../../src/components/protocol/webBrowser/OriginPageTools";
import type { OriginBrowserController } from "../../src/hooks/protocol/useOriginBrowser";
import type { OriginFindResult } from "../../src/hooks/protocol/useOriginFind";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function controller(): OriginBrowserController {
  return {
    state: {
      phase: "attached",
      snapshot: null,
      error: null,
      unavailableReason: null,
    },
    setViewport: vi.fn(),
    navigate: vi.fn(),
    focus: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    reconnect: vi.fn(),
    zoom: vi.fn().mockResolvedValue(true),
    find: vi.fn().mockResolvedValue(true),
    stopFind: vi.fn().mockResolvedValue(true),
  };
}
const settle = () => act(async () => {});
const debounce = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
function requestId(browser: OriginBrowserController) {
  const calls = vi.mocked(browser.find).mock.calls;
  return (calls[calls.length - 1] as unknown as unknown[])[4] as string;
}

describe("compact native find bar", () => {
  it("autofocuses one app-styled inline search without hiding the native page", async () => {
    const browser = controller();
    render(<OriginPageTools controller={browser} enabled defaultZoom={100} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    const input = screen.getByRole("textbox", { name: "Find text" });
    expect(input).toHaveFocus();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("search")).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".sor-modal-backdrop")).toBeNull();
    expect(browser.focus).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Type to search");
  });

  it("supports Enter, Shift+Enter and Escape without submitting the enclosing address form", async () => {
    const browser = controller(),
      submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <OriginPageTools controller={browser} enabled defaultZoom={100} />
      </form>,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    const input = screen.getByRole("textbox", { name: "Find text" });
    fireEvent.change(input, { target: { value: "needle" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(browser.find).toHaveBeenLastCalledWith(
      "needle",
      true,
      false,
      false,
      expect.any(String),
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await settle();
    expect(browser.find).toHaveBeenLastCalledWith(
      "needle",
      false,
      false,
      true,
      expect.any(String),
    );
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Match case" }), {
      key: "Escape",
    });
    await settle();
    expect(browser.stopFind).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("textbox", { name: "Find text" })).toBeNull();
    expect(screen.getByRole("button", { name: "Find in page" })).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports actual correlated current/total, zero matches, and case-sensitive rescans", async () => {
    const browser = controller();
    const view = render(
      <OriginPageTools controller={browser} enabled defaultZoom={100} />,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find text" }), {
      target: { value: "Search" },
    });
    await debounce();
    expect(screen.getByRole("status")).toHaveTextContent("Search sent");
    const result: OriginFindResult = {
      requestId: requestId(browser),
      activeMatchOrdinal: 2,
      numberOfMatches: 7,
      finalUpdate: true,
    };
    view.rerender(
      <OriginPageTools
        controller={browser}
        enabled
        defaultZoom={100}
        findResult={result}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 of 7");
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    await debounce();
    expect(browser.find).toHaveBeenLastCalledWith(
      "Search",
      true,
      true,
      false,
      expect.any(String),
    );
    view.rerender(
      <OriginPageTools
        controller={browser}
        enabled
        defaultZoom={100}
        findResult={{
          requestId: requestId(browser),
          activeMatchOrdinal: 0,
          numberOfMatches: 0,
          finalUpdate: true,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    expect(screen.getByRole("textbox", { name: "Find text" })).toHaveValue(
      "Search",
    );
  });

  it("never locks input or Escape behind a pending IPC request", async () => {
    let resolve!: (value: boolean) => void;
    const browser = controller();
    vi.mocked(browser.find).mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    render(<OriginPageTools controller={browser} enabled defaultZoom={100} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    const input = screen.getByRole("textbox", { name: "Find text" });
    fireEvent.change(input, { target: { value: "first" } });
    await debounce();
    expect(input).not.toHaveAttribute("readonly");
    fireEvent.change(input, { target: { value: "second" } });
    expect(input).toHaveValue("second");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    await act(async () => resolve(true));
    expect(browser.stopFind).toHaveBeenCalledWith(true);
    expect(browser.find).toHaveBeenCalledTimes(1);
  });

  it("opens/refocuses with the shell shortcut or menu request, but not while inactive", async () => {
    const browser = controller();
    const view = render(
      <OriginPageTools controller={browser} enabled defaultZoom={100} />,
    );
    await settle();
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = screen.getByRole("textbox", { name: "Find text" });
    fireEvent.change(input, { target: { value: "select me" } });
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(input).toHaveFocus();
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(9);
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    await settle();
    view.rerender(
      <OriginPageTools
        controller={browser}
        enabled={false}
        defaultZoom={100}
        findOpenRequest={1}
      />,
    );
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.queryByRole("search")).toBeNull();
    view.rerender(
      <OriginPageTools
        controller={browser}
        enabled
        defaultZoom={100}
        findOpenRequest={1}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Find text" })).toHaveFocus();
  });

  it("discards UI state on selected-view change and keeps the zoom display narrow", async () => {
    const browser = controller();
    const view = render(
      <OriginPageTools
        controller={browser}
        enabled
        defaultZoom={125}
        activeViewKey="root"
      />,
    );
    await settle();
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("125%");
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveClass(
      "min-w-11",
    );
    fireEvent.click(screen.getByRole("button", { name: "Find in page" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find text" }), {
      target: { value: "root-only" },
    });
    view.rerender(
      <OriginPageTools
        controller={browser}
        enabled
        defaultZoom={125}
        activeViewKey="popup"
      />,
    );
    await debounce();
    expect(screen.queryByRole("search")).toBeNull();
    expect(browser.find).not.toHaveBeenCalled();
    expect(browser.stopFind).not.toHaveBeenCalled();
  });
});
