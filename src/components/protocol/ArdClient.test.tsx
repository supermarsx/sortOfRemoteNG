import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArdClientModel } from "../../hooks/protocol/useArdClient";
import type { ConnectionSession } from "../../types/connection/connection";
import { DEFAULT_ARD_SETTINGS } from "../../types/protocols/ard";

const { hookMock } = vi.hoisted(() => ({ hookMock: vi.fn() }));

vi.mock("../../hooks/protocol/useArdClient", () => ({
  useArdClient: (...args: unknown[]) => hookMock(...args),
}));

import { ArdClient } from "./ArdClient";

const session = {
  id: "frontend-ard-1",
  connectionId: "connection-ard-1",
  name: "Office Mac",
  status: "connected",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ard",
  hostname: "mac.example.test",
} as ConnectionSession;

const createModel = (): ArdClientModel => ({
  canvasRef: { current: null },
  status: "connected",
  error: null,
  message: "Connected",
  backendSessionId: "backend-ard-1",
  settings: { ...DEFAULT_ARD_SETTINGS },
  capabilities: null,
  stats: {
    bytesSent: 10,
    bytesReceived: 20,
    framesDecoded: 3,
    keyEventsSent: 0,
    pointerEventsSent: 0,
  },
  desktopWidth: 1920,
  desktopHeight: 1080,
  sendInput: vi.fn().mockResolvedValue(undefined),
  setClipboard: vi.fn().mockResolvedValue(undefined),
  setCurtainMode: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  launchNativeScreenSharing: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  hookMock.mockReset();
  hookMock.mockReturnValue(createModel());
});

describe("ArdClient", () => {
  it("renders the embedded framebuffer with exact session statistics", () => {
    render(<ArdClient session={session} />);
    expect(screen.getByTestId("ard-client")).toBeInTheDocument();
    expect(
      screen.getByRole("application", {
        name: "Apple Remote Desktop framebuffer",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1920 × 1080")).toBeInTheDocument();
    expect(screen.getByText(/3 frames · 20 B in/)).toBeInTheDocument();
  });

  it("keeps Apple Account passwords out of the app and reports handoff failure", async () => {
    const model = createModel();
    model.status = "error";
    model.settings = {
      ...model.settings,
      authMode: "appleAccountNative",
    };
    model.launchNativeScreenSharing = vi
      .fn()
      .mockRejectedValue(new Error("Apple Screen Sharing requires macOS"));
    hookMock.mockReturnValue(model);

    render(<ArdClient session={session} />);
    expect(
      screen.getByText(/neither asks for nor forwards/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Apple Screen Sharing" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Apple Screen Sharing requires macOS",
      ),
    );
  });
});
