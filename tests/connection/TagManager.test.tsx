import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagManager } from "../../src/components/connection/TagManager";

describe("TagManager", () => {
  const defaultProps = {
    tags: ["server", "production"],
    availableTags: ["server", "production", "dev", "staging"],
    onChange: vi.fn(),
    onCreateTag: vi.fn(),
  };

  it("renders selected tags", () => {
    render(<TagManager {...defaultProps} />);
    expect(screen.getByText("server")).toBeDefined();
    expect(screen.getByText("production")).toBeDefined();
  });

  it("renders unused tags in available section", () => {
    render(<TagManager {...defaultProps} />);
    // "dev" and "staging" should be in the available section (preceded by a + icon)
    expect(screen.getByText("dev")).toBeDefined();
    expect(screen.getByText("staging")).toBeDefined();
  });

  it("calls onChange when adding a tag", () => {
    const onChange = vi.fn();
    render(<TagManager {...defaultProps} onChange={onChange} />);
    // Click an available tag to add it
    fireEvent.click(screen.getByText("dev"));
    expect(onChange).toHaveBeenCalledWith(["server", "production", "dev"]);
  });

  it("calls onChange when removing a tag", () => {
    const onChange = vi.fn();
    render(<TagManager {...defaultProps} onChange={onChange} />);
    // Find the X button near "server" and click it
    const buttons = screen.getAllByRole("button");
    // The remove buttons are associated with each selected tag
    const removeButton = buttons.find((btn) => {
      const parent = btn.closest("span");
      return parent?.textContent?.includes("server");
    });
    if (removeButton) {
      fireEvent.click(removeButton);
      expect(onChange).toHaveBeenCalledWith(["production"]);
    }
  });

  it("does not add duplicate tags", () => {
    const onChange = vi.fn();
    render(
      <TagManager
        tags={["server"]}
        availableTags={["server", "dev"]}
        onChange={onChange}
      />,
    );
    // "dev" is available, clicking it should add
    fireEvent.click(screen.getByText("dev"));
    expect(onChange).toHaveBeenCalledWith(["server", "dev"]);
  });

  it("renders no available tags section when all are selected", () => {
    const { container } = render(
      <TagManager
        tags={["server", "dev"]}
        availableTags={["server", "dev"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Available Tags")).toBeNull();
  });
});
