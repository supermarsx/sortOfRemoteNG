import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Textarea } from "../../src/components/ui/forms/Textarea";
import React from "react";

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId("ta").tagName).toBe("TEXTAREA");
  });

  it("applies default form variant class", () => {
    render(<Textarea data-testid="ta" />);
    expect(screen.getByTestId("ta")).toHaveClass("sor-form-textarea");
  });

  it("applies form-sm variant class", () => {
    render(<Textarea data-testid="ta" variant="form-sm" />);
    expect(screen.getByTestId("ta")).toHaveClass("sor-form-textarea-sm");
  });

  it("forwards placeholder and value", () => {
    render(<Textarea placeholder="Type here" defaultValue="initial" />);
    const ta = screen.getByPlaceholderText("Type here");
    expect(ta).toHaveValue("initial");
  });

  it("forwards ref", () => {
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} data-testid="ta" />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("appends custom className", () => {
    render(<Textarea data-testid="ta" className="extra" />);
    const ta = screen.getByTestId("ta");
    expect(ta).toHaveClass("sor-form-textarea");
    expect(ta).toHaveClass("extra");
  });
});
