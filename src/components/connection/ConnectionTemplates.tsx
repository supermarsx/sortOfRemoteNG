import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Select } from "../ui/forms";
import {
  AppDataJsonStore,
  stripCredentialFields,
  type SanitizedValue,
} from "../../utils/storage/appDataJsonStore";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConnectionTemplate {
  id: string;
  name: string;
  description: string;
  protocol: string;
  port: number;
  category: string;
  icon: string;
  settings: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

interface ConnectionTemplatesProps {
  onCreateFromTemplate?: (template: ConnectionTemplate) => void;
  onClose?: () => void;
}

type CategoryFilter =
  | "all"
  | "ssh"
  | "rdp"
  | "vnc"
  | "database"
  | "web"
  | "custom";

interface SettingRow {
  key: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/*  Built-in templates                                                 */
/* ------------------------------------------------------------------ */

const BUILTIN_TEMPLATES: ConnectionTemplate[] = [
  {
    id: "builtin-ssh-linux",
    name: "SSH Linux Server",
    description:
      "Standard SSH connection to a Linux server with key-based authentication.",
    protocol: "SSH",
    port: 22,
    category: "ssh",
    icon: "🐧",
    settings: { authMethod: "key", compression: true, keepAlive: 60 },
    tags: ["linux", "ssh", "server"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-ssh-jump",
    name: "SSH Jump Host",
    description:
      "SSH connection via a jump/bastion host for accessing internal networks.",
    protocol: "SSH",
    port: 22,
    category: "ssh",
    icon: "🔀",
    settings: { authMethod: "key", proxyJump: true, agentForwarding: true },
    tags: ["ssh", "jump", "bastion", "proxy"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-rdp-server",
    name: "RDP Windows Server",
    description:
      "Remote Desktop connection to a Windows Server with admin console.",
    protocol: "RDP",
    port: 3389,
    category: "rdp",
    icon: "🖥️",
    settings: { adminMode: true, nla: true, resolution: "1920x1080" },
    tags: ["rdp", "windows", "server"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-rdp-workstation",
    name: "RDP Workstation",
    description:
      "Remote Desktop connection to a Windows workstation for daily use.",
    protocol: "RDP",
    port: 3389,
    category: "rdp",
    icon: "💻",
    settings: {
      nla: true,
      resolution: "auto",
      redirectClipboard: true,
      redirectPrinters: true,
    },
    tags: ["rdp", "windows", "workstation"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-vnc",
    name: "VNC Server",
    description: "VNC connection for cross-platform remote desktop access.",
    protocol: "VNC",
    port: 5900,
    category: "vnc",
    icon: "🖵",
    settings: { colorDepth: 24, viewOnly: false, encoding: "tight" },
    tags: ["vnc", "remote", "desktop"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-sftp",
    name: "SFTP Server",
    description:
      "Secure file transfer over SSH for uploading and downloading files.",
    protocol: "SFTP",
    port: 22,
    category: "ssh",
    icon: "📁",
    settings: { authMethod: "key", resumeTransfers: true },
    tags: ["sftp", "ssh", "file-transfer"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-http-api",
    name: "HTTP API",
    description:
      "HTTP/HTTPS endpoint for REST API monitoring and health checks.",
    protocol: "HTTP",
    port: 443,
    category: "web",
    icon: "🌐",
    settings: { method: "GET", tls: true, timeout: 30, followRedirects: true },
    tags: ["http", "api", "web", "monitoring"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-mysql",
    name: "Database MySQL",
    description: "MySQL/MariaDB database connection with SSL support.",
    protocol: "MySQL",
    port: 3306,
    category: "database",
    icon: "🐬",
    settings: { ssl: true, charset: "utf8mb4", connectTimeout: 10 },
    tags: ["mysql", "mariadb", "database", "sql"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-mariadb",
    name: "Database MariaDB",
    description:
      "MariaDB database connection using the MySQL workbench with TLS support.",
    protocol: "MariaDB",
    port: 3306,
    category: "database",
    icon: "🦭",
    settings: {
      mysqlDialectHint: "mariadb",
      tlsMode: "preferred",
      charset: "utf8mb4",
      connectTimeout: 10,
    },
    tags: ["mariadb", "mysql", "database", "sql"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-postgres",
    name: "Database PostgreSQL",
    description:
      "PostgreSQL database connection with SSL and connection pooling.",
    protocol: "PostgreSQL",
    port: 5432,
    category: "database",
    icon: "🐘",
    settings: { ssl: "prefer", poolSize: 5, statementTimeout: 30000 },
    tags: ["postgres", "postgresql", "database", "sql"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-mongodb",
    name: "Database MongoDB",
    description:
      "MongoDB document database connection with authentication database and TLS.",
    protocol: "MongoDB",
    port: 27017,
    category: "database",
    icon: "🍃",
    settings: { authDatabase: "admin", tls: false, readPreference: "primary" },
    tags: ["mongodb", "mongo", "database", "nosql", "document"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
  {
    id: "builtin-k8s",
    name: "Kubernetes Cluster",
    description:
      "Kubernetes cluster connection for container orchestration management.",
    protocol: "K8s",
    port: 6443,
    category: "web",
    icon: "☸️",
    settings: { authType: "kubeconfig", namespace: "default", tls: true },
    tags: ["kubernetes", "k8s", "container", "cluster"],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    usageCount: 0,
  },
];

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ssh", label: "SSH" },
  { value: "rdp", label: "RDP" },
  { value: "vnc", label: "VNC" },
  { value: "database", label: "Database" },
  { value: "web", label: "Web" },
  { value: "custom", label: "Custom" },
];

const PROTOCOL_OPTIONS = [
  "SSH",
  "RDP",
  "VNC",
  "SFTP",
  "HTTP",
  "MySQL",
  "MariaDB",
  "PostgreSQL",
  "MongoDB",
  "K8s",
  "Other",
];

const STORAGE_KEY = "sor-connection-templates";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeUserTemplates(
  value: unknown,
): SanitizedValue<ConnectionTemplate[]> {
  if (!Array.isArray(value)) {
    throw new Error("Stored connection templates are corrupted");
  }
  let changed = false;
  const templates = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Stored connection templates contain an invalid entry");
    }
    const template = item as Record<string, unknown>;
    if (
      typeof template.id !== "string" ||
      typeof template.name !== "string" ||
      typeof template.description !== "string" ||
      typeof template.protocol !== "string" ||
      typeof template.port !== "number" ||
      typeof template.category !== "string" ||
      typeof template.icon !== "string" ||
      !Array.isArray(template.tags) ||
      typeof template.createdAt !== "string" ||
      typeof template.updatedAt !== "string" ||
      typeof template.usageCount !== "number"
    ) {
      throw new Error("Stored connection templates contain invalid fields");
    }
    const settings = stripCredentialFields(
      template.settings &&
        typeof template.settings === "object" &&
        !Array.isArray(template.settings)
        ? template.settings
        : {},
    );
    changed ||= settings.changed;
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      protocol: template.protocol,
      port: template.port,
      category: template.category,
      icon: template.icon,
      settings: settings.value as Record<string, unknown>,
      tags: template.tags.filter(
        (tag): tag is string => typeof tag === "string",
      ),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      usageCount: template.usageCount,
    };
  });
  return { value: templates, changed };
}

const templatesStore = new AppDataJsonStore<ConnectionTemplate[]>({
  key: "connection.templates",
  legacyLocalStorageKey: STORAGE_KEY,
  sanitize: sanitizeUserTemplates,
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ConnectionTemplates({
  onCreateFromTemplate,
  onClose,
}: ConnectionTemplatesProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userTemplates, setUserTemplates] = useState<ConnectionTemplate[]>([]);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const templatesRef = useRef<ConnectionTemplate[]>([]);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(false);
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] =
    useState<ConnectionTemplate | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  /* ---- form state ---- */
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formProtocol, setFormProtocol] = useState("SSH");
  const [formPort, setFormPort] = useState(22);
  const [formCategory, setFormCategory] = useState("ssh");
  const [formTags, setFormTags] = useState("");
  const [formSettings, setFormSettings] = useState<SettingRow[]>([
    { key: "", value: "" },
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);

  /* ---- durable load and serialized commits ---- */
  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    templatesStore
      .load()
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        const templates = result.value ?? [];
        templatesRef.current = templates;
        setUserTemplates(templates);
        if (result.sanitized) {
          setPersistenceError(
            "Secret-bearing template fields were removed during secure storage migration.",
          );
        }
      })
      .catch((error) => {
        if (!cancelled && mountedRef.current) {
          setPersistenceError(
            `Connection templates could not be loaded: ${String(error)}`,
          );
        }
      });
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const commitTemplates = useCallback(
    (
      update: (current: ConnectionTemplate[]) => ConnectionTemplate[],
    ): Promise<ConnectionTemplate[]> => {
      const operation = persistenceQueueRef.current.then(async () => {
        const result = await templatesStore.save(update(templatesRef.current));
        templatesRef.current = result.value;
        if (mountedRef.current) {
          setUserTemplates(result.value);
          setPersistenceError(
            result.changed
              ? "Secret-bearing template fields were omitted from durable storage."
              : null,
          );
        }
        return result.value;
      });
      persistenceQueueRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      operation.catch((error) => {
        if (mountedRef.current) {
          setPersistenceError(
            `Connection templates could not be saved: ${String(error)}`,
          );
        }
      });
      return operation;
    },
    [],
  );

  /* ---- all templates ---- */
  const allTemplates = [...BUILTIN_TEMPLATES, ...userTemplates];

  const filtered = allTemplates.filter((tpl) => {
    if (category !== "all" && tpl.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        tpl.name.toLowerCase().includes(q) ||
        tpl.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        tpl.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  /* ---- handlers ---- */
  const handleUseTemplate = useCallback(
    (tpl: ConnectionTemplate) => {
      /* bump usage count for user templates */
      if (
        templatesRef.current.some((userTemplate) => userTemplate.id === tpl.id)
      ) {
        void commitTemplates((current) =>
          current.map((u) =>
            u.id === tpl.id ? { ...u, usageCount: u.usageCount + 1 } : u,
          ),
        ).catch(() => undefined);
      }
      onCreateFromTemplate?.(tpl);
    },
    [commitTemplates, onCreateFromTemplate],
  );

  const resetForm = useCallback(() => {
    setFormName("");
    setFormDescription("");
    setFormProtocol("SSH");
    setFormPort(22);
    setFormCategory("ssh");
    setFormTags("");
    setFormSettings([{ key: "", value: "" }]);
    setEditingId(null);
  }, []);

  const openCreateForm = useCallback(() => {
    resetForm();
    setShowCreateForm(true);
  }, [resetForm]);

  const openEditForm = useCallback((tpl: ConnectionTemplate) => {
    setFormName(tpl.name);
    setFormDescription(tpl.description);
    setFormProtocol(tpl.protocol);
    setFormPort(tpl.port);
    setFormCategory(tpl.category);
    setFormTags(tpl.tags.join(", "));
    setFormSettings(
      Object.entries(tpl.settings).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    );
    setEditingId(tpl.id);
    setShowCreateForm(true);
    setSelectedTemplate(null);
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    if (!formName.trim()) return;
    const now = new Date().toISOString();
    const settings: Record<string, unknown> = {};
    for (const row of formSettings) {
      if (row.key.trim()) settings[row.key.trim()] = row.value;
    }

    if (editingId) {
      await commitTemplates((current) =>
        current.map((u) =>
          u.id === editingId
            ? {
                ...u,
                name: formName.trim(),
                description: formDescription.trim(),
                protocol: formProtocol,
                port: formPort,
                category: formCategory,
                tags: formTags
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                settings,
                updatedAt: now,
              }
            : u,
        ),
      );
    } else {
      const newTpl: ConnectionTemplate = {
        id: generateId(),
        name: formName.trim(),
        description: formDescription.trim(),
        protocol: formProtocol,
        port: formPort,
        category: formCategory,
        icon: "📌",
        settings,
        tags: formTags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      };
      await commitTemplates((current) => [...current, newTpl]);
    }
    if (!mountedRef.current) return;
    setShowCreateForm(false);
    resetForm();
  }, [
    formName,
    formDescription,
    formProtocol,
    formPort,
    formCategory,
    formTags,
    formSettings,
    editingId,
    commitTemplates,
    resetForm,
  ]);

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      await commitTemplates((current) =>
        current.filter((template) => template.id !== id),
      );
      if (mountedRef.current && selectedTemplate?.id === id) {
        setSelectedTemplate(null);
      }
    },
    [commitTemplates, selectedTemplate],
  );

  const addSettingRow = useCallback(() => {
    setFormSettings((prev) => [...prev, { key: "", value: "" }]);
  }, []);

  const updateSettingRow = useCallback(
    (idx: number, field: "key" | "value", val: string) => {
      setFormSettings((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)),
      );
    },
    [],
  );

  const removeSettingRow = useCallback((idx: number) => {
    setFormSettings((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /* ---- import / export ---- */
  const handleExport = useCallback(() => {
    const data = JSON.stringify(userTemplates, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connection-templates.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [userTemplates]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const imported = JSON.parse(
            reader.result as string,
          ) as ConnectionTemplate[];
          if (!Array.isArray(imported)) return;
          await commitTemplates((current) => {
            const ids = new Set(current.map((t) => t.id));
            const fresh = imported.filter((t) => !ids.has(t.id));
            return [...current, ...fresh];
          });
        } catch (error) {
          if (mountedRef.current) {
            setPersistenceError(
              `Templates could not be imported: ${String(error)}`,
            );
          }
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [commitTemplates],
  );

  const handleSaveFromExisting = useCallback(async () => {
    try {
      const data = await invoke<{
        connections?: Array<{ name: string; protocol: string; port: number }>;
      }>("load_data");
      const connections = data?.connections ?? [];
      if (mountedRef.current && connections?.length) {
        const conn = connections[0];
        setFormName(conn.name + " (template)");
        setFormProtocol(conn.protocol ?? "SSH");
        setFormPort(conn.port ?? 22);
      }
    } catch {
      /* invoke may not be available in dev */
    }
  }, []);

  /* ---- render helpers ---- */
  const isBuiltin = (id: string) => id.startsWith("builtin-");

  /* ---------------------------------------------------------------- */
  /*  Create / Edit Modal                                              */
  /* ---------------------------------------------------------------- */
  const renderCreateForm = () => (
    <div
      className="sor-tpl-modal-overlay"
      onClick={() => setShowCreateForm(false)}
    >
      <div className="sor-tpl-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="sor-tpl-modal-title">
          {editingId
            ? t("templates.editTemplate", "Edit Template")
            : t("templates.createTemplate", "Create Template")}
        </h3>

        <label className="sor-tpl-label">{t("templates.name", "Name")}</label>
        <input
          className="sor-form-input-sm"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
        />

        <label className="sor-tpl-label">
          {t("templates.description", "Description")}
        </label>
        <textarea
          className="sor-tpl-textarea"
          rows={2}
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
        />

        <div className="sor-tpl-row">
          <div className="sor-tpl-field">
            <label className="sor-tpl-label">
              {t("templates.protocol", "Protocol")}
            </label>
            <Select
              value={formProtocol}
              onChange={(v) => setFormProtocol(v)}
              variant="form-sm"
              className="w-full"
              options={PROTOCOL_OPTIONS.map((p) => ({ value: p, label: p }))}
            />
          </div>
          <div className="sor-tpl-field">
            <label className="sor-tpl-label">
              {t("templates.port", "Port")}
            </label>
            <input
              className="sor-form-input-sm"
              type="number"
              value={formPort}
              onChange={(e) => setFormPort(Number(e.target.value))}
            />
          </div>
          <div className="sor-tpl-field">
            <label className="sor-tpl-label">
              {t("templates.category", "Category")}
            </label>
            <Select
              value={formCategory}
              onChange={(v) => setFormCategory(v)}
              variant="form-sm"
              className="w-full"
              options={CATEGORY_FILTERS.filter((c) => c.value !== "all").map(
                (c) => ({ value: c.value, label: c.label }),
              )}
            />
          </div>
        </div>

        <label className="sor-tpl-label">
          {t("templates.tags", "Tags (comma-separated)")}
        </label>
        <input
          className="sor-form-input-sm"
          value={formTags}
          onChange={(e) => setFormTags(e.target.value)}
          placeholder="tag1, tag2"
        />

        <label className="sor-tpl-label">
          {t("templates.settings", "Settings")}
        </label>
        <div className="sor-tpl-settings-editor">
          {formSettings.map((row, idx) => (
            <div
              key={`setting-${row.key}-${idx}`}
              className="sor-tpl-setting-row"
            >
              <input
                className="sor-form-input-sm"
                placeholder="key"
                value={row.key}
                onChange={(e) => updateSettingRow(idx, "key", e.target.value)}
              />
              <input
                className="sor-form-input-sm"
                placeholder="value"
                value={row.value}
                onChange={(e) => updateSettingRow(idx, "value", e.target.value)}
              />
              <button
                className="sor-tpl-btn-icon"
                onClick={() => removeSettingRow(idx)}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          <button className="sor-tpl-btn-sm" onClick={addSettingRow}>
            + {t("templates.addSetting", "Add Setting")}
          </button>
        </div>

        <div className="sor-tpl-modal-actions">
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-secondary"
            onClick={handleSaveFromExisting}
          >
            {t("templates.saveFromExisting", "Load from Existing Connection")}
          </button>
          <div className="sor-tpl-spacer" />
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-secondary"
            onClick={() => setShowCreateForm(false)}
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-primary"
            onClick={handleSaveTemplate}
          >
            {t("common.save", "Save")}
          </button>
        </div>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  Detail Panel                                                     */
  /* ---------------------------------------------------------------- */
  const renderDetailPanel = () => {
    if (!selectedTemplate) return null;
    const tpl = selectedTemplate;
    return (
      <div className="sor-tpl-detail">
        <div className="sor-tpl-detail-header">
          <span className="sor-tpl-detail-icon">{tpl.icon}</span>
          <div>
            <h3 className="sor-tpl-detail-name">{tpl.name}</h3>
            <span className="sor-tpl-badge">{tpl.protocol}</span>
            <span className="sor-tpl-detail-port">:{tpl.port}</span>
          </div>
          <button
            className="sor-tpl-btn-icon"
            onClick={() => setSelectedTemplate(null)}
            title="Close"
          >
            ✕
          </button>
        </div>

        <p className="sor-tpl-detail-desc">{tpl.description}</p>

        {tpl.tags.length > 0 && (
          <div className="sor-tpl-detail-tags">
            {tpl.tags.map((tag) => (
              <span key={tag} className="sor-tpl-tag">
                {tag}
              </span>
            ))}
          </div>
        )}

        <h4 className="sor-tpl-detail-section">
          {t("templates.settings", "Settings")}
        </h4>
        <table className="sor-tpl-settings-table">
          <tbody>
            {Object.entries(tpl.settings).map(([k, v]) => (
              <tr key={k}>
                <td className="sor-tpl-settings-key">{k}</td>
                <td className="sor-tpl-settings-val">{String(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="sor-tpl-detail-meta">
          <span>
            {t("templates.usageCount", "Used")} {tpl.usageCount}×
          </span>
          <span>
            {t("templates.created", "Created")}{" "}
            {new Date(tpl.createdAt).toLocaleDateString()}
          </span>
        </div>

        <div className="sor-tpl-detail-actions">
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-primary"
            onClick={() => handleUseTemplate(tpl)}
          >
            {t("templates.createConnection", "Create Connection")}
          </button>
          {!isBuiltin(tpl.id) && (
            <>
              <button
                className="sor-tpl-btn-sm sor-tpl-btn-secondary"
                onClick={() => openEditForm(tpl)}
              >
                {t("common.edit", "Edit")}
              </button>
              <button
                className="sor-tpl-btn-sm sor-tpl-btn-danger"
                onClick={() => handleDeleteTemplate(tpl.id)}
              >
                {t("common.delete", "Delete")}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Main JSX                                                         */
  /* ---------------------------------------------------------------- */
  return (
    <div className="sor-tpl-container" data-testid="template-list">
      {/* ---- Header ---- */}
      <div className="sor-tpl-header">
        <h2 className="sor-tpl-title">
          {t("templates.title", "Connection Templates")}
        </h2>
        <div className="sor-tpl-header-actions">
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-secondary"
            onClick={handleExport}
          >
            {t("templates.export", "Export")}
          </button>
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t("templates.import", "Import")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="sor-tpl-hidden"
            onChange={handleImport}
          />
          <button
            className="sor-tpl-btn-sm sor-tpl-btn-primary"
            onClick={openCreateForm}
          >
            + {t("templates.new", "New Template")}
          </button>
          {onClose && (
            <button
              className="sor-tpl-btn-icon"
              onClick={onClose}
              title="Close"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {persistenceError && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {persistenceError}
        </div>
      )}

      {/* ---- Search ---- */}
      <input
        className="sor-tpl-search"
        placeholder={t("templates.search", "Search templates by name or tag…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* ---- Category pills ---- */}
      <div className="sor-tpl-categories">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c.value}
            className={`sor-tpl-pill ${category === c.value ? "sor-tpl-pill-active" : ""}`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ---- Content area ---- */}
      <div className="sor-tpl-content">
        {/* ---- Gallery grid ---- */}
        <div className="sor-tpl-grid">
          {filtered.length === 0 && (
            <p className="sor-tpl-empty">
              {t("templates.noResults", "No templates match your search.")}
            </p>
          )}
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className={`sor-tpl-card ${selectedTemplate?.id === tpl.id ? "sor-tpl-card-selected" : ""}`}
              data-testid="template-item"
              onClick={() => setSelectedTemplate(tpl)}
            >
              <div className="sor-tpl-card-top">
                <span className="sor-tpl-card-icon">{tpl.icon}</span>
                <span className="sor-tpl-badge">{tpl.protocol}</span>
              </div>
              <h4 className="sor-tpl-card-name">{tpl.name}</h4>
              <p className="sor-tpl-card-desc">{tpl.description}</p>
              <div className="sor-tpl-card-footer">
                <span className="sor-tpl-card-usage">
                  {tpl.usageCount}× {t("templates.used", "used")}
                </span>
                <button
                  className="sor-tpl-btn-sm sor-tpl-btn-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUseTemplate(tpl);
                  }}
                >
                  {t("templates.useTemplate", "Use Template")}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ---- Detail panel ---- */}
        {renderDetailPanel()}
      </div>

      {/* ---- Create / Edit modal ---- */}
      {showCreateForm && renderCreateForm()}
    </div>
  );
}
