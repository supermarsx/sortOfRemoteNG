import { useState, useCallback } from 'react';
import type { TunnelChainLayer, TunnelType } from '../../types/connection/connection';
import { proxyCollectionManager } from '../../utils/connection/proxyCollectionManager';

/** Chain metadata managed alongside layers. */
export interface ChainMetadata {
  name: string;
  description: string;
  tags: string[];
}

/**
 * Manages the state for composing a TunnelChainLayer array.
 * Used by the Tunnel Chain Editor tab and the per-connection VPN/Chain override.
 */
export function useTunnelChainEditor(initialChain?: TunnelChainLayer[]) {
  const [layers, setLayers] = useState<TunnelChainLayer[]>(initialChain ?? []);
  const [isDirty, setIsDirty] = useState(false);
  const [metadata, setMetadata] = useState<ChainMetadata>({ name: '', description: '', tags: [] });

  const addLayer = useCallback((type: TunnelType) => {
    const newLayer: TunnelChainLayer = createDefaultLayer(type);
    setLayers(prev => [...prev, newLayer]);
    setIsDirty(true);
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers(prev => prev.filter(l => l.id !== id));
    setIsDirty(true);
  }, []);

  const updateLayer = useCallback((id: string, updates: Partial<TunnelChainLayer>) => {
    setLayers(prev =>
      prev.map(l => (l.id === id ? { ...l, ...updates } : l))
    );
    setIsDirty(true);
  }, []);

  const moveLayer = useCallback((id: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
    setIsDirty(true);
  }, []);

  const toggleLayer = useCallback((id: string) => {
    setLayers(prev =>
      prev.map(l => (l.id === id ? { ...l, enabled: !l.enabled } : l))
    );
    setIsDirty(true);
  }, []);

  const resetLayers = useCallback((newLayers: TunnelChainLayer[]) => {
    setLayers(newLayers);
    setIsDirty(false);
  }, []);

  const clearLayers = useCallback(() => {
    setLayers([]);
    setIsDirty(true);
  }, []);

  const updateMetadata = useCallback((updates: Partial<ChainMetadata>) => {
    setMetadata(prev => ({ ...prev, ...updates }));
    setIsDirty(true);
  }, []);

  const loadFromProfile = useCallback((profileId: string) => {
    const profile = proxyCollectionManager.getTunnelProfile(profileId);
    if (!profile) return;
    const newLayer: TunnelChainLayer = {
      ...createDefaultLayer(profile.type),
      ...profile.config,
      id: crypto.randomUUID(), // fresh ID
      tunnelProfileId: profileId,
      name: profile.name,
    };
    setLayers(prev => [...prev, newLayer]);
    setIsDirty(true);
  }, []);

  const loadChain = useCallback((chain: { name?: string; description?: string; tags?: string[]; layers: TunnelChainLayer[] }) => {
    setLayers(chain.layers.map(l => ({ ...l })));
    setMetadata({
      name: chain.name ?? '',
      description: chain.description ?? '',
      tags: chain.tags ?? [],
    });
    setIsDirty(false);
  }, []);

  return {
    layers,
    isDirty,
    metadata,
    addLayer,
    removeLayer,
    updateLayer,
    moveLayer,
    toggleLayer,
    resetLayers,
    clearLayers,
    updateMetadata,
    loadFromProfile,
    loadChain,
  };
}

/**
 * Create a default TunnelChainLayer for a given tunnel type.
 */
function createDefaultLayer(type: TunnelType): TunnelChainLayer {
  const id = crypto.randomUUID();

  const base: TunnelChainLayer = {
    id,
    type,
    enabled: true,
  };

  switch (type) {
    case 'proxy':
      return {
        ...base,
        name: 'Proxy',
        proxy: {
          proxyType: 'socks5',
          host: '',
          port: 1080,
        },
      };
    case 'ssh-tunnel':
      return {
        ...base,
        name: 'SSH Tunnel',
        sshTunnel: {
          forwardType: 'local',
          host: '',
          port: 22,
          username: '',
        },
      };
    case 'ssh-jump':
      return {
        ...base,
        name: 'SSH Jump Host',
        sshChainingMethod: 'proxyjump',
        sshTunnel: {
          forwardType: 'local',
          host: '',
          port: 22,
          username: '',
        },
      };
    case 'ssh-proxycmd':
      return {
        ...base,
        name: 'SSH ProxyCommand',
        sshTunnel: {
          forwardType: 'local',
          proxyCommand: { template: 'nc' },
        },
      };
    case 'ssh-stdio':
      return {
        ...base,
        name: 'SSH Stdio',
        sshTunnel: {
          forwardType: 'local',
        },
      };
    case 'openvpn':
      return {
        ...base,
        name: 'OpenVPN',
        vpn: {
          protocol: 'udp',
        },
      };
    case 'wireguard':
      return {
        ...base,
        name: 'WireGuard',
        vpn: {},
      };
    case 'tailscale':
      return {
        ...base,
        name: 'Tailscale',
        mesh: {},
      };
    case 'zerotier':
      return {
        ...base,
        name: 'ZeroTier',
        mesh: {},
      };
    case 'shadowsocks':
      return {
        ...base,
        name: 'Shadowsocks',
        proxy: {
          proxyType: 'socks5',
          host: '',
          port: 8388,
        },
      };
    case 'tor':
      return {
        ...base,
        name: 'Tor',
        proxy: {
          proxyType: 'socks5',
          host: '127.0.0.1',
          port: 9050,
        },
      };
    default:
      return {
        ...base,
        name: type,
        tunnel: {},
      };
  }
}
