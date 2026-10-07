import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocumentHistoryControls from "../../src/components/documents/DocumentHistoryControls";
afterEach(cleanup);
describe("document history controls", () => {
  it("exposes single-step buttons and a keyboard-accessible multi-step menu", () => {
    const onStep = vi.fn();
    render(
      <DocumentHistoryControls
        undo={["Rename document", "Insert content", "Change icon"]}
        redo={["Move document"]}
        disabled={false}
        onStep={onStep}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo document edit" }));
    expect(onStep).toHaveBeenCalledWith("undo", 1);
    fireEvent.click(screen.getByRole("button", { name: "Undo history" }));
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.click(items[1]);
    expect(onStep).toHaveBeenLastCalledWith("undo", 2);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Redo history" }));
    fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Redo history" })).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("closes when access is revoked and disables unavailable operations", () => {
    const props = {
      undo: ["Edit text"],
      redo: [],
      disabled: false,
      onStep: vi.fn(),
    };
    const { rerender } = render(<DocumentHistoryControls {...props} />);
    expect(screen.getByRole("button", { name: "Redo history" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo history" }));
    rerender(<DocumentHistoryControls {...props} disabled />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo document edit" }));
    expect(props.onStep).not.toHaveBeenCalled();
  });
});
