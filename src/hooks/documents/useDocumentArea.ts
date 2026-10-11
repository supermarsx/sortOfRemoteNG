import { useLayoutEffect, useState } from "react";

/** Measure the owning pane, including when a session is tiled or detached. */
export function useDocumentArea() {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1024, height: 720 });
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const width =
        element.clientWidth -
        parseFloat(style.paddingLeft || "0") -
        parseFloat(style.paddingRight || "0");
      const height =
        element.clientHeight -
        parseFloat(style.paddingTop || "0") -
        parseFloat(style.paddingBottom || "0");
      // Hidden tabs have no layout. Retain their last useful dimensions.
      if (width > 0 && height > 0)
        setSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);
  return { ref, ...size };
}

export function clampDocumentSize(value: number, min: number, max: number) {
  return Math.max(Math.min(min, max), Math.min(value, max));
}
