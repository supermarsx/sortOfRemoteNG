import type { SectionProps } from "./types";
import React from "react";
import { Star, Trash2, FolderPlus, Code2, Play, Library } from "lucide-react";
import { MenuSurface } from "../../ui/overlays/MenuSurface";

const BarContextMenu: React.FC<SectionProps> = ({ mgr }) => {
  if (!mgr.bmBarContextMenu) return null;
  const managementReady =
    mgr.automation.libraryReady &&
    !mgr.automation.busy &&
    !mgr.automation.recording &&
    !mgr.automation.recordingPending;
  const openLibrary = (kind?: "script" | "macro") => {
    mgr.setBmBarContextMenu(null);
    mgr.automation.openLibrary(kind);
  };
  return (
    <MenuSurface
      isOpen={Boolean(mgr.bmBarContextMenu)}
      onClose={() => mgr.setBmBarContextMenu(null)}
      position={{ x: mgr.bmBarContextMenu.x, y: mgr.bmBarContextMenu.y }}
      className="min-w-[170px] rounded-lg py-1"
      dataTestId="web-browser-bookmark-bar-menu"
      ariaLabel="Bookmarks and automation actions"
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
      <div className="sor-menu-divider" />
      <button
        className="sor-menu-item text-xs py-1.5"
        disabled={!managementReady}
        data-tooltip="Choose a saved website script and add it to this connection's favorites. Does not run it."
        onClick={() => openLibrary("script")}
      >
        <Code2 size={12} /> Assign script
      </button>
      <button
        className="sor-menu-item text-xs py-1.5"
        disabled={!managementReady}
        data-tooltip="Choose a saved website macro and add it to this connection's favorites. Does not replay it."
        onClick={() => openLibrary("macro")}
      >
        <Play size={12} /> Assign macro
      </button>
      <button
        className="sor-menu-item text-xs py-1.5"
        disabled={!managementReady}
        data-tooltip={
          managementReady
            ? "Open the protected website library"
            : "Unlock and load the protected library; finish recording or the current operation first"
        }
        onClick={() => openLibrary()}
      >
        <Library size={12} /> Manage scripts &amp; macros
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
