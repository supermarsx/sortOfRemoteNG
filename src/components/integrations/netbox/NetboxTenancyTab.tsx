import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Contact as ContactIcon,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Tag as TagIcon,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NetboxTabProps } from "../../../types/netbox";
import type {
  Contact,
  ContactGroup,
  Tenant,
  TenantGroup,
} from "../../../types/netbox/tenancy";
import {
  useNetboxTenancy,
  type NetboxTenancyView,
} from "../../../hooks/integration/netbox/useNetboxTenancy";

// ─── View metadata ────────────────────────────────────────────────────────────

interface ViewMeta {
  key: NetboxTenancyView;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  /** Views backed by create/update/delete commands. */
  editable: boolean;
}

const VIEWS: ViewMeta[] = [
  {
    key: "tenants",
    labelKey: "integrations.netbox.tenancy.tenants",
    labelDefault: "Tenants",
    icon: Building2,
    editable: true,
  },
  {
    key: "tenantGroups",
    labelKey: "integrations.netbox.tenancy.tenantGroups",
    labelDefault: "Tenant Groups",
    icon: FolderTree,
    editable: true,
  },
  {
    key: "contacts",
    labelKey: "integrations.netbox.tenancy.contacts",
    labelDefault: "Contacts",
    icon: ContactIcon,
    editable: true,
  },
  {
    key: "contactGroups",
    labelKey: "integrations.netbox.tenancy.contactGroups",
    labelDefault: "Contact Groups",
    icon: FolderTree,
    editable: true,
  },
  {
    key: "contactRoles",
    labelKey: "integrations.netbox.tenancy.contactRoles",
    labelDefault: "Contact Roles",
    icon: TagIcon,
    editable: false,
  },
  {
    key: "contactAssignments",
    labelKey: "integrations.netbox.tenancy.contactAssignments",
    labelDefault: "Assignments",
    icon: Users,
    editable: false,
  },
];

/** Editable field descriptors per CRUD view. */
const FORM_FIELDS: Record<
  "tenants" | "tenantGroups" | "contacts" | "contactGroups",
  Array<{ name: string; labelKey: string; labelDefault: string }>
