import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArdClientModel } from "../../hooks/protocol/useArdClient";
import type { ConnectionSession } from "../../types/connection/connection";
import {
  DEFAULT_ARD_SETTINGS,
  type ArdRuntimeCapabilities,
} from "../../types/protocols/ard";

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

const nativeCapabilities: ArdRuntimeCapabilities = {
  embeddedRfb: {
    available: true,
    authenticationModes: ["macOsAccount", "vncPassword"],
    acceptsAppleAccountCredentials: false,
    supportsNetworkPath: false,
    networkPathReason: "direct only",
  },
  appleAccountNative: {
    available: true,
    requiresMacOs: true,
    acceptsPassword: false,
    targetPrefillSupported: false,
    reason: "Authentication remains in Screen Sharing.",
  },
};

const createModel = (): ArdClientModel => ({
  canvasRef: { current: null },
  status: "connected",
  runtimePath: "embedded",
  error: null,
  message: "Connected",
  backendSessionId: "backend-ard-1",
  settings: { ...DEFAULT_ARD_SETTINGS },
  capabilities: null,
  nativeHandoffResult: null,
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
  launchNativeScreenSharing: vi.fn().mockResolvedValue({
    applicationOpened: true,
    application: "Screen Sharing",
    platform: "macos",
    connectionEstablished: false,
    acceptsPassword: false,
    targetPrefilled: false,
  }),
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
    model.runtimePath = "nativeAppleAccount";
    model.settings = {
      ...model.settings,
      authMode: "appleAccountNative",
    };
    model.capabilities = nativeCapabilities;
    model.launchNativeScreenSharing = vi
      .fn()
      .mockRejectedValue(new Error("Apple Screen Sharing requires macOS"));
    hookMock.mockReturnValue(model);

    render(<ArdClient session={session} />);
    expect(
      screen.getByText(/password, two-factor approval/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open / focus Screen Sharing" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Apple Screen Sharing requires macOS",
      ),
    );
  });

  it("copies the saved account and invokes every explicit open or focus request", async () => {
    const model = createModel();
    model.status = "nativeHandoff";
    model.runtimePath = "nativeAppleAccount";
    model.settings = {
      ...model.settings,
      authMode: "appleAccountNative",
      appleAccountIdentifier: "person@example.test",
    };
    model.nativeHandoffResult = {
      applicationOpened: true,
      application: "Screen Sharing",
      platform: "macos",
      connectionEstablished: false,
      acceptsPassword: false,
      targetPrefilled: false,
    };
    model.capabilities = nativeCapabilities;
    hookMock.mockReturnValue(model);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn(), writeText },
    });

    render(<ArdClient session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Apple Account" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("person@example.test"),
    );

    const open = screen.getByRole("button", {
      name: "Open / focus Screen Sharing",
    });
    fireEvent.click(open);
    fireEvent.click(open);
    await waitFor(() =>
      expect(model.launchNativeScreenSharing).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.getByText(/confirms only the application handoff/i),
    ).toBeInTheDocument();
  });

  it("disables the native action when runtime capabilities reject the platform", () => {
    const model = createModel();
    model.status = "error";
    model.runtimePath = "unavailable";
    model.settings = {
      ...model.settings,
      authMode: "appleAccountNative",
    };
    model.capabilities = {
      ...nativeCapabilities,
      appleAccountNative: {
        ...nativeCapabilities.appleAccountNative,
        available: false,
        reason: "Screen Sharing requires macOS.",
      },
    };
    hookMock.mockReturnValue(model);

    render(<ArdClient session={session} />);
    const open = screen.getByRole("button", {
      name: "Open / focus Screen Sharing",
    });
    expect(open).toBeDisabled();
    fireEvent.click(open);
    expect(model.launchNativeScreenSharing).not.toHaveBeenCalled();
    expect(
      screen.getByText("Screen Sharing requires macOS."),
    ).toBeInTheDocument();
  });

  it("keeps the native action disabled while capabilities are loading", () => {
    const model = createModel();
    model.status = "nativeHandoff";
    model.runtimePath = "resolving";
    model.settings = {
      ...model.settings,
      authMode: "appleAccountNative",
    };
    model.capabilities = null;
    hookMock.mockReturnValue(model);

    render(<ArdClient session={session} />);
    const open = screen.getByRole("button", {
      name: "Open / focus Screen Sharing",
    });
    expect(open).toBeDisabled();
    fireEvent.click(open);
    expect(model.launchNativeScreenSharing).not.toHaveBeenCalled();
  });

  it.each([
    [
      "macOsAccount" as const,
      "This session uses the remote Mac account username and password.",
    ],
    [
      "vncPassword" as const,
      "This session uses the dedicated Screen Sharing VNC password; the username is ignored.",
    ],
  ])(
    "renders the embedded canvas and truthful %s fallback guidance",
    (authMode, guidance) => {
      const model = createModel();
      model.status = "connecting";
      model.runtimePath = "embeddedFallback";
      model.settings = {
        ...model.settings,
        authMode: "appleAccountNative",
        appleAccountIdentifier: "person@example.test",
        crossPlatformFallback: { enabled: true, authMode },
      };
      hookMock.mockReturnValue(model);

      render(<ArdClient session={session} />);

      expect(
        screen.getByRole("application", {
          name: "Apple Remote Desktop framebuffer",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("Cross-platform fallback")).toBeInTheDocument();
      const fallbackNotice = screen
        .getByText(/Embedded cross-platform fallback selected/)
        .closest("div");
      expect(fallbackNotice).toHaveTextContent(
        "Embedded cross-platform fallback selected.",
      );
      expect(fallbackNotice).toHaveTextContent(guidance);
      expect(fallbackNotice).toHaveTextContent(
        "These are not Apple Account credentials",
      );
      expect(
        screen.queryByRole("button", { name: "Open / focus Screen Sharing" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("person@example.test")).not.toBeInTheDocument();
    },
  );
});
