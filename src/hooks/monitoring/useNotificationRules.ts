import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  NotificationRule,
  NotificationTemplate,
  NotificationHistoryEntry,
  NotificationStats,
  NotificationConfig,
} from "../../types/monitoring/notifications";

export function useNotificationRules() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [history, setHistory] = useState<NotificationHistoryEntry[]>([]);
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<NotificationRule[]>("notif_list_rules");
      setRules(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
    finally { setLoading(false); }
  }, []);

  const addRule = useCallback(async (rule: Omit<NotificationRule, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const id = await invoke<string>("notif_add_rule", { rule });
      await fetchRules();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchRules]);

  const removeRule = useCallback(async (ruleId: string) => {
    try {
      await invoke("notif_remove_rule", { ruleId });
      setRules(prev => prev.filter(r => r.id !== ruleId));
    } catch (e) { setError(String(e)); }
  }, []);

  const updateRule = useCallback(async (ruleId: string, updates: Partial<NotificationRule>) => {
    try {
      await invoke("notif_update_rule", { ruleId, updates });
      await fetchRules();
    } catch (e) { setError(String(e)); }
  }, [fetchRules]);

  const enableRule = useCallback(async (ruleId: string) => {
    try {
      await invoke("notif_enable_rule", { ruleId });
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: true } : r));
    } catch (e) { setError(String(e)); }
  }, []);

  const disableRule = useCallback(async (ruleId: string) => {
    try {
      await invoke("notif_disable_rule", { ruleId });
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: false } : r));
    } catch (e) { setError(String(e)); }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const list = await invoke<NotificationTemplate[]>("notif_list_templates");
      setTemplates(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const addTemplate = useCallback(async (template: Omit<NotificationTemplate, 'id'>) => {
    try {
      const id = await invoke<string>("notif_add_template", { template });
      await fetchTemplates();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchTemplates]);

  const removeTemplate = useCallback(async (templateId: string) => {
    try {
      await invoke("notif_remove_template", { templateId });
      setTemplates(prev => prev.filter(t => t.id !== templateId));
    } catch (e) { setError(String(e)); }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const list = await invoke<NotificationHistoryEntry[]>("notif_get_history");
      setHistory(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchRecentHistory = useCallback(async (limit?: number) => {
    try {
      const list = await invoke<NotificationHistoryEntry[]>("notif_get_recent_history", { limit: limit ?? 50 });
      setHistory(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const clearHistory = useCallback(async () => {
    try {
      await invoke("notif_clear_history");
      setHistory([]);
    } catch (e) { setError(String(e)); }
  }, []);

  const testChannel = useCallback(async (channelKind: string, channelConfig: Record<string, unknown>) => {
    try {
      return await invoke<boolean>("notif_test_channel", { channelKind, channelConfig });
    } catch (e) { setError(String(e)); return false; }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<NotificationStats>("notif_get_stats");
      setStats(s);
      return s;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<NotificationConfig>("notif_get_config");
      setConfig(c);
    } catch (e) { setError(String(e)); }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<NotificationConfig>) => {
    try {
      const merged = { ...config, ...cfg } as NotificationConfig;
      await invoke("notif_update_config", { config: merged });
      setConfig(merged);
    } catch (e) { setError(String(e)); }
  }, [config]);

  return {
    rules, templates, history, stats, config, loading, error,
    fetchRules, addRule, removeRule, updateRule, enableRule, disableRule,
    addTemplate, removeTemplate, fetchTemplates,
    fetchHistory, fetchRecentHistory, clearHistory, testChannel,
    fetchStats, loadConfig, updateConfig,
  };
}
