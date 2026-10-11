import React, { useEffect, useRef } from "react";
import { clampDocumentSize } from "../../hooks/documents/useDocumentArea";
import styles from "./documentLayout.module.css";

export default function DocumentResizeHandle({
  axis,
  label,
  controls,
  value,
  min,
  max,
  onChange,
}: {
  axis: "width" | "height";
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  onChange: (size: number) => void;
}) {
  const drag = useRef<{ pointer: number; origin: number; size: number } | null>(
    null,
  );
  const latest = useRef({ axis, min, max, onChange });
  latest.current = { axis, min, max, onChange };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = drag.current;
      if (!start || event.pointerId !== start.pointer) return;
      const current = latest.current;
      const position = current.axis === "width" ? event.clientX : event.clientY;
      current.onChange(
        clampDocumentSize(
          start.size + position - start.origin,
          current.min,
          current.max,
        ),
      );
    };
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={axis === "width" ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(Math.min(min, max))}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} pixels`}
      title={`${label} · Drag or use arrow keys; Home/End for limits`}
      className={axis === "width" ? styles.widthHandle : styles.heightHandle}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = {
          pointer: event.pointerId,
          origin: axis === "width" ? event.clientX : event.clientY,
          size: value,
        };
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 16;
        const decrease = axis === "width" ? "ArrowLeft" : "ArrowUp";
        const increase = axis === "width" ? "ArrowRight" : "ArrowDown";
        const next =
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : event.key === decrease
                ? value - step
                : event.key === increase
                  ? value + step
                  : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(clampDocumentSize(next, min, max));
      }}
    />
  );
}
