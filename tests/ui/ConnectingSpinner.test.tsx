import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectingSpinner } from "../../src/components/ui/display/ConnectingSpinner";

describe("ConnectingSpinner", () => {
  beforeEach(() => {
    // jsdom deliberately has no canvas implementation. The spinner's canvas
    // variants already treat a missing context as unavailable, so return null
    // to exercise that fallback without jsdom's diagnostic noise.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
