import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
      <Select
        value=""
        onChange={vi.fn()}
        options={options}
        placeholder="Choose..."
      />,
    );
    expect(screen.getByText("Choose...")).toBeDefined();
  });

  it("applies settings variant class by default", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} />);
    const select = screen.getByRole("combobox");
    expect(select.className).toContain("sor-settings-select");
  });

  it("applies form-sm variant class", () => {
    render(
      <Select
        value="a"
        onChange={vi.fn()}
        options={options}
        variant="form-sm"
      />,
    );
    const select = screen.getByRole("combobox");
    expect(select.className).toContain("sor-form-select-sm");
  });

  it("renders disabled options", () => {
    render(<Select value="a" onChange={vi.fn()} options={options} />);
    // Open the dropdown first
    fireEvent.click(screen.getByRole("combobox"));
    const disabledOpt = screen
      .getByText("Option C")
      .closest("[role='option']") as HTMLElement;
    expect(disabledOpt?.getAttribute("aria-disabled")).toBe("true");
  });

  it("uses the label prop as an aria-label when provided", () => {
    render(
      <Select
        value="a"
        onChange={vi.fn()}
        options={options}
        label="Node selector"
      />,
    );
    expect(screen.getByLabelText("Node selector")).toBeInTheDocument();
  });

  describe("searchable", () => {
    const hosts = [
      { value: "", label: "None" },
      {
        value: "lis",
        label: "Lisboa edge",
        description: "Portugal · São João",
      },
      { value: "mad", label: "Madrid core", description: "Spain · Centro" },
      { value: "off", label: "Offline host", disabled: true },
    ];
    const labels = () =>
      within(screen.getByRole("listbox"))
        .queryAllByRole("option")
        .map((option) => option.textContent);

    it("renders descriptions in the dropdown only", () => {
      render(
        <Select value="lis" onChange={vi.fn()} options={hosts} searchable />,
      );
      const trigger = screen.getByRole("combobox");
      expect(trigger).toHaveTextContent("Lisboa edge");
      expect(trigger).not.toHaveTextContent("Portugal");

      fireEvent.click(trigger);
      expect(screen.getByText("Portugal · São João")).toHaveClass(
        "sor-select-option-description",
      );
    });

    it("filters labels and descriptions case- and accent-insensitively by every word", () => {
      render(<Select value="" onChange={vi.fn()} options={hosts} searchable />);
      fireEvent.click(screen.getByRole("combobox"));
      const search = screen.getByRole("textbox", { name: "Search options" });

      fireEvent.change(search, { target: { value: "MADRID" } });
      expect(labels()).toEqual(["Madrid coreSpain · Centro"]);

      fireEvent.change(search, { target: { value: "sao joao" } });
      expect(labels()).toEqual(["Lisboa edgePortugal · São João"]);

      fireEvent.change(search, { target: { value: "  portugal   edge " } });
      expect(labels()).toEqual(["Lisboa edgePortugal · São João"]);

      fireEvent.change(search, { target: { value: "portugal core" } });
      expect(labels()).toEqual([]);
      expect(screen.getByText("No matches")).toBeInTheDocument();

      fireEvent.change(search, { target: { value: "   " } });
      expect(labels()).toHaveLength(4);
    });

    it("keeps the filter input outside the listbox and tracks the active option", () => {
      const onChange = vi.fn();
      render(
        <Select value="" onChange={onChange} options={hosts} searchable />,
      );
      const trigger = screen.getByRole("combobox");
      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      const listbox = screen.getByRole("listbox");
      const search = screen.getByRole("textbox", { name: "Search options" });
      expect(listbox).not.toContainElement(search);
      expect(trigger).toHaveAttribute("aria-controls", listbox.id);
      expect(search).toHaveAttribute("aria-controls", listbox.id);

      const [none, lisboa] = within(listbox).getAllByRole("option");
      expect(search).toHaveAttribute("aria-activedescendant", none.id);
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(search).toHaveAttribute("aria-activedescendant", lisboa.id);
      fireEvent.keyDown(search, { key: "Enter" });

      expect(onChange).toHaveBeenCalledWith("lis");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(trigger).not.toHaveAttribute("aria-controls");
    });
  });
});
