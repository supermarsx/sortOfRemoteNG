import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OptionEmptyState,
  OptionGroup,
  OptionItemButton,
  OptionList,
} from "../src/components/ui/OptionList";

describe("OptionList primitives", () => {
  it("renders option group labels and empty state content", () => {
    render(
      <OptionList data-testid="option-list">
        <OptionGroup label="Actions">
          <OptionEmptyState>No options</OptionEmptyState>
        </OptionGroup>
      </OptionList>,
    );

    expect(screen.getByTestId("option-list")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("No options")).toBeInTheDocument();
  });

  it("handles option item click and selected styling", () => {
    const onSelect = vi.fn();

    render(
      <OptionList>
        <OptionItemButton onClick={onSelect} selected>
          Select me
        </OptionItemButton>
      </OptionList>,
    );

    const button = screen.getByRole("button", { name: "Select me" });
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(button.className).toContain("sor-option-item-selected");
  });

  it("respects disabled option item state", () => {
    const onSelect = vi.fn();

    render(
      <OptionList>
        <OptionItemButton onClick={onSelect} disabled>
          Disabled option
        </OptionItemButton>
      </OptionList>,
    );

    const button = screen.getByRole("button", { name: "Disabled option" });
    fireEvent.click(button);

    expect(onSelect).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(button.className).toContain("sor-option-item-disabled");
  });
});
