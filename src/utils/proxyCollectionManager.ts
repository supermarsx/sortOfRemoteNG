import { invoke } from '@tauri-apps/api/core';
import {
  SavedProxyProfile,
  SavedProxyChain,
  ProxyCollectionData,
  defaultProxyCollectionData,
  ProxyConfig,
} from '../types/settings';

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
        this.data = JSON.parse(stored) as ProxyCollectionData;
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
      } else {
        // Replace all data
        this.data = imported;
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
