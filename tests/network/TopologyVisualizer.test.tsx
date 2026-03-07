import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import TopologyVisualizer from "../../src/components/network/TopologyVisualizer";

// Mock canvas context
const mockContext = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  setTransform: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  closePath: vi.fn(),
  set fillStyle(_v: string) {},
  set strokeStyle(_v: string) {},
  set lineWidth(_v: number) {},
  set font(_v: string) {},
  set textAlign(_v: string) {},
  set textBaseline(_v: string) {},
  set globalAlpha(_v: number) {},
  set shadowColor(_v: string) {},
  set shadowBlur(_v: number) {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(null);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,");
});

/** Helper: render and flush the async fetchGraph / fetchStats triggered on mount */
async function renderOpen(props?: Partial<{ isOpen: boolean }>) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <TopologyVisualizer isOpen={props?.isOpen ?? true} />,
    );
  });
  return result!;
}

describe("TopologyVisualizer", () => {
  it("renders the topology toolbar", async () => {
    await renderOpen();
    // The layout label renders "topology.layout" + ":" from JSX
    expect(screen.getByText(/topology\.layout:/)).toBeInTheDocument();
  });

  it("shows layout selector", async () => {
    await renderOpen();
    // Layout options inside the <select>
    expect(screen.getByText("topology.layoutForce")).toBeInTheDocument();
    expect(screen.getByText("topology.layoutHierarchical")).toBeInTheDocument();
  });

  it("renders canvas element", async () => {
    const { container } = await renderOpen();
    const canvases = container.querySelectorAll("canvas");
    expect(canvases.length).toBeGreaterThanOrEqual(1);
  });

  it("shows zoom controls", async () => {
    await renderOpen();
    // Zoom buttons display + / − but carry title attributes with the i18n key
    expect(screen.getByTitle("topology.zoomIn")).toBeInTheDocument();
    expect(screen.getByTitle("topology.zoomOut")).toBeInTheDocument();
  });

  it("shows fit to view button", async () => {
    await renderOpen();
    expect(screen.getByText("topology.fit")).toBeInTheDocument();
  });

  it("shows export button", async () => {
    await renderOpen();
    expect(screen.getByText("topology.export")).toBeInTheDocument();
  });

  it("shows find bottlenecks button", async () => {
    await renderOpen();
    expect(screen.getByText("topology.bottlenecks")).toBeInTheDocument();
  });

  it("shows stats panel when stats are available", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "topo_get_stats") {
        return Promise.resolve({
          nodeCount: 5,
          edgeCount: 8,
          connectedComponents: 1,
          density: 0.4,
        });
      }
      return Promise.resolve(null);
    });
    await renderOpen();
    expect(screen.getByText("topology.statNodes")).toBeInTheDocument();
    expect(screen.getByText("topology.statEdges")).toBeInTheDocument();
  });

  it("has multiple toolbar buttons", async () => {
    await renderOpen();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("returns null when isOpen is false", async () => {
    const { container } = await renderOpen({ isOpen: false });
    expect(container.innerHTML).toBe("");
  });

  it("shows find path button", async () => {
    await renderOpen();
    expect(screen.getByText("topology.findPath")).toBeInTheDocument();
  });
});
