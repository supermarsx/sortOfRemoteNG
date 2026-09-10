"use client";
import React, { useEffect, useRef, useState } from "react";
import styles from "./documents.module.css";

import { validateDiagramSource, sanitizeDiagramSvg } from "./diagramSafety";
let renderQueue: Promise<unknown> = Promise.resolve();
export default function MermaidBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const token = useRef(0);
  const pendingContainer = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    token.current++;
    setSvg(null);
    setError(null);
    setBusy(false);
    return () => {
      // An operation generation, not a rendered DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      token.current++;
      pendingContainer.current?.remove();
      pendingContainer.current = null;
    };
  }, [source]);
  const preview = () => {
    const captured = ++token.current;
    setBusy(true);
    setError(null);
    setSvg(null);
    const work = async () => {
      let container: HTMLDivElement | undefined;
      try {
        validateDiagramSource(source);
        const { default: mermaid } = await import("mermaid");
        if (token.current !== captured) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          suppressErrorRendering: true,
          maxTextSize: 32768,
          maxEdges: 500,
          secure: [
            "securityLevel",
            "htmlLabels",
            "startOnLoad",
            "maxTextSize",
            "maxEdges",
            "suppressErrorRendering",
          ],
        });
        container = document.createElement("div");
        pendingContainer.current = container;
        container.style.position = "fixed";
        container.style.left = "-100000px";
        container.setAttribute("aria-hidden", "true");
        document.body.append(container);
        const result = await mermaid.render(
          `document-diagram-${crypto.randomUUID()}`,
          source,
          container,
        );
        const safe = await sanitizeDiagramSvg(result.svg);
        if (token.current === captured) setSvg(safe);
      } catch {
        if (token.current === captured)
          setError(
            "Diagram preview unavailable. Use bounded local flowchart, sequence, class, state or ER syntax without HTML, links, directives or images.",
          );
      } finally {
        container?.remove();
        if (pendingContainer.current === container)
          pendingContainer.current = null;
        if (token.current === captured) setBusy(false);
      }
    };
    renderQueue = renderQueue.then(work, work);
  };
  return (
    <div>
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={busy}
        onClick={preview}
      >
        {busy ? "Rendering diagram…" : "Preview diagram"}
      </button>
      {error && <p role="alert">{error}</p>}
      {svg && (
        <div
          aria-label="Diagram preview"
          className={styles.preview}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <p className={styles.help}>
        Local, noninteractive SVG preview. No remote images, HTML labels or
        diagram click actions.
      </p>
    </div>
  );
}
