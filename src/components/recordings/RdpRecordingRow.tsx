import React from "react";
import {
  Edit2,
  Trash2,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  Monitor,
  Play,
} from "lucide-react";
import type { SavedRdpRecording } from "../../types/macroTypes";
import { useInlineRename } from "../../hooks/useInlineRename";
import { formatDuration, formatBytes } from "../../utils/formatters";

interface RdpRecordingRowProps {
  recording: SavedRdpRecording;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onPlay: () => void;
}

export const RdpRecordingRow: React.FC<RdpRecordingRowProps> = ({
  recording,
  isExpanded,
  onToggle,
  onRename,
  onDelete,
  onExport,
  onPlay,
}) => {
  const rename = useInlineRename(recording.name, onRename);

  return (
    <div className={isExpanded ? "bg-[var(--color-surface)]/30" : ""}>
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[var(--color-surface)]/60"
      >
        <Monitor size={16} className="text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)] truncate">
            {recording.name}
          </div>
          <div className="text-[10px] text-[var(--color-textSecondary)] flex items-center gap-2 flex-wrap">
            {recording.host && (
              <>
                <span>{recording.host}</span>
                <span className="text-gray-600">·</span>
              </>
            )}
            {recording.connectionName && (
              <>
                <span>{recording.connectionName}</span>
                <span className="text-gray-600">·</span>
              </>
            )}
            <span>{formatDuration(recording.durationMs)}</span>
            <span className="text-gray-600">·</span>
            <span>
              {recording.width}x{recording.height}
            </span>
            <span className="text-gray-600">·</span>
            <span>{recording.format.toUpperCase()}</span>
            <span className="text-gray-600">·</span>
            <span>{formatBytes(recording.sizeBytes)}</span>
            <span className="text-gray-600">·</span>
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
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay();
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded"
              >
                <Play size={12} /> Play
              </button>
              <button
                onClick={rename.startRename}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Edit2 size={12} /> Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExport();
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded"
              >
                <Download size={12} /> Save to File
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
