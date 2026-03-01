import { Mgr } from "./types";
import React from "react";
import { ArrowDown, ArrowUp, Edit, FolderOpen, Pencil, Plus, Star, Trash2 } from "lucide-react";

const BookmarksSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="md:col-span-2">
    <div className="flex items-center justify-between mb-2">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-1.5">
        <Star size={14} className="text-yellow-400" />
        Bookmarks ({(mgr.formData.httpBookmarks || []).length})
      </label>
      <button
        type="button"
        onClick={mgr.openAddBookmark}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
      >
        <Plus size={12} /> Add bookmark
      </button>
    </div>
    {(mgr.formData.httpBookmarks || []).length === 0 ? (
      <p className="text-xs text-[var(--color-textMuted)] italic">
        No bookmarks yet. Add quick-access paths for this connection.
      </p>
    ) : (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {(mgr.formData.httpBookmarks || []).map((bm, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 bg-[var(--color-border)]/50 border border-[var(--color-border)]/50 rounded px-3 py-1.5 text-xs group"
          >
            {bm.isFolder ? (
              <FolderOpen
                size={12}
                className="text-blue-400/70 flex-shrink-0"
              />
            ) : (
              <Star
                size={12}
                className="text-yellow-400/70 flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-textSecondary)] truncate">{bm.name}</p>
              {bm.isFolder ? (
                <p className="text-[var(--color-textMuted)] font-mono truncate">
                  {bm.children.length} items
                </p>
              ) : (
                <p className="text-[var(--color-textMuted)] font-mono truncate">{bm.path}</p>
              )}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {idx > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const bookmarks = [
                      ...(mgr.formData.httpBookmarks || []),
                    ];
                    [bookmarks[idx - 1], bookmarks[idx]] = [
                      bookmarks[idx],
                      bookmarks[idx - 1],
                    ];
                    mgr.setFormData({
                      ...mgr.formData,
                      httpBookmarks: bookmarks,
                    });
                  }}
                  className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5 transition-colors"
                  title="Move up"
                >
                  <ArrowUp size={12} />
                </button>
              )}
              {idx < (mgr.formData.httpBookmarks || []).length - 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const bookmarks = [
                      ...(mgr.formData.httpBookmarks || []),
                    ];
                    [bookmarks[idx], bookmarks[idx + 1]] = [
                      bookmarks[idx + 1],
                      bookmarks[idx],
                    ];
                    mgr.setFormData({
                      ...mgr.formData,
                      httpBookmarks: bookmarks,
                    });
                  }}
                  className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5 transition-colors"
                  title="Move down"
                >
                  <ArrowDown size={12} />
                </button>
              )}
              {!bm.isFolder && (
                <button
                  type="button"
                  onClick={() => mgr.openEditBookmark(idx, bm.name, bm.path)}
                  className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5 transition-colors"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const bookmarks = (mgr.formData.httpBookmarks || []).filter(
                    (_, i) => i !== idx,
                  );
                  mgr.setFormData({
                    ...mgr.formData,
                    httpBookmarks: bookmarks,
                  });
                }}
                className="text-[var(--color-textMuted)] hover:text-red-400 p-0.5 transition-colors"
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default BookmarksSection;
