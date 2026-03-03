import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/* ------------------------------------------------------------------ */
/*  Types — mirror the Rust types from sorng-letsencrypt              */
/* ------------------------------------------------------------------ */

export type AcmeEnvironment =
  | "LetsEncryptProduction"
  | "LetsEncryptStaging"
  | "ZeroSsl"
  | "BuypassProduction"
  | "BuypassStaging"
  | "GoogleTrustServices"
  | "Custom";

export type ChallengeType = "Http01" | "Dns01" | "TlsAlpn01";

export type CertificateStatus =
  | "Pending"
  | "Active"
  | "Expired"
  | "Revoked"
  | "RenewalScheduled"
  | "Renewing"
  | "Failed";

export interface ManagedCertificate {
  id: string;
  account_id: string;
  primary_domain: string;
  domains: string[];
  status: CertificateStatus;
  key_algorithm: string;
  serial?: string;
  issuer_cn?: string;
  not_before?: string;
  not_after?: string;
  days_until_expiry?: number;
  fingerprint_sha256?: string;
  obtained_at?: string;
  last_renewed_at?: string;
  renewal_count: number;
  auto_renew: boolean;
  preferred_challenge: ChallengeType;
}

export interface AcmeAccount {
  id: string;
  status: string;
  contact: string[];
  created_at: string;
  environment: AcmeEnvironment;
}

export interface LetsEncryptConfig {
  enabled: boolean;
  environment: AcmeEnvironment;
  contact_email: string;
  additional_contacts: string[];
  agree_tos: boolean;
  preferred_challenge: ChallengeType;
  storage_dir: string;
  custom_directory_url?: string;
  ocsp_stapling: boolean;
  ocsp_refresh_interval_secs: number;
  http_challenge: HttpChallengeConfig;
  dns_provider?: DnsProviderConfig;
  renewal: RenewalConfig;
  certificate_key_algorithm: string;
  eab_key_id?: string;
  eab_hmac_key?: string;
}

export interface HttpChallengeConfig {
  standalone_server: boolean;
  listen_port: number;
  webroot_path?: string;
  proxy_to_gateway: boolean;
}

export interface DnsProviderConfig {
  provider: string;
  api_token?: string;
  api_key?: string;
  api_email?: string;
  zone_id?: string;
  region?: string;
  propagation_timeout_secs: number;
  polling_interval_secs: number;
}

export interface RenewalConfig {
  enabled: boolean;
  check_interval_secs: number;
  renew_before_days: number;
  warning_threshold_days: number;
  critical_threshold_days: number;
  max_retries: number;
  retry_backoff_secs: number;
  jitter_secs: number;
  notify_on_renewal: boolean;
  notify_on_failure: boolean;
}

export interface LetsEncryptStatus {
  enabled: boolean;
  running: boolean;
  environment: string;
  total_certificates: number;
  active_certificates: number;
  pending_renewal: number;
  expired_certificates: number;
  recent_events: LetsEncryptEvent[];
  next_renewal_check?: string;
  challenge_server_running: boolean;
}

export interface LetsEncryptEvent {
  type: string;
  [key: string]: unknown;
}

export interface CertificateHealthSummary {
  total: number;
  healthy: number;
  warning: number;
  critical: number;
  expired: number;
  revoked: number;
  error: number;
}

export interface OcspStatus {
  status: string;
  this_update?: string;
  next_update?: string;
  revocation_time?: string;
}

export interface RateLimitInfo {
  domain: string;
  issuances_this_week: number;
  limit: number;
  retry_after?: string;
}

/* ------------------------------------------------------------------ */
/*  Tab type                                                           */
/* ------------------------------------------------------------------ */

