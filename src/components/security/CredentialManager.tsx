import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Key,
  Shield,
  AlertTriangle,
  AlertCircle,
  Plus,
  RefreshCw,
  Trash2,
  Edit,
  Copy,
  Clock,
  Users,
  FileText,
  Search,
  Bell,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  RotateCw,
} from "lucide-react";
import { Select } from "../ui/forms";
import { useCredentials } from "../../hooks/security/useCredentials";
import type {
  TrackedCredential,
  RotationPolicy,
  CredentialGroup,
  CredentialAlert,
  CredentialAuditEntry,
  DuplicateGroup,
  CredentialKind,
  CredentialStrength,
} from "../../types/connection/credentials";

type TabId = "all" | "expiring" | "expired" | "groups" | "policies" | "audit";

const TABS: { id: TabId; labelKey: string }[] = [
  { id: "all", labelKey: "credentials.tabs.all" },
  { id: "expiring", labelKey: "credentials.tabs.expiring" },
  { id: "expired", labelKey: "credentials.tabs.expired" },
  { id: "groups", labelKey: "credentials.tabs.groups" },
  { id: "policies", labelKey: "credentials.tabs.policies" },
  { id: "audit", labelKey: "credentials.tabs.audit" },
];

const STRENGTH_META: Record<CredentialStrength, { color: string; label: string; pct: number }> = {
  very_weak: { color: "bg-error", label: "Very Weak", pct: 10 },
  weak: { color: "bg-warning", label: "Weak", pct: 30 },
  fair: { color: "bg-warning", label: "Fair", pct: 55 },
  strong: { color: "bg-success", label: "Strong", pct: 80 },
  very_strong: { color: "bg-success", label: "Very Strong", pct: 100 },
};

type SortField = "label" | "connectionName" | "kind" | "ageDays" | "expiresAt" | "strength" | "lastRotated";

/* ------------------------------------------------------------------ */
/*  Strength Meter                                                    */
/* ------------------------------------------------------------------ */

