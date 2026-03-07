import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Checkbox } from "../../src/components/ui/forms/Checkbox";

describe("Checkbox", () => {
  it("renders a checkbox input", () => {
    render(<Checkbox checked={false} onChange={vi.fn()} />);
    const input = screen.getByRole("checkbox");
    expect(input).toBeDefined();
  });

  it("reflects checked state", () => {
    render(<Checkbox checked={true} onChange={vi.fn()} />);
    const input = screen.getByRole("checkbox") as HTMLInputElement;
    expect(input.checked).toBe(true);
  });

  it("calls onChange with boolean on click", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} />);
    const input = screen.getByRole("checkbox");
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("applies settings variant class by default", () => {
    render(<Checkbox checked={false} onChange={vi.fn()} />);
    const input = screen.getByRole("checkbox");
    expect(input.className).toContain("sor-settings-checkbox");
  });

  it("applies form variant class", () => {
    render(<Checkbox checked={false} onChange={vi.fn()} variant="form" />);
    const input = screen.getByRole("checkbox");
    expect(input.className).toContain("sor-form-checkbox");
  });

  it("forwards disabled attribute", () => {
    render(<Checkbox checked={false} onChange={vi.fn()} disabled />);
    const input = screen.getByRole("checkbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
