import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import RDPClientHeader from "../src/components/rdp/RDPClientHeader";

const buildProps = () => {
  const handleSendKeys = vi.fn();

  return {
    props: {
      sessionName: "Server",
      sessionHostname: "server.local",
      connectionStatus: "connected",
      statusMessage: "",
      desktopSize: { width: 1920, height: 1080 },
      colorDepth: 32,
      perfLabel: "balanced",
      magnifierEnabled: true,
      magnifierActive: false,
      showInternals: false,
      showSettings: false,
      isFullscreen: false,
      recState: { isRecording: false, isPaused: false, duration: 0 },
      getStatusColor: () => "text-green-400",
      getStatusIcon: () => null,
      setMagnifierActive: vi.fn(),
      setShowInternals: vi.fn(),
      setShowSettings: vi.fn(),
      handleScreenshot: vi.fn(),
      handleScreenshotToClipboard: vi.fn(),
      handleStopRecording: vi.fn(),
      toggleFullscreen: vi.fn(),
      startRecording: vi.fn(),
      pauseRecording: vi.fn(),
      resumeRecording: vi.fn(),
      handleReconnect: vi.fn(),
      handleDisconnect: vi.fn(),
      handleCopyToClipboard: vi.fn(),
      handlePasteFromClipboard: vi.fn(),
      handleSendKeys,
      handleSignOut: vi.fn(),
      handleForceReboot: vi.fn(),
      connectionId: "c1",
      certFingerprint: "",
      connectionName: "My Server",
      onRenameConnection: vi.fn(),
      totpConfigs: [],
      onUpdateTotpConfigs: vi.fn(),
    },
    handleSendKeys,
  };
};

describe("RDPClientHeader", () => {
  it("opens and closes send-keys popover, and dispatches selected option", () => {
    const { props, handleSendKeys } = buildProps();
    render(<RDPClientHeader {...props} />);

    fireEvent.click(screen.getByTitle("Send key combination"));
    expect(screen.getByTestId("rdp-send-keys-popover")).toBeInTheDocument();
    expect(screen.getByText("Send Key Sequence")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Ctrl + Alt + Del"));
    expect(handleSendKeys).toHaveBeenCalledWith("ctrl-alt-del");
    expect(
      screen.queryByTestId("rdp-send-keys-popover"),
    ).not.toBeInTheDocument();
  });

  it("opens host-info popover and closes on outside click", () => {
    const { props } = buildProps();
    render(<RDPClientHeader {...props} />);

    fireEvent.click(screen.getByTitle("Host info & certificate"));
    expect(screen.getByTestId("rdp-host-info-popover")).toBeInTheDocument();
    expect(screen.getByText("Friendly Name")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByTestId("rdp-host-info-popover"),
    ).not.toBeInTheDocument();
  });
});
