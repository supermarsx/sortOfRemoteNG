import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  SavedProxyChain,
  SavedProxyProfile,
  SavedChainLayer,
} from "../types/settings";
import { proxyCollectionManager } from "../utils/proxyCollectionManager";
import { Modal, ModalHeader } from "./ui/Modal";

interface ProxyChainEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    chain: Omit<SavedProxyChain, "id" | "createdAt" | "updatedAt">,
  ) => void;
  editingChain: SavedProxyChain | null;
}

const LAYER_TYPES: Array<{
  value: SavedChainLayer["type"];
  label: string;
  description: string;
}> = [
  {
    value: "proxy",
    label: "Proxy",
    description: "HTTP, SOCKS, or other proxy",
  },
  {
    value: "ssh-tunnel",
    label: "SSH Tunnel",
    description: "SSH port forwarding",
  },
  { value: "openvpn", label: "OpenVPN", description: "OpenVPN connection" },
  { value: "wireguard", label: "WireGuard", description: "WireGuard VPN" },
];

export const ProxyChainEditor: React.FC<ProxyChainEditorProps> = ({
  isOpen,
  onClose,
  onSave,
  editingChain,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [layers, setLayers] = useState<SavedChainLayer[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<SavedProxyProfile[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSavedProfiles(proxyCollectionManager.getProfiles());
      if (editingChain) {
        setName(editingChain.name);
        setDescription(editingChain.description || "");
        setLayers([...editingChain.layers]);
        setTags(editingChain.tags || []);
      } else {
        setName("");
        setDescription("");
        setLayers([]);
        setTags([]);
      }
      setErrors({});
    }
  }, [isOpen, editingChain]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Chain name is required";
    }

    if (layers.length === 0) {
      newErrors.layers = "At least one layer is required";
    }

    // Check each layer has proper configuration
    layers.forEach((layer, index) => {
      if (
        layer.type === "proxy" &&
        !layer.proxyProfileId &&
        !layer.inlineConfig
      ) {
        newErrors[`layer-${index}`] =
          "Layer must have a profile or inline configuration";
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, layers]);

  const handleSave = () => {
    if (!validate()) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      layers: layers.map((layer, index) => ({ ...layer, position: index })),
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  const handleAddLayer = () => {
    const newLayer: SavedChainLayer = {
      position: layers.length,
      type: "proxy",
    };
    setLayers([...layers, newLayer]);
  };

  const handleRemoveLayer = (index: number) => {
    const newLayers = layers.filter((_, i) => i !== index);
    setLayers(newLayers.map((layer, i) => ({ ...layer, position: i })));
  };

  const handleMoveLayer = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= layers.length) return;

    const newLayers = [...layers];
    [newLayers[index], newLayers[newIndex]] = [
      newLayers[newIndex],
      newLayers[index],
    ];
    setLayers(newLayers.map((layer, i) => ({ ...layer, position: i })));
  };

  const handleLayerTypeChange = (
    index: number,
    type: SavedChainLayer["type"],
  ) => {
    const newLayers = [...layers];
    newLayers[index] = {
      ...newLayers[index],
      type,
      proxyProfileId: undefined,
      vpnProfileId: undefined,
      inlineConfig: undefined,
    };
    setLayers(newLayers);
  };

  const handleLayerProfileChange = (index: number, profileId: string) => {
    const newLayers = [...layers];
    newLayers[index] = {
      ...newLayers[index],
      proxyProfileId: profileId || undefined,
      inlineConfig: undefined,
    };
    setLayers(newLayers);
  };

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const getProfilesForType = (
    type: SavedChainLayer["type"],
  ): SavedProxyProfile[] => {
    if (type === "proxy") {
      return savedProfiles;
    }
    // Future: filter by VPN type for openvpn/wireguard
    return [];
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      backdropClassName="z-[60] bg-black/60 p-4"
      panelClassName="max-w-2xl mx-4 max-h-[85vh]"
      dataTestId="proxy-chain-editor-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-h-[85vh] overflow-hidden flex flex-col border border-[var(--color-border)]">
        <ModalHeader
          onClose={onClose}
          className="px-5 py-4 border-b border-[var(--color-border)]"
          title={
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {editingChain ? "Edit Proxy Chain" : "New Proxy Chain"}
            </h2>
          }
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Chain Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Chain Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Proxy Chain"
              className={`w-full px-3 py-2 bg-[var(--color-bg)] border rounded-lg text-[var(--color-text)] text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                errors.name ? "border-red-500" : "border-[var(--color-border)]"
              }`}
            />
            {errors.name && (
              <p className="text-xs text-red-400 mt-1">{errors.name}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this chain"
              rows={2}
              className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Layers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[var(--color-text)]">
                Chain Layers <span className="text-red-400">*</span>
              </label>
              <button
                onClick={handleAddLayer}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
              >
                <Plus size={12} />
                Add Layer
              </button>
            </div>

            {errors.layers && (
              <div className="flex items-center gap-2 p-2 mb-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                <AlertTriangle size={14} />
                {errors.layers}
              </div>
            )}

            <div className="text-xs text-[var(--color-textSecondary)] mb-3">
              Chain layers are executed in order. Traffic flows through each
              layer sequentially.
            </div>

            <div className="space-y-2">
              {layers.length === 0 ? (
                <div className="text-sm text-[var(--color-textSecondary)] py-6 text-center border border-dashed border-[var(--color-border)] rounded-lg">
                  No layers added. Click "Add Layer" to start building your
                  chain.
                </div>
              ) : (
                layers.map((layer, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg bg-[var(--color-bg)] ${
                      errors[`layer-${index}`]
                        ? "border-red-500"
                        : "border-[var(--color-border)]"
                    }`}
                  >
                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-3">
                        <GripVertical
                          size={14}
                          className="text-[var(--color-textSecondary)]"
                        />
                        <span className="text-xs font-mono text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">
                          Layer {index + 1}
                        </span>
                        <div className="flex-1" />
                        <button
                          onClick={() => handleMoveLayer(index, "up")}
                          disabled={index === 0}
                          className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] rounded disabled:opacity-30"
                          title="Move up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => handleMoveLayer(index, "down")}
                          disabled={index === layers.length - 1}
                          className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] rounded disabled:opacity-30"
                          title="Move down"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => handleRemoveLayer(index)}
                          className="p-1 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-red-500/10 rounded"
                          title="Remove layer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                            Layer Type
                          </label>
                          <select
                            value={layer.type}
                            onChange={(e) =>
                              handleLayerTypeChange(
                                index,
                                e.target.value as SavedChainLayer["type"],
                              )
                            }
                            className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
                          >
                            {LAYER_TYPES.map((lt) => (
                              <option key={lt.value} value={lt.value}>
                                {lt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {layer.type === "proxy" && (
                          <div>
                            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                              Proxy Profile
                            </label>
                            <select
                              value={layer.proxyProfileId || ""}
                              onChange={(e) =>
                                handleLayerProfileChange(index, e.target.value)
                              }
                              className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
                            >
                              <option value="">Select profile...</option>
                              {getProfilesForType(layer.type).map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name} ({profile.config.type})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {(layer.type === "openvpn" ||
                          layer.type === "wireguard") && (
                          <div>
                            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                              VPN Profile
                            </label>
                            <select
                              value={layer.vpnProfileId || ""}
                              onChange={(e) => {
                                const newLayers = [...layers];
                                newLayers[index] = {
                                  ...newLayers[index],
                                  vpnProfileId: e.target.value || undefined,
                                };
                                setLayers(newLayers);
                              }}
                              className="w-full px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] text-sm"
                            >
                              <option value="">Select VPN profile...</option>
                              {/* VPN profiles would be loaded here */}
                            </select>
                            <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                              VPN profiles coming soon
                            </p>
                          </div>
                        )}

                        {layer.type === "ssh-tunnel" && (
                          <div>
                            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                              SSH Tunnel
                            </label>
                            <p className="text-xs text-[var(--color-textSecondary)] px-2 py-1.5">
                              Configure SSH tunnels in the Tunnels tab
                            </p>
                          </div>
                        )}
                      </div>

                      {layer.proxyProfileId && layer.type === "proxy" && (
                        <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
                          {(() => {
                            const profile = savedProfiles.find(
                              (p) => p.id === layer.proxyProfileId,
                            );
                            if (!profile) return "Profile not found";
                            return (
                              <span className="font-mono">
                                {profile.config.host}:{profile.config.port}
                              </span>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    {errors[`layer-${index}`] && (
                      <div className="px-3 pb-2 text-xs text-red-400">
                        {errors[`layer-${index}`]}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Tags
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Add tag..."
                className="flex-1 px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm"
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
                className="px-3 py-1.5 text-xs rounded-md bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--color-border)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-[var(--color-text)]"
          >
            {editingChain ? "Update Chain" : "Create Chain"}
          </button>
        </div>
      </div>
    </Modal>
  );
};