export type LeTab = "overview" | "certificates" | "accounts" | "config" | "health" | "events";

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useLetsEncryptManager(isOpen: boolean, onClose: () => void) {
  /* ---- core state ---- */
  const [activeTab, setActiveTab] = useState<LeTab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  /* ---- data ---- */
  const [status, setStatus] = useState<LetsEncryptStatus | null>(null);
  const [certificates, setCertificates] = useState<ManagedCertificate[]>([]);
  const [accounts, setAccounts] = useState<AcmeAccount[]>([]);
  const [config, setConfig] = useState<LetsEncryptConfig | null>(null);
  const [health, setHealth] = useState<CertificateHealthSummary | null>(null);
  const [events, setEvents] = useState<LetsEncryptEvent[]>([]);

  /* ---- form state: request certificate ---- */
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestDomains, setRequestDomains] = useState("");
  const [requestChallenge, setRequestChallenge] = useState<ChallengeType>("Http01");
  const [requesting, setRequesting] = useState(false);

  /* ---- form state: config editor ---- */
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<LetsEncryptConfig | null>(null);

  /* ---- refresh helper ---- */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  /* ---- load data on open / tab change ---- */
  const loadStatus = useCallback(async () => {
    try {
      const s = await invoke<LetsEncryptStatus>("le_get_status");
      setStatus(s);
    } catch {
      /* non-critical */
    }
  }, []);

  const loadCertificates = useCallback(async () => {
    try {
      const certs = await invoke<ManagedCertificate[]>("le_list_certificates");
      setCertificates(certs);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const accts = await invoke<AcmeAccount[]>("le_list_accounts");
      setAccounts(accts);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<LetsEncryptConfig>("le_get_config");
      setConfig(cfg);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const h = await invoke<CertificateHealthSummary>("le_health_check");
      setHealth(h);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const ev = await invoke<LetsEncryptEvent[]>("le_recent_events", {
        count: 50,
      });
      setEvents(ev);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setLoading(true);
    const run = async () => {
      await loadStatus();
      switch (activeTab) {
        case "overview":
          await Promise.all([loadCertificates(), loadHealth()]);
          break;
        case "certificates":
          await loadCertificates();
          break;
        case "accounts":
          await loadAccounts();
          break;
        case "config":
          await loadConfig();
          break;
        case "health":
          await loadHealth();
          break;
        case "events":
          await loadEvents();
          break;
      }
      setLoading(false);
    };
    run();
  }, [
    isOpen,
    activeTab,
    refreshKey,
    loadStatus,
    loadCertificates,
    loadAccounts,
    loadConfig,
    loadHealth,
    loadEvents,
  ]);

  /* ---- service lifecycle ---- */
  const startService = useCallback(async () => {
    setError(null);
    try {
      await invoke("le_start");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  const stopService = useCallback(async () => {
    setError(null);
    try {
      await invoke("le_stop");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  /* ---- certificate ops ---- */
  const requestCertificate = useCallback(async () => {
    if (!requestDomains.trim()) return;
    setRequesting(true);
    setError(null);
    try {
      const domains = requestDomains
        .split(/[,\s]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      await invoke<ManagedCertificate>("le_request_certificate", {
        domains,
        challengeType: requestChallenge,
      });
      setShowRequestForm(false);
      setRequestDomains("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRequesting(false);
    }
  }, [requestDomains, requestChallenge, refresh]);

  const renewCertificate = useCallback(
    async (certId: string) => {
      setError(null);
      try {
        await invoke<ManagedCertificate>("le_renew_certificate", {
          certificateId: certId,
        });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const revokeCertificate = useCallback(
    async (certId: string) => {
      setError(null);
      try {
        await invoke("le_revoke_certificate", {
          certificateId: certId,
          reason: null,
        });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const removeCertificate = useCallback(
    async (certId: string) => {
      setError(null);
      try {
        await invoke("le_remove_certificate", { certificateId: certId });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  /* ---- account ops ---- */
  const registerAccount = useCallback(async () => {
    setError(null);
    try {
      await invoke<AcmeAccount>("le_register_account");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  const removeAccount = useCallback(
    async (accountId: string) => {
      setError(null);
      try {
        await invoke("le_remove_account", { accountId });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  /* ---- config ops ---- */
  const startEditingConfig = useCallback(() => {
    setConfigDraft(config ? { ...config } : null);
    setEditingConfig(true);
  }, [config]);

  const cancelEditingConfig = useCallback(() => {
    setEditingConfig(false);
    setConfigDraft(null);
  }, []);

  const saveConfig = useCallback(async () => {
    if (!configDraft) return;
    setError(null);
    try {
      await invoke("le_update_config", { config: configDraft });
      setEditingConfig(false);
      setConfigDraft(null);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [configDraft, refresh]);

  /* ---- OCSP ---- */
  const fetchOcsp = useCallback(
    async (certId: string) => {
      setError(null);
      try {
        await invoke<OcspStatus>("le_fetch_ocsp", { certificateId: certId });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  /* ---- rate limits ---- */
  const checkRateLimit = useCallback(async (domain: string) => {
    try {
      return await invoke<RateLimitInfo | null>("le_check_rate_limit", {
        domain,
      });
    } catch {
      return null;
    }
  }, []);

  return {
    /* navigation */
    activeTab,
    setActiveTab,
    /* state */
    loading,
    error,
    setError,
    /* data */
    status,
    certificates,
    accounts,
    config,
    health,
    events,
    /* service */
    startService,
    stopService,
    refresh,
    /* certificate ops */
    showRequestForm,
    setShowRequestForm,
    requestDomains,
    setRequestDomains,
    requestChallenge,
    setRequestChallenge,
    requesting,
    requestCertificate,
    renewCertificate,
    revokeCertificate,
    removeCertificate,
    /* account ops */
    registerAccount,
    removeAccount,
    /* config ops */
    editingConfig,
    configDraft,
    setConfigDraft,
    startEditingConfig,
    cancelEditingConfig,
    saveConfig,
    /* OCSP */
    fetchOcsp,
    /* rate limits */
    checkRateLimit,
  };
}
