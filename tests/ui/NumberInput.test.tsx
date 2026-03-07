import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberInput } from "../../src/components/ui/forms/NumberInput";

describe("NumberInput", () => {
  it("renders with value", () => {
    render(<NumberInput value={42} onChange={vi.fn()} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(42);
  });

  it("applies default variant class", () => {
    render(<NumberInput value={0} onChange={vi.fn()} />);
    expect(screen.getByRole("spinbutton")).toHaveClass("sor-settings-input");
  });

  it("applies form variant class", () => {
    render(<NumberInput value={0} onChange={vi.fn()} variant="form" />);
    expect(screen.getByRole("spinbutton")).toHaveClass("sor-form-input");
  });

  it("calls onChange with parsed number", () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith(25);
  });

  it("clamps value to min/max by default", () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} min={0} max={10} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "50" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("skips clamping when clamp is false", () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} min={0} max={10} clamp={false} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "50" } });
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it("treats NaN as 0", () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("forwards disabled prop", () => {
    render(<NumberInput value={0} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });
});
