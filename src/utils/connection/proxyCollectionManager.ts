import { invoke } from '@tauri-apps/api/core';
import {
  SavedProxyProfile,
  SavedProxyChain,
  ProxyCollectionData,
  defaultProxyCollectionData,
  ProxyConfig,
  SavedTunnelChain,
  SavedTunnelProfile,
} from '../../types/settings/settings';
import type { TunnelChainLayer, TunnelType } from '../../types/connection/connection';

const STORAGE_KEY = 'proxy_collection_data';

export class ProxyCollectionManager {
  private static instance: ProxyCollectionManager;
  private data: ProxyCollectionData = defaultProxyCollectionData;
  private listeners: Set<() => void> = new Set();

  static getInstance(): ProxyCollectionManager {
    if (!ProxyCollectionManager.instance) {
      ProxyCollectionManager.instance = new ProxyCollectionManager();
    }
    return ProxyCollectionManager.instance;
  }

  async initialize(): Promise<void> {
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    try {
      const stored = await invoke<string | null>('read_app_data', { key: STORAGE_KEY });
      if (stored) {
        const parsed = JSON.parse(stored) as ProxyCollectionData;
        // Ensure tunnelChains and tunnelProfiles exist for backward compatibility
        this.data = { ...parsed, tunnelChains: parsed.tunnelChains ?? [], tunnelProfiles: parsed.tunnelProfiles ?? [] };
      }
    } catch (error) {
      console.error('Failed to load proxy collection data:', error);
      this.data = defaultProxyCollectionData;
    }
  }

