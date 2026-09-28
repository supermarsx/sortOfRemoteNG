import type { SectionProps } from "./types";
import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Pencil,
  Trash2,
  Copy,
  FolderOpen,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { MenuSurface } from "../../ui/overlays/MenuSurface";

const BookmarkContextMenu: React.FC<SectionProps> = ({ mgr }) => {
  const { bmContextMenu, connection } = mgr;
  if (!bmContextMenu) return null;
  const root = connection?.httpBookmarks?.[bmContextMenu.idx];
  const childIdx = bmContextMenu.folderPath?.[0];
  const bookmark =
    childIdx === undefined
      ? root
      : root?.isFolder
        ? root.children[childIdx]
        : undefined;
  const bookmarkUrl =
    bookmark && !bookmark.isFolder ? mgr.resolveBookmarkUrl(bookmark.path) : "";

  return (
    <MenuSurface
      isOpen={Boolean(bmContextMenu)}
      onClose={() => mgr.setBmContextMenu(null)}
      position={{ x: bmContextMenu.x, y: bmContextMenu.y }}
      className="min-w-[170px] rounded-lg py-1"
      dataTestId="web-browser-bookmark-menu"
    >
      {bookmark && !bookmark.isFolder && (
        <>
          <button
            className="sor-menu-item text-xs py-1.5"
            onClick={() => {
              mgr.beginEditBookmark(bmContextMenu.idx, childIdx);
              mgr.setBmContextMenu(null);
            }}
          >
            <Pencil size={12} /> Edit bookmark
          </button>
          <button
            className="sor-menu-item text-xs py-1.5"
            disabled={!bookmarkUrl}
            onClick={() => {
              if (bookmarkUrl)
                navigator.clipboard.writeText(bookmarkUrl).catch(() => {});
              mgr.setBmContextMenu(null);
            }}
          >
            <Copy size={12} /> Copy URL
          </button>
          <button
            className="sor-menu-item text-xs py-1.5"
            disabled={!bookmarkUrl}
            onClick={() => {
              if (bookmarkUrl)
                invoke("open_url_external", { url: bookmarkUrl }).catch(() => {
                  window.open(bookmarkUrl, "_blank", "noopener,noreferrer");
                });
              mgr.setBmContextMenu(null);
            }}
          >
            <ExternalLink size={12} /> Open externally
          </button>
        </>
      )}
      {bmContextMenu.folderPath ? (
        <button
          className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
          onClick={() => {
            mgr.handleRemoveFromFolder(
              bmContextMenu.idx,
              bmContextMenu.folderPath![0],
            );
            mgr.setBmContextMenu(null);
          }}
        >
          <Trash2 size={12} /> Remove from folder
        </button>
      ) : (
        <>
          <button
            className="sor-menu-item text-xs py-1.5"
            onClick={() => {
              const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
              if (bm) {
                mgr.setEditBmName(bm.name);
                mgr.setEditingBmIdx(bmContextMenu.idx);
              }
              mgr.setBmContextMenu(null);
            }}
          >
            <Pencil size={12} /> Rename
          </button>
          <div className="sor-menu-divider" />
          {/* Move to folder */}
          {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder &&
            (connection?.httpBookmarks || []).some(
              (b, i) => b.isFolder && i !== bmContextMenu.idx,
            ) && (
              <>
                {(connection?.httpBookmarks || []).map((b, i) =>
                  b.isFolder && i !== bmContextMenu.idx ? (
                    <button
                      key={i}
                      className="sor-menu-item text-xs py-1.5"
                      onClick={() => {
                        mgr.handleMoveToFolder(bmContextMenu.idx, i);
                        mgr.setBmContextMenu(null);
                      }}
                    >
                      <FolderOpen size={12} /> Move to {b.name}
                    </button>
                  ) : null,
                )}
                <div className="sor-menu-divider" />
              </>
            )}
          {bmContextMenu.idx > 0 && (
            <button
              className="sor-menu-item text-xs py-1.5"
              onClick={() => {
                mgr.handleMoveBookmark(
                  bmContextMenu.idx,
                  bmContextMenu.idx - 1,
                );
                mgr.setBmContextMenu(null);
              }}
            >
              <ArrowLeft size={12} /> Move left
            </button>
          )}
          {bmContextMenu.idx < (connection?.httpBookmarks || []).length - 1 && (
            <button
              className="sor-menu-item text-xs py-1.5"
              onClick={() => {
                mgr.handleMoveBookmark(
                  bmContextMenu.idx,
                  bmContextMenu.idx + 1,
                );
                mgr.setBmContextMenu(null);
              }}
            >
              <ArrowRight size={12} /> Move right
            </button>
          )}
          <div className="sor-menu-divider" />
          <button
            className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
            onClick={() => {
              mgr.handleRemoveBookmark(bmContextMenu.idx);
              mgr.setBmContextMenu(null);
            }}
          >
            <Trash2 size={12} /> Remove
          </button>
        </>
      )}
    </MenuSurface>
  );
};

export default BookmarkContextMenu;
