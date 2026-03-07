import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "../../src/components/ui/display/EmptyState";

describe("EmptyState", () => {
  it("renders the message text", () => {
    render(<EmptyState icon={AlertCircle} message="No items found" />);
    expect(screen.getByText("No items found")).toBeDefined();
  });

  it("renders the hint when provided", () => {
    render(
      <EmptyState icon={AlertCircle} message="No items" hint="Try adding one" />,
    );
    expect(screen.getByText("Try adding one")).toBeDefined();
  });

  it("does not render hint when not provided", () => {
    render(<EmptyState icon={AlertCircle} message="No items" />);
    expect(screen.queryByText("Try adding one")).toBeNull();
  });

  it("renders children", () => {
    render(
      <EmptyState icon={AlertCircle} message="Empty">
        <button>Add Item</button>
      </EmptyState>,
    );
    expect(screen.getByText("Add Item")).toBeDefined();
  });

  it("applies custom className", () => {
    const { container } = render(
      <EmptyState icon={AlertCircle} message="Empty" className="my-class" />,
    );
    expect(container.firstElementChild?.classList.contains("my-class")).toBe(true);
  });
});
