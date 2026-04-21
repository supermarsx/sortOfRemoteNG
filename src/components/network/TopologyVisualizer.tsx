import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../ui/forms";
import { useTopology } from "../../hooks/network/useTopology";
import type {
  TopologyNode,
  LayoutAlgorithm,
  NodeKind,
} from "../../types/network/topology";

/* ---------- constants ---------- */
const NODE_RADIUS = 18;
const MINIMAP_W = 160;
const MINIMAP_H = 110;

/** Read a CSS variable from the document root, with a fallback */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

/** Build canvas-friendly theme color maps from CSS variables */
function getThemeColors() {
  return {
    node: {
      connection: cssVar("--color-primary", "#3b82f6"),
      gateway: cssVar("--color-warning", "#f59e0b"),
      bastion: cssVar("--color-error", "#ef4444"),
      proxy: cssVar("--color-accent", "#8b5cf6"),
      vpn: cssVar("--color-success", "#10b981"),
      group: cssVar("--color-secondary", "#6b7280"),
      external: cssVar("--color-info", "#ec4899"),
    } as Record<NodeKind, string>,
    status: {
      online: cssVar("--color-success", "#22c55e"),
      offline: cssVar("--color-error", "#ef4444"),
      unknown: cssVar("--color-textMuted", "#a3a3a3"),
    } as Record<string, string>,
    text: cssVar("--color-text", "#f8fafc"),
    textMuted: cssVar("--color-textMuted", "#cbd5e1"),
    primary: cssVar("--color-primary", "#3b82f6"),
    warning: cssVar("--color-warning", "#facc15"),
    error: cssVar("--color-error", "#ef4444"),
    info: cssVar("--color-info", "#38bdf8"),
    surface: cssVar("--color-surface", "#1f2937"),
    background: cssVar("--color-background", "#111827"),
    border: cssVar("--color-textMuted", "#94a3b8"),
    orange: cssVar("--color-warning", "#f97316"),
  };
}
// Legacy constants for initial/static references
const NODE_COLORS: Record<NodeKind, string> = {
  connection: "#3b82f6",
  gateway: "#f59e0b",
  bastion: "#ef4444",
  proxy: "#8b5cf6",
  vpn: "#10b981",
  group: "#6b7280",
  external: "#ec4899",
};
const STATUS_RING: Record<string, string> = {
  online: "#22c55e",
  offline: "#ef4444",
  unknown: "#a3a3a3",
};
const LAYOUT_OPTIONS: { value: LayoutAlgorithm; labelKey: string }[] = [
  { value: "force_directed", labelKey: "topology.layoutForce" },
  { value: "hierarchical", labelKey: "topology.layoutHierarchical" },
  { value: "circular", labelKey: "topology.layoutCircular" },
  { value: "grid", labelKey: "topology.layoutGrid" },
];

/* ---------- helpers ---------- */
interface Camera {
  x: number;
  y: number;
  zoom: number;
}

function worldToScreen(wx: number, wy: number, cam: Camera): [number, number] {
  return [(wx - cam.x) * cam.zoom, (wy - cam.y) * cam.zoom];
}

function screenToWorld(sx: number, sy: number, cam: Camera): [number, number] {
  return [sx / cam.zoom + cam.x, sy / cam.zoom + cam.y];
}

/* ---------- component ---------- */
export interface TopologyVisualizerProps {
  isOpen: boolean;
  onClose?: () => void;
}

