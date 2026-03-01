import { useState, useEffect, useCallback } from 'react';
import {
  SavedProxyChain,
  SavedProxyProfile,
  SavedChainLayer,
} from '../types/settings';
import { proxyCollectionManager } from '../utils/proxyCollectionManager';

interface UseProxyChainEditorParams {
  isOpen: boolean;
  editingChain: SavedProxyChain | null;
}

export function useProxyChainEditor({
  isOpen,
  editingChain,
}: UseProxyChainEditorParams) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [layers, setLayers] = useState<SavedChainLayer[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedProfiles, setSavedProfiles] = useState<SavedProxyProfile[]>([]);

  useEffect(() => {
    if (isOpen) {
      setSavedProfiles(proxyCollectionManager.getProfiles());
      if (editingChain) {
        setName(editingChain.name);
        setDescription(editingChain.description || '');
        setLayers([...editingChain.layers]);
        setTags(editingChain.tags || []);
      } else {
        setName('');
        setDescription('');
        setLayers([]);
        setTags([]);
      }
      setErrors({});
    }
  }, [isOpen, editingChain]);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Chain name is required';
    if (layers.length === 0) newErrors.layers = 'At least one layer is required';
    layers.forEach((layer, index) => {
      if (layer.type === 'proxy' && !layer.proxyProfileId && !layer.inlineConfig) {
        newErrors[`layer-${index}`] =
          'Layer must have a profile or inline configuration';
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, layers]);

  const buildChainData = useCallback(
    (): Omit<SavedProxyChain, 'id' | 'createdAt' | 'updatedAt'> => ({
      name: name.trim(),
      description: description.trim() || undefined,
      layers: layers.map((layer, index) => ({ ...layer, position: index })),
      tags: tags.length > 0 ? tags : undefined,
    }),
    [name, description, layers, tags],
  );

  const handleAddLayer = useCallback(() => {
    const newLayer: SavedChainLayer = { position: layers.length, type: 'proxy' };
    setLayers([...layers, newLayer]);
  }, [layers]);

  const handleRemoveLayer = useCallback(
    (index: number) => {
      const newLayers = layers.filter((_, i) => i !== index);
      setLayers(newLayers.map((layer, i) => ({ ...layer, position: i })));
    },
    [layers],
  );

  const handleMoveLayer = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= layers.length) return;
      const newLayers = [...layers];
      [newLayers[index], newLayers[newIndex]] = [
        newLayers[newIndex],
        newLayers[index],
      ];
      setLayers(newLayers.map((layer, i) => ({ ...layer, position: i })));
    },
    [layers],
  );

  const handleLayerTypeChange = useCallback(
    (index: number, type: SavedChainLayer['type']) => {
      const newLayers = [...layers];
      newLayers[index] = {
        ...newLayers[index],
        type,
        proxyProfileId: undefined,
        vpnProfileId: undefined,
        inlineConfig: undefined,
      };
      setLayers(newLayers);
    },
    [layers],
  );

  const handleLayerProfileChange = useCallback(
    (index: number, profileId: string) => {
      const newLayers = [...layers];
      newLayers[index] = {
        ...newLayers[index],
        proxyProfileId: profileId || undefined,
        inlineConfig: undefined,
      };
      setLayers(newLayers);
    },
    [layers],
  );

  const handleVpnProfileChange = useCallback(
    (index: number, vpnProfileId: string) => {
      const newLayers = [...layers];
      newLayers[index] = {
        ...newLayers[index],
        vpnProfileId: vpnProfileId || undefined,
      };
      setLayers(newLayers);
    },
    [layers],
  );

  const handleAddTag = useCallback(() => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
    },
    [tags],
  );

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  const getProfilesForType = useCallback(
    (type: SavedChainLayer['type']): SavedProxyProfile[] => {
      if (type === 'proxy') return savedProfiles;
      return [];
    },
    [savedProfiles],
  );

  return {
    name,
    setName,
    description,
    setDescription,
    layers,
    tags,
    tagInput,
    setTagInput,
    errors,
    savedProfiles,
    validate,
    buildChainData,
    handleAddLayer,
    handleRemoveLayer,
    handleMoveLayer,
    handleLayerTypeChange,
    handleLayerProfileChange,
    handleVpnProfileChange,
    handleAddTag,
    handleRemoveTag,
    handleTagKeyDown,
    getProfilesForType,
  };
}

export const LAYER_TYPES: Array<{
  value: SavedChainLayer['type'];
  label: string;
  description: string;
}> = [
  { value: 'proxy', label: 'Proxy', description: 'HTTP, SOCKS, or other proxy' },
  { value: 'ssh-tunnel', label: 'SSH Tunnel', description: 'SSH port forwarding' },
  { value: 'openvpn', label: 'OpenVPN', description: 'OpenVPN connection' },
  { value: 'wireguard', label: 'WireGuard', description: 'WireGuard VPN' },
];
