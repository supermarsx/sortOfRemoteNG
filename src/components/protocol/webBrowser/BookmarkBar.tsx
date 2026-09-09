import type { SectionProps } from "./types";
import BarContextMenu from "./BarContextMenu";
import BookmarkChip from "./BookmarkChip";
import BookmarkContextMenu from "./BookmarkContextMenu";
import FolderChip from "./FolderChip";
import React from "react";
import { Star } from "lucide-react";
import {
  WebAutomationControls,
  WebAutomationFavoriteChips,
} from "./WebAutomationControls";

const BookmarkBar: React.FC<SectionProps> = ({ mgr }) => {
  const baseUrl = mgr.buildTargetUrl().replace(/\/+$/, "");
  return (
    <div
      className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-1 flex min-w-0 items-center gap-2 min-h-[28px] relative"
      data-testid="web-bookmark-bar"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          mgr.setBmContextMenu(null);
          mgr.setBmBarContextMenu({ x: e.clientX, y: e.clientY });
        }
      }}
    >
      <WebAutomationControls
        automation={mgr.automation}
        showFavorites={false}
      />
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        data-testid="web-bookmark-scroll"
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
          className={`flex-shrink-0 ${mgr.isCurrentPageBookmarked ? "text-warning" : "text-warning/60"}`}
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
          <span className="shrink-0 text-xs text-[var(--color-textMuted,var(--color-textSecondary))] italic select-none">
            Right-click bar to add folders — use ★ to save pages
          </span>
        )}
        <WebAutomationFavoriteChips automation={mgr.automation} />
      </div>
      <BookmarkContextMenu mgr={mgr} />
      <BarContextMenu mgr={mgr} />
    </div>
  );
};

export default BookmarkBar;
