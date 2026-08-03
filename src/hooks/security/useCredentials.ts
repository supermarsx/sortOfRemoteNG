import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ComplianceResult,
  CredentialAlert,
  CredentialAuditEntry,
  CredentialConfig,
  CredentialGroup,
  CredentialKind,
  CredentialStats,
  CredentialStrength,
  DuplicateGroup,
  RotationPolicy,
  StrengthResult,
  TrackedCredential,
} from "../../types/connection/credentials";

type NativeCredentialType =
  | "password"
  | "ssh_key"
  | "ssh_certificate"
  | "tls_certificate"
  | "api_key"
  | "token"
  | "passphrase"
  | "saml_assertion"
  | "kerberos_ticket"
  | "otp_secret";

interface NativeCredentialRecord {
  id: string;
  connection_id: string;
  credential_type: NativeCredentialType;
  label: string;
  username: string | null;
  fingerprint: string;
  created_at: string;
  last_rotated_at: string | null;
  expires_at: string | null;
  rotation_policy_id: string | null;
  group_id: string | null;
  strength: CredentialStrength | null;
  notes: string;
  metadata: Record<string, string>;
}

interface NativeRotationPolicy {
  id: string;
  name: string;
  max_age_days: number;
  warn_before_days: number;
  require_different: boolean;
  min_strength: CredentialStrength | null;
  applies_to: NativeCredentialType[];
  auto_notify: boolean;
  enforce: boolean;
}

interface NativeCredentialGroup {
  id: string;
  name: string;
  description: string;
  credential_ids: string[];
  shared_policy_id: string | null;
  auto_rotate_together: boolean;
}