const TopologyVisualizer: React.FC<TopologyVisualizerProps> = ({
  isOpen,
}) => {
  const { t } = useTranslation();
  const topo = useTopology();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [pathTarget, setPathTarget] = useState<string | null>(null);
  const [showBottlenecks, setShowBottlenecks] = useState(false);
  const [focusedNodeIndex, setFocusedNodeIndex] = useState<number>(-1);
  const [srAnnouncement, setSrAnnouncement] = useState("");

  /* ---- data loading ---- */
  useEffect(() => {
    if (!isOpen) return;
    topo.fetchGraph();
    topo.fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topo methods are stable
  }, [isOpen]);

  /* ---- derived lookups ---- */
  const nodes = useMemo(() => topo.graph?.nodes ?? [], [topo.graph?.nodes]);
  const edges = useMemo(() => topo.graph?.edges ?? [], [topo.graph?.edges]);
  const nodeMap = useRef<Map<string, TopologyNode>>(new Map());
  useEffect(() => {
    const m = new Map<string, TopologyNode>();
    for (const n of nodes) m.set(n.id, n);
    nodeMap.current = m;
  }, [nodes]);

  const blastSet = useMemo(() => new Set(topo.blastRadius?.affectedNodes ?? []), [topo.blastRadius]);
  const pathSet = useMemo(() => new Set(topo.path?.path ?? []), [topo.path]);
  const bottleneckSet = useMemo(() => new Set(topo.bottlenecks.map((b) => b.nodeId)), [topo.bottlenecks]);

  /* ---- hit-test ---- */
  const hitTest = useCallback(
    (sx: number, sy: number): TopologyNode | null => {
      const [wx, wy] = screenToWorld(sx, sy, camera);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = n.x - wx;
        const dy = n.y - wy;
        if (dx * dx + dy * dy <= NODE_RADIUS * NODE_RADIUS) return n;
      }
      return null;
    },
    [camera, nodes],
  );

  /* ---- mouse handlers ---- */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const node = hitTest(sx, sy);
      if (node) {
        topo.setSelectedNode(node.id);
        topo.getBlastRadius(node.id);
        if (pathSource && !pathTarget) {
          setPathTarget(node.id);
          topo.findPath(pathSource, node.id);
        }
      } else {
        setDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    },
    [hitTest, topo, pathSource, pathTarget],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragging && dragStart) {
        const dx = (e.clientX - dragStart.x) / camera.zoom;
        const dy = (e.clientY - dragStart.y) / camera.zoom;
        setCamera((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }
      const rect = canvasRef.current!.getBoundingClientRect();
      const node = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      setHoveredNode(node?.id ?? null);
    },
    [dragging, dragStart, camera.zoom, hitTest],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setDragStart(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setCamera((c) => ({
      ...c,
      zoom: Math.min(5, Math.max(0.1, c.zoom * factor)),
    }));
  }, []);

  /* ---- toolbar actions ---- */
  const handleLayoutChange = (alg: LayoutAlgorithm) => topo.applyLayout(alg);

  const zoomIn = useCallback(() => setCamera((c) => ({ ...c, zoom: Math.min(5, c.zoom * 1.25) })), []);
  const zoomOut = useCallback(() => setCamera((c) => ({ ...c, zoom: Math.max(0.1, c.zoom * 0.8) })), []);

  /* ---- keyboard handler ---- */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const PAN = 20;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setCamera((c) => ({ ...c, y: c.y - PAN / c.zoom }));
          break;
        case "ArrowDown":
          e.preventDefault();
          setCamera((c) => ({ ...c, y: c.y + PAN / c.zoom }));
          break;
        case "ArrowLeft":
          e.preventDefault();
          setCamera((c) => ({ ...c, x: c.x - PAN / c.zoom }));
          break;
        case "ArrowRight":
          e.preventDefault();
          setCamera((c) => ({ ...c, x: c.x + PAN / c.zoom }));
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
          e.preventDefault();
          zoomOut();
          break;
        case "Tab":
          if (nodes.length === 0) break;
          e.preventDefault();
          setFocusedNodeIndex((prev) => {
            const next = e.shiftKey
              ? (prev <= 0 ? nodes.length - 1 : prev - 1)
              : (prev + 1) % nodes.length;
            const node = nodes[next];
            topo.setSelectedNode(node.id);
            setSrAnnouncement(`Selected node: ${node.label}`);
            return next;
          });
          break;
        case "Enter":
          if (focusedNodeIndex >= 0 && focusedNodeIndex < nodes.length) {
            e.preventDefault();
            const node = nodes[focusedNodeIndex];
            topo.setSelectedNode(node.id);
            topo.getBlastRadius(node.id);
            setSrAnnouncement(`Activated node: ${node.label}`);
          }
          break;
        case "Escape":
          e.preventDefault();
          topo.setSelectedNode(null as unknown as string);
          setFocusedNodeIndex(-1);
          setSrAnnouncement("Selection cleared");
          break;
      }
    },
    [nodes, focusedNodeIndex, topo, zoomIn, zoomOut],
  );

  const fitToView = useCallback(() => {
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 40;
    const maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40;
    const maxY = Math.max(...ys) + 40;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    const zoom = Math.min(w / (maxX - minX), h / (maxY - minY), 3);
    setCamera({
      x: minX - (w / zoom - (maxX - minX)) / 2,
      y: minY - (h / zoom - (maxY - minY)) / 2,
      zoom,
    });
  }, [nodes]);

  const exportImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "topology.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const handleDetectBottlenecks = async () => {
    await topo.findBottlenecks();
    setShowBottlenecks(true);
  };

  const startPathFind = () => {
    setPathSource(topo.selectedNode);
    setPathTarget(null);
    topo.findPath("", ""); // clear
  };

  /* ---- canvas render ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isOpen) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = containerRef.current;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const tc = getThemeColors();

    /* edges */
    for (const edge of edges) {
      const src = nodeMap.current.get(edge.source);
      const tgt = nodeMap.current.get(edge.target);
      if (!src || !tgt) continue;

      const onPath = pathSet.has(edge.source) && pathSet.has(edge.target);
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = onPath ? tc.warning : `${tc.border}80`;
      ctx.lineWidth = onPath ? 3 : 1;
      ctx.stroke();

      /* arrow for directed edges */
      if (!edge.bidirectional) {
        const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);
        const tipX = tgt.x - Math.cos(angle) * NODE_RADIUS;
        const tipY = tgt.y - Math.sin(angle) * NODE_RADIUS;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - 10 * Math.cos(angle - 0.4),
          tipY - 10 * Math.sin(angle - 0.4),
        );
        ctx.lineTo(
          tipX - 10 * Math.cos(angle + 0.4),
          tipY - 10 * Math.sin(angle + 0.4),
        );
        ctx.closePath();
        ctx.fillStyle = onPath ? tc.warning : `${tc.border}b3`;
        ctx.fill();
      }
    }

    /* nodes */
    for (const node of nodes) {
      const isSelected = node.id === topo.selectedNode;
      const isBlast = blastSet.has(node.id);
      const isBottleneck = showBottlenecks && bottleneckSet.has(node.id);
      const isPath = pathSet.has(node.id);
      const isHover = node.id === hoveredNode;

      /* blast radius glow */
      if (isBlast) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_RADIUS + 10, 0, Math.PI * 2);
        ctx.fillStyle = `${tc.error}26`;
        ctx.fill();
      }

      /* bottleneck ring */
      if (isBottleneck) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = tc.orange;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      /* path highlight */
      if (isPath) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, NODE_RADIUS + 5, 0, Math.PI * 2);
        ctx.strokeStyle = tc.warning;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      /* status ring */
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE_RADIUS + 2, 0, Math.PI * 2);
      ctx.strokeStyle = tc.status[node.status] ?? tc.status.unknown;
      ctx.lineWidth = 2;
      ctx.stroke();

      /* node circle */
      ctx.beginPath();
      ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = tc.node[node.kind] ?? tc.node.connection;
      ctx.fill();

      if (isSelected || isHover) {
        ctx.strokeStyle = isSelected ? tc.text : tc.textMuted;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      /* label */
      ctx.fillStyle = tc.text;
      ctx.font = "11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.label.slice(0, 10), node.x, node.y);
    }

    ctx.restore();
  }, [
    isOpen,
    nodes,
    edges,
    camera,
    topo.selectedNode,
    blastSet,
    pathSet,
    bottleneckSet,
    showBottlenecks,
    hoveredNode,
  ]);

  /* ---- minimap ---- */
  useEffect(() => {
    const mini = miniRef.current;
    if (!mini || !nodes.length) return;
    const mCtx = mini.getContext("2d");
    if (!mCtx) return;
    mini.width = MINIMAP_W;
    mini.height = MINIMAP_H;
    mCtx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    const mc = getThemeColors();
    mCtx.fillStyle = `${mc.background}b3`;
    mCtx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 20;
    const maxX = Math.max(...xs) + 20;
    const minY = Math.min(...ys) - 20;
    const maxY = Math.max(...ys) + 20;
    const scaleX = MINIMAP_W / (maxX - minX || 1);
    const scaleY = MINIMAP_H / (maxY - minY || 1);
    const scale = Math.min(scaleX, scaleY);

    for (const e of edges) {
      const s = nodeMap.current.get(e.source);
      const tg = nodeMap.current.get(e.target);
      if (!s || !tg) continue;
      mCtx.beginPath();
      mCtx.moveTo((s.x - minX) * scale, (s.y - minY) * scale);
      mCtx.lineTo((tg.x - minX) * scale, (tg.y - minY) * scale);
      mCtx.strokeStyle = `${mc.border}4d`;
      mCtx.lineWidth = 0.5;
      mCtx.stroke();
    }

    for (const n of nodes) {
      mCtx.beginPath();
      mCtx.arc((n.x - minX) * scale, (n.y - minY) * scale, 2, 0, Math.PI * 2);
      mCtx.fillStyle = mc.node[n.kind] ?? mc.border;
      mCtx.fill();
    }

    /* viewport rect */
    const canvas = canvasRef.current;
    if (canvas) {
      const vx = (camera.x - minX) * scale;
      const vy = (camera.y - minY) * scale;
      const vw = (canvas.width / camera.zoom) * scale;
      const vh = (canvas.height / camera.zoom) * scale;
      mCtx.strokeStyle = mc.info;
      mCtx.lineWidth = 1;
      mCtx.strokeRect(vx, vy, vw, vh);
    }
  }, [nodes, edges, camera]);

  /* ---- selected node details ---- */
  const selected = topo.selectedNode ? nodeMap.current.get(topo.selectedNode) : null;
  const connectionCount = selected
    ? edges.filter((e) => e.source === selected.id || e.target === selected.id).length
    : 0;

  if (!isOpen) return null;

  return (
    <div className="sor-topology-root flex flex-col h-full bg-[var(--color-surface)] text-[var(--color-text)]" data-testid="topology-view">
      {/* ---- Toolbar ---- */}
      <div className="sor-topology-toolbar flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]">
        <label className="sor-topology-layout-label text-xs font-medium mr-1">
          {t("topology.layout", "Layout")}:
        </label>
        <Select
          value={LAYOUT_OPTIONS[0].value}
          onChange={(v) => handleLayoutChange(v as LayoutAlgorithm)}
          variant="form-sm"
          options={LAYOUT_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.labelKey, o.value.replace("_", " ")),
          }))}
        />

        <span className="sor-topology-sep mx-1 text-[var(--color-border)]">|</span>

        <button className="sor-topology-btn text-xs px-2 py-1 rounded hover:bg-[var(--color-hover)]" onClick={zoomIn} title={t("topology.zoomIn", "Zoom In")}>+</button>
        <button className="sor-topology-btn text-xs px-2 py-1 rounded hover:bg-[var(--color-hover)]" onClick={zoomOut} title={t("topology.zoomOut", "Zoom Out")}>−</button>
        <button className="sor-topology-btn text-xs px-2 py-1 rounded hover:bg-[var(--color-hover)]" onClick={fitToView}>{t("topology.fit", "Fit")}</button>
        <button className="sor-topology-btn text-xs px-2 py-1 rounded hover:bg-[var(--color-hover)]" onClick={exportImage}>{t("topology.export", "Export PNG")}</button>

        <span className="sor-topology-sep mx-1 text-[var(--color-border)]">|</span>

        <button className="sor-topology-btn text-xs px-2 py-1 rounded hover:bg-[var(--color-hover)]" onClick={handleDetectBottlenecks}>
          {t("topology.bottlenecks", "Bottlenecks")}
        </button>
        <button
          className="sor-topology-btn text-xs px-2 py-1 rounded hover:bg-[var(--color-hover)]"
          onClick={startPathFind}
          disabled={!topo.selectedNode}
          title={t("topology.pathHint", "Select a node first, then click target")}
        >
          {t("topology.findPath", "Find Path")}
        </button>

        {topo.loading && (
          <span className="sor-topology-loading ml-auto text-xs text-[var(--color-muted)] animate-pulse">
            {t("topology.loading", "Computing…")}
          </span>
        )}
        {topo.error && (
          <span className="sor-topology-error ml-2 text-xs text-error">{topo.error}</span>
        )}
      </div>

      {/* ---- Main area ---- */}
      <div className="sor-topology-body flex flex-1 min-h-0">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="sor-topology-canvas-wrap relative flex-1 min-w-0 focus:outline-2 focus:outline-[var(--color-accent,#3b82f6)] focus:outline-offset-[-2px]"
          role="application"
          aria-label="Network topology visualization"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <canvas
            ref={canvasRef}
            className="sor-topology-canvas block w-full h-full cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
          <div className="sr-only" role="status" aria-live="assertive">
            {srAnnouncement}
          </div>

          {/* Minimap */}
          <canvas
            ref={miniRef}
            className="sor-topology-minimap absolute bottom-2 left-2 rounded border border-[var(--color-border)] pointer-events-none"
            width={MINIMAP_W}
            height={MINIMAP_H}
          />

          {/* Legend */}
          <div className="sor-topology-legend absolute top-2 left-2 bg-[var(--color-surfaceHover)]/90 backdrop-blur rounded p-2 text-[10px] leading-relaxed border border-[var(--color-border)]">
            {(Object.entries(NODE_COLORS) as [NodeKind, string][]).map(([kind, color]) => (
              <div key={kind} className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span className="capitalize">{t(`topology.kind.${kind}`, kind)}</span>
              </div>
            ))}
          </div>

          {/* Stats */}
          {topo.stats && (
            <div className="sor-topology-stats absolute bottom-2 right-2 bg-[var(--color-surfaceHover)]/90 backdrop-blur rounded p-2 text-[10px] border border-[var(--color-border)] grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-[var(--color-muted)]">{t("topology.statNodes", "Nodes")}</span>
              <span className="font-mono text-right">{topo.stats.nodeCount}</span>
              <span className="text-[var(--color-muted)]">{t("topology.statEdges", "Edges")}</span>
              <span className="font-mono text-right">{topo.stats.edgeCount}</span>
              <span className="text-[var(--color-muted)]">{t("topology.statComponents", "Components")}</span>
              <span className="font-mono text-right">{topo.stats.connectedComponents}</span>
              <span className="text-[var(--color-muted)]">{t("topology.statDensity", "Density")}</span>
              <span className="font-mono text-right">{topo.stats.density.toFixed(3)}</span>
            </div>
          )}
        </div>

        {/* ---- Details panel ---- */}
        {selected && (
          <aside className="sor-topology-details w-64 border-l border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-4 overflow-y-auto text-sm">
            <h3 className="font-semibold mb-3 text-base">{selected.label}</h3>

            <dl className="sor-topology-dl space-y-2">
              <div>
                <dt className="text-[var(--color-muted)] text-xs">{t("topology.type", "Type")}</dt>
                <dd className="capitalize">{selected.kind}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)] text-xs">{t("topology.hostname", "Hostname / IP")}</dt>
                <dd className="font-mono text-xs">{selected.hostname ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)] text-xs">{t("topology.status", "Status")}</dt>
                <dd className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: STATUS_RING[selected.status] }}
                  />
                  <span className="capitalize">{selected.status}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)] text-xs">{t("topology.connections", "Connections")}</dt>
                <dd>{connectionCount}</dd>
              </div>
              {selected.protocol && (
                <div>
                  <dt className="text-[var(--color-muted)] text-xs">{t("topology.protocol", "Protocol")}</dt>
                  <dd className="uppercase text-xs">{selected.protocol}</dd>
                </div>
              )}
            </dl>

            {/* Blast radius info */}
            {topo.blastRadius && (
              <div className="sor-topology-blast mt-4 p-2 rounded bg-error/10 border border-error/30 text-xs">
                <p className="font-medium text-error mb-1">{t("topology.blastRadius", "Blast Radius")}</p>
                <p>
                  {t("topology.blastAffected", "Affected nodes: {{count}}", {
                    count: topo.blastRadius.affectedNodes.length,
                  })}
                </p>
                <p>
                  {t("topology.blastImpact", "Impact score: {{score}}", {
                    score: topo.blastRadius.impactScore.toFixed(2),
                  })}
                </p>
              </div>
            )}

            {/* Path info */}
            {topo.path && topo.path.path.length > 0 && (
              <div className="sor-topology-path mt-4 p-2 rounded bg-warning/10 border border-warning/30 text-xs">
                <p className="font-medium text-warning mb-1">{t("topology.shortestPath", "Shortest Path")}</p>
                <p>{t("topology.pathHops", "Hops: {{hops}}", { hops: topo.path.hops })}</p>
                <p>{t("topology.pathWeight", "Weight: {{w}}", { w: topo.path.totalWeight.toFixed(2) })}</p>
                <ol className="list-decimal list-inside mt-1 space-y-0.5">
                  {topo.path.path.map((nid) => {
                    const pn = nodeMap.current.get(nid);
                    return <li key={nid}>{pn?.label ?? nid}</li>;
                  })}
                </ol>
              </div>
            )}

            {pathSource && !pathTarget && (
              <p className="mt-3 text-xs text-[var(--color-muted)] italic">
                {t("topology.selectTarget", "Click a second node to complete the path.")}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

export default TopologyVisualizer;
