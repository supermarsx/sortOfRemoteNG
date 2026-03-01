import BarContextMenu from "./BarContextMenu";
import BookmarkChip from "./BookmarkChip";
import BookmarkContextMenu from "./BookmarkContextMenu";
import FolderChip from "./FolderChip";
import React from "react";
import { Star } from "lucide-react";

const BookmarkBar: React.FC<SectionProps> = ({ mgr }) => {
  const baseUrl = mgr.buildTargetUrl().replace(/\/+$/, "");
  return (
    <div
      className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-1 flex items-center gap-1 overflow-x-auto min-h-[28px] relative"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          mgr.setBmContextMenu(null);
          mgr.setBmBarContextMenu({ x: e.clientX, y: e.clientY });
        }
      }}
    >
      <Star
        size={11}
        className={`flex-shrink-0 ${mgr.isCurrentPageBookmarked ? "text-yellow-400" : "text-yellow-400/60"}`}
        fill={mgr.isCurrentPageBookmarked ? "currentColor" : "none"}
      />
      {(mgr.connection?.httpBookmarks || []).map((bm, idx) =>
        bm.isFolder ? (
          <FolderChip
            key={`folder-${idx}`}
            mgr={mgr}
            bm={bm}
            idx={idx}
            baseUrl={baseUrl}
          />
        ) : (
          <BookmarkChip
            key={idx}
            mgr={mgr}
            bm={bm}
            idx={idx}
            baseUrl={baseUrl}
          />
        ),
      )}
      {(mgr.connection?.httpBookmarks || []).length === 0 && (
        <span className="text-xs text-[var(--color-textMuted,var(--color-textSecondary))] italic select-none">
          Right-click bar to add folders — use ★ to save pages
        </span>
      )}
      <BookmarkContextMenu mgr={mgr} />
      <BarContextMenu mgr={mgr} />
    </div>
  );
};

export default BookmarkBar;
