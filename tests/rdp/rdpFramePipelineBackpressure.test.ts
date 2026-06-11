import { createElement } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import RDPInternalsPanel from "../../src/components/rdp/RDPInternalsPanel";
import { DEFAULT_RDP_SETTINGS } from "../../src/types/connection/connection";
import type {
  RDPLifecycleEvent,
  RDPStatsEvent,
  RdpFramePressureState,
  RdpFrameBackpressureUpdate,
} from "../../src/types/rdp/rdpEvents";

// ---------------------------------------------------------------------------
// L4 (e14): frame-pressure / telemetry diagnostics surface.
//
// This file drives the RDPInternalsPanel directly with `rdp://lifecycle`-shaped
// lifecycle snapshots (carrying channelSummary + frameFlowSummary) and with the
// `useRdpFrameBackpressure`-derived props (framePressureState +
// frameBackpressureTelemetry), which the L3 panel renders. Driving the panel in
// isolation is the recommended path from the L3 handoff: the backpressure props
// come from a sampling loop inside useRDPClient, not directly from an event, so
// passing them as props gives a deterministic frame-pressure surface test.
//
// NOTE: i18n is not initialised in the vitest harness, so react-i18next falls
// back to each `t(key, default)` default string but does NOT interpolate
// `{{var}}` placeholders. Assertions therefore target stable label strings,
// raw numeric values, and the em-dash placeholder (U+2013) rather than
// interpolated values like "4.3ms".
// ---------------------------------------------------------------------------

const DASH = "–"; // em-dash placeholder rendered for absent optional fields

const baseStats: RDPStatsEvent = {
  session_id: "rdp-session-bp",
  uptime_secs: 30,
  bytes_received: 1048576,
  bytes_sent: 65536,
  pdus_received: 400,
  pdus_sent: 80,
  frame_count: 250,
  fps: 24.0,
  input_events: 90,
  errors_recovered: 0,
  reactivations: 0,
  phase: "active",
  last_error: null,
};

function makeLifecycle(
  overrides: Partial<RDPLifecycleEvent> = {},
): RDPLifecycleEvent {
  return {
    sessionId: "rdp-session-bp",
    state: "active",
    activeSubstate: "running",
    phaseStartedAtMs: 10,
    transitionCount: 5,
    reconnectAttempt: 0,
    channelSummary: { enabledCount: 4, readyCount: 4, failedCount: 0 },
    frameFlowSummary: {
      queuedFrames: 0,
      deliveredFrames: 250,
      droppedFrames: 0,
      coalescedFrames: 0,
    },
    ...overrides,
  };
}

function renderPanel(props: {
  lifecycle: RDPLifecycleEvent | null;
  framePressureState?: RdpFramePressureState;
  frameBackpressureTelemetry?: RdpFrameBackpressureUpdate | null;
}) {
  return render(
    createElement(RDPInternalsPanel, {
      stats: baseStats,
      lifecycle: props.lifecycle,
      connectTiming: null,
      rdpSettings: DEFAULT_RDP_SETTINGS,
      activeRenderBackend: "wgpu",
      activeFrontendRenderer: "Canvas 2D",
      framePressureState: props.framePressureState,
      frameBackpressureTelemetry: props.frameBackpressureTelemetry,
      onClose: () => {},
    }),
  );
}