  private async saveData(): Promise<void> {
    try {
      await invoke('write_app_data', { 
        key: STORAGE_KEY, 
        value: JSON.stringify(this.data) 
      });
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save proxy collection data:', error);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  // ===== Profile Management =====

  getProfiles(): SavedProxyProfile[] {
    return [...this.data.profiles];
  }

  getProfile(id: string): SavedProxyProfile | undefined {
    return this.data.profiles.find(p => p.id === id);
  }

  async createProfile(
    name: string,
    config: ProxyConfig,
    options?: {
      description?: string;
      tags?: string[];
      isDefault?: boolean;
    }
  ): Promise<SavedProxyProfile> {
    const now = new Date().toISOString();
    const profile: SavedProxyProfile = {
      id: crypto.randomUUID(),
      name,
      config,
      description: options?.description,
      tags: options?.tags,
      isDefault: options?.isDefault,
      createdAt: now,
      updatedAt: now,
    };

    // If this is set as default, unset any existing default
    if (profile.isDefault) {
      this.data.profiles.forEach(p => {
        if (p.config.type === config.type) {
          p.isDefault = false;
        }
      });
    }

    this.data.profiles.push(profile);
    await this.saveData();
    return profile;
  }

  async updateProfile(
    id: string,
    updates: Partial<Omit<SavedProxyProfile, 'id' | 'createdAt'>>
  ): Promise<SavedProxyProfile | null> {
    const index = this.data.profiles.findIndex(p => p.id === id);
    if (index === -1) return null;

    // If setting as default, unset any existing default of the same type
    if (updates.isDefault && updates.config) {
      this.data.profiles.forEach(p => {
        if (p.config.type === updates.config!.type) {
          p.isDefault = false;
        }
      });
    }

    this.data.profiles[index] = {
      ...this.data.profiles[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.saveData();
    return this.data.profiles[index];
  }

  async deleteProfile(id: string): Promise<boolean> {
    const index = this.data.profiles.findIndex(p => p.id === id);
    if (index === -1) return false;

    // Check if any chains use this profile
    const usedByChains = this.data.chains.filter(chain =>
      chain.layers.some(layer => layer.proxyProfileId === id)
    );

    if (usedByChains.length > 0) {
      throw new Error(
        `Cannot delete profile: used by chains: ${usedByChains.map(c => c.name).join(', ')}`
      );
    }

    this.data.profiles.splice(index, 1);
    await this.saveData();
    return true;
  }

  getDefaultProfile(type: ProxyConfig['type']): SavedProxyProfile | undefined {
    return this.data.profiles.find(p => p.config.type === type && p.isDefault);
  }

  // ===== Chain Management =====

  getChains(): SavedProxyChain[] {
    return [...this.data.chains];
  }

  getChain(id: string): SavedProxyChain | undefined {
    return this.data.chains.find(c => c.id === id);
  }

  async createChain(
    name: string,
    layers: SavedProxyChain['layers'],
    options?: {
      description?: string;
      tags?: string[];
    }
  ): Promise<SavedProxyChain> {
    const now = new Date().toISOString();
    const chain: SavedProxyChain = {
      id: crypto.randomUUID(),
      name,
      layers,
      description: options?.description,
      tags: options?.tags,
      createdAt: now,
      updatedAt: now,
    };

    this.data.chains.push(chain);
    await this.saveData();
    return chain;
  }

  async updateChain(
    id: string,
    updates: Partial<Omit<SavedProxyChain, 'id' | 'createdAt'>>
  ): Promise<SavedProxyChain | null> {
    const index = this.data.chains.findIndex(c => c.id === id);
    if (index === -1) return null;

    this.data.chains[index] = {
      ...this.data.chains[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.saveData();
    return this.data.chains[index];
  }

  async deleteChain(id: string): Promise<boolean> {
    const index = this.data.chains.findIndex(c => c.id === id);
    if (index === -1) return false;

    this.data.chains.splice(index, 1);
    await this.saveData();
    return true;
  }

  async reorderChainLayers(chainId: string, fromIndex: number, toIndex: number): Promise<boolean> {
    const chain = this.data.chains.find(c => c.id === chainId);
    if (!chain) return false;

    const [layer] = chain.layers.splice(fromIndex, 1);
    chain.layers.splice(toIndex, 0, layer);

    // Update positions
    chain.layers.forEach((layer, index) => {
      layer.position = index;
    });

    chain.updatedAt = new Date().toISOString();
    await this.saveData();
    return true;
  }

  async addLayerToChain(
    chainId: string,
    layer: SavedProxyChain['layers'][0],
    position?: number
  ): Promise<boolean> {
    const chain = this.data.chains.find(c => c.id === chainId);
    if (!chain) return false;

    const insertPos = position ?? chain.layers.length;
    layer.position = insertPos;

    chain.layers.splice(insertPos, 0, layer);

    // Update positions for all layers after insertion
    chain.layers.forEach((l, index) => {
      l.position = index;
    });

    chain.updatedAt = new Date().toISOString();
    await this.saveData();
    return true;
  }

  async removeLayerFromChain(chainId: string, position: number): Promise<boolean> {
    const chain = this.data.chains.find(c => c.id === chainId);
    if (!chain || position < 0 || position >= chain.layers.length) return false;

    chain.layers.splice(position, 1);

    // Update positions
    chain.layers.forEach((layer, index) => {
      layer.position = index;
    });

    chain.updatedAt = new Date().toISOString();
    await this.saveData();
    return true;
  }

  // ===== Tunnel Chain Template Management =====

  getTunnelChains(): SavedTunnelChain[] {
    return [...(this.data.tunnelChains ?? [])];
  }

  getTunnelChain(id: string): SavedTunnelChain | undefined {
    return (this.data.tunnelChains ?? []).find(c => c.id === id);
  }

  async createTunnelChain(
    name: string,
    layers: TunnelChainLayer[],
    options?: {
      description?: string;
      tags?: string[];
    }
  ): Promise<SavedTunnelChain> {
    const now = new Date().toISOString();
    const chain: SavedTunnelChain = {
      id: crypto.randomUUID(),
      name,
      layers,
      description: options?.description,
      tags: options?.tags,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.data.tunnelChains) {
      this.data.tunnelChains = [];
    }
    this.data.tunnelChains.push(chain);
    await this.saveData();
    return chain;
  }

  async updateTunnelChain(
    id: string,
    updates: Partial<Omit<SavedTunnelChain, 'id' | 'createdAt'>>
  ): Promise<SavedTunnelChain | null> {
    const chains = this.data.tunnelChains ?? [];
    const index = chains.findIndex(c => c.id === id);
    if (index === -1) return null;

    chains[index] = {
      ...chains[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.data.tunnelChains = chains;
    await this.saveData();
    return chains[index];
  }

  async deleteTunnelChain(id: string): Promise<boolean> {
    const chains = this.data.tunnelChains ?? [];
    const index = chains.findIndex(c => c.id === id);
    if (index === -1) return false;

    chains.splice(index, 1);
    this.data.tunnelChains = chains;
    await this.saveData();
    return true;
  }

  async duplicateTunnelChain(id: string, newName?: string): Promise<SavedTunnelChain | null> {
    const original = this.getTunnelChain(id);
    if (!original) return null;

    return this.createTunnelChain(
      newName || `${original.name} (Copy)`,
      original.layers.map(layer => ({ ...layer })),
      {
        description: original.description,
        tags: original.tags ? [...original.tags] : undefined,
      }
    );
  }

  searchTunnelChains(query: string): SavedTunnelChain[] {
    const lowerQuery = query.toLowerCase();
    return (this.data.tunnelChains ?? []).filter(chain =>
      chain.name.toLowerCase().includes(lowerQuery) ||
      chain.description?.toLowerCase().includes(lowerQuery) ||
      chain.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  getTunnelChainsByTags(tags: string[]): SavedTunnelChain[] {
    return (this.data.tunnelChains ?? []).filter(chain =>
      tags.some(tag => chain.tags?.includes(tag))
    );
  }

  // ===== Tunnel Profile Management =====

  getTunnelProfiles(): SavedTunnelProfile[] {
    return [...(this.data.tunnelProfiles ?? [])];
  }

  getTunnelProfile(id: string): SavedTunnelProfile | undefined {
    return (this.data.tunnelProfiles ?? []).find(p => p.id === id);
  }

  async createTunnelProfile(
    name: string,
    type: TunnelType,
    config: TunnelChainLayer,
    options?: {
      description?: string;
      tags?: string[];
    }
  ): Promise<SavedTunnelProfile> {
    const now = new Date().toISOString();
    const profile: SavedTunnelProfile = {
      id: crypto.randomUUID(),
      name,
      type,
      config,
      description: options?.description,
      tags: options?.tags,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.data.tunnelProfiles) {
      this.data.tunnelProfiles = [];
    }
    this.data.tunnelProfiles.push(profile);
    await this.saveData();
    return profile;
  }

  async updateTunnelProfile(
    id: string,
    updates: Partial<Omit<SavedTunnelProfile, 'id' | 'createdAt'>>
  ): Promise<SavedTunnelProfile | null> {
    const profiles = this.data.tunnelProfiles ?? [];
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return null;

    profiles[index] = {
      ...profiles[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.data.tunnelProfiles = profiles;
    await this.saveData();
    return profiles[index];
  }

  async deleteTunnelProfile(id: string): Promise<boolean> {
    const profiles = this.data.tunnelProfiles ?? [];
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return false;

    // Check if any tunnel chains reference this profile
    const usedByChains = (this.data.tunnelChains ?? []).filter(chain =>
      chain.layers.some(layer => layer.tunnelProfileId === id)
    );
    if (usedByChains.length > 0) {
      throw new Error(
        `Cannot delete profile: used by chains: ${usedByChains.map(c => c.name).join(', ')}`
      );
    }

    profiles.splice(index, 1);
    this.data.tunnelProfiles = profiles;
    await this.saveData();
    return true;
  }

  async duplicateTunnelProfile(id: string, newName?: string): Promise<SavedTunnelProfile | null> {
    const original = this.getTunnelProfile(id);
    if (!original) return null;

    return this.createTunnelProfile(
      newName || `${original.name} (Copy)`,
      original.type,
      { ...original.config },
      {
        description: original.description,
        tags: original.tags ? [...original.tags] : undefined,
      }
    );
  }

  searchTunnelProfiles(query: string): SavedTunnelProfile[] {
    const lowerQuery = query.toLowerCase();
    return (this.data.tunnelProfiles ?? []).filter(profile =>
      profile.name.toLowerCase().includes(lowerQuery) ||
      profile.description?.toLowerCase().includes(lowerQuery) ||
      profile.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
      profile.type.toLowerCase().includes(lowerQuery)
    );
  }

  getTunnelProfilesByTags(tags: string[]): SavedTunnelProfile[] {
    return (this.data.tunnelProfiles ?? []).filter(profile =>
      tags.some(tag => profile.tags?.includes(tag))
    );
  }

  // ===== Import/Export =====

  async exportData(): Promise<string> {
    return JSON.stringify(this.data, null, 2);
  }

  async importData(jsonData: string, merge: boolean = false): Promise<void> {
    try {
      const imported = JSON.parse(jsonData) as ProxyCollectionData;

      if (merge) {
        // Merge profiles (avoid duplicates by ID)
        const existingProfileIds = new Set(this.data.profiles.map(p => p.id));
        imported.profiles.forEach(profile => {
          if (!existingProfileIds.has(profile.id)) {
            this.data.profiles.push(profile);
          }
        });

        // Merge chains (avoid duplicates by ID)
        const existingChainIds = new Set(this.data.chains.map(c => c.id));
        imported.chains.forEach(chain => {
          if (!existingChainIds.has(chain.id)) {
            this.data.chains.push(chain);
          }
        });

        // Merge tunnel chains (avoid duplicates by ID)
        const existingTunnelChainIds = new Set((this.data.tunnelChains ?? []).map(c => c.id));
        (imported.tunnelChains ?? []).forEach(tunnelChain => {
          if (!existingTunnelChainIds.has(tunnelChain.id)) {
            if (!this.data.tunnelChains) {
              this.data.tunnelChains = [];
            }
            this.data.tunnelChains.push(tunnelChain);
          }
        });

        // Merge tunnel profiles (avoid duplicates by ID)
        const existingTunnelProfileIds = new Set((this.data.tunnelProfiles ?? []).map(p => p.id));
        (imported.tunnelProfiles ?? []).forEach(tunnelProfile => {
          if (!existingTunnelProfileIds.has(tunnelProfile.id)) {
            if (!this.data.tunnelProfiles) {
              this.data.tunnelProfiles = [];
            }
            this.data.tunnelProfiles.push(tunnelProfile);
          }
        });
      } else {
        // Replace all data
        this.data = { ...imported, tunnelChains: imported.tunnelChains ?? [], tunnelProfiles: imported.tunnelProfiles ?? [] };
      }

      await this.saveData();
    } catch (error) {
      throw new Error(`Failed to import proxy collection data: ${error}`);
    }
  }

  // ===== Search & Filter =====

  searchProfiles(query: string): SavedProxyProfile[] {
    const lowerQuery = query.toLowerCase();
    return this.data.profiles.filter(profile =>
      profile.name.toLowerCase().includes(lowerQuery) ||
      profile.description?.toLowerCase().includes(lowerQuery) ||
      profile.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
      profile.config.host.toLowerCase().includes(lowerQuery)
    );
  }

  searchChains(query: string): SavedProxyChain[] {
    const lowerQuery = query.toLowerCase();
    return this.data.chains.filter(chain =>
      chain.name.toLowerCase().includes(lowerQuery) ||
      chain.description?.toLowerCase().includes(lowerQuery) ||
      chain.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  getProfilesByType(type: ProxyConfig['type']): SavedProxyProfile[] {
    return this.data.profiles.filter(p => p.config.type === type);
  }

  getProfilesByTags(tags: string[]): SavedProxyProfile[] {
    return this.data.profiles.filter(profile =>
      tags.some(tag => profile.tags?.includes(tag))
    );
  }

  getChainsByTags(tags: string[]): SavedProxyChain[] {
    return this.data.chains.filter(chain =>
      tags.some(tag => chain.tags?.includes(tag))
    );
  }

  // ===== Utility Methods =====

  async duplicateProfile(id: string, newName?: string): Promise<SavedProxyProfile | null> {
    const original = this.getProfile(id);
    if (!original) return null;

    return this.createProfile(
      newName || `${original.name} (Copy)`,
      { ...original.config },
      {
        description: original.description,
        tags: original.tags ? [...original.tags] : undefined,
        isDefault: false,
      }
    );
  }

  async duplicateChain(id: string, newName?: string): Promise<SavedProxyChain | null> {
    const original = this.getChain(id);
    if (!original) return null;

    return this.createChain(
      newName || `${original.name} (Copy)`,
      original.layers.map(layer => ({ ...layer })),
      {
        description: original.description,
        tags: original.tags ? [...original.tags] : undefined,
      }
    );
  }
}

export const proxyCollectionManager = ProxyCollectionManager.getInstance();
