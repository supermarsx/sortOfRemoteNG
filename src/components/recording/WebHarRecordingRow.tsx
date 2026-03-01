import React from "react";
import {
  Edit2,
  Trash2,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  Globe,
} from "lucide-react";
import type { SavedWebRecording } from "../../types/macroTypes";
import { useInlineRename } from "../../hooks/window/useInlineRename";
import { formatDuration, formatBytes } from "../../utils/formatters";

interface WebHarRecordingRowProps {
  recording: SavedWebRecording;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: (format: "json" | "har") => void;
}

export const WebHarRecordingRow: React.FC<WebHarRecordingRowProps> = ({
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
        <Globe size={16} className="text-cyan-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">
            {recording.name}
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
            {recording.host && (
              <>
                <span>{recording.host}</span>
                <span className="text-[var(--color-textMuted)]">·</span>
              </>
            )}
            <span>{meta.entry_count} requests</span>
            <span className="text-[var(--color-textMuted)]">·</span>
            <span>{formatDuration(meta.duration_ms)}</span>
            <span className="text-[var(--color-textMuted)]">·</span>
            <span>{formatBytes(meta.total_bytes_transferred)}</span>
            <span className="text-[var(--color-textMuted)]">·</span>
            <span>{new Date(recording.savedAt).toLocaleString()}</span>
          </div>
        </div>
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
        <div className="px-5 pb-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
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
                  className="sor-tag"
                >
                  <Edit2 size={12} /> Rename
                </button>
                <button
                  onClick={() => onExport("har")}
                  className="sor-tag"
                >
                  <Download size={12} /> HAR
                </button>
                <button
                  onClick={() => onExport("json")}
                  className="sor-tag"
                >
                  <Download size={12} /> JSON
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
          {/* Request table */}
          <div className="max-h-60 overflow-y-auto rounded border border-[var(--color-border)]/50">
            <table className="w-full text-xs">
              <thead className="text-[var(--color-textMuted)] sticky top-0 bg-[var(--color-surface)]">
                <tr>
                  <th className="text-left py-1 px-2">Method</th>
                  <th className="text-left py-1 px-2">URL</th>
                  <th className="text-left py-1 px-2">Status</th>
                  <th className="text-left py-1 px-2">Type</th>
                  <th className="text-right py-1 px-2">Size</th>
                  <th className="text-right py-1 px-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {recording.recording.entries.map((entry, i) => (
                  <tr
                    key={i}
                    className="border-t border-[var(--color-border)]/50 hover:bg-[var(--color-surface)]/60"
                  >
                    <td className="py-1 px-2 font-mono text-blue-400">
                      {entry.method}
                    </td>
                    <td
                      className="py-1 px-2 text-[var(--color-textSecondary)] truncate max-w-[300px]"
                      title={entry.url}
                    >
                      {entry.url.replace(meta.target_url, "") || "/"}
                    </td>
                    <td
                      className={`py-1 px-2 font-mono ${entry.status >= 400 ? "text-red-400" : entry.status >= 300 ? "text-yellow-400" : "text-green-400"}`}
                    >
                      {entry.status}
                    </td>
                    <td className="py-1 px-2 text-[var(--color-textMuted)] truncate max-w-[120px]">
                      {entry.content_type?.split(";")[0] || "-"}
                    </td>
                    <td className="py-1 px-2 text-right text-[var(--color-textMuted)]">
                      {formatBytes(entry.response_body_size)}
                    </td>
                    <td className="py-1 px-2 text-right text-[var(--color-textMuted)]">
                      {entry.duration_ms}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
