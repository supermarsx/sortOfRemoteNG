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
import { Connection } from "../types/connection";
import { useConnections } from "../contexts/useConnections";
import { useSettings } from "../contexts/SettingsContext";
import { getDefaultPort } from "../utils/defaultPorts";
import { generateId } from "../utils/id";
import {
  getConnectionDepth,
  getMaxDescendantDepth,
  MAX_NESTING_DEPTH,
} from "../utils/dragDropManager";

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
  ignoreSshSecurityErrors: true,
  sshConnectTimeout: 30,
  sshKeepAliveInterval: 60,
  sshKnownHostsPath: "",
  icon: "",
  basicAuthUsername: "",
  basicAuthPassword: "",
  basicAuthRealm: "",
  httpHeaders: {},
};

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

  const [formData, setFormData] = useState<Partial<Connection>>(DEFAULT_FORM);
  const [expandedSections, setExpandedSections] = useState({
    advanced: false,
    description: false,
  });
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saved">("idle");
  const autoSaveTimerRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

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
      setFormData({
        ...connection,
        privateKey: connection.privateKey || "",
        passphrase: connection.passphrase || "",
        ignoreSshSecurityErrors: connection.ignoreSshSecurityErrors ?? true,
        sshConnectTimeout: connection.sshConnectTimeout ?? 30,
        sshKeepAliveInterval: connection.sshKeepAliveInterval ?? 60,
        sshKnownHostsPath: connection.sshKnownHostsPath || "",
        icon: connection.icon || "",
        basicAuthUsername: connection.basicAuthUsername || "",
        basicAuthPassword: connection.basicAuthPassword || "",
        basicAuthRealm: connection.basicAuthRealm || "",
        httpHeaders: connection.httpHeaders || {},
      });
      setTimeout(() => {
        isInitializedRef.current = true;
      }, 100);
    } else {
      setFormData({
        ...DEFAULT_FORM,
        cloudProvider: undefined,
      });
      isInitializedRef.current = false;
    }
    setAutoSaveStatus("idle");
  }, [connection, isOpen]);

  const buildConnectionData = useCallback((): Connection => {
    const now = new Date();
    return {
      ...(connection || {}),
      id: connection?.id || generateId(),
      name: formData.name || "New Connection",
      protocol: formData.protocol as Connection["protocol"],
      hostname: formData.hostname || "",
      port: formData.port || getDefaultPort(formData.protocol as string),
      username: formData.username,
      password: formData.password,
      privateKey: formData.privateKey,
      passphrase: formData.passphrase,
      domain: formData.domain,
      description: formData.description || "",
      isGroup: formData.isGroup || false,
      tags: formData.tags || [],
      parentId: formData.parentId,
      icon: formData.icon || undefined,
      order: connection?.order ?? Date.now(),
      createdAt: connection?.createdAt || now,
      updatedAt: now,
      authType: formData.authType,
      basicAuthUsername: formData.basicAuthUsername,
      basicAuthPassword: formData.basicAuthPassword,
      basicAuthRealm: formData.basicAuthRealm,
      httpHeaders: formData.httpHeaders,
      httpVerifySsl: formData.httpVerifySsl,
      cloudProvider: formData.cloudProvider,
      ignoreSshSecurityErrors: formData.ignoreSshSecurityErrors ?? true,
      sshConnectTimeout: formData.sshConnectTimeout,
      sshKeepAliveInterval: formData.sshKeepAliveInterval,
      sshKnownHostsPath: formData.sshKnownHostsPath || undefined,
      tlsTrustPolicy: formData.tlsTrustPolicy,
      sshTrustPolicy: formData.sshTrustPolicy,
      rdpTrustPolicy: formData.rdpTrustPolicy,
      rdpSettings: formData.rdpSettings,
      totpSecret: formData.totpSecret,
      totpConfigs: formData.totpConfigs,
    };
  }, [formData, connection]);

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
  }, [formData, connection, settings.autoSaveEnabled, buildConnectionData, dispatch]);

  // ── Handlers ──────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      const connectionData = buildConnectionData();

      if (connection) {
        dispatch({ type: "UPDATE_CONNECTION", payload: connectionData });
      } else {
        dispatch({ type: "ADD_CONNECTION", payload: connectionData });
      }
      onClose();
    },
    [buildConnectionData, connection, dispatch, onClose],
  );

  const handleTagsChange = useCallback(
    (tags: string[]) => setFormData((p) => ({ ...p, tags })),
    [],
  );

  const handleProtocolChange = useCallback((protocol: string) => {
    setFormData((prev) => ({
      ...prev,
      protocol: protocol as Connection["protocol"],
      port: getDefaultPort(protocol),
      authType: ["http", "https"].includes(protocol) ? "basic" : "password",
    }));
  }, []);

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
    settings,
    connection,
    handleSubmit,
    handleTagsChange,
    handleProtocolChange,
    toggleSection,
  };
}

export type ConnectionEditorMgr = ReturnType<typeof useConnectionEditor>;
