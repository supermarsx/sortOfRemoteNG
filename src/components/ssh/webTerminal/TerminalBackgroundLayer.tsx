import React, { useEffect, useRef } from "react";
import type { TerminalBackgroundMgr } from "../../../hooks/ssh/useTerminalBackground";

interface TerminalBackgroundLayerProps {
  mgr: TerminalBackgroundMgr;
  /** Width/height of the container so the canvas can be resized */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Renders all background layers beneath the terminal:
 * 1. Background layer (solid / gradient / image)
 * 2. Animated canvas (matrix, starfield, etc.)
 * 3. Overlay layers (color, vignette, scanlines, CRT, etc.)
 *
 * Place this as the first child of the terminal container (position: relative).
 */
const TerminalBackgroundLayer: React.FC<TerminalBackgroundLayerProps> = ({ mgr, containerRef }) => {
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  /* Keep canvas sized to container */
  useEffect(() => {
    if (!containerRef?.current || typeof ResizeObserver === "undefined") return;
    const el = containerRef.current;

    const syncSize = () => {
      const { width, height } = el.getBoundingClientRect();
      mgr.resizeCanvas(Math.floor(width), Math.floor(height));
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(el);
    resizeObserverRef.current = ro;
    return () => { ro.disconnect(); resizeObserverRef.current = null; };
  }, [containerRef, mgr]);

  if (!mgr.enabled) return null;

  return (
    <>
      {/* Static background (solid / gradient / image) */}
      {mgr.bgType !== "animated" && mgr.bgType !== "none" && (
        <div style={mgr.backgroundStyle} aria-hidden />
      )}

      {/* Animated canvas background */}
      {mgr.bgType === "animated" && (
        <canvas
          ref={mgr.canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            opacity: mgr.config?.opacity ?? 1,
          }}
          aria-hidden
        />
      )}

      {/* Overlay layers */}
      {mgr.overlayStyles.map((style, i) => (
        <div key={i} style={style} aria-hidden />
      ))}
    </>
  );
};

export default TerminalBackgroundLayer;
