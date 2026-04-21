import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  FilterRule,
  SmartGroup,
  FilterPreset,
  FilterEvaluationResult,
  FilterConfig,
  FilterStats,
  FilterCondition,
  FilterLogic,
} from "../../types/connection/filters";

export function useFilters() {
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [smartGroups, setSmartGroups] = useState<SmartGroup[]>([]);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [config, setConfig] = useState<FilterConfig | null>(null);
  const [stats, setStats] = useState<FilterStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFilters = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<FilterRule[]>("filter_list");
      setFilters(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
    finally { setLoading(false); }
  }, []);

  const createFilter = useCallback(async (name: string, conditions: FilterCondition[], logic: FilterLogic) => {
    try {
      const id = await invoke<string>("filter_create", { name, conditions, logic });
      await fetchFilters();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchFilters]);

  const deleteFilter = useCallback(async (filterId: string) => {
    try {
      await invoke("filter_delete", { filterId });
      setFilters(prev => prev.filter(f => f.id !== filterId));
    } catch (e) { setError(String(e)); }
  }, []);

  const updateFilter = useCallback(async (filterId: string, updates: Partial<FilterRule>) => {
    try {
      await invoke("filter_update", { filterId, updates });
      await fetchFilters();
    } catch (e) { setError(String(e)); }
  }, [fetchFilters]);

  const evaluateFilter = useCallback(async (filterId: string, connectionIds: string[]) => {
    try {
      return await invoke<FilterEvaluationResult>("filter_evaluate", { filterId, connectionIds });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const fetchPresets = useCallback(async () => {
    try {
      const list = await invoke<FilterPreset[]>("filter_get_presets");
      setPresets(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchSmartGroups = useCallback(async () => {
    try {
      const list = await invoke<SmartGroup[]>("filter_list_smart_groups");
      setSmartGroups(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const createSmartGroup = useCallback(async (name: string, filterId: string, icon?: string, color?: string) => {
    try {
      const id = await invoke<string>("filter_create_smart_group", { name, filterId, icon: icon ?? "folder", color: color ?? "#3b82f6" });
      await fetchSmartGroups();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchSmartGroups]);

  const deleteSmartGroup = useCallback(async (groupId: string) => {
    try {
      await invoke("filter_delete_smart_group", { groupId });
      setSmartGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (e) { setError(String(e)); }
  }, []);

  const updateSmartGroup = useCallback(async (groupId: string, updates: Partial<SmartGroup>) => {
    try {
      await invoke("filter_update_smart_group", { groupId, updates });
      await fetchSmartGroups();
    } catch (e) { setError(String(e)); }
  }, [fetchSmartGroups]);

  const evaluateSmartGroup = useCallback(async (groupId: string, connectionIds: string[]) => {
    try {
      return await invoke<FilterEvaluationResult>("filter_evaluate_smart_group", { groupId, connectionIds });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const invalidateCache = useCallback(async () => {
    try {
      await invoke("filter_invalidate_cache");
    } catch (e) { setError(String(e)); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<FilterStats>("filter_get_stats");
      setStats(s);
      return s;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<FilterConfig>("filter_get_config");
      setConfig(c);
    } catch (e) { setError(String(e)); }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<FilterConfig>) => {
    try {
      const merged = { ...config, ...cfg } as FilterConfig;
      await invoke("filter_update_config", { config: merged });
      setConfig(merged);
    } catch (e) { setError(String(e)); }
  }, [config]);

  return {
    filters, smartGroups, presets, config, stats, loading, error,
    fetchFilters, createFilter, deleteFilter, updateFilter, evaluateFilter,
    fetchPresets, createSmartGroup, deleteSmartGroup, fetchSmartGroups,
    updateSmartGroup, evaluateSmartGroup, invalidateCache,
    fetchStats, loadConfig, updateConfig,
  };
}
