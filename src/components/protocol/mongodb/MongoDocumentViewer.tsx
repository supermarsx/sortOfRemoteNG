import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMongoJson } from "../../../hooks/protocol/useMongoDBClient";
import type { MongoDocument } from "../../../types/mongodb";

interface MongoDocumentViewerProps {
  document: MongoDocument | null;
  index: number | null;
  onClose: () => void;
}

/** Expanded pretty-printed view of a single selected document. */
export function MongoDocumentViewer({
  document,
  index,
  onClose,
}: MongoDocumentViewerProps) {
  const { t } = useTranslation();
  if (!document) return null;
  return (
    <aside
      className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)]"
      data-testid="mongodb-document-viewer"
      aria-label={t("mongoClient.viewer.ariaLabel", "Document viewer")}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-semibold text-[var(--color-text)]">
          {t("mongoClient.viewer.title", "Document")}
          {index !== null ? ` #${index + 1}` : ""}
        </span>
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label={t("mongoClient.viewer.close", "Close document viewer")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-[var(--color-text)]">
        {formatMongoJson(document)}
      </pre>
    </aside>
  );
}
