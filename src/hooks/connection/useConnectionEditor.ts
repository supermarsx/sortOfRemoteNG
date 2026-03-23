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
      const resolved = {
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
      };
      setFormData(resolved);
      originalDataRef.current = JSON.stringify(resolved);
      setTimeout(() => {
        isInitializedRef.current = true;
      }, 100);
    } else {
      const initial = { ...DEFAULT_FORM, cloudProvider: undefined };
      setFormData(initial);
      originalDataRef.current = JSON.stringify(initial);
      isInitializedRef.current = false;
    }
    setAutoSaveStatus("idle");
  }, [connection, isOpen]);

  const buildConnectionData = useCallback((): Connection => {
    const now = new Date();
    // Spread ALL formData fields so newly added settings (winrmSettings,
    // enableWinrmTools, sshConnectionConfigOverride, etc.) are always
    // persisted without having to enumerate them individually.
    return {
      ...(connection || {}),
      ...formData,
      id: connection?.id || generateId(),
      name: formData.name || "New Connection",
      protocol: formData.protocol as Connection["protocol"],
      hostname: formData.hostname || "",
      port: formData.port || getDefaultPort(formData.protocol as string),
      isGroup: formData.isGroup || false,
      tags: formData.tags || [],
      order: connection?.order ?? Date.now(),
      createdAt: connection?.createdAt || now,
      updatedAt: now,
    } as Connection;
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

      // Detect whether anything actually changed
      const hasChanges = JSON.stringify(formData) !== originalDataRef.current;

      if (connection) {
        if (!hasChanges) {
          toast.info("No changes to save");
          return;
        }
        const connectionData = buildConnectionData();
        dispatch({ type: "UPDATE_CONNECTION", payload: connectionData });
        toast.success(`"${connectionData.name}" saved`);
        // Update the baseline so subsequent saves detect new changes correctly
        originalDataRef.current = JSON.stringify(formData);
      } else {
        const connectionData = buildConnectionData();
        dispatch({ type: "ADD_CONNECTION", payload: connectionData });
        toast.success(`"${connectionData.name}" created`);
        onClose();
      }
    },
    [buildConnectionData, connection, dispatch, onClose, formData, toast],
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

  const handleResetToDefaults = useCallback(() => {
    setFormData((prev) => ({
      ...DEFAULT_FORM,
      id: prev.id,
      name: prev.name,
      createdAt: prev.createdAt,
      protocol: prev.protocol,
      port: getDefaultPort(prev.protocol as string),
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
    handleResetToDefaults,
    toggleSection,
  };
}

export type ConnectionEditorMgr = ReturnType<typeof useConnectionEditor>;
