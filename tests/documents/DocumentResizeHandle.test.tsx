import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocumentResizeHandle from "../../src/components/documents/DocumentResizeHandle";
import ResizableDocumentView from "../../src/components/documents/ResizableDocumentView";

afterEach(cleanup);

function pointer(type: string, position: number, id = 1) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: position,
    clientY: position,
  });
  Object.defineProperty(event, "pointerId", { value: id });
  return event;
}

describe("document resizing", () => {
  it("allows the full owning pane on large monitors and updates both resize limits", () => {
    render(
      <ResizableDocumentView className="pane">
        <input aria-label="Draft" defaultValue="unsaved" />
      </ResizableDocumentView>,
    );
    const area = screen.getByRole("main").firstElementChild!;
    const frame = area.firstElementChild!;
    const width = screen.getByRole("separator", {
      name: "Document view width",
    });
    const height = screen.getByRole("separator", {
      name: "Document view height",
    });
    for (const [paneWidth, paneHeight] of [
      [3840, 2160],
      [5120, 2880],
    ]) {
      Object.defineProperties(area, {
        clientWidth: { configurable: true, value: paneWidth },
        clientHeight: { configurable: true, value: paneHeight },
      });
      fireEvent(window, new Event("resize"));
      fireEvent.keyDown(width, { key: "Home" });
      fireEvent.keyDown(height, { key: "Home" });
      expect(width).toHaveAttribute("aria-valuenow", "320");
      expect(height).toHaveAttribute("aria-valuenow", "240");
      fireEvent.keyDown(width, { key: "End" });
      fireEvent.keyDown(height, { key: "End" });
      expect(width).toHaveAttribute("aria-valuemax", String(paneWidth - 8));
      expect(height).toHaveAttribute("aria-valuemax", String(paneHeight - 8));
      expect(width).toHaveAttribute("aria-valuenow", String(paneWidth - 8));
      expect(height).toHaveAttribute("aria-valuenow", String(paneHeight - 8));
      expect(frame).toHaveStyle({
        width: `${paneWidth}px`,
        height: `${paneHeight}px`,
      });
    }
    expect(screen.getByRole("textbox")).toHaveValue("unsaved");
  });

  it.each(["width", "height"] as const)(
    "bounds %s drags and stops on cancel or unmount",
    (axis) => {
      const changed = vi.fn();
      function Harness() {
        const [value, setValue] = useState(300);
        return (
          <DocumentResizeHandle
            axis={axis}
            label="Resize"
            controls="pane"
            min={200}
            max={500}
            value={value}
            onChange={(next) => {
              changed(next);
              setValue(next);
            }}
          />
        );
      }
      const view = render(<Harness />);
      const handle = screen.getByRole("separator");
      fireEvent(handle, pointer("pointerdown", 100));
      fireEvent(window, pointer("pointermove", 2000, 2));
      expect(changed).not.toHaveBeenCalled();
      fireEvent(window, pointer("pointermove", 2000));
      expect(handle).toHaveAttribute("aria-valuenow", "500");
      fireEvent(window, pointer("pointermove", -2000));
      expect(handle).toHaveAttribute("aria-valuenow", "200");
      fireEvent(window, pointer("pointercancel", 0));
      fireEvent(window, pointer("pointermove", 500));
      expect(changed).toHaveBeenCalledTimes(2);
      fireEvent(handle, pointer("pointerdown", 100));
      view.unmount();
      fireEvent(window, pointer("pointermove", 200));
      expect(changed).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the view inside a smaller tiled pane and restores preferred dimensions when space returns", () => {
    render(
      <ResizableDocumentView className="pane">
        <input aria-label="Draft" defaultValue="unsaved" />
      </ResizableDocumentView>,
    );
    const draft = screen.getByRole("textbox");
    const area = screen.getByRole("main").firstElementChild!;
    const width = screen.getByRole("separator", {
      name: "Document view width",
    });
    const height = screen.getByRole("separator", {
      name: "Document view height",
    });
    fireEvent.keyDown(width, { key: "Home" });
    fireEvent.keyDown(height, { key: "Home" });
    Object.defineProperties(area, {
      clientWidth: { configurable: true, value: 200 },
      clientHeight: { configurable: true, value: 150 },
    });
    fireEvent(window, new Event("resize"));
    expect(width).toHaveAttribute("aria-valuenow", "192");
    expect(height).toHaveAttribute("aria-valuenow", "142");
    expect(width).toHaveAttribute("aria-valuemin", "192");
    Object.defineProperties(area, {
      clientWidth: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 600 },
    });
    fireEvent(window, new Event("resize"));
    expect(width).toHaveAttribute("aria-valuenow", "320");
    expect(height).toHaveAttribute("aria-valuenow", "240");
    expect(screen.getByRole("textbox")).toBe(draft);
    expect(draft).toHaveValue("unsaved");
  });
});