interface NativeCredentialAlert {
  id: string;
  credential_id: string;
  connection_id: string;
  alert_type: string;
  message: string;
  severity: "info" | "warning" | "critical";
  created_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

interface NativeCredentialStats {
  total_credentials: number;
  by_type: Record<string, number>;
  expired_count: number;
  expiring_soon_count: number;
  stale_count: number;
  weak_count: number;
  duplicate_count: number;
  avg_age_days: number;
  oldest_credential_days: number;
}

interface NativeCredentialConfig {
  check_interval_seconds: number;
  default_max_age_days: number;
  default_warn_before_days: number;
  duplicate_detection: boolean;
  strength_checking: boolean;
  auto_alerts: boolean;
}

type NativeExpiryStatus =
  | { status: "valid" | "never_expires" | "unknown" }
  | { status: "expiring_soon"; days_remaining: number }
  | { status: "expired"; days_overdue: number };

const DAY_MS = 86_400_000;

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `credential-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function toNativeKind(kind: CredentialKind): NativeCredentialType {
  if (kind === "certificate") return "tls_certificate";
  if (kind === "totp_secret") return "otp_secret";
  return kind;
}

function fromNativeKind(kind: NativeCredentialType): CredentialKind {
  if (kind === "tls_certificate" || kind === "ssh_certificate")
    return "certificate";
  if (kind === "otp_secret") return "totp_secret";
  if (kind === "passphrase") return "password";
  if (kind === "saml_assertion" || kind === "kerberos_ticket") return "token";
  return kind;
}

function stringifyMetadata(
  metadata: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );
}

function metadataNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toTrackedCredential(
  record: NativeCredentialRecord,
): TrackedCredential {
  const createdAtMs = Date.parse(record.created_at);
  const expiresAtMs = record.expires_at
    ? Date.parse(record.expires_at)
    : Number.NaN;
  const ageDays = Number.isFinite(createdAtMs)
    ? Math.max(0, Math.floor((Date.now() - createdAtMs) / DAY_MS))
    : 0;
  const metadata: Record<string, unknown> = {
    ...record.metadata,
    username: record.username,
    fingerprint: record.fingerprint,
    rotationPolicyId: record.rotation_policy_id,
    groupId: record.group_id,
    notes: record.notes,
  };

  return {
    id: record.id,
    connectionId: record.connection_id,
    connectionName:
      record.metadata.connectionName ??
      record.metadata.connection_name ??
      record.connection_id,
    kind: fromNativeKind(record.credential_type),
    label: record.label,
    createdAt: record.created_at,
    lastRotated: record.last_rotated_at,
    expiresAt: record.expires_at,
    rotationCount: metadataNumber(record.metadata.rotationCount, 0),
    strength: record.strength ?? "fair",
    ageDays,
    isExpired: Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now(),
    isStale: ageDays > metadataNumber(record.metadata.maxAgeDays, 90),
    metadata,
  };
}

function toNativeCredential(
  credential: TrackedCredential,
  previous?: NativeCredentialRecord,
): NativeCredentialRecord {
  const metadata = stringifyMetadata(credential.metadata);
  metadata.connectionName = credential.connectionName;
  metadata.rotationCount = String(credential.rotationCount);

  return {
    id: credential.id,
    connection_id: credential.connectionId,
    credential_type: toNativeKind(credential.kind),
    label: credential.label,
    username:
      typeof credential.metadata.username === "string"
        ? credential.metadata.username
        : (previous?.username ?? null),
    fingerprint:
      typeof credential.metadata.fingerprint === "string"
        ? credential.metadata.fingerprint
        : (previous?.fingerprint ?? credential.id),
    created_at:
      credential.createdAt || previous?.created_at || new Date().toISOString(),
    last_rotated_at: credential.lastRotated,
    expires_at: credential.expiresAt,
    rotation_policy_id:
      typeof credential.metadata.rotationPolicyId === "string"
        ? credential.metadata.rotationPolicyId
        : (previous?.rotation_policy_id ?? null),
    group_id:
      typeof credential.metadata.groupId === "string"
        ? credential.metadata.groupId
        : (previous?.group_id ?? null),
    strength: credential.strength,
    notes:
      typeof credential.metadata.notes === "string"
        ? credential.metadata.notes
        : (previous?.notes ?? ""),
    metadata,
  };
}

function toRotationPolicy(policy: NativeRotationPolicy): RotationPolicy {
  return {
    id: policy.id,
    name: policy.name,
    kind: fromNativeKind(policy.applies_to[0] ?? "password"),
    maxAgeDays: policy.max_age_days,
    warningDays: policy.warn_before_days,
    requireMinStrength: policy.min_strength ?? "fair",
    minLength: 0,
    requireUppercase: false,
    requireLowercase: false,
    requireDigits: false,
    requireSpecial: false,
    forbidReuse: policy.require_different ? 1 : 0,
    enabled: policy.auto_notify || policy.enforce,
  };
}

function toCredentialGroup(group: NativeCredentialGroup): CredentialGroup {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    credentialIds: group.credential_ids,
    policyId: group.shared_policy_id,
  };
}

function mapAlertType(alertType: string): CredentialAlert["alertType"] {
  const map: Record<string, CredentialAlert["alertType"]> = {
    expiring_certificate: "expiring_soon",
    expired_certificate: "expired",
    stale_password: "stale",
    weak_password: "weak",
    duplicate_password: "duplicate",
    expiring_key: "expiring_soon",
    rotation_overdue: "stale",
    policy_violation: "non_compliant",
  };
  return map[alertType] ?? "non_compliant";
}

function toCredentialAlert(alert: NativeCredentialAlert): CredentialAlert {
  return {
    id: alert.id,
    credentialId: alert.credential_id,
    alertType: mapAlertType(alert.alert_type),
    severity: alert.severity,
    message: alert.message,
    timestamp: alert.created_at,
    acknowledged: alert.acknowledged,
  };
}

function strengthResult(strength: CredentialStrength): StrengthResult {
  const score = {
    very_weak: 0,
    weak: 1,
    fair: 2,
    strong: 3,
    very_strong: 4,
  }[strength];
  return {
    strength,
    score,
    suggestions: [],
    entropyBits: score * 20,
  };
}

function toCredentialStats(stats: NativeCredentialStats): CredentialStats {
  const byKind = {
    password: stats.by_type.Password ?? 0,
    ssh_key: stats.by_type["SSH Key"] ?? 0,
    certificate:
      (stats.by_type["SSH Certificate"] ?? 0) +
      (stats.by_type["TLS Certificate"] ?? 0),
    api_key: stats.by_type["API Key"] ?? 0,
    token:
      (stats.by_type.Token ?? 0) +
      (stats.by_type["SAML Assertion"] ?? 0) +
      (stats.by_type["Kerberos Ticket"] ?? 0),
    totp_secret: stats.by_type["OTP Secret"] ?? 0,
  };
  return {
    total: stats.total_credentials,
    byKind,
    expired: stats.expired_count,
    expiringSoon: stats.expiring_soon_count,
    stale: stats.stale_count,
    weak: stats.weak_count,
    duplicateGroups: stats.duplicate_count,
    averageAgeDays: stats.avg_age_days,
    complianceRate:
      stats.total_credentials === 0
        ? 1
        : Math.max(0, 1 - stats.stale_count / stats.total_credentials),
  };
}

function toCredentialConfig(config: NativeCredentialConfig): CredentialConfig {
  return {
    enabled: true,
    autoScanEnabled: config.auto_alerts,
    scanIntervalMs: config.check_interval_seconds * 1000,
    defaultWarningDays: config.default_warn_before_days,
    defaultMaxAgeDays: config.default_max_age_days,
    trackPasswordStrength: config.strength_checking,
    detectDuplicates: config.duplicate_detection,
  };
}

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
  const nativeRecords = useRef(new Map<string, NativeCredentialRecord>());

  const fail = useCallback(<T>(reason: unknown, fallback: T): T => {
    setError(String(reason));
    return fallback;
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await invoke<NativeCredentialRecord[]>("cred_list");
      nativeRecords.current = new Map(
        records.map((record) => [record.id, record]),
      );
      const list = records.map(toTrackedCredential);
      setCredentials(list);
      return list;
    } catch (reason) {
      return fail(reason, [] as TrackedCredential[]);
    } finally {
      setLoading(false);
    }
  }, [fail]);

  const add = useCallback(
    async (
      credential: Omit<
        TrackedCredential,
        "id" | "ageDays" | "isExpired" | "isStale"
      >,
    ) => {
      const id = createId();
      const tracked: TrackedCredential = {
        ...credential,
        id,
        ageDays: 0,
        isExpired: false,
        isStale: false,
      };
      try {
        await invoke("cred_add", { record: toNativeCredential(tracked) });
        await fetchAll();
        return id;
      } catch (reason) {
        return fail(reason, null);
      }
    },
    [fail, fetchAll],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await invoke("cred_remove", { id });
        nativeRecords.current.delete(id);
        setCredentials((previous) =>
          previous.filter((credential) => credential.id !== id),
        );
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail],
  );

  const update = useCallback(
    async (id: string, updates: Partial<TrackedCredential>) => {
      const previous = nativeRecords.current.get(id);
      if (!previous) {
        fail(`Credential ${id} is not loaded`, undefined);
        return;
      }
      const current = toTrackedCredential(previous);
      const merged: TrackedCredential = {
        ...current,
        ...updates,
        metadata: { ...current.metadata, ...updates.metadata },
      };
      try {
        await invoke("cred_update", {
          record: toNativeCredential(merged, previous),
        });
        await fetchAll();
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail, fetchAll],
  );

  const recordRotation = useCallback(
    async (id: string) => {
      try {
        await invoke("cred_record_rotation", { id });
        await fetchAll();
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail, fetchAll],
  );

  const checkExpiry = useCallback(
    async (id: string) => {
      try {
        const status = await invoke<NativeExpiryStatus>("cred_check_expiry", {
          id,
        });
        if (status.status === "expired") {
          return { isExpired: true, daysUntil: -status.days_overdue };
        }
        if (status.status === "expiring_soon") {
          return { isExpired: false, daysUntil: status.days_remaining };
        }
        return { isExpired: false, daysUntil: null };
      } catch (reason) {
        return fail(reason, null);
      }
    },
    [fail],
  );

  const getStale = useCallback(
    async (maxAgeDays = 90) => {
      try {
        const records = await invoke<NativeCredentialRecord[]>(
          "cred_get_stale",
          {
            policyAgeDays: maxAgeDays,
          },
        );
        return records.map(toTrackedCredential);
      } catch (reason) {
        return fail(reason, [] as TrackedCredential[]);
      }
    },
    [fail],
  );

  const getExpiringSoon = useCallback(
    async (withinDays = 30) => {
      try {
        const records = await invoke<NativeCredentialRecord[]>(
          "cred_get_expiring_soon",
          {
            days: withinDays,
          },
        );
        return records.map(toTrackedCredential);
      } catch (reason) {
        return fail(reason, [] as TrackedCredential[]);
      }
    },
    [fail],
  );

  const getExpired = useCallback(async () => {
    try {
      const records =
        await invoke<NativeCredentialRecord[]>("cred_get_expired");
      return records.map(toTrackedCredential);
    } catch (reason) {
      return fail(reason, [] as TrackedCredential[]);
    }
  }, [fail]);

  const checkStrength = useCallback(
    async (password: string) => {
      try {
        const strength = await invoke<CredentialStrength>(
          "cred_check_strength",
          { password },
        );
        return strengthResult(strength);
      } catch (reason) {
        return fail(reason, null);
      }
    },
    [fail],
  );

  const detectDuplicates = useCallback(async () => {
    try {
      const duplicateIds = await invoke<string[][]>("cred_detect_duplicates");
      return duplicateIds.map<DuplicateGroup>((credentialIds, index) => ({
        hash: `duplicate-${index}`,
        credentialIds,
        count: credentialIds.length,
      }));
    } catch (reason) {
      return fail(reason, [] as DuplicateGroup[]);
    }
  }, [fail]);

  const checkCompliance = useCallback(
    async (credentialId: string, policyId: string) => {
      try {
        const violations = await invoke<string[]>("cred_check_compliance", {
          credentialId,
        });
        return {
          credentialId,
          policyId,
          status: violations.length === 0 ? "compliant" : "non_compliant",
          violations,
        } satisfies ComplianceResult;
      } catch (reason) {
        return fail(reason, null);
      }
    },
    [fail],
  );

  const fetchPolicies = useCallback(async () => {
    try {
      const nativePolicies =
        await invoke<NativeRotationPolicy[]>("cred_list_policies");
      const list = nativePolicies.map(toRotationPolicy);
      setPolicies(list);
      return list;
    } catch (reason) {
      return fail(reason, [] as RotationPolicy[]);
    }
  }, [fail]);

  const addPolicy = useCallback(
    async (policy: Omit<RotationPolicy, "id">) => {
      const id = createId();
      const nativePolicy: NativeRotationPolicy = {
        id,
        name: policy.name,
        max_age_days: policy.maxAgeDays,
        warn_before_days: policy.warningDays,
        require_different: policy.forbidReuse > 0,
        min_strength: policy.requireMinStrength,
        applies_to: [toNativeKind(policy.kind)],
        auto_notify: policy.enabled,
        enforce: policy.enabled,
      };
      try {
        await invoke("cred_add_policy", { policy: nativePolicy });
        await fetchPolicies();
        return id;
      } catch (reason) {
        return fail(reason, null);
      }
    },
    [fail, fetchPolicies],
  );

  const removePolicy = useCallback(
    async (id: string) => {
      try {
        await invoke("cred_remove_policy", { id });
        setPolicies((previous) =>
          previous.filter((policy) => policy.id !== id),
        );
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail],
  );

  const fetchGroups = useCallback(async () => {
    try {
      const nativeGroups =
        await invoke<NativeCredentialGroup[]>("cred_list_groups");
      const list = nativeGroups.map(toCredentialGroup);
      setGroups(list);
      return list;
    } catch (reason) {
      return fail(reason, [] as CredentialGroup[]);
    }
  }, [fail]);

  const createGroup = useCallback(
    async (name: string, description: string) => {
      const id = createId();
      const group: NativeCredentialGroup = {
        id,
        name,
        description,
        credential_ids: [],
        shared_policy_id: null,
        auto_rotate_together: false,
      };
      try {
        await invoke("cred_create_group", { group });
        await fetchGroups();
        return id;
      } catch (reason) {
        return fail(reason, null);
      }
    },
    [fail, fetchGroups],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      try {
        await invoke("cred_delete_group", { id });
        setGroups((previous) => previous.filter((group) => group.id !== id));
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail],
  );

  const addToGroup = useCallback(
    async (groupId: string, credentialId: string) => {
      try {
        await invoke("cred_add_to_group", { groupId, credentialId });
        await fetchGroups();
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail, fetchGroups],
  );

  const removeFromGroup = useCallback(
    async (groupId: string, credentialId: string) => {
      try {
        await invoke("cred_remove_from_group", { groupId, credentialId });
        await fetchGroups();
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail, fetchGroups],
  );

  const fetchAlerts = useCallback(async () => {
    try {
      const nativeAlerts =
        await invoke<NativeCredentialAlert[]>("cred_get_alerts");
      const list = nativeAlerts.map(toCredentialAlert);
      setAlerts(list);
      return list;
    } catch (reason) {
      return fail(reason, [] as CredentialAlert[]);
    }
  }, [fail]);

  const acknowledgeAlert = useCallback(
    async (id: string) => {
      try {
        await invoke("cred_acknowledge_alert", { id });
        setAlerts((previous) =>
          previous.map((alert) =>
            alert.id === id ? { ...alert, acknowledged: true } : alert,
          ),
        );
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [fail],
  );

  const generateAlerts = useCallback(async () => {
    try {
      const nativeAlerts = await invoke<NativeCredentialAlert[]>(
        "cred_generate_alerts",
      );
      setAlerts(nativeAlerts.map(toCredentialAlert));
    } catch (reason) {
      fail(reason, undefined);
    }
  }, [fail]);

  const fetchAuditLog = useCallback(
    async (credentialId?: string) => {
      try {
        const list = await invoke<CredentialAuditEntry[]>(
          "cred_get_audit_log",
          { count: 500 },
        );
        const filtered = credentialId
          ? list.filter((entry) => entry.credentialId === credentialId)
          : list;
        setAuditLog(filtered);
        return filtered;
      } catch (reason) {
        return fail(reason, [] as CredentialAuditEntry[]);
      }
    },
    [fail],
  );

  const fetchStats = useCallback(async () => {
    try {
      const nativeStats = await invoke<NativeCredentialStats>("cred_get_stats");
      const result = toCredentialStats(nativeStats);
      setStats(result);
      return result;
    } catch (reason) {
      return fail(reason, null);
    }
  }, [fail]);

  const loadConfig = useCallback(async () => {
    try {
      const nativeConfig =
        await invoke<NativeCredentialConfig>("cred_get_config");
      setConfig(toCredentialConfig(nativeConfig));
    } catch (reason) {
      fail(reason, undefined);
    }
  }, [fail]);

  const updateConfig = useCallback(
    async (patch: Partial<CredentialConfig>) => {
      const merged = {
        ...(config ?? {
          enabled: true,
          autoScanEnabled: true,
          scanIntervalMs: 3_600_000,
          defaultWarningDays: 14,
          defaultMaxAgeDays: 90,
          trackPasswordStrength: true,
          detectDuplicates: true,
        }),
        ...patch,
      };
      const nativeConfig: NativeCredentialConfig = {
        check_interval_seconds: Math.max(
          1,
          Math.round(merged.scanIntervalMs / 1000),
        ),
        default_max_age_days: merged.defaultMaxAgeDays,
        default_warn_before_days: merged.defaultWarningDays,
        duplicate_detection: merged.detectDuplicates,
        strength_checking: merged.trackPasswordStrength,
        auto_alerts: merged.autoScanEnabled,
      };
      try {
        await invoke("cred_update_config", { config: nativeConfig });
        setConfig(merged);
      } catch (reason) {
        fail(reason, undefined);
      }
    },
    [config, fail],
  );

  return {
    credentials,
    policies,
    groups,
    alerts,
    auditLog,
    stats,
    config,
    loading,
    error,
    fetchAll,
    add,
    remove,
    update,
    recordRotation,
    checkExpiry,
    getStale,
    getExpiringSoon,
    getExpired,
    checkStrength,
    detectDuplicates,
    checkCompliance,
    addPolicy,
    removePolicy,
    fetchPolicies,
    createGroup,
    deleteGroup,
    fetchGroups,
    addToGroup,
    removeFromGroup,
    fetchAlerts,
    acknowledgeAlert,
    generateAlerts,
    fetchAuditLog,
    fetchStats,
    loadConfig,
    updateConfig,
  };
}
