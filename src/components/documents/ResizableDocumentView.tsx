import React, { useId, useState } from "react";
import {
  clampDocumentSize,
  useDocumentArea,
} from "../../hooks/documents/useDocumentArea";
import DocumentResizeHandle from "./DocumentResizeHandle";
import styles from "./documentLayout.module.css";

export default function ResizableDocumentView({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  const area = useDocumentArea();
  const id = useId();
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const maxWidth = Math.max(1, area.width - 8);
  const maxHeight = Math.max(1, area.height - 8);
  const currentWidth = clampDocumentSize(width ?? maxWidth, 320, maxWidth);
  const currentHeight = clampDocumentSize(height ?? maxHeight, 240, maxHeight);
  return (
    <main className={`${styles.viewPane} ${className}`}>
      <div ref={area.ref} className={styles.viewArea}>
        <div
          className={styles.viewFrame}
          style={{ width: currentWidth + 8, height: currentHeight + 8 }}
        >
          <div id={id} className={styles.viewContent}>
            {children}
          </div>
          <DocumentResizeHandle
            axis="width"
            label="Document view width"
            controls={id}
            value={currentWidth}
            min={320}
            max={maxWidth}
            onChange={setWidth}
          />
          <DocumentResizeHandle
            axis="height"
            label="Document view height"
            controls={id}
            value={currentHeight}
            min={240}
            max={maxHeight}
            onChange={setHeight}
          />
        </div>
      </div>
    </main>
  );
}
