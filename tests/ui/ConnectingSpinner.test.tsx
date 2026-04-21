import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectingSpinner } from "../../src/components/ui/display/ConnectingSpinner";

describe("ConnectingSpinner", () => {
  it("renders default message 'Connecting...'", () => {
    render(<ConnectingSpinner />);
    expect(screen.getByText("Connecting...")).toBeDefined();
  });

  it("renders custom message", () => {
    render(<ConnectingSpinner message="Loading data..." />);
    expect(screen.getByText("Loading data...")).toBeDefined();
  });

  it("renders detail when provided", () => {
    render(<ConnectingSpinner detail="server.example.com" />);
    expect(screen.getByText("server.example.com")).toBeDefined();
  });

  it("renders statusMessage when provided", () => {
    render(<ConnectingSpinner statusMessage="Negotiating TLS..." />);
    expect(screen.getByText("Negotiating TLS...")).toBeDefined();
  });

  it("does not render detail when not provided", () => {
    render(<ConnectingSpinner />);
    const details = screen.queryByText("server.example.com");
    expect(details).toBeNull();
  });
});
