import React from "react";
import {
  Edit2,
  Trash2,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  Terminal,
  Film,
} from "lucide-react";
import type { SavedRecording } from "../../types/macroTypes";
import { useInlineRename } from "../../hooks/useInlineRename";
import { formatDuration } from "../../utils/formatters";

interface SshRecordingRowProps {
  recording: SavedRecording;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: (format: "json" | "asciicast" | "script" | "gif") => void;
}

export const SshRecordingRow: React.FC<SshRecordingRowProps> = ({
  recording,
  isExpanded,
  onToggle,
  onRename,
  onDelete,
  onExport,
}) => {
  const rename = useInlineRename(recording.name, onRename);
  const meta = recording.recording.metadata;

  return (
    <div className={isExpanded ? "bg-[var(--color-surface)]/30" : ""}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--color-surface)]/60"
      >
        <Terminal size={16} className="text-green-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">
            {recording.name}
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
            <span>{meta.host}</span>
            <span className="text-gray-600">·</span>
            <span>{meta.username}@</span>
            <span className="text-gray-600">·</span>
            <span>{formatDuration(meta.duration_ms)}</span>
            <span className="text-gray-600">·</span>
            <span>{meta.entry_count} entries</span>
            <span className="text-gray-600">·</span>
            <span>
              {meta.cols}x{meta.rows}
            </span>
            <span className="text-gray-600">·</span>
            <span>{new Date(recording.savedAt).toLocaleString()}</span>
          </div>
        </div>
        {recording.tags && recording.tags.length > 0 && (
          <div className="flex gap-1">
            {recording.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[9px] bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {isExpanded ? (
          <ChevronUp size={14} className="text-[var(--color-textSecondary)]" />
        ) : (
          <ChevronDown
            size={14}
            className="text-[var(--color-textSecondary)]"
          />
        )}
      </div>

      {isExpanded && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          {rename.isRenaming ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={rename.draft}
                onChange={(e) => rename.setDraft(e.target.value)}
                className="sor-settings-input sor-settings-input-compact flex-1"
                autoFocus
                onKeyDown={rename.handleKeyDown}
              />
              <button
                onClick={rename.commitRename}
                className="p-1 text-green-400 hover:text-green-300"
              >
                <Save size={14} />
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={rename.startRename}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Edit2 size={12} /> Rename
              </button>
              <button
                onClick={() => onExport("asciicast")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> Asciicast
              </button>
              <button
                onClick={() => onExport("script")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> Script
              </button>
              <button
                onClick={() => onExport("json")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> JSON
              </button>
              <button
                onClick={() => onExport("gif")}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Film size={12} /> GIF
              </button>
              <div className="flex-1" />
              <button
                onClick={onDelete}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded"
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
