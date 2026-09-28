import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "../../src/components/ui/forms/Select";

const options = [
  { value: "icmp", label: "ICMP echo" },
  { value: "tcp", label: "TCP connection" },
];

describe("shared Select disabled portal behavior", () => {
  it("exposes the accessible label on its button trigger and open listbox", () => {
    render(
      <Select
        label="Ping method"
        value="icmp"
        options={options}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Ping method" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);
    expect(
      screen.getByRole("listbox", { name: "Ping method" }),
    ).toHaveAttribute("id", trigger.getAttribute("aria-controls"));
  });

  it("closes when disabled and stays closed when re-enabled", () => {
    const onChange = vi.fn();
    const props = { label: "Scan profile", value: "icmp", options, onChange };
    const { rerender } = render(<Select {...props} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    rerender(<Select {...props} disabled />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Select {...props} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("option", { name: "TCP connection" }));
    expect(onChange).toHaveBeenCalledWith("tcp");
  });

  it("cannot open inside a disabled fieldset", () => {
    render(
      <fieldset disabled>
        <Select value="icmp" options={options} onChange={vi.fn()} />
      </fieldset>,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes a portal when an ancestor fieldset becomes disabled", async () => {
    const { container } = render(
      <fieldset>
        <div>
          <Select
            value="icmp"
            options={options}
            onChange={vi.fn()}
            searchable
          />
        </div>
      </fieldset>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox").closest("fieldset")).toBeNull();
    act(() => {
      container.querySelector("fieldset")!.disabled = true;
    });
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it.each(["mouse", "keyboard"])(
    "blocks %s selection before the fieldset observer runs",
    (method) => {
      const onChange = vi.fn();
      const { container } = render(
        <fieldset>
          <Select
            value="icmp"
            options={options}
            onChange={onChange}
            searchable
          />
        </fieldset>,
      );
      fireEvent.click(screen.getByRole("combobox"));
      const option = screen.getByRole("option", { name: "TCP connection" });
      const search = screen.getByRole("textbox");
      act(() => {
        container.querySelector("fieldset")!.disabled = true;
        if (method === "mouse") fireEvent.mouseDown(option);
        else fireEvent.keyDown(search, { key: "Enter" });
      });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    },
  );

  it("preserves the native disabled-fieldset first-legend exception", () => {
    const onChange = vi.fn();
    render(
      <fieldset disabled>
        <legend>
          <Select value="icmp" options={options} onChange={onChange} />
        </legend>
      </fieldset>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "TCP connection" }));
    expect(onChange).toHaveBeenCalledWith("tcp");
  });
});
