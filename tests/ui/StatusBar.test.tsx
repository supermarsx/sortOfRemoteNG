import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../../src/components/ui/display/StatusBar";

describe("StatusBar", () => {
  it("renders left content", () => {
    render(<StatusBar left={<span>Session: SSH</span>} />);
    expect(screen.getByText("Session: SSH")).toBeInTheDocument();
  });

  it("renders right content when provided", () => {
    render(<StatusBar left="left" right={<span>Connected</span>} />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("does not render right section when omitted", () => {
    const { container } = render(<StatusBar left="info" />);
    // Only one child div (left side)
    const wrapper = container.firstElementChild!;
    expect(wrapper.children).toHaveLength(1);
  });

  it("applies custom className", () => {
    const { container } = render(<StatusBar left="x" className="extra" />);
    expect(container.firstElementChild).toHaveClass("extra");
  });
});
