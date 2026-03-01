import React from "react";
import { Star, ChevronRight, FolderOpen } from "lucide-react";
import { HttpBookmarkItem } from "../../../types/connection";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { OptionEmptyState, OptionItemButton, OptionList } from "../../ui/display/OptionList";

const FolderChip: React.FC<{
  mgr: WebBrowserMgr;
  bm: HttpBookmarkItem;
  idx: number;
  baseUrl: string;
}> = ({ mgr, bm, idx, baseUrl }) => {
  if (!bm.isFolder) return null;
  const isOpen = mgr.openFolders.has(idx);
  return (
    <div className="relative flex-shrink-0">
      <button
        ref={(node) => {
          mgr.folderButtonRefs.current[idx] = node;
        }}
        onClick={() =>
          mgr.setOpenFolders((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
          })
        }
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          mgr.setBmBarContextMenu(null);
          mgr.setBmContextMenu({ x: e.clientX, y: e.clientY, idx });
        }}
        draggable
        onDragStart={mgr.handleDragStart(idx)}
        onDragOver={mgr.handleDragOver(idx)}
        onDrop={mgr.handleDrop(idx)}
        onDragEnd={mgr.handleDragEnd}
        className={`text-xs px-2 py-0.5 rounded hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors whitespace-nowrap flex items-center gap-1 ${
          mgr.dragOverIdx === idx ? "ring-1 ring-[var(--color-primary)]" : ""
        }`}
        title={bm.name}
      >
        <FolderOpen size={11} />
        {bm.name}
        <ChevronRight
          size={10}
          className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
      </button>
      {isOpen && (
        <PopoverSurface
          isOpen={isOpen}
          onClose={() => mgr.closeFolderDropdown(idx)}
          anchorRef={{ current: mgr.folderButtonRefs.current[idx] }}
          align="start"
          offset={2}
          className="sor-popover-panel min-w-[140px] py-0.5"
          dataTestId={`web-browser-folder-popover-${idx}`}
        >
          <OptionList>
            {bm.children.length === 0 && (
              <OptionEmptyState className="italic text-[var(--color-textMuted,var(--color-textSecondary))]">
                Empty folder
              </OptionEmptyState>
            )}
            {bm.children.map((child, cIdx) => {
              if (child.isFolder) return null;
              const childUrl = baseUrl + child.path;
              const isActive = child.path === mgr.currentPath;
              return (
                <OptionItemButton
                  key={cIdx}
                  onClick={() => mgr.navigateToUrl(childUrl)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    mgr.setBmBarContextMenu(null);
                    mgr.setBmContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      idx,
                      folderPath: [cIdx],
                    });
                  }}
                  compact
                  selected={isActive}
                  className="whitespace-nowrap text-xs"
                  title={child.path}
                >
                  <span className="flex items-center gap-1">
                    {isActive && <Star size={9} fill="currentColor" />}
                    {child.name}
                  </span>
                </OptionItemButton>
              );
            })}
          </OptionList>
        </PopoverSurface>
      )}
    </div>
  );
};

export default FolderChip;