> = {
  tenants: [
    { name: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
    { name: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
    { name: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
    { name: "comments", labelKey: "integrations.netbox.tenancy.field.comments", labelDefault: "Comments" },
  ],
  tenantGroups: [
    { name: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
    { name: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
    { name: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
  ],
  contacts: [
    { name: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
    { name: "title", labelKey: "integrations.netbox.tenancy.field.title", labelDefault: "Title" },
    { name: "phone", labelKey: "integrations.netbox.tenancy.field.phone", labelDefault: "Phone" },
    { name: "email", labelKey: "integrations.netbox.tenancy.field.email", labelDefault: "Email" },
    { name: "address", labelKey: "integrations.netbox.tenancy.field.address", labelDefault: "Address" },
    { name: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
  ],
  contactGroups: [
    { name: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
    { name: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
    { name: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
  ],
};

type EditableView = keyof typeof FORM_FIELDS;

const INPUT_CLS =
  "netbox-input rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]";

const isEditable = (v: NetboxTenancyView): v is EditableView =>
  v === "tenants" || v === "tenantGroups" || v === "contacts" || v === "contactGroups";

/** Pull the display name off a nested ref stored on a record. */
function refName(ref: unknown): string {
  if (ref && typeof ref === "object" && "name" in ref) {
    const n = (ref as { name?: unknown }).name;
    if (typeof n === "string") return n;
  }
  return "—";
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * NetBox Tenancy & Contacts tab (t42-netbox-c4). A six-way sub-view over
 * Tenants, Tenant Groups, Contacts, Contact Groups, Contact Roles and
 * Assignments. The four object views support create / update (PUT) / partial
 * update (PATCH) / delete; roles and assignments are read-only lists. Every one
 * of the crate's 24 tenancy commands is reachable from here via
 * `useNetboxTenancy`.
 */
const NetboxTenancyTab: React.FC<NetboxTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const state = useNetboxTenancy(connectionId);
  const {
    tenants,
    tenantGroups,
    contacts,
    contactGroups,
    contactRoles,
    contactAssignments,
    loading,
    error,
    load,
    remove,
    clearError,
    api,
  } = state;

  const [view, setView] = useState<NetboxTenancyView>("tenants");
  // `null` = no form; `-1` = creating; otherwise the id being edited.
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void load(view);
    setEditId(null);
    setFormError(null);
  }, [view, load]);

  const rows = useMemo(() => {
    switch (view) {
      case "tenants":
        return tenants;
      case "tenantGroups":
        return tenantGroups;
      case "contacts":
        return contacts;
      case "contactGroups":
        return contactGroups;
      case "contactRoles":
        return contactRoles;
      case "contactAssignments":
        return contactAssignments;
      default:
        return [];
    }
  }, [
    view,
    tenants,
    tenantGroups,
    contacts,
    contactGroups,
    contactRoles,
    contactAssignments,
  ]);

  const openCreate = useCallback(() => {
    setForm({});
    setFormError(null);
    setEditId(-1);
  }, []);

  const openEdit = useCallback(
    (record: Tenant | TenantGroup | Contact | ContactGroup) => {
      if (!isEditable(view)) return;
      const next: Record<string, string> = {};
      for (const f of FORM_FIELDS[view]) {
        const val = (record as Record<string, unknown>)[f.name];
        next[f.name] = typeof val === "string" ? val : "";
      }
      setForm(next);
      setFormError(null);
      setEditId(record.id ?? null);
    },
    [view],
  );

  const closeForm = useCallback(() => {
    setEditId(null);
    setFormError(null);
  }, []);

  /** Build the request payload from the current form (drop empty strings). */
  const payload = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v.trim() !== "") out[k] = v.trim();
    }
    return out;
  }, [form]);

  const createRecord = useCallback(async () => {
    if (!isEditable(view)) return;
    setBusy(true);
    setFormError(null);
    try {
      const data = payload();
      if (view === "tenants") await api.createTenant(connectionId, data);
      else if (view === "tenantGroups") await api.createTenantGroup(connectionId, data);
      else if (view === "contacts") await api.createContact(connectionId, data);
      else await api.createContactGroup(connectionId, data);
      closeForm();
      await load(view);
    } catch (e) {
      setFormError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [view, payload, api, connectionId, closeForm, load]);

  /** Full replace (PUT). */
  const updateRecord = useCallback(async () => {
    if (!isEditable(view) || editId == null || editId < 0) return;
    setBusy(true);
    setFormError(null);
    try {
      const data = payload();
      if (view === "tenants") await api.updateTenant(connectionId, editId, data);
      else if (view === "tenantGroups") await api.updateTenantGroup(connectionId, editId, data);
      else if (view === "contacts") await api.updateContact(connectionId, editId, data);
      else await api.updateContactGroup(connectionId, editId, data);
      closeForm();
      await load(view);
    } catch (e) {
      setFormError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [view, editId, payload, api, connectionId, closeForm, load]);

  /** Partial patch (PATCH) — only tenants & contacts expose a PATCH command. */
  const patchRecord = useCallback(async () => {
    if (editId == null || editId < 0) return;
    if (view !== "tenants" && view !== "contacts") return;
    setBusy(true);
    setFormError(null);
    try {
      const data = payload();
      if (view === "tenants")
        await api.partialUpdateTenant(connectionId, editId, data);
      else await api.partialUpdateContact(connectionId, editId, data);
      closeForm();
      await load(view);
    } catch (e) {
      setFormError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [view, editId, payload, api, connectionId, closeForm, load]);

  const deleteRecord = useCallback(
    async (id: number | null | undefined) => {
      if (id == null) return;
      await remove(view, id);
    },
    [remove, view],
  );

  const activeMeta = VIEWS.find((v) => v.key === view)!;
  const canPatch = view === "tenants" || view === "contacts";

  return (
    <div className="flex h-full flex-col">
      {/* Sub-view selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-1">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = v.key === view;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
                active
                  ? "bg-primary/15 text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {t(v.labelKey, v.labelDefault)}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-sm font-medium text-[var(--color-text)]">
          {t(activeMeta.labelKey, activeMeta.labelDefault)}
        </span>
        <span className="text-xs text-[var(--color-textMuted)]">
          {t("integrations.netbox.tenancy.count", "{{count}} items", {
            count: rows.length,
          })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => void load(view)}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.netbox.tenancy.refresh", "Refresh")}
          >
            <RefreshCw size={12} />
          </button>
          {activeMeta.editable && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
            >
              <Plus size={12} />
              {t("integrations.netbox.tenancy.new", "New")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 bg-[var(--color-error,#ef4444)]/10 px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{error}</span>
          <button onClick={clearError} className="opacity-70 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
            {t("integrations.netbox.tenancy.empty", "No records.")}
          </div>
        ) : (
          <TenancyTable
            view={view}
            rows={rows}
            onEdit={openEdit}
            onDelete={deleteRecord}
          />
        )}
      </div>

      {/* Create / edit form */}
      {editId !== null && isEditable(view) && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {editId < 0
                ? t("integrations.netbox.tenancy.createTitle", "Create")
                : t("integrations.netbox.tenancy.editTitle", "Edit")}{" "}
              {t(activeMeta.labelKey, activeMeta.labelDefault)}
            </span>
            <button
              onClick={closeForm}
              className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {FORM_FIELDS[view].map((f) => (
              <label key={f.name} className="flex flex-col gap-1 text-xs">
                <span className="text-[var(--color-textSecondary)]">
                  {t(f.labelKey, f.labelDefault)}
                </span>
                <input
                  className={INPUT_CLS}
                  value={form[f.name] ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, [f.name]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          {formError && (
            <p className="mt-2 text-xs text-[var(--color-error,#ef4444)]">
              {formError}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {editId < 0 ? (
              <button
                onClick={() => void createRecord()}
                disabled={busy}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {t("integrations.netbox.tenancy.create", "Create")}
              </button>
            ) : (
              <>
                <button
                  onClick={() => void updateRecord()}
                  disabled={busy}
                  className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                  title={t("integrations.netbox.tenancy.saveHint", "Replace (PUT)")}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  {t("integrations.netbox.tenancy.save", "Save")}
                </button>
                {canPatch && (
                  <button
                    onClick={() => void patchRecord()}
                    disabled={busy}
                    className="app-bar-button flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-60"
                    title={t(
                      "integrations.netbox.tenancy.patchHint",
                      "Patch only the filled fields (PATCH)",
                    )}
                  >
                    <Pencil size={12} />
                    {t("integrations.netbox.tenancy.patch", "Patch")}
                  </button>
                )}
              </>
            )}
            <button
              onClick={closeForm}
              className="app-bar-button px-3 py-1.5 text-xs"
            >
              {t("integrations.netbox.tenancy.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Table ─────────────────────────────────────────────────────────────────────

interface TableProps {
  view: NetboxTenancyView;
  rows: unknown[];
  onEdit: (r: Tenant | TenantGroup | Contact | ContactGroup) => void;
  onDelete: (id: number | null | undefined) => void;
}

/** Per-view column headers + cell renderer. Keeps the parent lean. */
const TenancyTable: React.FC<TableProps> = ({ view, rows, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const editable = isEditable(view);

  const columns: Array<{ key: string; labelKey: string; labelDefault: string }> =
    useMemo(() => {
      switch (view) {
        case "tenants":
          return [
            { key: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
            { key: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
            { key: "group", labelKey: "integrations.netbox.tenancy.field.group", labelDefault: "Group" },
            { key: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
          ];
        case "tenantGroups":
          return [
            { key: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
            { key: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
            { key: "tenantCount", labelKey: "integrations.netbox.tenancy.field.tenantCount", labelDefault: "Tenants" },
            { key: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
          ];
        case "contacts":
          return [
            { key: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
            { key: "title", labelKey: "integrations.netbox.tenancy.field.title", labelDefault: "Title" },
            { key: "email", labelKey: "integrations.netbox.tenancy.field.email", labelDefault: "Email" },
            { key: "phone", labelKey: "integrations.netbox.tenancy.field.phone", labelDefault: "Phone" },
            { key: "group", labelKey: "integrations.netbox.tenancy.field.group", labelDefault: "Group" },
          ];
        case "contactGroups":
          return [
            { key: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
            { key: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
            { key: "contactCount", labelKey: "integrations.netbox.tenancy.field.contactCount", labelDefault: "Contacts" },
            { key: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
          ];
        case "contactRoles":
          return [
            { key: "name", labelKey: "integrations.netbox.tenancy.field.name", labelDefault: "Name" },
            { key: "slug", labelKey: "integrations.netbox.tenancy.field.slug", labelDefault: "Slug" },
            { key: "description", labelKey: "integrations.netbox.tenancy.field.description", labelDefault: "Description" },
          ];
        case "contactAssignments":
          return [
            { key: "contact", labelKey: "integrations.netbox.tenancy.field.contact", labelDefault: "Contact" },
            { key: "role", labelKey: "integrations.netbox.tenancy.field.role", labelDefault: "Role" },
            { key: "objectType", labelKey: "integrations.netbox.tenancy.field.objectType", labelDefault: "Object type" },
            { key: "priority", labelKey: "integrations.netbox.tenancy.field.priority", labelDefault: "Priority" },
          ];
        default:
          return [];
      }
    }, [view]);

  const cell = useCallback((row: Record<string, unknown>, key: string): string => {
    const val = row[key];
    if (val == null) return "—";
    if (key === "group" || key === "contact" || key === "role") return refName(val);
    if (key === "priority") {
      if (val && typeof val === "object" && "label" in val) {
        const l = (val as { label?: unknown }).label;
        return typeof l === "string" ? l : "—";
      }
      return "—";
    }
    if (typeof val === "string" || typeof val === "number") return String(val);
    return "—";
  }, []);

  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 bg-[var(--color-surface)]">
        <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-textSecondary)]">
          {columns.map((c) => (
            <th key={c.key} className="px-4 py-1.5 font-medium">
              {t(c.labelKey, c.labelDefault)}
            </th>
          ))}
          {editable && <th className="px-4 py-1.5" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const row = r as Record<string, unknown>;
          const id = typeof row.id === "number" ? row.id : null;
          return (
            <tr
              key={id ?? i}
              className="border-b border-[var(--color-border)]/50 text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            >
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-1.5">
                  {cell(row, c.key)}
                </td>
              ))}
              {editable && (
                <td className="px-4 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() =>
                        onEdit(row as unknown as Tenant | TenantGroup | Contact | ContactGroup)
                      }
                      className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                      title={t("integrations.netbox.tenancy.editTitle", "Edit")}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => onDelete(id)}
                      className="text-[var(--color-textSecondary)] hover:text-[var(--color-error,#ef4444)]"
                      title={t("integrations.netbox.tenancy.delete", "Delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default NetboxTenancyTab;
