import React from "react";
import { Star } from "lucide-react";
import { HttpBookmarkItem } from "../../../types/connection";

const BookmarkChip: React.FC<{
  mgr: WebBrowserMgr;
  bm: HttpBookmarkItem;
  idx: number;
  baseUrl: string;
}> = ({ mgr, bm, idx, baseUrl }) => {
  if (bm.isFolder) return null;
  const bookmarkUrl = baseUrl + bm.path;
  const isActive = bm.path === mgr.currentPath;

  if (mgr.editingBmIdx === idx) {
    return (
      <input
        ref={mgr.editBmRef}
        type="text"
        value={mgr.editBmName}
        onChange={(e) => mgr.setEditBmName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            mgr.handleRenameBookmark(idx, mgr.editBmName);
            mgr.setEditingBmIdx(null);
          } else if (e.key === "Escape") {
            mgr.setEditingBmIdx(null);
          }
        }}
        onBlur={() => {
          mgr.handleRenameBookmark(idx, mgr.editBmName);
          mgr.setEditingBmIdx(null);
        }}
        className="text-xs px-2 py-0.5 rounded bg-[var(--color-background)] border border-[var(--color-primary)] text-[var(--color-text)] w-28 focus:outline-none"
      />
    );
  }

  return (
    <button
      draggable
      onDragStart={mgr.handleDragStart(idx)}
      onDragOver={mgr.handleDragOver(idx)}
      onDrop={mgr.handleDrop(idx)}
      onDragEnd={mgr.handleDragEnd}
      onClick={() => {
        mgr.navigateToUrl(bookmarkUrl);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mgr.setBmBarContextMenu(null);
        mgr.setBmContextMenu({ x: e.clientX, y: e.clientY, idx });
      }}
      className={`text-xs px-2 py-0.5 rounded hover:bg-[var(--color-surfaceHover)] transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${
        mgr.dragOverIdx === idx ? "ring-1 ring-[var(--color-primary)]" : ""
      } ${
        isActive
          ? "text-yellow-400 font-semibold bg-[var(--color-surfaceHover)]"
          : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      }`}
      title={bm.path}
    >
      {isActive && <Star size={9} fill="currentColor" />}
      {bm.name}
    </button>
  );
};

export default BookmarkChip;
