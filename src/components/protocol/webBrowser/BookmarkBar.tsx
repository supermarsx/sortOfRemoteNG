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
  const closeBookmarkMenus = () => {
    mgr.setBmContextMenu(null);
    mgr.setBmBarContextMenu(null);
    mgr.setOpenFolders(new Set());
  };
  const openBarMenu = (x: number, y: number) => {
    closeBookmarkMenus();
    mgr.setBmBarContextMenu({ x, y });
  };
  return (
    <div
      className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-1 flex min-w-0 items-center gap-2 min-h-[28px] relative"
      data-testid="web-bookmark-bar"
      role="group"
      aria-label="Bookmarks, scripts and macros"
      tabIndex={0}
      aria-haspopup="menu"
      onContextMenu={(e) => {
        const target = e.target;
        // Portaled menus still bubble through React. Only claim noninteractive
        // descendants physically inside this bar; controls keep their own menus.
        if (
          e.defaultPrevented ||
          !(target instanceof Element) ||
          !e.currentTarget.contains(target)
        )
          return;
        const control = target.closest(
          'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="menu"], [role="menuitem"], [role="dialog"], [tabindex]',
        );
        if (control && control !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        openBarMenu(e.clientX || rect.left, e.clientY || rect.bottom);
      }}
      onKeyDown={(e) => {
        if (
          e.target !== e.currentTarget ||
          !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        openBarMenu(rect.left, rect.bottom);
      }}
    >
      <WebAutomationControls
        automation={mgr.automation}
        showFavorites={false}
      />
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        data-testid="web-bookmark-scroll"
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
            Right-click here to add bookmarks, folders, scripts or macros
          </span>
        )}
        <WebAutomationFavoriteChips
          automation={mgr.automation}
          onContextMenuOpen={closeBookmarkMenus}
          otherMenuOpen={
            !!mgr.bmBarContextMenu ||
            !!mgr.bmContextMenu ||
            mgr.openFolders.size > 0
          }
        />
      </div>
      <BookmarkContextMenu mgr={mgr} />
      <BarContextMenu mgr={mgr} />
    </div>
  );
};

export default BookmarkBar;
