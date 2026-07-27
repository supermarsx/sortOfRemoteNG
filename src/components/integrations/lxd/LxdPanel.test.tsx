import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LxdPanel } from "./LxdPanel";

vi.mock("../../../hooks/integrations/useIntegrationConfigStore", () => ({
  useIntegrationConfigStore: () => ({
    instances: [],
    createInstance: vi.fn(),
    updateInstance: vi.fn(),
    readSecret: vi.fn(),
  }),
}));

vi.mock("../../../hooks/integration/lxd/useLxdConnection", () => ({
  useLxdConnection: () => ({
    summary: null,
    connected: false,
    isLoading: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    refreshStatus: vi.fn(),
  }),
}));

describe("LxdPanel transport safety", () => {
  it("verifies TLS by default and makes the bypass warning explicit", () => {
    render(<LxdPanel isOpen onClose={vi.fn()} />);

    const bypass = screen.getByRole("checkbox", {
      name: "Skip TLS verification",
    });
    expect(bypass).not.toBeChecked();
    expect(
      screen.getByText(/Trust-password enrollment is not implemented yet/i),
    ).toBeInTheDocument();

    fireEvent.click(bypass);
    expect(bypass).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "TLS certificate verification is disabled",
    );
  });
});
