import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBanner } from "../../src/components/ui/display/ErrorBanner";

describe("ErrorBanner", () => {
  it("renders nothing when error is null", () => {
    const { container } = render(<ErrorBanner error={null} onClear={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when error is undefined", () => {
    const { container } = render(<ErrorBanner error={undefined} onClear={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when error is empty string", () => {
    const { container } = render(<ErrorBanner error="" onClear={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the error when provided", () => {
    render(<ErrorBanner error="Connection failed" onClear={vi.fn()} />);
    expect(screen.getByText("Connection failed")).toBeDefined();
  });

  it("redacts secrets before rendering", () => {
    render(
      <ErrorBanner
        error="proxyCommandPassword=super-secret"
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("proxyCommandPassword=[redacted]")).toBeDefined();
    expect(screen.queryByText(/super-secret/)).toBeNull();
  });

  it("calls onClear when dismiss button is clicked", () => {
    const onClear = vi.fn();
    render(<ErrorBanner error="Error" onClear={onClear} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("applies compact styling", () => {
    const { container } = render(
      <ErrorBanner error="Error" onClear={vi.fn()} compact />,
    );
    expect(container.firstElementChild?.className).toContain("text-xs");
  });
});
