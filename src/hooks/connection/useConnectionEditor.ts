import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Monitor,
  Terminal,
  Globe,
  Database,
  Server,
  Shield,
  Cloud,
  Folder as FolderIcon,
  Star,
  HardDrive,
  LucideIcon,
} from "lucide-react";
import { Connection } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { useToastContext } from "../../contexts/ToastContext";
import { getDefaultPort } from "../../utils/discovery/defaultPorts";
import { generateId } from "../../utils/core/id";
import {
  getConnectionDepth,
  getMaxDescendantDepth,
  MAX_NESTING_DEPTH,
} from "../../utils/window/dragDropManager";

/* ═══════════════════════════════════════════════════════════════
   Static data
   ═══════════════════════════════════════════════════════════════ */

export interface ProtocolOption {
  value: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
}

export const PROTOCOL_OPTIONS: ProtocolOption[] = [
  { value: "rdp", label: "RDP", desc: "Remote Desktop", icon: Monitor, color: "blue" },
  { value: "ssh", label: "SSH", desc: "Secure Shell", icon: Terminal, color: "green" },
  { value: "vnc", label: "VNC", desc: "Virtual Network", icon: Server, color: "purple" },
  { value: "http", label: "HTTP", desc: "Web Service", icon: Globe, color: "orange" },
  { value: "https", label: "HTTPS", desc: "Secure Web", icon: Shield, color: "emerald" },
  { value: "winrm", label: "WinRM", desc: "Windows Remote Management", icon: Server, color: "amber" },
  { value: "anydesk", label: "AnyDesk", desc: "Remote Access", icon: Monitor, color: "red" },
];

export const CLOUD_OPTIONS = [
  { value: "gcp", label: "GCP", desc: "Google Cloud" },
  { value: "azure", label: "Azure", desc: "Microsoft" },
  { value: "digital-ocean", label: "DO", desc: "Digital Ocean" },
];

export interface IconOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

export const ICON_OPTIONS: IconOption[] = [
  { value: "", label: "Default", icon: Monitor },
  { value: "terminal", label: "Terminal", icon: Terminal },
  { value: "globe", label: "Web", icon: Globe },
  { value: "database", label: "Database", icon: Database },
  { value: "server", label: "Server", icon: Server },
  { value: "shield", label: "Shield", icon: Shield },
  { value: "cloud", label: "Cloud", icon: Cloud },
  { value: "folder", label: "Folder", icon: FolderIcon },
  { value: "star", label: "Star", icon: Star },
  { value: "drive", label: "Drive", icon: HardDrive },
];

export const PROTOCOL_COLOR_MAP: Record<string, string> = {
  blue: "bg-blue-500/20 border-blue-500/60 text-blue-300",
  green: "bg-green-500/20 border-green-500/60 text-green-300",
  purple: "bg-purple-500/20 border-purple-500/60 text-purple-300",
  orange: "bg-orange-500/20 border-orange-500/60 text-orange-300",
  emerald: "bg-emerald-500/20 border-emerald-500/60 text-emerald-300",
  red: "bg-red-500/20 border-red-500/60 text-red-300",
  amber: "bg-amber-500/20 border-amber-500/60 text-amber-300",
};

