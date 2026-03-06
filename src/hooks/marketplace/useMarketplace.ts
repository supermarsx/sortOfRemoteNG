import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  MarketplaceListing,
  InstalledPlugin,
  PluginRepository,
  PluginReview,
  MarketplaceStats,
  MarketplaceConfig,
  PluginCategory,
} from "../../types/marketplace/marketplace";

export function useMarketplace() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [repositories, setRepositories] = useState<PluginRepository[]>([]);
  const [reviews, setReviews] = useState<PluginReview[]>([]);
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  const [config, setConfig] = useState<MarketplaceConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string, category?: PluginCategory) => {
    setLoading(true);
    setSearchQuery(query);
    if (category) setSelectedCategory(category);
    try {
      const results = await invoke<MarketplaceListing[]>("mkt_search", { query, category: category ?? null });
      setListings(results);
      return results;
    } catch (e) { setError(String(e)); return []; }
    finally { setLoading(false); }
  }, []);

  const getListing = useCallback(async (pluginId: string) => {
    try {
      return await invoke<MarketplaceListing>("mkt_get_listing", { pluginId });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const getCategories = useCallback(async () => {
    try {
      return await invoke<string[]>("mkt_get_categories");
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const getFeatured = useCallback(async () => {
    try {
      const list = await invoke<MarketplaceListing[]>("mkt_get_featured");
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const getPopular = useCallback(async () => {
    try {
      return await invoke<MarketplaceListing[]>("mkt_get_popular");
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchInstalled = useCallback(async () => {
    try {
      const list = await invoke<InstalledPlugin[]>("mkt_get_installed");
      setInstalled(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const install = useCallback(async (pluginId: string) => {
    setInstalling(pluginId);
    try {
      await invoke("mkt_install", { pluginId });
      await fetchInstalled();
    } catch (e) { setError(String(e)); }
    finally { setInstalling(null); }
  }, [fetchInstalled]);

  const uninstall = useCallback(async (pluginId: string) => {
    try {
      await invoke("mkt_uninstall", { pluginId });
      setInstalled(prev => prev.filter(p => p.id !== pluginId));
    } catch (e) { setError(String(e)); }
  }, []);

  const updatePlugin = useCallback(async (pluginId: string) => {
    setInstalling(pluginId);
    try {
      await invoke("mkt_update", { pluginId });
      await fetchInstalled();
    } catch (e) { setError(String(e)); }
    finally { setInstalling(null); }
  }, [fetchInstalled]);

  const checkUpdates = useCallback(async () => {
    try {
      return await invoke<InstalledPlugin[]>("mkt_check_updates");
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchRepositories = useCallback(async () => {
    try {
      const list = await invoke<PluginRepository[]>("mkt_list_repositories");
      setRepositories(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const refreshRepositories = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("mkt_refresh_repositories");
      await fetchRepositories();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [fetchRepositories]);

  const addRepository = useCallback(async (name: string, url: string, branch?: string) => {
    try {
      const id = await invoke<string>("mkt_add_repository", { name, url, branch: branch ?? "main" });
      await fetchRepositories();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchRepositories]);

  const removeRepository = useCallback(async (repoId: string) => {
    try {
      await invoke("mkt_remove_repository", { repoId });
      setRepositories(prev => prev.filter(r => r.id !== repoId));
    } catch (e) { setError(String(e)); }
  }, []);

  const fetchReviews = useCallback(async (pluginId: string) => {
    try {
      const list = await invoke<PluginReview[]>("mkt_get_reviews", { pluginId });
      setReviews(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const addReview = useCallback(async (pluginId: string, rating: number, title: string, body: string) => {
    try {
      const id = await invoke<string>("mkt_add_review", { pluginId, rating, title, body });
      await fetchReviews(pluginId);
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchReviews]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<MarketplaceStats>("mkt_get_stats");
      setStats(s);
      return s;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<MarketplaceConfig>("mkt_get_config");
      setConfig(c);
    } catch (e) { setError(String(e)); }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<MarketplaceConfig>) => {
    try {
      const merged = { ...config, ...cfg } as MarketplaceConfig;
      await invoke("mkt_update_config", { config: merged });
      setConfig(merged);
    } catch (e) { setError(String(e)); }
  }, [config]);

  return {
    listings, installed, repositories, reviews, stats, config,
    searchQuery, selectedCategory, loading, installing, error,
    search, getListing, getCategories, getFeatured, getPopular,
    install, uninstall, updatePlugin, fetchInstalled, checkUpdates,
    refreshRepositories, addRepository, removeRepository, fetchRepositories,
    fetchReviews, addReview, fetchStats, loadConfig, updateConfig,
    setSearchQuery, setSelectedCategory,
  };
}
