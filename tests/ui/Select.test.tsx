import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "../../src/components/ui/forms/Select";

const options = [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
  { value: "c", label: "Option C", disabled: true },
];

describe("Select", () => {
  it("renders a select element", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} />);
    const select = screen.getByRole("combobox");
    expect(select).toBeDefined();
  });

  it("renders all options", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} />);
    expect(screen.getByText("Option A")).toBeDefined();
    expect(screen.getByText("Option B")).toBeDefined();
    expect(screen.getByText("Option C")).toBeDefined();
  });

  it("calls onChange with selected value", () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={options} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("renders placeholder when provided", () => {
    render(
      <Select value="" onChange={vi.fn()} options={options} placeholder="Choose..." />,
    );
    expect(screen.getByText("Choose...")).toBeDefined();
  });

  it("applies settings variant class by default", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} />);
    const select = screen.getByRole("combobox");
    expect(select.className).toContain("sor-settings-select");
  });

  it("applies form-sm variant class", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} variant="form-sm" />);
    const select = screen.getByRole("combobox");
    expect(select.className).toContain("sor-form-select-sm");
  });

  it("renders disabled options", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} />);
    const disabledOpt = screen.getByText("Option C").closest("option") as HTMLOptionElement;
    expect(disabledOpt?.disabled).toBe(true);
  });
});