/* ═══════════════════════════════════════════════════════════════
   Default form data
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_FORM: Partial<Connection> = {
  name: "",
  protocol: "rdp",
  hostname: "",
  port: 3389,
  username: "",
  password: "",
  domain: "",
  description: "",
  isGroup: false,
  tags: [],
  parentId: undefined,
  authType: "password",
  privateKey: "",
  passphrase: "",
  ignoreSshSecurityErrors: false,
  sshConnectTimeout: 30,
  sshKeepAliveInterval: 60,
  sshKnownHostsPath: "",
  icon: "",
  basicAuthUsername: "",
  basicAuthPassword: "",
  basicAuthRealm: "",
  httpHeaders: {},
};

type ManagedSshSecretField = "password" | "passphrase" | "privateKey";

export interface ManagedSshSecretsController {
  passwordInputRef: React.RefObject<HTMLInputElement | null>;
  passphraseInputRef: React.RefObject<HTMLInputElement | null>;
  privateKeyInputRef: React.RefObject<HTMLTextAreaElement | null>;
  hasPassword: boolean;
  hasPassphrase: boolean;
  hasPrivateKey: boolean;
  handlePasswordChange: (value: string) => void;
  handlePassphraseChange: (value: string) => void;
  handlePrivateKeyChange: (value: string) => void;
  getPassword: () => string;
  getPassphrase: () => string;
  getPrivateKey: () => string;
  clearAll: () => void;
}

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useConnectionEditor(
  connection: Connection | undefined,
  isOpen: boolean,
  onClose: () => void,
) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();

  const [formData, setFormData] = useState<Partial<Connection>>(DEFAULT_FORM);
  const [expandedSections, setExpandedSections] = useState({
    advanced: false,
    description: false,
  });
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saved">("idle");
  const autoSaveTimerRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);
  const originalDataRef = useRef<string>("");
  const sshPasswordRef = useRef(
    connection?.protocol === "ssh" ? connection.password || "" : "",
  );
  const sshPassphraseRef = useRef(
    connection?.protocol === "ssh" ? connection.passphrase || "" : "",
  );
  const sshPrivateKeyRef = useRef(
    connection?.protocol === "ssh" ? connection.privateKey || "" : "",
  );
  const sshTotpSecretRef = useRef(
    connection?.protocol === "ssh" ? connection.totpSecret || "" : "",
  );
  const sshProxyCommandPasswordRef = useRef(
    connection?.protocol === "ssh"
      ? connection.sshConnectionConfigOverride?.proxyCommandPassword || ""
      : "",
  );
  const sshPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const sshPassphraseInputRef = useRef<HTMLInputElement | null>(null);
  const sshPrivateKeyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [hasSshPassword, setHasSshPassword] = useState(
    sshPasswordRef.current.length > 0,
  );
  const [hasSshPassphrase, setHasSshPassphrase] = useState(
    sshPassphraseRef.current.length > 0,
  );
  const [hasSshPrivateKey, setHasSshPrivateKey] = useState(
    sshPrivateKeyRef.current.length > 0,
  );
  const [sshSecretRevision, setSshSecretRevision] = useState(0);

  const syncManagedSshInputs = useCallback(() => {
    if (sshPasswordInputRef.current) {
      sshPasswordInputRef.current.value = sshPasswordRef.current;
    }

    if (sshPassphraseInputRef.current) {
      sshPassphraseInputRef.current.value = sshPassphraseRef.current;
    }

    if (sshPrivateKeyInputRef.current) {
      sshPrivateKeyInputRef.current.value = sshPrivateKeyRef.current;
    }
  }, []);

  const setManagedSshSecret = useCallback(
    (
      field: ManagedSshSecretField,
      value: string,
      options?: { touch?: boolean },
    ) => {
      switch (field) {
        case "password":
          sshPasswordRef.current = value;
          setHasSshPassword(value.length > 0);
          if (sshPasswordInputRef.current && sshPasswordInputRef.current.value !== value) {
            sshPasswordInputRef.current.value = value;
          }
          break;
        case "passphrase":
          sshPassphraseRef.current = value;
          setHasSshPassphrase(value.length > 0);
          if (
            sshPassphraseInputRef.current &&
            sshPassphraseInputRef.current.value !== value
          ) {
            sshPassphraseInputRef.current.value = value;
          }
          break;
        case "privateKey":
          sshPrivateKeyRef.current = value;
          setHasSshPrivateKey(value.length > 0);
          if (sshPrivateKeyInputRef.current && sshPrivateKeyInputRef.current.value !== value) {
            sshPrivateKeyInputRef.current.value = value;
          }
          break;
      }

      if (options?.touch !== false) {
        setSshSecretRevision((current) => current + 1);
      }
    },
    [],
  );

  const hydrateManagedSshSecrets = useCallback(
    (values: Record<ManagedSshSecretField, string>) => {
      setManagedSshSecret("password", values.password, { touch: false });
      setManagedSshSecret("passphrase", values.passphrase, { touch: false });
      setManagedSshSecret("privateKey", values.privateKey, { touch: false });
    },
    [setManagedSshSecret],
  );

  const clearManagedSshSecrets = useCallback(
    (options?: { touch?: boolean }) => {
      hydrateManagedSshSecrets({
        password: "",
        passphrase: "",
        privateKey: "",
      });
      sshTotpSecretRef.current = "";
      sshProxyCommandPasswordRef.current = "";

      if (options?.touch) {
        setSshSecretRevision((current) => current + 1);
      }
    },
    [hydrateManagedSshSecrets],
  );

  const sanitizeSshConnectionOverride = useCallback(
    (override: Connection["sshConnectionConfigOverride"]) => {
      if (!override) {
        return undefined;
      }

      const { proxyCommandPassword: _, ...rest } = override;
      return Object.keys(rest).length > 0 ? rest : undefined;
    },
    [],
  );

  const mergeManagedSshSecrets = useCallback((data: Partial<Connection>) => {
    if (data.protocol !== "ssh") {
      return data;
    }

    const sshConnectionConfigOverride =
      data.sshConnectionConfigOverride || sshProxyCommandPasswordRef.current
        ? {
            ...(data.sshConnectionConfigOverride || {}),
            ...(sshProxyCommandPasswordRef.current
              ? { proxyCommandPassword: sshProxyCommandPasswordRef.current }
              : {}),
          }
        : undefined;

    return {
      ...data,
      password: sshPasswordRef.current,
      passphrase: sshPassphraseRef.current,
      privateKey: sshPrivateKeyRef.current,
      totpSecret: sshTotpSecretRef.current,
      sshConnectionConfigOverride,
    };
  }, []);

  const buildEditorSnapshot = useCallback((data: Partial<Connection>) => {
    const snapshot = mergeManagedSshSecrets(data);

    return JSON.stringify(snapshot);
  }, [mergeManagedSshSecrets]);

  // ── Derived ───────────────────────────────────────────────────
  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          state.connections
            .flatMap((conn) => conn.tags || [])
            .filter((tag) => tag.trim() !== ""),
        ),
      ).sort(),
    [state.connections],
  );

  const availableGroups = useMemo(
    () => state.connections.filter((conn) => conn.isGroup),
    [state.connections],
  );

  const selectableGroups = useMemo(() => {
    const currentId = formData.id;
    const isGroup = formData.isGroup;
    const descendantDepth =
      currentId && isGroup
        ? getMaxDescendantDepth(currentId, state.connections)
        : 0;

    return availableGroups.map((group) => {
      if (currentId && group.id === currentId) {
        return { group, disabled: true, reason: "Cannot be its own parent" };
      }

      if (currentId) {
        let checkId: string | undefined = group.id;
        while (checkId) {
          const parent = state.connections.find((c) => c.id === checkId);
          if (parent?.parentId === currentId) {
            return {
              group,
              disabled: true,
              reason: "Cannot move into own descendant",
            };
          }
          checkId = parent?.parentId;
        }
      }

      const groupDepth = getConnectionDepth(group.id, state.connections) + 1;
      const wouldExceedDepth = groupDepth + descendantDepth >= MAX_NESTING_DEPTH;

      return {
        group,
        disabled: wouldExceedDepth,
        reason: wouldExceedDepth
          ? `Max depth (${MAX_NESTING_DEPTH}) exceeded`
          : undefined,
      };
    });
  }, [availableGroups, state.connections, formData.id, formData.isGroup]);

  const isNewConnection = !connection;

  // ── Effects ───────────────────────────────────────────────────
  useEffect(() => {
    if (connection) {
      const isSshConnection = connection.protocol === "ssh";

      if (isSshConnection) {
        hydrateManagedSshSecrets({
          password: connection.password || "",
          passphrase: connection.passphrase || "",
          privateKey: connection.privateKey || "",
        });
        sshTotpSecretRef.current = connection.totpSecret || "";
        sshProxyCommandPasswordRef.current =
          connection.sshConnectionConfigOverride?.proxyCommandPassword || "";
      } else {
        clearManagedSshSecrets();
      }

      const resolved = {
        ...connection,
        password: isSshConnection ? "" : connection.password || "",
        privateKey: isSshConnection ? "" : connection.privateKey || "",
        passphrase: isSshConnection ? "" : connection.passphrase || "",
        totpSecret: isSshConnection ? "" : connection.totpSecret || "",
        ignoreSshSecurityErrors: connection.ignoreSshSecurityErrors ?? false,
        sshConnectTimeout: connection.sshConnectTimeout ?? 30,
        sshKeepAliveInterval: connection.sshKeepAliveInterval ?? 60,
        sshKnownHostsPath: connection.sshKnownHostsPath || "",
        icon: connection.icon || "",
        basicAuthUsername: connection.basicAuthUsername || "",
        basicAuthPassword: connection.basicAuthPassword || "",
        basicAuthRealm: connection.basicAuthRealm || "",
        httpHeaders: connection.httpHeaders || {},
        sshConnectionConfigOverride: isSshConnection
          ? sanitizeSshConnectionOverride(connection.sshConnectionConfigOverride)
          : connection.sshConnectionConfigOverride,
      };
      setFormData(resolved);
      originalDataRef.current = buildEditorSnapshot(resolved);
      // Mark as initialized on the *next* effect cycle so the auto-save
      // effect that fires from the setFormData re-render still sees false.
      isInitializedRef.current = false;
      requestAnimationFrame(() => {
        isInitializedRef.current = true;
      });
    } else {
      clearManagedSshSecrets();
      const initial = { ...DEFAULT_FORM, cloudProvider: undefined };
      setFormData(initial);
      originalDataRef.current = buildEditorSnapshot(initial);
      isInitializedRef.current = false;
    }
    setAutoSaveStatus("idle");
  }, [
    buildEditorSnapshot,
    clearManagedSshSecrets,
    connection,
    hydrateManagedSshSecrets,
    isOpen,
    sanitizeSshConnectionOverride,
  ]);

  useEffect(() => {
    if (formData.protocol === "ssh" && isOpen) {
      syncManagedSshInputs();
    }
  }, [formData.authType, formData.protocol, isOpen, sshSecretRevision, syncManagedSshInputs]);

  useEffect(() => {
    if (!isOpen) {
      clearManagedSshSecrets();
    }
  }, [clearManagedSshSecrets, isOpen]);

  useEffect(() => {
    return () => {
      clearManagedSshSecrets();
    };
  }, [clearManagedSshSecrets]);

  const buildConnectionData = useCallback((): Connection => {
    const now = new Date().toISOString();
    const effectiveFormData = mergeManagedSshSecrets(formData);

    // enableWinrmTools, sshConnectionConfigOverride, etc.) are always
    // persisted without having to enumerate them individually.
    return {
      ...(connection || {}),
      ...effectiveFormData,
      id: connection?.id || generateId(),
      name: effectiveFormData.name || "New Connection",
      protocol: effectiveFormData.protocol as Connection["protocol"],
      hostname: effectiveFormData.hostname || "",
      port:
        effectiveFormData.port ||
        getDefaultPort(effectiveFormData.protocol as string),
      isGroup: effectiveFormData.isGroup || false,
      tags: effectiveFormData.tags || [],
      order: connection?.order ?? Date.now(),
      createdAt: connection?.createdAt || now,
      updatedAt: now,
    } as Connection;
  }, [formData, connection, mergeManagedSshSecrets]);

  // Auto-save effect
  useEffect(() => {
    if (!connection || !settings.autoSaveEnabled || !isInitializedRef.current) {
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setAutoSaveStatus("pending");

    autoSaveTimerRef.current = window.setTimeout(() => {
      const connectionData = buildConnectionData();
      dispatch({ type: "UPDATE_CONNECTION", payload: connectionData });
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 2000);
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [formData, connection, settings.autoSaveEnabled, buildConnectionData, dispatch, sshSecretRevision]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

      // Detect whether anything actually changed
      const hasChanges = buildEditorSnapshot(formData) !== originalDataRef.current;

      if (connection) {
        if (!hasChanges) {
          toast.info("No changes to save");
          return;
        }
        const connectionData = buildConnectionData();
        dispatch({ type: "UPDATE_CONNECTION", payload: connectionData });
        toast.success(`"${connectionData.name}" saved`);
        // Update the baseline so subsequent saves detect new changes correctly
        originalDataRef.current = buildEditorSnapshot(formData);
      } else {
        const connectionData = buildConnectionData();
        dispatch({ type: "ADD_CONNECTION", payload: connectionData });
        toast.success(`"${connectionData.name}" created`);
        onClose();
      }
    },
    [buildConnectionData, buildEditorSnapshot, connection, dispatch, onClose, formData, toast],
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => setFormData((p) => ({ ...p, tags })),
    [],
  );

  const handleProtocolChange = useCallback((protocol: string) => {
    const nextProtocol = protocol as Connection["protocol"];
    const nextAuthType = ["http", "https"].includes(protocol)
      ? "basic"
      : "password";

    if (formData.protocol === "ssh" && nextProtocol !== "ssh") {
      const carriedPassword = sshPasswordRef.current;
      clearManagedSshSecrets();
      setFormData((prev) => ({
        ...prev,
        protocol: nextProtocol,
        port: getDefaultPort(protocol),
        authType: nextAuthType,
        password: carriedPassword,
        passphrase: "",
        privateKey: "",
        totpSecret: "",
        sshConnectionConfigOverride: sanitizeSshConnectionOverride(
          prev.sshConnectionConfigOverride,
        ),
      }));
      return;
    }

    if (formData.protocol !== "ssh" && nextProtocol === "ssh") {
      hydrateManagedSshSecrets({
        password: typeof formData.password === "string" ? formData.password : "",
        passphrase:
          typeof formData.passphrase === "string" ? formData.passphrase : "",
        privateKey:
          typeof formData.privateKey === "string" ? formData.privateKey : "",
      });
      sshTotpSecretRef.current =
        typeof formData.totpSecret === "string" ? formData.totpSecret : "";
      sshProxyCommandPasswordRef.current =
        formData.sshConnectionConfigOverride?.proxyCommandPassword || "";
      setFormData((prev) => ({
        ...prev,
        protocol: nextProtocol,
        port: getDefaultPort(protocol),
        authType: nextAuthType,
        password: "",
        passphrase: "",
        privateKey: "",
        totpSecret: "",
        sshConnectionConfigOverride: sanitizeSshConnectionOverride(
          prev.sshConnectionConfigOverride,
        ),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      protocol: nextProtocol,
      port: getDefaultPort(protocol),
      authType: nextAuthType,
    }));
  }, [clearManagedSshSecrets, formData.passphrase, formData.password, formData.privateKey, formData.protocol, formData.sshConnectionConfigOverride, formData.totpSecret, hydrateManagedSshSecrets, sanitizeSshConnectionOverride]);

  const handleResetToDefaults = useCallback(() => {
    clearManagedSshSecrets();
    setFormData((prev) => ({
      ...DEFAULT_FORM,
      id: prev.id,
      name: prev.name,
      createdAt: prev.createdAt,
      protocol: prev.protocol,
      port: getDefaultPort(prev.protocol as string),
    }));
  }, [clearManagedSshSecrets]);

  const sshSecrets = useMemo<ManagedSshSecretsController>(
    () => ({
      passwordInputRef: sshPasswordInputRef,
      passphraseInputRef: sshPassphraseInputRef,
      privateKeyInputRef: sshPrivateKeyInputRef,
      hasPassword: hasSshPassword,
      hasPassphrase: hasSshPassphrase,
      hasPrivateKey: hasSshPrivateKey,
      handlePasswordChange: (value: string) =>
        setManagedSshSecret("password", value),
      handlePassphraseChange: (value: string) =>
        setManagedSshSecret("passphrase", value),
      handlePrivateKeyChange: (value: string) =>
        setManagedSshSecret("privateKey", value),
      getPassword: () => sshPasswordRef.current,
      getPassphrase: () => sshPassphraseRef.current,
      getPrivateKey: () => sshPrivateKeyRef.current,
      clearAll: () => clearManagedSshSecrets({ touch: true }),
    }),
    [
      clearManagedSshSecrets,
      hasSshPassphrase,
      hasSshPassword,
      hasSshPrivateKey,
      setManagedSshSecret,
    ],
  );

  const toggleSection = useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    [],
  );

  return {
    formData,
    setFormData,
    expandedSections,
    autoSaveStatus,
    allTags,
    availableGroups,
    selectableGroups,
    isNewConnection,
    sshSecrets,
    settings,
    connection,
    handleSubmit,
    handleTagsChange,
    handleProtocolChange,
    handleResetToDefaults,
    toggleSection,
  };
}

export type ConnectionEditorMgr = ReturnType<typeof useConnectionEditor>;
