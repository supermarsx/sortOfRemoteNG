import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RDPStatusBar } from "../../src/components/rdp/RDPStatusBar";
import type { RDPStatsEvent } from "../../src/types/rdp/rdpEvents";

const baseProps = {
  rdpSessionId: "abc12345-session",
  sessionId: "sess-001",
  isConnected: false,
  desktopSize: { width: 1920, height: 1080 },
  stats: null as RDPStatsEvent | null,
  certFingerprint: null as string | null,
  audioEnabled: false,
  clipboardEnabled: false,
  magnifierActive: false,
};

describe("RDPStatusBar", () => {
  it("renders session id and protocol", () => {
    render(<RDPStatusBar {...baseProps} />);
    expect(screen.getByText(/Session:/)).toBeInTheDocument();
    expect(screen.getByText(/Protocol: RDP/)).toBeInTheDocument();
  });

  it("shows desktop size when connected", () => {
    render(<RDPStatusBar {...baseProps} isConnected />);
    expect(screen.getByText("Desktop: 1920x1080")).toBeInTheDocument();
  });

  it("shows stats when connected and stats provided", () => {
    const stats: RDPStatsEvent = {
      session_id: "abc",
      uptime_secs: 120,
      bytes_received: 1024,
      bytes_sent: 512,
      pdus_received: 10,
      pdus_sent: 5,
      frame_count: 60,
      fps: 30,
      input_events: 200,
      errors_recovered: 0,
      reactivations: 0,
      phase: "active",
      last_error: null,
    };
    render(<RDPStatusBar {...baseProps} isConnected stats={stats} />);
    expect(screen.getByText("30 FPS")).toBeInTheDocument();
  });

  it("shows cert fingerprint when connected", () => {
    render(
      <RDPStatusBar
        {...baseProps}
        isConnected
        certFingerprint="aabbccddeeff00112233445566778899"
      />,
    );
    expect(screen.getByText(/Cert:/)).toBeInTheDocument();
  });

  it("does not show desktop details when disconnected", () => {
    render(<RDPStatusBar {...baseProps} isConnected={false} />);
    expect(screen.queryByText(/Desktop:/)).toBeNull();
  });
});
