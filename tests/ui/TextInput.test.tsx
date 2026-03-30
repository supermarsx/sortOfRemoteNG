import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextInput } from "../../src/components/ui/forms/TextInput";

describe("TextInput", () => {
  it("renders a text input", () => {
    render(<TextInput />);
    const input = screen.getByRole("textbox");
    expect(input).toBeDefined();
  });

  it("applies form variant class by default", () => {
    render(<TextInput />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("sor-form-input");
  });

  it("applies settings variant class", () => {
    render(<TextInput variant="settings" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("sor-settings-input");
  });

  it("forwards value and onChange", () => {
    const onChange = vi.fn();
    render(<TextInput value="hello" onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("hello");
    fireEvent.change(input, { target: { value: "world" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards placeholder attribute", () => {
    render(<TextInput placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText("Enter text...")).toBeDefined();
  });

  it("forwards disabled attribute", () => {
    render(<TextInput disabled />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("applies custom className", () => {
    render(<TextInput className="my-extra-class" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("my-extra-class");
  });

  it("uses the label prop as an aria-label when provided", () => {
    render(<TextInput label="Connection name" />);
    expect(screen.getByLabelText("Connection name")).toBeInTheDocument();
  });
});
