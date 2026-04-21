import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Slider } from "../../src/components/ui/forms/Slider";

describe("Slider", () => {
  it("renders with value and range", () => {
    render(<Slider value={50} onChange={vi.fn()} min={0} max={100} />);
    expect(screen.getByRole("slider")).toHaveValue("50");
  });

  it("applies default variant class", () => {
    render(<Slider value={0} onChange={vi.fn()} min={0} max={100} />);
    expect(screen.getByRole("slider")).toHaveClass("sor-settings-range");
  });

  it("applies wide variant class", () => {
    render(<Slider value={0} onChange={vi.fn()} min={0} max={100} variant="wide" />);
    expect(screen.getByRole("slider")).toHaveClass("sor-settings-range-wide");
  });

  it("calls onChange with number value", () => {
    const onChange = vi.fn();
    render(<Slider value={50} onChange={onChange} min={0} max={100} />);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "75" } });
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it("forwards disabled prop", () => {
    render(<Slider value={0} onChange={vi.fn()} min={0} max={100} disabled />);
    expect(screen.getByRole("slider")).toBeDisabled();
  });

  it("respects step prop", () => {
    render(<Slider value={0} onChange={vi.fn()} min={0} max={100} step={5} />);
    expect(screen.getByRole("slider")).toHaveAttribute("step", "5");
  });
});
