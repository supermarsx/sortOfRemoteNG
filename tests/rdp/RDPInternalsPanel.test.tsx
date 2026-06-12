import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RDPInternalsPanel } from "../../src/components/rdp/RDPInternalsPanel";
import type {
  RDPStatsEvent,
  RDPGfxDiagnostics,
} from "../../src/types/rdp/rdpEvents";
import type { RDPConnectionSettings } from "../../src/types/connection/connection";

const baseStats: RDPStatsEvent = {
  session_id: "sess-1",
  uptime_secs: 60,
  bytes_received: 2048,
  bytes_sent: 1024,
  pdus_received: 20,
  pdus_sent: 10,
  frame_count: 120,
  fps: 30,
  input_events: 50,
  errors_recovered: 0,
  reactivations: 0,
  phase: "active",
  last_error: null,
};

const baseProps = {
  stats: baseStats,
  lifecycle: null,
  connectTiming: null,
  rdpSettings: {} as RDPConnectionSettings,
  activeRenderBackend: "wgpu",
  activeFrontendRenderer: "WebGPU",
  onClose: vi.fn(),
};

const gfx = (overrides: Partial<RDPGfxDiagnostics> = {}): RDPGfxDiagnostics => ({
  summary: { enabledCount: 1, readyCount: 1, failedCount: 0 },
  capVersion: 0x000a0100,
  codec: "AVC444",
  surfacesActive: 2,
  framesDecoded: 480,
  frameAcksSent: 480,
  pipelineErrors: 0,
  nalPassthrough: false,
  ...overrides,
});

describe("RDPInternalsPanel — RDPGFX row", () => {
  it("renders the GFX diagnostics row from a stats event carrying gfx", () => {
    render(
      <RDPInternalsPanel {...baseProps} stats={{ ...baseStats, gfx: gfx() }} />,
    );
    expect(screen.getByText("GFX Codec")).toBeInTheDocument();
    expect(screen.getByText("AVC444")).toBeInTheDocument();
    expect(screen.getByText("GFX Surfaces")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("GFX Frames")).toBeInTheDocument();
    expect(screen.getByText("GFX Errors")).toBeInTheDocument();
    // Frame count rendered (480) with ack subtitle.
    expect(screen.getByText(/480/)).toBeInTheDocument();
  });

  it("does not render the GFX row when gfx is absent (no crash)", () => {
    render(<RDPInternalsPanel {...baseProps} stats={baseStats} />);
    expect(screen.queryByText("GFX Codec")).toBeNull();
    expect(screen.queryByText("GFX Surfaces")).toBeNull();
    expect(screen.queryByText("GFX Errors")).toBeNull();
  });

  it("surfaces pipeline errors with the error styling", () => {
    render(
      <RDPInternalsPanel
        {...baseProps}
        stats={{
          ...baseStats,
          gfx: gfx({ pipelineErrors: 3, lastErrorClass: "h264_decode_error" }),
        }}
      />,
    );
    const errorsLabel = screen.getByText("GFX Errors");
    const errorsCell = errorsLabel.parentElement;
    expect(errorsCell).not.toBeNull();
    // The value "3" is shown and the last-error class is the tooltip.
    expect(errorsCell?.querySelector('[title="h264_decode_error"]')).not.toBeNull();
    expect(errorsCell?.textContent).toContain("3");
  });
});
