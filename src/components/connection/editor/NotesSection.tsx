import React from "react";
import { FileText } from "lucide-react";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import type { Connection } from "../../../types/connection/connection";
import { Textarea } from "../../ui/forms";
import { MachineAssignmentSection } from "./MachineAssignmentSection";

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
      placeholder={
        mgr.formData.isGroup
          ? "Add notes about this folder..."
          : "Add notes about this connection..."
      }
    />
  </div>
);

export const NotesSection: React.FC<{
  mgr: NotesSectionManager;
  connections?: readonly Connection[];
  databaseId?: string;
}> = ({ mgr, connections = [], databaseId }) => (
  <div className="space-y-4">
    <DescriptionSection mgr={mgr} />
    {!mgr.formData.isGroup && (
      <MachineAssignmentSection
        assignment={mgr.formData.machineAssignment}
        connections={connections}
        databaseId={databaseId}
        currentConnectionId={mgr.formData.id}
        onChange={(machineAssignment) =>
          mgr.setFormData((current) => ({ ...current, machineAssignment }))
        }
      />
    )}
  </div>
);
