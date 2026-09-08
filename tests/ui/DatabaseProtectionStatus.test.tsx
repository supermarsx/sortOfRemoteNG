import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DatabaseProtectionStatus from "../../src/components/SettingsDialog/sections/security/DatabaseProtectionStatus";

describe("Disk protection refresh button", () => {
  it("keeps the refresh action on an accessible button with a decorative icon", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <DatabaseProtectionStatus
        probe={{ status: null, loading: false, error: null, refresh }}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Refresh disk protection status",
    });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeEnabled();
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows progress and blocks repeated refreshes until inspection finishes", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const probe = { status: null, loading: true, error: null, refresh };
    const { rerender } = render(<DatabaseProtectionStatus probe={probe} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent(/refreshing|inspecting/i);
    fireEvent.click(button);
    expect(refresh).not.toHaveBeenCalled();

    rerender(<DatabaseProtectionStatus probe={{ ...probe, loading: false }} />);
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveTextContent("Refresh disk protection status");
  });
});
