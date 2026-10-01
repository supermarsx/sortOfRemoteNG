import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  Layers,
  X,
  UserPlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTunnelChainEditor } from "../../../hooks/network/useTunnelChainEditor";
import { useVpnManager } from "../../../hooks/network/useVpnManager";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import type {
  TunnelType,
  TunnelChainLayer,
} from "../../../types/connection/connection";
import type { SavedTunnelProfile } from "../../../types/settings/vpnSettings";
import {
  TUNNEL_TYPE_OPTIONS,
  getTypeIcon,
  getTypeLabel,
} from "./tunnelChainShared.helpers";
import { LayerConfigForm, ChainPreviewInline } from "./tunnelChainShared";

interface TunnelChainEditorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  /** If set, load this chain for editing. Otherwise, create new. */
  editingChainId?: string;
}

const TunnelChainEditorPanel: React.FC<TunnelChainEditorPanelProps> = ({
  isOpen,
  onClose,
  onSave,
  editingChainId,
}) => {
  const { t } = useTranslation();
  const editor = useTunnelChainEditor();
  const vpnManager = useVpnManager(isOpen);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [tunnelProfiles, setTunnelProfiles] = useState<SavedTunnelProfile[]>(
    [],
  );

  // Load existing chain if editing
  useEffect(() => {
    if (!isOpen) return;
    setTunnelProfiles(proxyCollectionManager.getTunnelProfiles());
    if (editingChainId) {
      const chain = proxyCollectionManager.getTunnelChain(editingChainId);
      if (chain) {
        editor.loadChain(chain);
      }
    }
  }, [isOpen, editingChainId]); // eslint-disable-line react-hooks/exhaustive-deps, react/exhaustive-deps

  const handleAddLayer = useCallback(
    (type: TunnelType) => {
      editor.addLayer(type);
      setShowAddMenu(false);
    },
    [editor],
  );

  const handleAddFromProfile = useCallback(
    (profileId: string) => {
      editor.loadFromProfile(profileId);
      setShowProfileMenu(false);
    },
    [editor],
  );

  const handleSave = useCallback(async () => {
    const { name, description, tags } = editor.metadata;
    if (!name.trim() || editor.layers.length === 0) return;

    if (editingChainId) {
      await proxyCollectionManager.updateTunnelChain(editingChainId, {
        name: name.trim(),
        description: description.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        layers: editor.layers,
      });
    } else {
      await proxyCollectionManager.createTunnelChain(
        name.trim(),
        editor.layers,
        {
          description: description.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        },
      );
    }
    onSave();
  }, [editor, editingChainId, onSave]);

  const groupedTypes = useMemo(
    () =>
      TUNNEL_TYPE_OPTIONS.reduce<Record<string, typeof TUNNEL_TYPE_OPTIONS>>(
        (acc, opt) => {
          (acc[opt.category] ??= []).push(opt);
          return acc;
        },
        {},
      ),
    [],
  );

  const [tagInput, setTagInput] = useState("");
  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !editor.metadata.tags.includes(tag)) {
      editor.updateMetadata({ tags: [...editor.metadata.tags, tag] });
    }
    setTagInput("");
  }, [tagInput, editor]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      editor.updateMetadata({
        tags: editor.metadata.tags.filter((t) => t !== tag),
      });
    },
    [editor],
  );

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          {editingChainId
            ? t(
                "proxyChainMenu.tunnelChainEditor.editTitle",
                "Edit Tunnel Chain",
              )
            : t(
                "proxyChainMenu.tunnelChainEditor.newTitle",
                "New Tunnel Chain",
              )}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={
              !editor.metadata.name.trim() || editor.layers.length === 0
            }
            className="sor-btn sor-btn-primary sor-btn-sm"
          >
            <Save size={12} />{" "}
            {editingChainId
              ? t("proxyChainMenu.tunnelChainEditor.update", "Update")
              : t("proxyChainMenu.common.save", "Save")}
          </button>
          <button
            onClick={onClose}
            aria-label={t("proxyChainMenu.common.close", "Close")}
            className="sor-icon-btn"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Metadata */}
        <div className="space-y-3">
          <div>
            <label className="sor-form-label">
              {t("proxyChainMenu.tunnelChainEditor.nameLabel", "Name *")}
            </label>
            <input
              type="text"
              value={editor.metadata.name}
              onChange={(e) => editor.updateMetadata({ name: e.target.value })}
              placeholder={t(
                "proxyChainMenu.tunnelChainEditor.namePlaceholder",
                "e.g. Office VPN + Jump Host",
              )}
              className="sor-form-input min-w-0 text-sm"
              autoFocus
            />
          </div>
          <div>
            <label className="sor-form-label">
              {t(
                "proxyChainMenu.tunnelChainEditor.descriptionLabel",
                "Description",
              )}
            </label>
            <textarea
              value={editor.metadata.description}
              onChange={(e) =>
                editor.updateMetadata({ description: e.target.value })
              }
              placeholder={t(
                "proxyChainMenu.tunnelChainEditor.descriptionPlaceholder",
                "Optional description...",
              )}
              rows={2}
              className="sor-form-textarea text-sm resize-y"
            />
          </div>
          <div>
            <label className="sor-form-label">
              {t("proxyChainMenu.tunnelChainEditor.tagsLabel", "Tags")}
            </label>
            <div className="flex items-center gap-1 flex-wrap">
              {editor.metadata.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="sor-icon-btn-danger"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder={t(
                  "proxyChainMenu.tunnelChainEditor.tagPlaceholder",
                  "Add tag...",
                )}
                className="sor-form-input-sm w-40 min-w-0"
              />
            </div>
          </div>
        </div>

        {/* Layer actions */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <h3 className="text-sm font-medium text-[var(--color-text)]">
            {t(
              "proxyChainMenu.tunnelChainEditor.layersHeading",
              "Layers ({{layerCount}})",
              {
                layerCount: editor.layers.length,
              },
            )}
          </h3>
          <div className="flex items-center gap-2">
            {editor.isDirty && (
              <button
                onClick={() => editor.clearLayers()}
                className="sor-btn sor-btn-secondary sor-btn-sm"
              >
                <RotateCcw size={12} />{" "}
                {t("proxyChainMenu.tunnelChainEditor.reset", "Reset")}
              </button>
            )}

            {/* Add from Profile */}
            {tunnelProfiles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowProfileMenu(!showProfileMenu);
                    setShowAddMenu(false);
                  }}
                  className="sor-btn sor-btn-secondary sor-btn-sm"
                >
                  <UserPlus size={12} />{" "}
                  {t(
                    "proxyChainMenu.tunnelChainEditor.fromProfile",
                    "From Profile",
                  )}
                </button>
                {showProfileMenu && (
                  <div className="absolute right-0 top-full mt-1 w-52 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md shadow-lg py-1 max-h-48 overflow-y-auto">
                    {tunnelProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        onClick={() => handleAddFromProfile(profile.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors"
                      >
                        {getTypeIcon(profile.type)}
                        <span className="truncate">{profile.name}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-textMuted)]">
                          {getTypeLabel(profile.type)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Add Layer */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowAddMenu(!showAddMenu);
                  setShowProfileMenu(false);
                }}
                className="sor-btn sor-btn-primary sor-btn-sm"
              >
                <Plus size={12} />{" "}
                {t("proxyChainMenu.tunnelChainEditor.addLayer", "Add Layer")}
              </button>
              {showAddMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md shadow-lg py-1 max-h-72 overflow-y-auto">
                  {Object.entries(groupedTypes).map(([category, types]) => (
                    <div key={category}>
                      <div className="px-3 py-1 text-[10px] font-semibold text-[var(--color-textMuted)] uppercase tracking-wider">
                        {category}
                      </div>
                      {types.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleAddLayer(opt.value)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors"
                        >
                          {opt.icon} {opt.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Layer list */}
        {editor.layers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--color-textMuted)]">
            <Layers size={32} className="mb-2 opacity-40" />
            <p className="text-sm">
              {t(
                "proxyChainMenu.tunnelChainEditor.emptyTitle",
                "No layers in chain",
              )}
            </p>
            <p className="text-xs mt-1">
              {t(
                "proxyChainMenu.tunnelChainEditor.emptyHint",
                'Click "Add Layer" to start building a tunnel chain',
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {editor.layers.map((layer, idx) => (
              <div
                key={layer.id}
                className={`rounded-md border transition-colors ${
                  layer.enabled
                    ? "border-[var(--color-border)] bg-[var(--color-surface)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] opacity-50"
                }`}
              >
                <div className="flex items-center gap-2 p-2.5">
                  <span className="text-[var(--color-textMuted)] text-xs font-mono w-5 text-center">
                    {idx + 1}
                  </span>
                  <span className="text-[var(--color-textSecondary)]">
                    {getTypeIcon(layer.type)}
                  </span>
                  <button
                    onClick={() =>
                      setExpandedLayer(
                        expandedLayer === layer.id ? null : layer.id,
                      )
                    }
                    className="flex-1 text-left text-sm text-[var(--color-text)] font-medium truncate"
                  >
                    {layer.name || getTypeLabel(layer.type)}
                  </button>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]">
                    {getTypeLabel(layer.type)}
                  </span>
                  {layer.tunnelProfileId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                      {t(
                        "proxyChainMenu.tunnelChainEditor.profileBadge",
                        "profile",
                      )}
                    </span>
                  )}
                  <button
                    onClick={() => editor.toggleLayer(layer.id)}
                    className="sor-icon-btn"
                    title={
                      layer.enabled
                        ? t(
                            "proxyChainMenu.tunnelChainEditor.disableLayer",
                            "Disable",
                          )
                        : t(
                            "proxyChainMenu.tunnelChainEditor.enableLayer",
                            "Enable",
                          )
                    }
                  >
                    {layer.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button
                    onClick={() => editor.moveLayer(layer.id, "up")}
                    aria-label="Move layer up"
                    disabled={idx === 0}
                    className="sor-icon-btn"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => editor.moveLayer(layer.id, "down")}
                    aria-label="Move layer down"
                    disabled={idx === editor.layers.length - 1}
                    className="sor-icon-btn"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    onClick={() => editor.removeLayer(layer.id)}
                    aria-label="Remove layer"
                    className="sor-icon-btn-danger"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {expandedLayer === layer.id && (
                  <div className="px-3 pb-3 border-t border-[var(--color-border)]">
                    <div className="mt-2">
                      <input
                        type="text"
                        placeholder={t(
                          "proxyChainMenu.tunnelChainEditor.layerNamePlaceholder",
                          "Layer name (optional)",
                        )}
                        value={layer.name ?? ""}
                        onChange={(e) =>
                          editor.updateLayer(layer.id, {
                            name: e.target.value || undefined,
                          })
                        }
                        className="sor-form-input min-w-0 text-sm"
                      />
                    </div>
                    <LayerConfigForm
                      layer={layer}
                      vpnProfileCatalog={vpnManager.profileCatalog}
                      onUpdate={(updates) =>
                        editor.updateLayer(layer.id, updates)
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Chain preview */}
        {editor.layers.length > 0 && (
          <div className="p-3 rounded-md bg-[var(--color-surfaceHover)] border border-[var(--color-border)]">
            <div className="text-xs text-[var(--color-textMuted)] mb-1">
              {t("proxyChainMenu.tunnelChainEditor.chainPath", "Chain Path:")}
            </div>
            <ChainPreviewInline layers={editor.layers} />
          </div>
        )}
      </div>
    </div>
  );
};

export default TunnelChainEditorPanel;
