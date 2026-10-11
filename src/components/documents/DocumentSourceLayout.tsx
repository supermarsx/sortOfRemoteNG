import React, { useId, useState } from "react";
import { Columns2, Rows2 } from "lucide-react";
import {
  clampDocumentSize,
  useDocumentArea,
} from "../../hooks/documents/useDocumentArea";
import DocumentResizeHandle from "./DocumentResizeHandle";
import styles from "./documentLayout.module.css";

/** Keep the source and preview mounted while changing their split geometry. */
export default function DocumentSourceLayout({
  label,
  source,
  preview,
}: {
  label: string;
  source: React.ReactNode;
  preview: React.ReactNode;
}) {
  const id = useId();
  const area = useDocumentArea();
  const [sideBySide, setSideBySide] = useState(false);
  const [height, setHeight] = useState(440);
  const [sourceWidth, setSourceWidth] = useState<number | null>(null);
  const [sourceHeight, setSourceHeight] = useState<number | null>(null);
  const horizontal = sideBySide && area.width >= 480;
  const extent = horizontal ? area.width : height;
  const min = horizontal ? 160 : 100;
  const max = Math.max(min, extent - min - 8);
  const value = clampDocumentSize(
    (horizontal ? sourceWidth : sourceHeight) ?? (extent - 8) / 2,
    min,
    max,
  );
  return (
    <div className={styles.sourceLayout}>
      <div
        className={styles.sourceToolbar}
        role="group"
        aria-label={`${label} preview layout`}
      >
        <button
          type="button"
          className={`sor-btn sor-btn-secondary ${styles.compactButton}`}
          aria-pressed={!sideBySide}
          onClick={() => setSideBySide(false)}
        >
          <Rows2 size={14} aria-hidden="true" /> Stack source and preview
        </button>
        <button
          type="button"
          className={`sor-btn sor-btn-secondary ${styles.compactButton}`}
          aria-pressed={sideBySide}
          onClick={() => setSideBySide(true)}
        >
          <Columns2 size={14} aria-hidden="true" /> Source and preview side by
          side
        </button>
      </div>
      <div
        ref={area.ref}
        id={id}
        className={`${styles.sourcePanes} ${horizontal ? "" : styles.stacked}`}
        style={{ height }}
      >
        <div
          id={`${id}-source`}
          className={styles.sourcePane}
          style={{ flexBasis: value }}
        >
          {source}
        </div>
        <DocumentResizeHandle
          axis={horizontal ? "width" : "height"}
          label={`${label} source ${horizontal ? "width" : "height"}`}
          controls={`${id}-source`}
          value={value}
          min={min}
          max={max}
          onChange={horizontal ? setSourceWidth : setSourceHeight}
        />
        <div className={styles.sourcePreview}>{preview}</div>
      </div>
      <DocumentResizeHandle
        axis="height"
        label={`${label} source and preview height`}
        controls={id}
        value={height}
        min={240}
        max={1000}
        onChange={setHeight}
      />
    </div>
  );
}
