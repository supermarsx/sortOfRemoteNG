// Plugin Marketplace types

export type PluginCategory = 'connection' | 'security' | 'monitoring' | 'automation' | 'theme' | 'integration' | 'tool' | 'widget' | 'import_export' | 'other';
export type PluginStatus = 'available' | 'installed' | 'update_available' | 'installing' | 'error';

export interface MarketplaceListing {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  version: string;
  author: string;
  authorUrl: string | null;
  category: PluginCategory;
  tags: string[];
  repositoryUrl: string;
  homepage: string | null;
  license: string;
  downloads: number;
  rating: number;
  reviewCount: number;
  verified: boolean;
  featured: boolean;
  iconUrl: string | null;
  screenshotUrls: string[];
  minAppVersion: string;
  publishedAt: string;
  updatedAt: string;
  fileSize: number;
  checksum: string;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  installedVersion: string;
  latestVersion: string;
  category: PluginCategory;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  repositoryUrl: string;
  hasUpdate: boolean;
  autoUpdate: boolean;
  fileSize: number;
}

export interface PluginRepository {
  id: string;
  name: string;
  url: string;
  branch: string;
  enabled: boolean;
  lastRefreshed: string | null;
  pluginCount: number;
  isDefault: boolean;
}

export interface PluginReview {
  id: string;
  pluginId: string;
  author: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
  helpful: number;
}

export interface MarketplaceStats {
  totalListings: number;
  installedCount: number;
  updatesAvailable: number;
  totalDownloads: number;
  repositoryCount: number;
  lastRefreshed: string | null;
}

export interface MarketplaceConfig {
  autoCheckUpdates: boolean;
  autoUpdateEnabled: boolean;
  checkIntervalMs: number;
  allowUnverified: boolean;
  defaultRepository: string;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  maxConcurrentInstalls: number;
}
