import React from "react";
import { Plus, Palette, Edit, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal, ModalHeader, ModalBody } from "../ui/overlays/Modal";
import { EmptyState } from "../ui/display";
import {
  useColorTagManager,
  PREDEFINED_COLORS,
} from "../../hooks/connection/useColorTagManager";
import { Checkbox } from "../ui/forms";

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
  const { t } = useTranslation();
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
              <Palette size={20} className="text-primary" />
              <span>{t("colorTags.title", "Color Tag Manager")}</span>
            </h2>
          }
          actions={
            <button
              onClick={() => mgr.setShowAddForm(true)}
              className="sor-btn-primary-sm"
            >
              <Plus size={14} />
              <span>{t("colorTags.addTag", "Add Tag")}</span>
            </button>
          }
        />

        <ModalBody className="p-6 max-h-[calc(90vh-200px)]">
          {/* Add Tag Form */}
          {mgr.showAddForm && (
            <div className="bg-[var(--color-border)] rounded-lg p-4 mb-6">
              <h3 className="text-[var(--color-text)] font-medium mb-4">
                {t("colorTags.addNew", "Add New Color Tag")}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="sor-form-label">
                    {t("colorTags.tagName", "Tag Name")}
                  </label>
                  <input
                    type="text"
                    value={mgr.newTag.name || ""}
                    onChange={(e) =>
                      mgr.setNewTag({ ...mgr.newTag, name: e.target.value })
                    }
                    className="sor-form-input"
                    placeholder={t("colorTags.enterTagName", "Enter tag name")}
                  />
                </div>

                <div>
                  <label className="sor-form-label">
                    {t("colorTags.color", "Color")}
                  </label>
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
                          onClick={() =>
                            mgr.setNewTag({ ...mgr.newTag, color })
                          }
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
                  <Checkbox
                    checked={mgr.newTag.global || false}
                    onChange={(v: boolean) =>
                      mgr.setNewTag({ ...mgr.newTag, global: v })
                    }
                    variant="form"
                  />
                  <span className="text-[var(--color-textSecondary)]">
                    {t(
                      "colorTags.globalTagDescription",
                      "Global tag (available for all connections)",
                    )}
                  </span>
                </label>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => mgr.setShowAddForm(false)}
                    className="sor-btn sor-btn-secondary"
                  >
                    {t("dialogs.cancel", "Cancel")}
                  </button>
                  <button
                    onClick={mgr.handleAddTag}
                    className="sor-btn sor-btn-primary"
                  >
                    {t("colorTags.addTag", "Add Tag")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Edit Tag Form */}
          {mgr.editingTag && (
            <div className="bg-[var(--color-border)] rounded-lg p-4 mb-6">
              <h3 className="text-[var(--color-text)] font-medium mb-4">
                {t("colorTags.editTitle", "Edit Color Tag")}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="sor-form-label">
                    {t("colorTags.tagName", "Tag Name")}
                  </label>
                  <input
                    type="text"
                    value={mgr.editingTag.name}
                    onChange={(e) =>
                      mgr.setEditingTag({
                        ...mgr.editingTag!,
                        name: e.target.value,
                      })
                    }
                    className="sor-form-input"
                  />
                </div>

                <div>
                  <label className="sor-form-label">
                    {t("colorTags.color", "Color")}
                  </label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={mgr.editingTag.color}
                      onChange={(e) =>
                        mgr.setEditingTag({
                          ...mgr.editingTag!,
                          color: e.target.value,
                        })
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
                  <Checkbox
                    checked={mgr.editingTag.global}
                    onChange={(v: boolean) =>
                      mgr.setEditingTag({ ...mgr.editingTag!, global: v })
                    }
                    variant="form"
                  />
                  <span className="text-[var(--color-textSecondary)]">
                    {t("colorTags.globalTag", "Global tag")}
                  </span>
                </label>

                <div className="flex justify-end space-x-3">
                  <button
                    onClick={() => mgr.setEditingTag(null)}
                    className="sor-btn sor-btn-secondary"
                  >
                    {t("dialogs.cancel", "Cancel")}
                  </button>
                  <button
                    onClick={mgr.handleUpdateTag}
                    className="sor-btn sor-btn-primary"
                  >
                    {t("common.update", "Update")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Color Tags List */}
          <div className="space-y-3">
            <h3 className="text-[var(--color-text)] font-medium">
              {t("colorTags.existing", "Existing Color Tags")}
            </h3>

            {Object.values(colorTags).length === 0 ? (
              <EmptyState
                icon={Palette}
                iconSize={48}
                message={t("colorTags.empty", "No color tags created yet")}
                hint={t(
                  "colorTags.emptyHint",
                  "Add a color tag to organize your connections",
                )}
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
                        <span className="ml-2 text-xs text-primary bg-primary/30 px-2 py-1 rounded">
                          {t("colorTags.global", "Global")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => mgr.handleEditTag(tag)}
                      className="sor-icon-btn-sm"
                      title={t("common.edit", "Edit")}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => mgr.handleDeleteTag(tag.id)}
                      className="sor-icon-btn-danger"
                      title={t("common.delete", "Delete")}
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
