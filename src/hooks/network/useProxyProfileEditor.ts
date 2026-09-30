import { useState, useEffect, useCallback, useContext } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import { SavedProxyProfile, ProxyConfig } from "../../types/settings/settings";

export function useProxyProfileEditor(
  isOpen: boolean,
  editingProfile: SavedProxyProfile | null | undefined,
  onSave: (
    profile: Omit<SavedProxyProfile, "id" | "createdAt" | "updatedAt">,
  ) => void,
) {
  const context = useContext(ConnectionContext);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [config, setConfig] = useState<ProxyConfig>({
    type: "socks5",
    host: "",
    port: 1080,
    enabled: true,
  });

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setTags([]);
    setTagInput("");
    setIsDefault(false);
    setConfig({
      type: "socks5",
      host: "",
      port: 1080,
      enabled: true,
    });
  }, []);

  useEffect(() => {
    if (editingProfile) {
      setName(editingProfile.name);
      setDescription(editingProfile.description || "");
      setTags(editingProfile.tags || []);
      setIsDefault(editingProfile.isDefault || false);
      setConfig(editingProfile.config);
    } else {
      resetForm();
    }
  }, [editingProfile, isOpen, resetForm]);

  const linked = config.type === "ssh" && config.sshConnectionId !== undefined;
  const authMethod =
    config.sshAuthMethod ?? (config.sshKeyFile ? "key" : "password");
  const source = context?.state.connections.find(
    (c) =>
      c.id === config.sshConnectionId && c.protocol === "ssh" && !c.isGroup,
  );
  const canSave = Boolean(
    name.trim() &&
    (linked
      ? source &&
        context?.databaseAvailability?.status === "ready" &&
        config.sshConnectionDatabaseId ===
          context.databaseAvailability.databaseId
      : config.host.trim() &&
        Number.isInteger(config.port) &&
        config.port > 0 &&
        config.port <= 65535 &&
        (config.type !== "ssh" ||
          (config.username?.trim() &&
            (authMethod === "key"
              ? config.sshKeyFile?.trim()
              : config.password)))),
  );

  const handleSave = useCallback(() => {
    if (!canSave) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      isDefault,
      config: linked
        ? {
            ...config,
            host: "",
            port: 22,
            username: undefined,
            password: undefined,
            sshKeyFile: undefined,
            sshKeyPassphrase: undefined,
            sshAuthMethod: undefined,
          }
        : config.type === "ssh"
          ? {
              ...config,
              sshAuthMethod: authMethod,
              password: authMethod === "password" ? config.password : undefined,
              sshKeyFile: authMethod === "key" ? config.sshKeyFile : undefined,
              sshKeyPassphrase:
                authMethod === "key" ? config.sshKeyPassphrase : undefined,
            }
          : config,
    });

    resetForm();
  }, [
    name,
    description,
    tags,
    isDefault,
    config,
    onSave,
    resetForm,
    canSave,
    linked,
    authMethod,
  ]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
    },
    [tags],
  );

  const updateConfig = useCallback((updates: Partial<ProxyConfig>) => {
    setConfig((prev) => ({
      ...prev,
      ...(updates.type && updates.type !== prev.type
        ? {
            sshConnectionId: undefined,
            sshConnectionDatabaseId: undefined,
            ...(updates.type === "ssh" ? { port: 22 } : {}),
          }
        : {}),
      ...updates,
    }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && tagInput) {
        e.preventDefault();
        handleAddTag();
      }
    },
    [tagInput, handleAddTag],
  );

  return {
    name,
    setName,
    description,
    setDescription,
    tags,
    tagInput,
    setTagInput,
    isDefault,
    setIsDefault,
    config,
    handleSave,
    handleAddTag,
    handleRemoveTag,
    updateConfig,
    handleKeyDown,
    canSave,
    editingProfile,
  };
}