/** Find the value cell paired with a given label inside the compact grid. */
function valueFor(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.parentElement?.querySelector(".font-mono");
  return valueEl?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

afterEach(() => cleanup());

describe("RDP frame pipeline backpressure / telemetry surface", () => {
  describe("channel summary rows", () => {
    it("shows enabled / ready / fault counts from the lifecycle channelSummary", () => {
      renderPanel({
        lifecycle: makeLifecycle({
          channelSummary: { enabledCount: 4, readyCount: 3, failedCount: 1 },
        }),
      });

      expect(screen.getByText("Channels Enabled")).toBeInTheDocument();
      expect(valueFor("Channels Enabled")).toBe("4");

      expect(screen.getByText("Channels Ready")).toBeInTheDocument();
      expect(valueFor("Channels Ready")).toBe("3/4");

      expect(screen.getByText("Channel Faults")).toBeInTheDocument();
      expect(valueFor("Channel Faults")).toBe("1");
    });

    it("renders ready cell as healthy when ready meets enabled and fault-free", () => {
      renderPanel({
        lifecycle: makeLifecycle({
          channelSummary: { enabledCount: 2, readyCount: 2, failedCount: 0 },
        }),
      });
      expect(valueFor("Channels Ready")).toBe("2/2");
      expect(valueFor("Channel Faults")).toBe("0");
    });
  });

  describe("frame flow rows (queued / delivered / dropped + coalesced + avg render)", () => {
    it("shows queued / delivered / dropped counts", () => {
      renderPanel({
        lifecycle: makeLifecycle({
          frameFlowSummary: {
            queuedFrames: 12,
            deliveredFrames: 287,
            droppedFrames: 5,
            coalescedFrames: 9,
          },
        }),
      });
      expect(valueFor("Frames Queued")).toBe("12");
      expect(valueFor("Frames Delivered")).toBe("287");
      expect(valueFor("Frames Dropped")).toBe("5");
    });

    it("shows the new coalesced count when coalescedFrames is present", () => {
      renderPanel({
        lifecycle: makeLifecycle({
          frameFlowSummary: {
            queuedFrames: 1,
            deliveredFrames: 100,
            droppedFrames: 0,
            coalescedFrames: 42,
          },
        }),
      });
      expect(screen.getByText("Frames Coalesced")).toBeInTheDocument();
      expect(valueFor("Frames Coalesced")).toBe("42");
    });

    it("renders coalesced as a number even when zero (present, not absent)", () => {
      renderPanel({
        lifecycle: makeLifecycle({
          frameFlowSummary: {
            queuedFrames: 0,
            deliveredFrames: 50,
            droppedFrames: 0,
            coalescedFrames: 0,
          },
        }),
      });
      expect(valueFor("Frames Coalesced")).toBe("0");
    });

    it("renders an avg-render value cell (non-dash) when averageRenderMs is present", () => {
      renderPanel({
        lifecycle: makeLifecycle({
          frameFlowSummary: {
            queuedFrames: 0,
            deliveredFrames: 250,
            droppedFrames: 0,
            coalescedFrames: 0,
            averageRenderMs: 4.3,
          },
        }),
      });
      expect(screen.getByText("Avg Render")).toBeInTheDocument();
      // i18n interpolation is inert in tests, but the value cell must NOT be the
      // absent-field placeholder when averageRenderMs is provided.
      expect(valueFor("Avg Render")).not.toBe(DASH);
    });

    it("renders coalesced / avg-render defensively (–) for a pre-L2 event missing those fields", () => {
      // Cast through unknown: a pre-L2 wire payload omits coalescedFrames /
      // averageRenderMs entirely. The panel must back-compat render the em-dash.
      const preL2Lifecycle = makeLifecycle({
        frameFlowSummary: {
          queuedFrames: 0,
          deliveredFrames: 250,
          droppedFrames: 0,
        } as RDPLifecycleEvent["frameFlowSummary"],
      });
      renderPanel({ lifecycle: preL2Lifecycle });

      expect(screen.getByText("Frames Coalesced")).toBeInTheDocument();
      expect(valueFor("Frames Coalesced")).toBe(DASH);
      expect(screen.getByText("Avg Render")).toBeInTheDocument();
      expect(valueFor("Avg Render")).toBe(DASH);
      // queued/delivered/dropped still render normally.
      expect(valueFor("Frames Queued")).toBe("0");
      expect(valueFor("Frames Delivered")).toBe("250");
    });
  });

  describe("backpressure row (useRdpFrameBackpressure state)", () => {
    it("shows Healthy and the queue depth when the pipeline is healthy", () => {
      renderPanel({
        lifecycle: makeLifecycle(),
        framePressureState: "healthy",
        frameBackpressureTelemetry: {
          sessionId: "rdp-session-bp",
          renderer: "Canvas 2D",
          queueDepth: 0,
          queuedFrames: 0,
          droppedFrames: 0,
          coalescedFrames: 0,
          lastFrameRenderMs: 3.1,
          presentedFrames: 250,
          isVisible: true,
          isDetached: false,
          pressureState: "healthy",
          timestampMs: 1000,
        },
      });

      expect(screen.getByText("Backpressure")).toBeInTheDocument();
      expect(valueFor("Backpressure")).toBe("Healthy");
      expect(screen.getByText("Queue Depth")).toBeInTheDocument();
      expect(valueFor("Queue Depth")).toBe("0");
    });

    it("shows Backpressured and a non-zero queue depth when the pipeline is saturated", () => {
      renderPanel({
        lifecycle: makeLifecycle(),
        framePressureState: "backpressured",
        frameBackpressureTelemetry: {
          sessionId: "rdp-session-bp",
          renderer: "Canvas 2D",
          queueDepth: 17,
          queuedFrames: 17,
          droppedFrames: 4,
          coalescedFrames: 2,
          lastFrameRenderMs: 22.5,
          presentedFrames: 200,
          isVisible: true,
          isDetached: false,
          pressureState: "backpressured",
          timestampMs: 2000,
        },
      });

      expect(valueFor("Backpressure")).toBe("Backpressured");
      // queueDepth value is rendered (p95 suffix uses inert i18n interpolation,
      // so assert the depth number is present rather than the full string).
      expect(valueFor("Queue Depth")).toContain("17");
    });

    it("omits the backpressure rows entirely when no telemetry has arrived", () => {
      renderPanel({ lifecycle: makeLifecycle() });
      expect(screen.queryByText("Backpressure")).not.toBeInTheDocument();
      expect(screen.queryByText("Queue Depth")).not.toBeInTheDocument();
    });
  });

  describe("failure-class row", () => {
    it("shows – when lastFailureClass is absent (pending backend)", () => {
      renderPanel({ lifecycle: makeLifecycle() });
      expect(screen.getByText("Failure Class")).toBeInTheDocument();
      expect(valueFor("Failure Class")).toBe(DASH);
    });

    it("shows the failure class when present", () => {
      renderPanel({
        lifecycle: makeLifecycle({ lastFailureClass: "credssp-auth" }),
      });
      expect(valueFor("Failure Class")).toBe("credssp-auth");
    });
  });
});
