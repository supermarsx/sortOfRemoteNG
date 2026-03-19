import React, { useState, useMemo, useCallback } from "react";
import {
  Tag,
  Plus,
  Edit,
  Trash2,
  Search,
  Palette,
  X,
  Check,
} from "lucide-react";
import { Modal, ModalHeader, ModalBody } from "../ui/overlays/Modal";
import { EmptyState } from "../ui/display";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { PREDEFINED_COLORS } from "../../hooks/connection/useColorTagManager";

interface TagManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActiveTab = "text" | "color";

export const TagManagerDialog: React.FC<TagManagerDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { state, dispatch } = useConnections();
  const { settings, updateSettings } = useSettings();

  const [activeTab, setActiveTab] = useState<ActiveTab>("text");
  const [searchFilter, setSearchFilter] = useState("");

  // ── Text Tags State ───────────────────────────────────────────
  const [newTextTag, setNewTextTag] = useState("");
  const [editingTextTag, setEditingTextTag] = useState<string | null>(null);
  const [editingTextTagValue, setEditingTextTagValue] = useState("");

  // ── Color Tags State ──────────────────────────────────────────
  const [showAddColorForm, setShowAddColorForm] = useState(false);
  const [newColorTag, setNewColorTag] = useState({ name: "", color: "#3b82f6" });
  const [editingColorTagId, setEditingColorTagId] = useState<string | null>(null);
  const [editingColorTag, setEditingColorTag] = useState({ name: "", color: "#3b82f6" });

  // ── Derived: all unique text tags across connections ──────────
  const textTagsWithCounts = useMemo(() => {
    const tagMap = new Map<string, number>();
    for (const conn of state.connections) {
      if (conn.tags) {
        for (const t of conn.tags) {
          tagMap.set(t, (tagMap.get(t) || 0) + 1);
        }
      }
    }
    return Array.from(tagMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, [state.connections]);

  const filteredTextTags = useMemo(() => {
    if (!searchFilter.trim()) return textTagsWithCounts;
    const q = searchFilter.toLowerCase();
    return textTagsWithCounts.filter((t) => t.tag.toLowerCase().includes(q));
  }, [textTagsWithCounts, searchFilter]);

  // ── Derived: color tags with usage counts ─────────────────────
  const colorTagsWithCounts = useMemo(() => {
    const colorTags = settings.colorTags || {};
    const countMap = new Map<string, number>();
    for (const conn of state.connections) {
      if (conn.colorTag) {
        countMap.set(conn.colorTag, (countMap.get(conn.colorTag) || 0) + 1);
      }
    }
    return Object.entries(colorTags).map(([id, tag]) => ({
      id,
      name: tag.name,
      color: tag.color,
      global: tag.global,
      count: countMap.get(id) || 0,
    }));
  }, [settings.colorTags, state.connections]);

  const filteredColorTags = useMemo(() => {
    if (!searchFilter.trim()) return colorTagsWithCounts;
    const q = searchFilter.toLowerCase();
    return colorTagsWithCounts.filter((t) => t.name.toLowerCase().includes(q));
  }, [colorTagsWithCounts, searchFilter]);

  // ── Text Tag Actions ──────────────────────────────────────────

  const handleCreateTextTag = useCallback(() => {
    const name = newTextTag.trim();
    if (!name) return;
    // Tag is created implicitly -- it only exists on connections.
    // We do not need to add it anywhere yet; user will assign it later.
    // But we still show it in the list for discoverability.
    // Since text tags are stored on connections, we just show a note.
    setNewTextTag("");
  }, [newTextTag]);

  const handleRenameTextTag = useCallback(
    (oldTag: string) => {
      const newName = editingTextTagValue.trim();
      if (!newName || newName === oldTag) {
        setEditingTextTag(null);
        return;
      }
      // Update all connections that have this tag
      for (const conn of state.connections) {
        if (conn.tags?.includes(oldTag)) {
          const updatedTags = conn.tags.map((t) => (t === oldTag ? newName : t));
          dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...conn, tags: updatedTags },
          });
        }
      }
      setEditingTextTag(null);
      setEditingTextTagValue("");
    },
    [editingTextTagValue, state.connections, dispatch],
  );

  const handleDeleteTextTag = useCallback(
    (tag: string) => {
      if (!confirm(`Remove tag "${tag}" from all connections?`)) return;
      for (const conn of state.connections) {
        if (conn.tags?.includes(tag)) {
          dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...conn, tags: conn.tags.filter((t) => t !== tag) },
          });
        }
      }
    },
    [state.connections, dispatch],
  );

  // ── Color Tag Actions ─────────────────────────────────────────

  const handleAddColorTag = useCallback(() => {
    const name = newColorTag.name.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    const updated = {
      ...settings.colorTags,
      [id]: { name, color: newColorTag.color, global: true },
    };
    void updateSettings({ colorTags: updated });
    setNewColorTag({ name: "", color: "#3b82f6" });
    setShowAddColorForm(false);
  }, [newColorTag, settings.colorTags, updateSettings]);

  const handleUpdateColorTag = useCallback(() => {
    if (!editingColorTagId) return;
    const name = editingColorTag.name.trim();
    if (!name) return;
    const existing = settings.colorTags[editingColorTagId];
    const updated = {
      ...settings.colorTags,
      [editingColorTagId]: {
        ...existing,
        name,
        color: editingColorTag.color,
      },
    };
    void updateSettings({ colorTags: updated });
    setEditingColorTagId(null);
  }, [editingColorTagId, editingColorTag, settings.colorTags, updateSettings]);

  const handleDeleteColorTag = useCallback(
    (tagId: string) => {
      if (!confirm("Are you sure you want to delete this color tag?")) return;
      const updated = { ...settings.colorTags };
      delete updated[tagId];
      void updateSettings({ colorTags: updated });
      // Remove from connections
      for (const conn of state.connections) {
        if (conn.colorTag === tagId) {
          dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...conn, colorTag: undefined },
          });
        }
      }
    },
    [settings.colorTags, updateSettings, state.connections, dispatch],
  );

  if (!isOpen) return null;

  const content = (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto w-full p-6 space-y-6">
          {/* Heading */}
          <div>
            <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              Tag Manager
            </h3>
            <p className="text-xs text-[var(--color-textSecondary)] mt-1">
              Manage text tags and color tags for organizing connections.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-[var(--color-border)]">
            {[
              { id: "text" as const, label: "Text Tags", icon: Tag, count: textTagsWithCounts.length },
              { id: "color" as const, label: "Color Tags", icon: Palette, count: colorTagsWithCounts.length },
            ].map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSearchFilter(""); }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative ${
                    active ? "text-[var(--color-text)]" : "text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]"
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none ${
                    active ? "bg-primary/20 text-primary" : "bg-[var(--color-border)] text-[var(--color-textMuted)]"
                  }`}>{tab.count}</span>
                  {active && <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-full" />}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="sor-form-input pl-9 text-sm w-full"
              placeholder={`Search ${activeTab === "text" ? "text" : "color"} tags...`}
            />
          </div>

          {/* Content */}
          {activeTab === "text" ? (
            <TextTagsSection
              filteredTags={filteredTextTags}
              newTextTag={newTextTag}
              setNewTextTag={setNewTextTag}
              onCreateTag={handleCreateTextTag}
              editingTag={editingTextTag}
              editingTagValue={editingTextTagValue}
              setEditingTag={setEditingTextTag}
              setEditingTagValue={setEditingTextTagValue}
              onRenameTag={handleRenameTextTag}
              onDeleteTag={handleDeleteTextTag}
            />
          ) : (
            <ColorTagsSection
              filteredTags={filteredColorTags}
              showAddForm={showAddColorForm}
              setShowAddForm={setShowAddColorForm}
              newTag={newColorTag}
              setNewTag={setNewColorTag}
              onAddTag={handleAddColorTag}
              editingTagId={editingColorTagId}
              editingTag={editingColorTag}
              setEditingTagId={setEditingColorTagId}
              setEditingTag={setEditingColorTag}
              onUpdateTag={handleUpdateColorTag}
              onDeleteTag={handleDeleteColorTag}
            />
          )}
        </div>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return content;
};

// ─── Text Tags Section ──────────────────────────────────────────

interface TextTagsSectionProps {
  filteredTags: { tag: string; count: number }[];
  newTextTag: string;
  setNewTextTag: (v: string) => void;
  onCreateTag: () => void;
  editingTag: string | null;
  editingTagValue: string;
  setEditingTag: (v: string | null) => void;
  setEditingTagValue: (v: string) => void;
  onRenameTag: (oldTag: string) => void;
  onDeleteTag: (tag: string) => void;
}

const TextTagsSection: React.FC<TextTagsSectionProps> = ({
  filteredTags,
  newTextTag,
  setNewTextTag,
  onCreateTag,
  editingTag,
  editingTagValue,
  setEditingTag,
  setEditingTagValue,
  onRenameTag,
  onDeleteTag,
}) => (
  <div className="space-y-3">
    {/* Create new tag */}
    <div className="flex items-center space-x-2">
      <input
        type="text"
        value={newTextTag}
        onChange={(e) => setNewTextTag(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onCreateTag()}
        className="sor-form-input flex-1 text-sm"
        placeholder="New tag name..."
      />
      <button
        onClick={onCreateTag}
        disabled={!newTextTag.trim()}
        className="sor-btn-primary-sm"
      >
        <Plus size={14} />
        <span>Add</span>
      </button>
    </div>

    {/* Tags list */}
    {filteredTags.length === 0 ? (
      <EmptyState
        icon={Tag}
        iconSize={40}
        message="No text tags found"
        hint="Tags are created when assigned to connections"
        className="py-8"
      />
    ) : (
      <div className="space-y-1.5">
        {filteredTags.map(({ tag, count }) => (
          <div
            key={tag}
            className="flex items-center justify-between p-2.5 bg-[var(--color-border)]/50 rounded-lg group"
          >
            {editingTag === tag ? (
              <div className="flex items-center space-x-2 flex-1 mr-2">
                <input
                  type="text"
                  value={editingTagValue}
                  onChange={(e) => setEditingTagValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameTag(tag);
                    if (e.key === "Escape") setEditingTag(null);
                  }}
                  className="sor-form-input flex-1 text-sm"
                  autoFocus
                />
                <button
                  onClick={() => onRenameTag(tag)}
                  className="sor-icon-btn-sm text-success"
                  title="Save"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setEditingTag(null)}
                  className="sor-icon-btn-sm"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-2 min-w-0">
                  <Tag size={14} className="text-primary flex-shrink-0" />
                  <span className="text-[var(--color-text)] text-sm truncate">{tag}</span>
                  <span className="text-xs text-[var(--color-textSecondary)] bg-[var(--color-border)] px-1.5 py-0.5 rounded flex-shrink-0">
                    {count} {count === 1 ? "connection" : "connections"}
                  </span>
                </div>
                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      setEditingTag(tag);
                      setEditingTagValue(tag);
                    }}
                    className="sor-icon-btn-sm"
                    title="Rename"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => onDeleteTag(tag)}
                    className="sor-icon-btn-danger"
                    title="Delete from all connections"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

// ─── Color Tags Section ──────────────────────────────────────────

interface ColorTagsSectionProps {
  filteredTags: { id: string; name: string; color: string; global: boolean; count: number }[];
  showAddForm: boolean;
  setShowAddForm: (v: boolean) => void;
  newTag: { name: string; color: string };
  setNewTag: (v: { name: string; color: string }) => void;
  onAddTag: () => void;
  editingTagId: string | null;
  editingTag: { name: string; color: string };
  setEditingTagId: (v: string | null) => void;
  setEditingTag: (v: { name: string; color: string }) => void;
  onUpdateTag: () => void;
  onDeleteTag: (id: string) => void;
}

const ColorTagsSection: React.FC<ColorTagsSectionProps> = ({
  filteredTags,
  showAddForm,
  setShowAddForm,
  newTag,
  setNewTag,
  onAddTag,
  editingTagId,
  editingTag,
  setEditingTagId,
  setEditingTag,
  onUpdateTag,
  onDeleteTag,
}) => (
  <div className="space-y-3">
    {/* Add color tag button / form */}
    {showAddForm ? (
      <div className="bg-[var(--color-border)]/50 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-medium text-[var(--color-text)]">Add New Color Tag</h4>
        <div>
          <label className="sor-form-label">Name</label>
          <input
            type="text"
            value={newTag.name}
            onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && onAddTag()}
            className="sor-form-input text-sm"
            placeholder="Tag name"
            autoFocus
          />
        </div>
        <div>
          <label className="sor-form-label">Color</label>
          <div className="flex items-center space-x-3">
            <input
              type="color"
              value={newTag.color}
              onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
              className="w-10 h-8 rounded border border-[var(--color-border)] cursor-pointer"
            />
            <div className="flex flex-wrap gap-1.5">
              {PREDEFINED_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewTag({ ...newTag, color })}
                  className={`w-5 h-5 rounded border-2 transition-all ${
                    newTag.color === color ? "border-white scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end space-x-2">
          <button onClick={() => setShowAddForm(false)} className="sor-btn-secondary">
            Cancel
          </button>
          <button onClick={onAddTag} disabled={!newTag.name.trim()} className="sor-btn-primary">
            Add Tag
          </button>
        </div>
      </div>
    ) : (
      <button onClick={() => setShowAddForm(true)} className="sor-btn-primary-sm">
        <Plus size={14} />
        <span>Add Color Tag</span>
      </button>
    )}

    {/* Color tags list */}
    {filteredTags.length === 0 ? (
      <EmptyState
        icon={Palette}
        iconSize={40}
        message="No color tags defined"
        hint="Create color tags to visually categorize connections"
        className="py-8"
      />
    ) : (
      <div className="space-y-1.5">
        {filteredTags.map((ct) => (
          <div
            key={ct.id}
            className="flex items-center justify-between p-2.5 bg-[var(--color-border)]/50 rounded-lg group"
          >
            {editingTagId === ct.id ? (
              <div className="flex items-center space-x-2 flex-1 mr-2">
                <input
                  type="color"
                  value={editingTag.color}
                  onChange={(e) => setEditingTag({ ...editingTag, color: e.target.value })}
                  className="w-8 h-7 rounded border border-[var(--color-border)] cursor-pointer flex-shrink-0"
                />
                <input
                  type="text"
                  value={editingTag.name}
                  onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onUpdateTag();
                    if (e.key === "Escape") setEditingTagId(null);
                  }}
                  className="sor-form-input flex-1 text-sm"
                  autoFocus
                />
                <div className="flex flex-wrap gap-1 max-w-[160px]">
                  {PREDEFINED_COLORS.slice(0, 10).map((color) => (
                    <button
                      key={color}
                      onClick={() => setEditingTag({ ...editingTag, color })}
                      className={`w-4 h-4 rounded border transition-all ${
                        editingTag.color === color ? "border-white scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <button onClick={onUpdateTag} className="sor-icon-btn-sm text-success" title="Save">
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingTagId(null)} className="sor-icon-btn-sm" title="Cancel">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div
                    className="w-5 h-5 rounded border border-[var(--color-border)] flex-shrink-0"
                    style={{ backgroundColor: ct.color }}
                  />
                  <span className="text-[var(--color-text)] text-sm truncate">{ct.name}</span>
                  {ct.global && (
                    <span className="text-[10px] text-primary bg-primary/20 px-1.5 py-0.5 rounded flex-shrink-0">
                      Global
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-textSecondary)] bg-[var(--color-border)] px-1.5 py-0.5 rounded flex-shrink-0">
                    {ct.count} {ct.count === 1 ? "connection" : "connections"}
                  </span>
                </div>
                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      setEditingTagId(ct.id);
                      setEditingTag({ name: ct.name, color: ct.color });
                    }}
                    className="sor-icon-btn-sm"
                    title="Edit"
                  >
                    <Edit size={14} />
                  </button>
                  <button
                    onClick={() => onDeleteTag(ct.id)}
                    className="sor-icon-btn-danger"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

export default TagManagerDialog;