function StrengthMeter({ strength }: { strength: CredentialStrength }) {
  const meta = STRENGTH_META[strength];
  return (
    <div className="sor-strength-meter flex items-center gap-2">
      <div className="h-2 w-20 rounded bg-[var(--color-bgSecondary)] overflow-hidden">
        <div className={`h-full rounded ${meta.color}`} style={{ width: `${meta.pct}%` }} />
      </div>
      <span className="text-xs text-[var(--color-textSecondary)]">{meta.label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add / Edit  Dialog                                                */
/* ------------------------------------------------------------------ */

interface CredDialogProps {
  credential: Partial<TrackedCredential> | null;
  onSave: (data: Partial<TrackedCredential>) => void;
  onClose: () => void;
}

function CredentialDialog({ credential, onSave, onClose }: CredDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!credential?.id;

  const [form, setForm] = useState({
    label: credential?.label ?? "",
    connectionName: credential?.connectionName ?? "",
    connectionId: credential?.connectionId ?? "",
    kind: (credential?.kind ?? "password") as CredentialKind,
    expiresAt: credential?.expiresAt ?? "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="sor-credential-dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="sor-credential-dialog bg-[var(--color-bgPrimary)] border border-[var(--color-border)] rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--color-textPrimary)]">
            {isEdit ? t("credentials.editTitle") : t("credentials.addTitle")}
          </h3>
          <button onClick={onClose} className="sor-btn-icon p-1 rounded hover:bg-[var(--color-bgSecondary)]">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm text-[var(--color-textSecondary)]">{t("credentials.fields.name")}</span>
            <input value={form.label} onChange={(e) => set("label", e.target.value)} className="sor-input mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bgSecondary)] px-3 py-2 text-sm text-[var(--color-textPrimary)]" />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--color-textSecondary)]">{t("credentials.fields.connectionName")}</span>
            <input value={form.connectionName} onChange={(e) => set("connectionName", e.target.value)} className="sor-input mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bgSecondary)] px-3 py-2 text-sm text-[var(--color-textPrimary)]" />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--color-textSecondary)]">{t("credentials.fields.kind")}</span>
            <Select
              value={form.kind}
              onChange={(v) => set("kind", v)}
              variant="form-sm"
              className="mt-1 w-full"
              options={(["password", "ssh_key", "certificate", "api_key", "token", "totp_secret"] as CredentialKind[]).map((k) => ({
                value: k,
                label: k.replace(/_/g, " "),
              }))}
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--color-textSecondary)]">{t("credentials.fields.expiresAt")}</span>
            <input type="date" value={form.expiresAt?.split("T")[0] ?? ""} onChange={(e) => set("expiresAt", e.target.value)} className="sor-input mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bgSecondary)] px-3 py-2 text-sm text-[var(--color-textPrimary)]" />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="sor-btn px-4 py-2 text-sm rounded border border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-bgSecondary)]">
            {t("common.cancel")}
          </button>
          <button onClick={() => onSave({ ...credential, ...form })} className="sor-btn-primary px-4 py-2 text-sm rounded bg-primary text-white hover:bg-primary/90">
            {isEdit ? t("common.save") : t("common.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Duplicates Panel                                                  */
/* ------------------------------------------------------------------ */

function DuplicatesPanel({ groups, credentials, onClose }: { groups: DuplicateGroup[]; credentials: TrackedCredential[]; onClose: () => void }) {
  const { t } = useTranslation();
  const nameOf = (id: string) => credentials.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="sor-duplicates-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="sor-duplicates-panel bg-[var(--color-bgPrimary)] border border-[var(--color-border)] rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--color-textPrimary)] flex items-center gap-2">
            <Copy size={18} /> {t("credentials.duplicates.title")}
          </h3>
          <button onClick={onClose} className="sor-btn-icon p-1 rounded hover:bg-[var(--color-bgSecondary)]"><X size={16} /></button>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-[var(--color-textSecondary)]">{t("credentials.duplicates.none")}</p>
        ) : (
          <ul className="space-y-3">
            {groups.map((g) => (
              <li key={g.hash} className="border border-[var(--color-border)] rounded p-3">
                <p className="text-sm font-medium text-[var(--color-textPrimary)]">{g.count} duplicates (hash: {g.hash.slice(0, 8)}…)</p>
                <ul className="mt-1 space-y-1">
                  {g.credentialIds.map((id) => (
                    <li key={id} className="text-xs text-[var(--color-textSecondary)]">• {nameOf(id)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function CredentialManager() {
  const { t } = useTranslation();
  const creds = useCredentials();

  const [tab, setTab] = useState<TabId>("all");
  const [sortField, setSortField] = useState<SortField>("label");
  const [sortAsc, setSortAsc] = useState(true);
  const [editingCred, setEditingCred] = useState<Partial<TrackedCredential> | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[] | null>(null);
  const [expiringSoon, setExpiringSoon] = useState<TrackedCredential[]>([]);
  const [expiredList, setExpiredList] = useState<TrackedCredential[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expiringDays, setExpiringDays] = useState(30);

  /* initial load */
  useEffect(() => {
    creds.fetchAll();
    creds.fetchStats();
    creds.fetchPolicies();
    creds.fetchGroups();
    creds.fetchAlerts();
    creds.fetchAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* refresh expiring / expired when tab changes */
  useEffect(() => {
    if (tab === "expiring") creds.getExpiringSoon(expiringDays).then(setExpiringSoon);
    if (tab === "expired") creds.getExpired().then(setExpiredList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, expiringDays]);

  /* sorting */
  const sorted = useMemo(() => {
    const list = [...creds.credentials];
    list.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return list;
  }, [creds.credentials, sortField, sortAsc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((p) => !p);
    else { setSortField(field); setSortAsc(true); }
  };

  /* actions */
  const handleSave = useCallback(async (data: Partial<TrackedCredential>) => {
    if (data.id) {
      await creds.update(data.id, data);
    } else {
      await creds.add(data as Parameters<typeof creds.add>[0]);
    }
    setShowDialog(false);
    setEditingCred(null);
  }, [creds]);

  const handleDetectDuplicates = useCallback(async () => {
    const result = await creds.detectDuplicates();
    setDuplicates(result);
  }, [creds]);

  const toggleGroupExpand = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  /* ---------- header ---------- */
  const stats = creds.stats;

  /* ---------- render helpers ---------- */
  const sortHeader = (label: string, field: SortField) => (
    <th className="sor-th px-3 py-2 text-left text-xs font-medium text-[var(--color-textSecondary)] cursor-pointer select-none" onClick={() => toggleSort(field)}>
      {label} {sortField === field ? (sortAsc ? "▲" : "▼") : ""}
    </th>
  );

  /* ================================================================ */
  if (creds.loading && creds.credentials.length === 0) {
    return (
      <div className="sor-credential-manager flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-primary" size={24} />
        <span className="ml-2 text-[var(--color-textSecondary)]">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="sor-credential-manager flex flex-col h-full overflow-hidden text-[var(--color-textPrimary)]">
      {/* ---------- error banner ---------- */}
      {creds.error && (
        <div className="sor-error-banner flex items-center gap-2 bg-error/10 border border-error/30 rounded px-3 py-2 mx-4 mt-2 text-sm text-error">
          <AlertCircle size={14} /> {creds.error}
        </div>
      )}

      {/* ---------- alerts ---------- */}
      {creds.alerts.filter((a) => !a.acknowledged).length > 0 && (
        <div className="sor-alerts mx-4 mt-2 space-y-1">
          {creds.alerts.filter((a) => !a.acknowledged).slice(0, 5).map((a) => (
            <div key={a.id} className={`sor-alert flex items-center justify-between rounded px-3 py-1.5 text-xs ${a.severity === "critical" ? "bg-error/10 text-error" : a.severity === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"}`}>
              <span className="flex items-center gap-1"><Bell size={12} /> {a.message}</span>
              <button onClick={() => creds.acknowledgeAlert(a.id)} className="sor-btn-icon ml-2 hover:opacity-80"><Check size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* ---------- header ---------- */}
      <div className="sor-header flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Key className="text-primary" size={20} />
          <h2 className="text-lg font-semibold">{t("credentials.title")}</h2>
        </div>

        {stats && (
          <div className="flex items-center gap-2 ml-2">
            <span className="sor-badge rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs">{stats.total} total</span>
            <span className="sor-badge rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs">{stats.expiringSoon} expiring</span>
            <span className="sor-badge rounded-full bg-error/15 text-error px-2 py-0.5 text-xs">{stats.expired} expired</span>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => { setEditingCred(null); setShowDialog(true); }} className="sor-btn-primary flex items-center gap-1 rounded px-3 py-1.5 text-xs bg-primary text-white hover:bg-primary/90">
            <Plus size={14} /> {t("credentials.addBtn")}
          </button>
          <button onClick={() => creds.generateAlerts()} className="sor-btn flex items-center gap-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-bgSecondary)]">
            <Bell size={14} /> {t("credentials.generateAlerts")}
          </button>
          <button onClick={handleDetectDuplicates} className="sor-btn flex items-center gap-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-bgSecondary)]">
            <Copy size={14} /> {t("credentials.detectDuplicates")}
          </button>
        </div>
      </div>

      {/* ---------- tabs ---------- */}
      <div className="sor-tab-bar flex gap-1 px-4 pt-2 border-b border-[var(--color-border)]">
        {TABS.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)} className={`sor-tab px-3 py-2 text-xs font-medium rounded-t transition-colors ${tab === tb.id ? "bg-[var(--color-bgSecondary)] text-[var(--color-textPrimary)] border-b-2 border-primary" : "text-[var(--color-textSecondary)] hover:text-[var(--color-textPrimary)]"}`}>
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {/* ---------- tab content ---------- */}
      <div className="sor-tab-content flex-1 overflow-auto px-4 py-3">
        {/* ===== All Credentials ===== */}
        {tab === "all" && (
          creds.credentials.length === 0 ? (
            <div className="sor-empty flex flex-col items-center justify-center h-48 text-[var(--color-textSecondary)]">
              <Shield size={32} className="mb-2 opacity-40" />
              <p className="text-sm">{t("credentials.empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="sor-table w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    {sortHeader(t("credentials.col.name"), "label")}
                    {sortHeader(t("credentials.col.connection"), "connectionName")}
                    {sortHeader(t("credentials.col.kind"), "kind")}
                    {sortHeader(t("credentials.col.age"), "ageDays")}
                    {sortHeader(t("credentials.col.expires"), "expiresAt")}
                    {sortHeader(t("credentials.col.strength"), "strength")}
                    {sortHeader(t("credentials.col.lastRotated"), "lastRotated")}
                    <th className="sor-th px-3 py-2 text-left text-xs font-medium text-[var(--color-textSecondary)]">{t("credentials.col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => (
                    <tr key={c.id} className="sor-row border-b border-[var(--color-border)] hover:bg-[var(--color-bgSecondary)] transition-colors">
                      <td className="px-3 py-2 font-medium">{c.label}</td>
                      <td className="px-3 py-2 text-[var(--color-textSecondary)]">{c.connectionName}</td>
                      <td className="px-3 py-2"><span className="sor-kind-badge rounded bg-[var(--color-bgSecondary)] px-1.5 py-0.5 text-xs">{c.kind.replace(/_/g, " ")}</span></td>
                      <td className="px-3 py-2">{c.ageDays}d</td>
                      <td className={`px-3 py-2 ${c.isExpired ? "text-error" : ""}`}>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2"><StrengthMeter strength={c.strength} /></td>
                      <td className="px-3 py-2 text-[var(--color-textSecondary)]">{c.lastRotated ? new Date(c.lastRotated).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => creds.recordRotation(c.id)} title={t("credentials.rotate")} className="sor-btn-icon p-1 rounded hover:bg-[var(--color-bgSecondary)]"><RotateCw size={14} /></button>
                          <button onClick={() => { setEditingCred(c); setShowDialog(true); }} title={t("common.edit")} className="sor-btn-icon p-1 rounded hover:bg-[var(--color-bgSecondary)]"><Edit size={14} /></button>
                          <button onClick={() => creds.remove(c.id)} title={t("common.delete")} className="sor-btn-icon p-1 rounded hover:bg-error/10 text-error"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ===== Expiring Soon ===== */}
        {tab === "expiring" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-[var(--color-textSecondary)]">{t("credentials.withinDays")}</label>
              <input type="number" value={expiringDays} onChange={(e) => setExpiringDays(Number(e.target.value))} min={1} max={365} className="sor-input w-20 rounded border border-[var(--color-border)] bg-[var(--color-bgSecondary)] px-2 py-1 text-xs text-[var(--color-textPrimary)]" />
            </div>
            {expiringSoon.length === 0 ? (
              <div className="sor-empty flex flex-col items-center justify-center h-32 text-[var(--color-textSecondary)]">
                <Check size={24} className="mb-2 text-success" />
                <p className="text-sm">{t("credentials.noneExpiring")}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {expiringSoon.map((c) => (
                  <li key={c.id} className="sor-expiring-item flex items-center justify-between rounded border border-warning/30 bg-warning/5 px-4 py-2">
                    <div>
                      <p className="text-sm font-medium text-warning">{c.label}</p>
                      <p className="text-xs text-[var(--color-textSecondary)]">{c.connectionName} — expires {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "?"}</p>
                    </div>
                    <button onClick={() => creds.recordRotation(c.id)} className="sor-btn-primary flex items-center gap-1 rounded px-3 py-1 text-xs bg-warning text-white hover:bg-warning/90">
                      <RotateCw size={12} /> {t("credentials.rotate")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ===== Expired ===== */}
        {tab === "expired" && (
          expiredList.length === 0 ? (
            <div className="sor-empty flex flex-col items-center justify-center h-32 text-[var(--color-textSecondary)]">
              <Check size={24} className="mb-2 text-success" />
              <p className="text-sm">{t("credentials.noneExpired")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {expiredList.map((c) => (
                <li key={c.id} className="sor-expired-item flex items-center justify-between rounded border border-error/30 bg-error/5 px-4 py-2">
                  <div>
                    <p className="text-sm font-medium text-error">{c.label}</p>
                    <p className="text-xs text-[var(--color-textSecondary)]">{c.connectionName} — expired {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : ""}</p>
                  </div>
                  <button onClick={() => creds.recordRotation(c.id)} className="sor-btn-primary flex items-center gap-1 rounded px-3 py-1 text-xs bg-error text-white hover:bg-error/90">
                    <RotateCw size={12} /> {t("credentials.rotateNow")}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {/* ===== Groups ===== */}
        {tab === "groups" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{t("credentials.groups.title")}</h3>
              <button onClick={() => { const name = prompt(t("credentials.groups.namePrompt")); if (name) creds.createGroup(name, ""); }} className="sor-btn-primary flex items-center gap-1 rounded px-3 py-1.5 text-xs bg-primary text-white hover:bg-primary/90">
                <Plus size={14} /> {t("credentials.groups.create")}
              </button>
            </div>
            {creds.groups.length === 0 ? (
              <div className="sor-empty flex flex-col items-center justify-center h-32 text-[var(--color-textSecondary)]">
                <Users size={24} className="mb-2 opacity-40" />
                <p className="text-sm">{t("credentials.groups.empty")}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {creds.groups.map((g) => {
                  const expanded = expandedGroups.has(g.id);
                  const members = creds.credentials.filter((c) => g.credentialIds.includes(c.id));
                  return (
                    <li key={g.id} className="sor-group-card border border-[var(--color-border)] rounded">
                      <div className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-[var(--color-bgSecondary)]" onClick={() => toggleGroupExpand(g.id)}>
                        <div className="flex items-center gap-2">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="text-sm font-medium">{g.name}</span>
                          <span className="sor-badge rounded-full bg-[var(--color-bgSecondary)] px-2 py-0.5 text-xs text-[var(--color-textSecondary)]">{g.credentialIds.length} members</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); creds.deleteGroup(g.id); }} className="sor-btn-icon p-1 rounded hover:bg-error/10 text-error"><Trash2 size={14} /></button>
                      </div>
                      {expanded && (
                        <div className="px-4 pb-3 border-t border-[var(--color-border)]">
                          {members.length === 0 ? (
                            <p className="text-xs text-[var(--color-textSecondary)] py-2">{t("credentials.groups.noMembers")}</p>
                          ) : (
                            <ul className="mt-2 space-y-1">
                              {members.map((m) => (
                                <li key={m.id} className="flex items-center justify-between text-xs text-[var(--color-textSecondary)] py-1">
                                  <span>{m.label} ({m.connectionName})</span>
                                  <button onClick={() => creds.removeFromGroup(g.id, m.id)} className="sor-btn-icon p-0.5 rounded hover:bg-error/10 text-error"><X size={12} /></button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="mt-2">
                            <Select
                              value=""
                              onChange={(v) => { if (v) creds.addToGroup(g.id, v); }}
                              variant="form-sm"
                              options={[
                                { value: "", label: t("credentials.groups.addMember") },
                                ...creds.credentials.filter((c) => !g.credentialIds.includes(c.id)).map((c) => ({
                                  value: c.id,
                                  label: c.label,
                                })),
                              ]}
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* ===== Policies ===== */}
        {tab === "policies" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{t("credentials.policies.title")}</h3>
              <button onClick={() => { const name = prompt(t("credentials.policies.namePrompt")); if (name) creds.addPolicy({ name, kind: "password", maxAgeDays: 90, warningDays: 14, requireMinStrength: "fair", minLength: 12, requireUppercase: true, requireLowercase: true, requireDigits: true, requireSpecial: false, forbidReuse: 3, enabled: true }); }} className="sor-btn-primary flex items-center gap-1 rounded px-3 py-1.5 text-xs bg-primary text-white hover:bg-primary/90">
                <Plus size={14} /> {t("credentials.policies.create")}
              </button>
            </div>
            {creds.policies.length === 0 ? (
              <div className="sor-empty flex flex-col items-center justify-center h-32 text-[var(--color-textSecondary)]">
                <FileText size={24} className="mb-2 opacity-40" />
                <p className="text-sm">{t("credentials.policies.empty")}</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {creds.policies.map((p) => (
                  <div key={p.id} className="sor-policy-card border border-[var(--color-border)] rounded p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium">{p.name}</h4>
                      <div className="flex items-center gap-1">
                        <span className={`sor-badge rounded-full px-2 py-0.5 text-xs ${p.enabled ? "bg-success/15 text-success" : "bg-[var(--color-bgSecondary)] text-[var(--color-textSecondary)]"}`}>
                          {p.enabled ? t("common.enabled") : t("common.disabled")}
                        </span>
                        <button onClick={() => creds.removePolicy(p.id)} className="sor-btn-icon p-1 rounded hover:bg-error/10 text-error"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.kind")}</dt>
                      <dd>{p.kind.replace(/_/g, " ")}</dd>
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.maxAge")}</dt>
                      <dd>{p.maxAgeDays} days</dd>
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.warning")}</dt>
                      <dd>{p.warningDays} days</dd>
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.minStrength")}</dt>
                      <dd>{p.requireMinStrength.replace(/_/g, " ")}</dd>
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.minLength")}</dt>
                      <dd>{p.minLength} chars</dd>
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.rules")}</dt>
                      <dd className="flex flex-wrap gap-1">
                        {p.requireUppercase && <span className="sor-rule-tag rounded bg-[var(--color-bgSecondary)] px-1">A-Z</span>}
                        {p.requireLowercase && <span className="sor-rule-tag rounded bg-[var(--color-bgSecondary)] px-1">a-z</span>}
                        {p.requireDigits && <span className="sor-rule-tag rounded bg-[var(--color-bgSecondary)] px-1">0-9</span>}
                        {p.requireSpecial && <span className="sor-rule-tag rounded bg-[var(--color-bgSecondary)] px-1">!@#</span>}
                      </dd>
                      <dt className="text-[var(--color-textSecondary)]">{t("credentials.policies.forbidReuse")}</dt>
                      <dd>{p.forbidReuse} prior</dd>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== Audit Log ===== */}
        {tab === "audit" && (
          creds.auditLog.length === 0 ? (
            <div className="sor-empty flex flex-col items-center justify-center h-32 text-[var(--color-textSecondary)]">
              <Clock size={24} className="mb-2 opacity-40" />
              <p className="text-sm">{t("credentials.audit.empty")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {creds.auditLog.map((entry) => {
                const cred = creds.credentials.find((c) => c.id === entry.credentialId);
                return (
                  <div key={entry.id} className="sor-audit-entry flex items-start gap-3 border-b border-[var(--color-border)] py-2">
                    <span className="text-xs text-[var(--color-textSecondary)] whitespace-nowrap min-w-[140px]">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                    <span className="sor-audit-action rounded bg-[var(--color-bgSecondary)] px-1.5 py-0.5 text-xs font-medium min-w-[80px] text-center">
                      {entry.action}
                    </span>
                    <span className="text-xs text-[var(--color-textPrimary)] font-medium">
                      {cred?.label ?? entry.credentialId.slice(0, 8)}
                    </span>
                    <span className="text-xs text-[var(--color-textSecondary)] flex-1 truncate">
                      {entry.details}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ---------- dialogs ---------- */}
      {showDialog && (
        <CredentialDialog
          credential={editingCred}
          onSave={handleSave}
          onClose={() => { setShowDialog(false); setEditingCred(null); }}
        />
      )}

      {duplicates !== null && (
        <DuplicatesPanel
          groups={duplicates}
          credentials={creds.credentials}
          onClose={() => setDuplicates(null)}
        />
      )}
    </div>
  );
}

export default CredentialManager;
