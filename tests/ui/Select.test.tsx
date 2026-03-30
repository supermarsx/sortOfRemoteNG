import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Select } from "../../src/components/ui/forms/Select";

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

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
    // Open the dropdown first (it's portal-based and only renders when open)
    fireEvent.click(screen.getByRole("combobox"));
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(3);
    expect(opts[0]).toHaveTextContent("Option A");
    expect(opts[1]).toHaveTextContent("Option B");
    expect(opts[2]).toHaveTextContent("Option C");
  });

  it("calls onChange with selected value", () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={options} />);
    // Open the dropdown
    fireEvent.click(screen.getByRole("combobox"));
    // Select an option via mouseDown (as the component uses onMouseDown)
    const optionB = screen.getByText("Option B");
    fireEvent.mouseDown(optionB);
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
    // Open the dropdown first
    fireEvent.click(screen.getByRole("combobox"));
    const disabledOpt = screen.getByText("Option C").closest("[role='option']") as HTMLElement;
    expect(disabledOpt?.getAttribute("aria-disabled")).toBe("true");
  });

  it("uses the label prop as an aria-label when provided", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} label="Node selector" />);
    expect(screen.getByLabelText("Node selector")).toBeInTheDocument();
  });
});
