import React from "react";
import { FileText } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import { Textarea } from "../../ui/forms";

type NotesSectionManager = Pick<
  ConnectionEditorMgr,
  "formData" | "setFormData"
>;

export const DescriptionSection: React.FC<{ mgr: NotesSectionManager }> = ({
  mgr,
}) => (
  <div
    data-editor-search-section="notes-description"
    className="rounded-xl border border-[var(--color-border)] p-4"
  >
    <div className="mb-3 flex items-center gap-2 text-[var(--color-textSecondary)]">
      <FileText size={16} aria-hidden="true" />
      <label
        htmlFor="editor-description"
        className="text-sm font-medium text-[var(--color-text)]"
      >
        Description & Notes
      </label>
      {mgr.formData.description && (
        <span className="ml-auto text-xs text-[var(--color-textMuted)]">
          {mgr.formData.description.length} chars
        </span>
      )}
    </div>
    <Textarea
      id="editor-description"
      data-testid="editor-description"
      data-editor-search-field="description"
      value={mgr.formData.description || ""}
      onChange={(value) =>
        mgr.setFormData({ ...mgr.formData, description: value })
      }
      rows={6}
      className="w-full resize-y px-4 py-3"
      placeholder="Add notes about this connection..."
    />
  </div>
);

export const NotesSection: React.FC<{ mgr: NotesSectionManager }> = ({
  mgr,
}) => <DescriptionSection mgr={mgr} />;
