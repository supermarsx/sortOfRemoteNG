import { Mgr } from "./types";
import React from "react";
import { Edit, Save } from "lucide-react";
import Modal, { ModalHeader } from "../../ui/overlays/Modal";

const BookmarkModal: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.showAddBookmark) return null;
  return (
    <Modal
      isOpen={mgr.showAddBookmark}
      onClose={() => mgr.setShowAddBookmark(false)}
      panelClassName="max-w-md mx-4"
      dataTestId="http-options-bookmark-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={() => mgr.setShowAddBookmark(false)}
          className="relative h-12 border-b border-[var(--color-border)]"
          titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
          title={
            mgr.editingBookmarkIdx !== null ? "Edit Bookmark" : "Add Bookmark"
          }
        />
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Name
            </label>
            <input
              ref={mgr.bookmarkNameRef}
              type="text"
              value={mgr.bookmarkName}
              onChange={(e) => mgr.setBookmarkName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleSaveBookmark();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. Status Page"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Path
            </label>
            <input
              type="text"
              value={mgr.bookmarkPath}
              onChange={(e) => mgr.setBookmarkPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleSaveBookmark();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. /status-log.asp"
            />
            <p className="text-xs text-[var(--color-textMuted)] mt-1">
              Relative path starting with /. Will be appended to the connection
              URL.
            </p>
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => mgr.setShowAddBookmark(false)}
              className="sor-modal-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={mgr.handleSaveBookmark}
              className="sor-modal-primary"
            >
              {mgr.editingBookmarkIdx !== null ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default BookmarkModal;
