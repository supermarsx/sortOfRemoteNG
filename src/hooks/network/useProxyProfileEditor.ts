import { useState, useEffect, useCallback } from 'react';
import { SavedProxyProfile, ProxyConfig } from '../../types/settings';

export function useProxyProfileEditor(
  isOpen: boolean,
  editingProfile: SavedProxyProfile | null | undefined,
  onSave: (profile: Omit<SavedProxyProfile, 'id' | 'createdAt' | 'updatedAt'>) => void,
) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [config, setConfig] = useState<ProxyConfig>({
    type: 'socks5',
    host: '',
    port: 1080,
    enabled: true,
  });

  const resetForm = useCallback(() => {
    setName('');
    setDescription('');
    setTags([]);
    setTagInput('');
    setIsDefault(false);
    setConfig({
      type: 'socks5',
      host: '',
      port: 1080,
      enabled: true,
    });
  }, []);

  useEffect(() => {
    if (editingProfile) {
      setName(editingProfile.name);
      setDescription(editingProfile.description || '');
      setTags(editingProfile.tags || []);
      setIsDefault(editingProfile.isDefault || false);
      setConfig(editingProfile.config);
    } else {
      resetForm();
    }
  }, [editingProfile, isOpen, resetForm]);

  const handleSave = useCallback(() => {
    if (!name.trim() || !config.host.trim()) return;

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      isDefault,
      config,
    });

    resetForm();
  }, [name, description, tags, isDefault, config, onSave, resetForm]);

  const handleAddTag = useCallback(() => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
    },
    [tags],
  );

  const updateConfig = useCallback((updates: Partial<ProxyConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && tagInput) {
        e.preventDefault();
        handleAddTag();
      }
    },
    [tagInput, handleAddTag],
  );

  const canSave = name.trim() !== '' && config.host.trim() !== '';

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
