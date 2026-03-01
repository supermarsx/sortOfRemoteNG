import React from "react";
import { Star, Trash2, FolderPlus } from "lucide-react";
import { MenuSurface } from "../../ui/overlays/MenuSurface";

const BarContextMenu: React.FC<SectionProps> = ({ mgr }) => {
  if (!mgr.bmBarContextMenu) return null;
  return (
    <MenuSurface
      isOpen={Boolean(mgr.bmBarContextMenu)}
      onClose={() => mgr.setBmBarContextMenu(null)}
      position={{ x: mgr.bmBarContextMenu.x, y: mgr.bmBarContextMenu.y }}
      className="min-w-[170px] rounded-lg py-1"
      dataTestId="web-browser-bookmark-bar-menu"
    >
      <button
        className="sor-menu-item text-xs py-1.5"
        onClick={() => {
          mgr.handleAddFolder();
          mgr.setBmBarContextMenu(null);
        }}
      >
        <FolderPlus size={12} /> New folder
      </button>
      <button
        className="sor-menu-item text-xs py-1.5"
        onClick={() => {
          mgr.handleAddBookmark();
          mgr.setBmBarContextMenu(null);
        }}
      >
        <Star size={12} /> Bookmark this page
      </button>
      {(mgr.connection?.httpBookmarks || []).length > 0 && (
        <>
          <div className="sor-menu-divider" />
          <button
            className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
            onClick={() => {
              mgr.handleDeleteAllBookmarks();
              mgr.setBmBarContextMenu(null);
            }}
          >
            <Trash2 size={12} /> Delete all bookmarks
          </button>
        </>
      )}
    </MenuSurface>
  );
};

export default BarContextMenu;
