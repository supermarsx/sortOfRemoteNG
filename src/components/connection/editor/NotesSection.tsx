import React from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import { Textarea } from "../../ui/forms";

export const DescriptionSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => (
  <div
    data-editor-search-section="notes-description"
    className="border border-[var(--color-border)] rounded-xl overflow-hidden"
  >
    <button
      type="button"
      onClick={() => mgr.toggleSection("description")}
      aria-expanded={mgr.expandedSections.description}
      className="w-full flex items-center justify-between px-3 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
    >
      <div className="flex items-center gap-2 text-[var(--color-textSecondary)]">
        <FileText size={16} />
        <span className="text-sm font-medium">Description & Notes</span>
        {mgr.formData.description && (
          <span className="text-xs text-[var(--color-textMuted)] ml-2">
            ({mgr.formData.description.length} chars)
          </span>
        )}
      </div>
      {mgr.expandedSections.description ? (
        <ChevronUp size={16} className="text-[var(--color-textSecondary)]" />
      ) : (
        <ChevronDown size={16} className="text-[var(--color-textSecondary)]" />
      )}
    </button>
    {mgr.expandedSections.description && (
      <div className="p-4 border-t border-[var(--color-border)]">
        <Textarea
          data-testid="editor-description"
          data-editor-search-field="description"
          value={mgr.formData.description || ""}
          onChange={(value) =>
            mgr.setFormData({ ...mgr.formData, description: value })
          }
          rows={4}
          className="w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
          placeholder="Add notes about this connection..."
        />
      </div>
    )}
  </div>
);

export const NotesSection: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => <DescriptionSection mgr={mgr} />;
