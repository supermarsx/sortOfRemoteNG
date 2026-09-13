import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebsiteMacroEditor } from "../../src/components/recording/WebsiteMacroEditor";
import type { WebInteractionMacro } from "../../src/types/recording/webAutomation";

afterEach(cleanup);
const macro: WebInteractionMacro = {
  id: "fixture",
  kind: "macro",
  name: "Public action",
  description: "",
  createdAt: "2026-09-13",
  updatedAt: "2026-09-13",
  steps: [{ kind: "click", selector: "html > body > button:nth-of-type(1)" }],
};
const props = () => ({
  macro,
  onChange: vi.fn(),
  onSave: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
});

describe("recording editor themed dropdowns", () => {
  it("changes the real macro action through themed keyboard and pointer choices without inventing fill secrets", () => {
    const p = props();
    const { rerender } = render(<WebsiteMacroEditor {...p} />);
    const trigger = screen.getByRole("combobox", { name: "Action 1" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveClass("sor-select-trigger");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Set checkbox" }));
    expect(p.onChange).toHaveBeenLastCalledWith({
      ...macro,
      steps: [
        { kind: "check", selector: macro.steps[0].selector, checked: true },
      ],
    });
    rerender(<WebsiteMacroEditor {...p} macro={p.onChange.mock.calls[0][0]} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Action 1" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Fill (prompt at replay)" }),
    );
    expect(p.onChange).toHaveBeenLastCalledWith({
      ...macro,
      steps: [{ kind: "fill", selector: macro.steps[0].selector }],
    });
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("does not mutate a disabled editor even when a portal option was already open", () => {
    const p = props();
    const { rerender } = render(<WebsiteMacroEditor {...p} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Action 1" }));
    expect(
      screen.getByRole("option", { name: "Set checkbox" }),
    ).toBeInTheDocument();
    rerender(<WebsiteMacroEditor {...p} disabled />);
    expect(screen.getByRole("combobox", { name: "Action 1" })).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole("option", { name: "Set checkbox" }));
    expect(p.onChange).not.toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
  });
});
