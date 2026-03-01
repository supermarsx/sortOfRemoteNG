import React from "react";
import { Plus, Palette, Edit, Trash2 } from "lucide-react";
import { Modal, ModalHeader, ModalBody } from "./ui/overlays/Modal";
import { EmptyState } from './ui/display';
import { useColorTagManager, PREDEFINED_COLORS } from "../hooks/connection/useColorTagManager";
import { Checkbox } from './ui/forms';

type Mgr = ReturnType<typeof useColorTagManager>;

interface ColorTag {
  id: string;
  name: string;
  color: string;
  global: boolean;
}

interface ColorTagManagerProps {
  isOpen: boolean;
  onClose: () => void;
  colorTags: Record<string, ColorTag>;
  onUpdateColorTags: (tags: Record<string, ColorTag>) => void;
}

export const ColorTagManager: React.FC<ColorTagManagerProps> = ({
  isOpen,
  onClose,
  colorTags,
  onUpdateColorTags,
}) => {
  const mgr = useColorTagManager(colorTags, onUpdateColorTags);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      panelClassName="max-w-2xl mx-4 max-h-[90vh]"
      dataTestId="color-tag-manager-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full max-h-[90vh] overflow-hidden">
        <ModalHeader
          onClose={onClose}
          className="p-6 border-b border-[var(--color-border)]"
          title={
            <h2 className="text-xl font-semibold text-[var(--color-text)] flex items-center space-x-2">
              <Palette size={20} className="text-blue-400" />
              <span>Color Tag Manager</span>
            </h2>
          }
          actions={
            <button
              onClick={() => mgr.setShowAddForm(true)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors flex items-center space-x-2"
            >
              <Plus size={14} />
              <span>Add Tag</span>
            </button>
          }
        />

        <ModalBody className="p-6 max-h-[calc(90vh-200px)]">
          {/* Add Tag Form */}
          {mgr.showAddForm && (
            <div className="bg-[var(--color-border)] rounded-lg p-4 mb-6">
              <h3 className="text-[var(--color-text)] font-medium mb-4">
                Add New Color Tag
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="sor-form-label">Tag Name</label>
                  <input
                    type="text"
                    value={mgr.newTag.name || ""}
                    onChange={(e) =>
                      mgr.setNewTag({ ...mgr.newTag, name: e.target.value })
                    }
                    className="sor-form-input"
                    placeholder="Enter tag name"
                  />
                </div>

                <div>
                  <label className="sor-form-label">Color</label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={mgr.newTag.color || "#3b82f6"}
                      onChange={(e) =>
                        mgr.setNewTag({ ...mgr.newTag, color: e.target.value })
                      }
                      className="w-12 h-8 rounded border border-[var(--color-border)]"
                    />
                    <div className="flex flex-wrap gap-2">
                      {PREDEFINED_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => mgr.setNewTag({ ...mgr.newTag, color })}
                          className={`w-6 h-6 rounded border-2 transition-all ${
                            mgr.newTag.color === color
                              ? "border-[var(--color-border)] scale-110"
                              : "border-[var(--color-border)]"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <label className="flex items-center space-x-2">
                  <Checkbox checked={mgr.newTag.global || false} onChange={(v: boolean) => mgr.setNewTag({ ...mgr.newTag, global: v })} variant="form" />
                  <span className="text-[var(--color-textSecondary)]">
                    Global tag (available for all connections)
                  </span>
                </label>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => mgr.setShowAddForm(false)}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={mgr.handleAddTag}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
                  >
                    Add Tag
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Tag Form */}
          {mgr.editingTag && (
            <div className="bg-[var(--color-border)] rounded-lg p-4 mb-6">
              <h3 className="text-[var(--color-text)] font-medium mb-4">
                Edit Color Tag
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="sor-form-label">Tag Name</label>
                  <input
                    type="text"
                    value={mgr.editingTag.name}
                    onChange={(e) =>
                      mgr.setEditingTag({ ...mgr.editingTag!, name: e.target.value })
                    }
                    className="sor-form-input"
                  />
                </div>

                <div>
                  <label className="sor-form-label">Color</label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={mgr.editingTag.color}
                      onChange={(e) =>
                        mgr.setEditingTag({ ...mgr.editingTag!, color: e.target.value })
                      }
                      className="w-12 h-8 rounded border border-[var(--color-border)]"
                    />
                    <div className="flex flex-wrap gap-2">
                      {PREDEFINED_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() =>
                            mgr.setEditingTag({ ...mgr.editingTag!, color })
                          }
                          className={`w-6 h-6 rounded border-2 transition-all ${
                            mgr.editingTag!.color === color
                              ? "border-[var(--color-border)] scale-110"
                              : "border-[var(--color-border)]"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <label className="flex items-center space-x-2">
                  <Checkbox checked={mgr.editingTag.global} onChange={(v: boolean) => mgr.setEditingTag({ ...mgr.editingTag!, global: v })} variant="form" />
                  <span className="text-[var(--color-textSecondary)]">
                    Global tag
                  </span>
                </label>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => mgr.setEditingTag(null)}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-[var(--color-text)] rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={mgr.handleUpdateTag}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Color Tags List */}
          <div className="space-y-3">
            <h3 className="text-[var(--color-text)] font-medium">
              Existing Color Tags
            </h3>

            {Object.values(colorTags).length === 0 ? (
              <EmptyState
                icon={Palette}
                iconSize={48}
                message="No color tags created yet"
                hint="Add a color tag to organize your connections"
                className="py-8"
              />
            ) : (
              Object.values(colorTags).map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between p-3 bg-[var(--color-border)] rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-6 h-6 rounded border border-[var(--color-border)]"
                      style={{ backgroundColor: tag.color }}
                    />
                    <div>
                      <span className="text-[var(--color-text)] font-medium">
                        {tag.name}
                      </span>
                      {tag.global && (
                        <span className="ml-2 text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded">
                          Global
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => mgr.handleEditTag(tag)}
                      className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      title="Edit"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => mgr.handleDeleteTag(tag.id)}
                      className="p-2 hover:bg-[var(--color-border)] rounded transition-colors text-red-400 hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ModalBody>
      </div>
    </Modal>
  );
};
