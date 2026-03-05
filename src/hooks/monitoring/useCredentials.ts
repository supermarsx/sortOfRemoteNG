import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  TrackedCredential,
  RotationPolicy,
  CredentialGroup,
  CredentialAlert,
  StrengthResult,
  ComplianceResult,
  DuplicateGroup,
  CredentialAuditEntry,
  CredentialStats,
  CredentialConfig,
} from "../../types/credentials";

export function useCredentials() {
  const [credentials, setCredentials] = useState<TrackedCredential[]>([]);
  const [policies, setPolicies] = useState<RotationPolicy[]>([]);
  const [groups, setGroups] = useState<CredentialGroup[]>([]);
  const [alerts, setAlerts] = useState<CredentialAlert[]>([]);
  const [auditLog, setAuditLog] = useState<CredentialAuditEntry[]>([]);
  const [stats, setStats] = useState<CredentialStats | null>(null);
  const [config, setConfig] = useState<CredentialConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<TrackedCredential[]>("cred_list");
      setCredentials(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
    finally { setLoading(false); }
  }, []);

  const add = useCallback(async (cred: Omit<TrackedCredential, 'id' | 'ageDays' | 'isExpired' | 'isStale'>) => {
    try {
      const id = await invoke<string>("cred_add", { credential: cred });
      await fetchAll();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchAll]);

  const remove = useCallback(async (credId: string) => {
    try {
      await invoke("cred_remove", { credentialId: credId });
      setCredentials(prev => prev.filter(c => c.id !== credId));
    } catch (e) { setError(String(e)); }
  }, []);

  const update = useCallback(async (credId: string, updates: Partial<TrackedCredential>) => {
    try {
      await invoke("cred_update", { credentialId: credId, updates });
      await fetchAll();
    } catch (e) { setError(String(e)); }
  }, [fetchAll]);

  const recordRotation = useCallback(async (credId: string) => {
    try {
      await invoke("cred_record_rotation", { credentialId: credId });
      await fetchAll();
    } catch (e) { setError(String(e)); }
  }, [fetchAll]);

  const checkExpiry = useCallback(async (credId: string) => {
    try {
      return await invoke<{ isExpired: boolean; daysUntil: number | null }>("cred_check_expiry", { credentialId: credId });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const getStale = useCallback(async (maxAgeDays?: number) => {
    try {
      return await invoke<TrackedCredential[]>("cred_get_stale", { maxAgeDays: maxAgeDays ?? 90 });
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const getExpiringSoon = useCallback(async (withinDays?: number) => {
    try {
      return await invoke<TrackedCredential[]>("cred_get_expiring_soon", { withinDays: withinDays ?? 30 });
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const getExpired = useCallback(async () => {
    try {
      return await invoke<TrackedCredential[]>("cred_get_expired");
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const checkStrength = useCallback(async (password: string) => {
    try {
      return await invoke<StrengthResult>("cred_check_strength", { password });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const detectDuplicates = useCallback(async () => {
    try {
      return await invoke<DuplicateGroup[]>("cred_detect_duplicates");
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const checkCompliance = useCallback(async (credId: string, policyId: string) => {
    try {
      return await invoke<ComplianceResult>("cred_check_compliance", { credentialId: credId, policyId });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  // Policy management
  const fetchPolicies = useCallback(async () => {
    try {
      const list = await invoke<RotationPolicy[]>("cred_list_policies");
      setPolicies(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const addPolicy = useCallback(async (policy: Omit<RotationPolicy, 'id'>) => {
    try {
      const id = await invoke<string>("cred_add_policy", { policy });
      await fetchPolicies();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchPolicies]);

  const removePolicy = useCallback(async (policyId: string) => {
    try {
      await invoke("cred_remove_policy", { policyId });
      setPolicies(prev => prev.filter(p => p.id !== policyId));
    } catch (e) { setError(String(e)); }
  }, []);

  // Group management
  const fetchGroups = useCallback(async () => {
    try {
      const list = await invoke<CredentialGroup[]>("cred_list_groups");
      setGroups(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const createGroup = useCallback(async (name: string, description: string) => {
    try {
      const id = await invoke<string>("cred_create_group", { name, description });
      await fetchGroups();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchGroups]);

  const deleteGroup = useCallback(async (groupId: string) => {
    try {
      await invoke("cred_delete_group", { groupId });
      setGroups(prev => prev.filter(g => g.id !== groupId));
    } catch (e) { setError(String(e)); }
  }, []);

  const addToGroup = useCallback(async (groupId: string, credId: string) => {
    try {
      await invoke("cred_add_to_group", { groupId, credentialId: credId });
      await fetchGroups();
    } catch (e) { setError(String(e)); }
  }, [fetchGroups]);

  const removeFromGroup = useCallback(async (groupId: string, credId: string) => {
    try {
      await invoke("cred_remove_from_group", { groupId, credentialId: credId });
      await fetchGroups();
    } catch (e) { setError(String(e)); }
  }, [fetchGroups]);

  // Alerts
  const fetchAlerts = useCallback(async () => {
    try {
      const list = await invoke<CredentialAlert[]>("cred_get_alerts");
      setAlerts(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    try {
      await invoke("cred_acknowledge_alert", { alertId });
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
    } catch (e) { setError(String(e)); }
  }, []);

  const generateAlerts = useCallback(async () => {
    try {
      await invoke("cred_generate_alerts");
      await fetchAlerts();
    } catch (e) { setError(String(e)); }
  }, [fetchAlerts]);

  // Audit
  const fetchAuditLog = useCallback(async (credId?: string) => {
    try {
      const list = await invoke<CredentialAuditEntry[]>("cred_get_audit_log", { credentialId: credId ?? null });
      setAuditLog(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  // Stats & config
  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<CredentialStats>("cred_get_stats");
      setStats(s);
      return s;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<CredentialConfig>("cred_get_config");
      setConfig(c);
    } catch (e) { setError(String(e)); }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<CredentialConfig>) => {
    try {
      const merged = { ...config, ...cfg } as CredentialConfig;
      await invoke("cred_update_config", { config: merged });
      setConfig(merged);
    } catch (e) { setError(String(e)); }
  }, [config]);

  return {
    credentials, policies, groups, alerts, auditLog, stats, config, loading, error,
    fetchAll, add, remove, update, recordRotation, checkExpiry,
    getStale, getExpiringSoon, getExpired, checkStrength, detectDuplicates, checkCompliance,
    addPolicy, removePolicy, fetchPolicies,
    createGroup, deleteGroup, fetchGroups, addToGroup, removeFromGroup,
    fetchAlerts, acknowledgeAlert, generateAlerts,
    fetchAuditLog, fetchStats, loadConfig, updateConfig,
  };
}
