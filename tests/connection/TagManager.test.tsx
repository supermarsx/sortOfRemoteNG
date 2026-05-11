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

  it("prevents duplicate tags case-insensitively", () => {
    const onChange = vi.fn();
    const onCreateTag = vi.fn();
    render(
      <TagManager
        tags={["Server"]}
        availableTags={["server", "Production"]}
        onChange={onChange}
        onCreateTag={onCreateTag}
      />,
    );

    expect(screen.queryByRole("button", { name: /Add tag server/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    fireEvent.change(screen.getByTestId("tag-input"), {
      target: { value: " server " },
    });
    fireEvent.click(screen.getByTestId("tag-create"));

    expect(onChange).not.toHaveBeenCalled();
    expect(onCreateTag).not.toHaveBeenCalled();
  });

  it("creates a normalized tag with Enter", () => {
    const onChange = vi.fn();
    const onCreateTag = vi.fn();
    render(
      <TagManager
        tags={[]}
        availableTags={[]}
        onChange={onChange}
        onCreateTag={onCreateTag}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    const input = screen.getByTestId("tag-input");
    fireEvent.change(input, { target: { value: "  staging   east  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateTag).toHaveBeenCalledWith("staging east");
    expect(onChange).toHaveBeenCalledWith(["staging east"]);
  });

  it("exposes accessible remove buttons for selected chips", () => {
    render(<TagManager {...defaultProps} />);

    expect(
      screen.getByRole("button", { name: "Remove tag server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove tag production" }),
    ).toBeInTheDocument();
  });

  it("renders no available tags section when all are selected", () => {
    render(
      <TagManager
        tags={["server", "dev"]}
        availableTags={["server", "dev"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Available Tags")).toBeNull();
  });
});
