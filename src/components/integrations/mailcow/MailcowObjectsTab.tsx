// mailcow "Domains, Mailboxes & Aliases" tab (t42-mailcow-c1).
//
// Provisioning surface (the "Mail Setup" half of the mailcow admin UI): Domains,
// Mailboxes, Aliases, Domain aliases, DKIM, Resources and App passwords. Binds all
// 35 provisioning `mailcow_*` commands through `useMailcowObjects` /
// `mailcowObjectsApi`. A category tab per the shell contract — mounted only once
// the shell holds a live connection, so `connectionId` is always usable and is
// passed as the `id` arg to every command.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MailcowTabProps } from "./registry";
import type {
  MailcowAlias,
  MailcowAppPassword,
  MailcowDomain,
  MailcowDomainAlias,
  MailcowMailbox,
  MailcowResource,
} from "../../../types/mailcow/objects";
import { useMailcowObjects } from "../../../hooks/integration/mailcow/useMailcowObjects";

// ─── Shared primitives ─────────────────────────────────────────────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-60";
const primaryBtnCls =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

const tk = (key: string) => `integrations.mailcow.objects.${key}`;

type Obj = ReturnType<typeof useMailcowObjects>;

/** Side drawer showing a formatted JSON payload (a fetched domain/mailbox/alias
 *  detail, a generated DKIM key, a resource …). */
const JsonDrawer: React.FC<{
  title: string;
  data: unknown;
  onClose: () => void;
}> = ({ title, data, onClose }) => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {title}
        </span>
        <button onClick={onClose} className={btnCls} title={t(tk("close"), "Close")}>
          <X size={14} />
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-[var(--color-textSecondary)]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

// ─── Form modal ─────────────────────────────────────────────────────────────────

type FieldType = "text" | "password" | "number" | "checkbox" | "select" | "textarea";

interface FieldSpec {
  key: string;
  label: string;
  type?: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | boolean;
}

type FormValues = Record<string, string | boolean>;

/** Small labelled-input form modal. Produces a flat `FormValues` record the
 *  caller shapes into a typed request. Numeric fields come back as strings and
 *  are parsed at the call site. */
const FormModal: React.FC<{
  title: string;
  fields: FieldSpec[];
  submitLabel: string;
  onSubmit: (values: FormValues) => void | Promise<void>;
  onClose: () => void;
}> = ({ title, fields, submitLabel, onSubmit, onClose }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<FormValues>(() => {
    const init: FormValues = {};
    for (const f of fields) {
      init[f.key] =
        f.defaultValue ??
        (f.type === "checkbox"
          ? false
          : f.type === "select"
            ? (f.options?.[0]?.value ?? "")
            : "");
    }
    return init;
  });
  const [busy, setBusy] = useState(false);

  const set = useCallback(
    (key: string, v: string | boolean) =>
      setValues((prev) => ({ ...prev, [key]: v })),
    [],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  }, [values, onSubmit]);

  const canSubmit = fields.every(
    (f) =>
      !f.required ||
      (typeof values[f.key] === "string" &&
        (values[f.key] as string).trim() !== ""),
  );

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-full w-full max-w-md flex-col rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {title}
          </span>
          <button onClick={onClose} className={btnCls}>
            <X size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {fields.map((f) =>
            f.type === "checkbox" ? (
              <label
                key={f.key}
                className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]"
              >
                <input
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) => set(f.key, e.target.checked)}
                />
                {f.label}
              </label>
            ) : (
              <label
                key={f.key}
                className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]"
              >
                {f.label}
                {f.type === "select" ? (
                  <select
                    className={inputCls}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    className={`${inputCls} min-h-[6rem] font-mono`}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    type={f.type === "password" ? "password" : "text"}
                    inputMode={f.type === "number" ? "numeric" : undefined}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </label>
            ),
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <button onClick={onClose} className={btnCls} disabled={busy}>
            {t(tk("cancel"), "Cancel")}
          </button>
          <button
            onClick={submit}
            className={primaryBtnCls}
            disabled={busy || !canSubmit}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Section chrome ──────────────────────────────────────────────────────────────

const SectionBar: React.FC<{
  count?: number;
  isLoading: boolean;
  onRefresh: () => void;
  onNew?: () => void;
  newLabel?: string;
  children?: React.ReactNode;
}> = ({ count, isLoading, onRefresh, onNew, newLabel, children }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
      {children}
      <div className="ml-auto flex items-center gap-2">
        {count != null && (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t(tk("count"), "{{count}} items", { count })}
          </span>
        )}
        <button onClick={onRefresh} className={btnCls} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t(tk("refresh"), "Refresh")}
        </button>
        {onNew && (
          <button onClick={onNew} className={primaryBtnCls}>
            <Plus size={12} />
            {newLabel ?? t(tk("new"), "New")}
          </button>
        )}
      </div>
    </div>
  );
};

interface TableRow {
  id: string;
  cells: string[];
  onDelete?: () => void;
  deleteTitle?: string;
  extra?: Array<{ label: string; onClick: () => void }>;
}

const DataTable: React.FC<{ columns: string[]; rows: TableRow[] }> = ({
  columns,
  rows,
}) => {
  const { t } = useTranslation();
  if (rows.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--color-textSecondary)]">
        {t(tk("empty"), "No records.")}
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-[var(--color-surface)]">
          <tr className="text-left text-xs text-[var(--color-textMuted)]">
            {columns.map((c) => (
              <th key={c} className="px-3 py-1.5 font-medium">
                {c}
              </th>
            ))}
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
            >
              {r.cells.map((cell, i) => (
                <td key={i} className="px-3 py-1.5 text-[var(--color-text)]">
                  {cell}
                </td>
              ))}
              <td className="px-3 py-1.5">
                <div className="flex items-center justify-end gap-1">
                  {r.extra?.map((x) => (
                    <button key={x.label} onClick={x.onClick} className={btnCls}>
                      {x.label}
                    </button>
                  ))}
                  {r.onDelete && (
                    <button
                      onClick={r.onDelete}
                      className={btnCls}
                      title={r.deleteTitle ?? t(tk("delete"), "Delete")}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Shared per-section frame: error banner + drawer/modal overlay slots. */
interface Overlay {
  drawer: { title: string; data: unknown } | null;
  modal: React.ReactNode | null;
}

const SectionLayout: React.FC<{
  overlay: Overlay;
  setOverlay: React.Dispatch<React.SetStateAction<Overlay>>;
  error: string | null;
  children: React.ReactNode;
}> = ({ overlay, setOverlay, error, children }) => (
  <div className="relative flex min-h-0 flex-1">
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p className="border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          {error}
        </p>
      )}
      {children}
    </div>
    {overlay.modal}
    {overlay.drawer && (
      <JsonDrawer
        title={overlay.drawer.title}
        data={overlay.drawer.data}
        onClose={() => setOverlay((s) => ({ ...s, drawer: null }))}
      />
    )}
  </div>
);

function useOverlay() {
  const [overlay, setOverlay] = useState<Overlay>({ drawer: null, modal: null });
  const closeModal = useCallback(
    () => setOverlay((s) => ({ ...s, modal: null })),
    [],
  );
  const openDrawer = useCallback(
    (title: string, data: unknown) =>
      setOverlay((s) => ({ ...s, drawer: { title, data } })),
    [],
  );
  return { overlay, setOverlay, closeModal, openDrawer };
}

const num = (v: string | boolean): number | undefined => {
  const n = Number(String(v).trim());
  return String(v).trim() !== "" && Number.isFinite(n) ? n : undefined;
};
const str = (v: string | boolean): string => String(v).trim();
const optStr = (v: string | boolean): string | undefined =>
  str(v) === "" ? undefined : str(v);
const bool = (v: string | boolean): boolean => Boolean(v);
const yn = (v: boolean): string => (v ? "✓" : "✗");

// ─── Domains ─────────────────────────────────────────────────────────────────────

const DomainsSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [rows, setRows] = useState<MailcowDomain[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    const res = await run((id) => api.listDomains(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = useCallback(
    async (domain: string) => {
      const res = await run((id) => api.getDomain(id, domain));
      if (res) openDrawer(domain, res);
    },
    [run, api, openDrawer],
  );

  const create = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("domains.new"), "New domain")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "domain", label: t(tk("domains.domain"), "Domain"), required: true, placeholder: "example.com" },
            { key: "description", label: t(tk("domains.description"), "Description") },
            { key: "mailboxes", label: t(tk("domains.maxMailboxes"), "Max mailboxes"), type: "number", defaultValue: "10" },
            { key: "aliases", label: t(tk("domains.maxAliases"), "Max aliases"), type: "number", defaultValue: "400" },
            { key: "max_quota", label: t(tk("domains.maxQuotaBytes"), "Max quota (bytes)"), type: "number", defaultValue: "1073741824" },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createDomain(id, {
                domain: str(v.domain),
                description: optStr(v.description),
                mailboxes: num(v.mailboxes),
                aliases: num(v.aliases),
                max_quota: num(v.max_quota),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const edit = (d: MailcowDomain) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("domains.edit"), "Edit domain")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            { key: "description", label: t(tk("domains.description"), "Description"), defaultValue: d.description },
            { key: "mailboxes", label: t(tk("domains.maxMailboxes"), "Max mailboxes"), type: "number", defaultValue: String(d.max_mailboxes) },
            { key: "aliases", label: t(tk("domains.maxAliases"), "Max aliases"), type: "number", defaultValue: String(d.max_aliases) },
            { key: "max_quota", label: t(tk("domains.maxQuotaBytes"), "Max quota (bytes)"), type: "number", defaultValue: String(d.max_quota) },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: d.active },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.updateDomain(id, d.domain_name, {
                description: optStr(v.description),
                mailboxes: num(v.mailboxes),
                aliases: num(v.aliases),
                max_quota: num(v.max_quota),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const remove = useCallback(
    async (domain: string) => {
      await run((id) => api.deleteDomain(id, domain));
      void load();
    },
    [run, api, load],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={create}
        newLabel={t(tk("domains.new"), "New domain")}
      />
      <DataTable
        columns={[
          t(tk("domains.domain"), "Domain"),
          t(tk("domains.mailboxes"), "Mailboxes"),
          t(tk("domains.aliases"), "Aliases"),
          t(tk("active"), "Active"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.domain_name}-${i}`,
          cells: [
            r.domain_name,
            `${r.mailboxes} / ${r.max_mailboxes}`,
            `${r.aliases} / ${r.max_aliases}`,
            yn(r.active),
          ],
          onDelete: () => remove(r.domain_name),
          extra: [
            { label: t(tk("view"), "View"), onClick: () => detail(r.domain_name) },
            { label: t(tk("edit"), "Edit"), onClick: () => edit(r) },
          ],
        }))}
      />
    </SectionLayout>
  );
};

// ─── Mailboxes ───────────────────────────────────────────────────────────────────

const MailboxesSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [rows, setRows] = useState<MailcowMailbox[]>([]);
  const [domain, setDomain] = useState("");
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    const d = domain.trim();
    const res = await run((id) =>
      d ? api.listMailboxesByDomain(id, d) : api.listMailboxes(id),
    );
    if (res) setRows(res);
  }, [run, api, domain]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detail = useCallback(
    async (username: string) => {
      const res = await run((id) => api.getMailbox(id, username));
      if (res) openDrawer(username, res);
    },
    [run, api, openDrawer],
  );

  const create = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("mailboxes.new"), "New mailbox")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "local_part", label: t(tk("mailboxes.localPart"), "Local part"), required: true, placeholder: "john" },
            { key: "domain", label: t(tk("mailboxes.domain"), "Domain"), required: true, defaultValue: domain, placeholder: "example.com" },
            { key: "name", label: t(tk("mailboxes.name"), "Full name"), required: true },
            { key: "password", label: t(tk("mailboxes.password"), "Password"), type: "password", required: true },
            { key: "quota", label: t(tk("mailboxes.quotaBytes"), "Quota (bytes)"), type: "number", defaultValue: "1073741824" },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: true },
            { key: "force_pw_update", label: t(tk("mailboxes.forcePwUpdate"), "Force password change at next login"), type: "checkbox" },
            { key: "tls_enforce_in", label: t(tk("mailboxes.tlsIn"), "Enforce TLS inbound"), type: "checkbox" },
            { key: "tls_enforce_out", label: t(tk("mailboxes.tlsOut"), "Enforce TLS outbound"), type: "checkbox" },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createMailbox(id, {
                local_part: str(v.local_part),
                domain: str(v.domain),
                name: str(v.name),
                password: str(v.password),
                quota: num(v.quota),
                active: bool(v.active),
                force_pw_update: bool(v.force_pw_update),
                tls_enforce_in: bool(v.tls_enforce_in),
                tls_enforce_out: bool(v.tls_enforce_out),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const edit = (m: MailcowMailbox) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("mailboxes.edit"), "Edit mailbox")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            { key: "name", label: t(tk("mailboxes.name"), "Full name"), defaultValue: m.name },
            { key: "password", label: t(tk("mailboxes.newPassword"), "New password (leave blank to keep)"), type: "password" },
            { key: "quota", label: t(tk("mailboxes.quotaBytes"), "Quota (bytes)"), type: "number", defaultValue: String(m.quota) },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: m.active },
            { key: "force_pw_update", label: t(tk("mailboxes.forcePwUpdate"), "Force password change at next login"), type: "checkbox", defaultValue: false },
            { key: "tls_enforce_in", label: t(tk("mailboxes.tlsIn"), "Enforce TLS inbound"), type: "checkbox", defaultValue: m.tls_enforce_in },
            { key: "tls_enforce_out", label: t(tk("mailboxes.tlsOut"), "Enforce TLS outbound"), type: "checkbox", defaultValue: m.tls_enforce_out },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.updateMailbox(id, m.username, {
                name: optStr(v.name),
                password: optStr(v.password),
                quota: num(v.quota),
                active: bool(v.active),
                force_pw_update: bool(v.force_pw_update),
                tls_enforce_in: bool(v.tls_enforce_in),
                tls_enforce_out: bool(v.tls_enforce_out),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const pushover = (username: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("mailboxes.pushover"), "Pushover setup")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            {
              key: "config",
              label: t(tk("mailboxes.pushoverConfig"), "Config (JSON)"),
              type: "textarea",
              defaultValue: '{\n  "active": 1,\n  "key": "",\n  "token": ""\n}',
            },
          ]}
          onSubmit={async (v) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(str(v.config));
            } catch {
              obj.setError(t(tk("mailboxes.pushoverBadJson"), "Pushover config is not valid JSON."));
              return;
            }
            await run((id) => api.pushoverSetup(id, username, parsed));
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const toggleNotifications = useCallback(
    async (username: string, enable: boolean) => {
      await run((id) => api.quarantineNotifications(id, username, enable));
    },
    [run, api],
  );

  const remove = useCallback(
    async (username: string) => {
      await run((id) => api.deleteMailbox(id, username));
      void load();
    },
    [run, api, load],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={create}
        newLabel={t(tk("mailboxes.new"), "New mailbox")}
      >
        <input
          className={`${inputCls} w-52`}
          placeholder={t(tk("mailboxes.filterDomain"), "Filter by domain (blank = all)")}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t(tk("apply"), "Apply")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(tk("mailboxes.username"), "Username"),
          t(tk("mailboxes.name"), "Name"),
          t(tk("mailboxes.usage"), "Usage"),
          t(tk("active"), "Active"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.username}-${i}`,
          cells: [
            r.username,
            r.name || "—",
            `${r.percent_in_use}%`,
            yn(r.active),
          ],
          onDelete: () => remove(r.username),
          extra: [
            { label: t(tk("view"), "View"), onClick: () => detail(r.username) },
            { label: t(tk("edit"), "Edit"), onClick: () => edit(r) },
            {
              label: t(tk("mailboxes.notifyOn"), "Notify on"),
              onClick: () => toggleNotifications(r.username, true),
            },
            {
              label: t(tk("mailboxes.notifyOff"), "Notify off"),
              onClick: () => toggleNotifications(r.username, false),
            },
            { label: t(tk("mailboxes.pushover"), "Pushover"), onClick: () => pushover(r.username) },
          ],
        }))}
      />
    </SectionLayout>
  );
};

// ─── Aliases ─────────────────────────────────────────────────────────────────────

const AliasesSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [rows, setRows] = useState<MailcowAlias[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    const res = await run((id) => api.listAliases(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = useCallback(
    async (aliasId: number, label: string) => {
      const res = await run((id) => api.getAlias(id, aliasId));
      if (res) openDrawer(label, res);
    },
    [run, api, openDrawer],
  );

  const create = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("aliases.new"), "New alias")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "address", label: t(tk("aliases.address"), "Address"), required: true, placeholder: "info@example.com" },
            { key: "goto", label: t(tk("aliases.goto"), "Goto (comma-separated)"), required: true, placeholder: "john@example.com" },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createAlias(id, {
                address: str(v.address),
                goto: str(v.goto),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const edit = (a: MailcowAlias) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("aliases.edit"), "Edit alias")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            { key: "address", label: t(tk("aliases.address"), "Address"), defaultValue: a.address },
            { key: "goto", label: t(tk("aliases.goto"), "Goto (comma-separated)"), defaultValue: a.goto },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: a.active },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.updateAlias(id, a.id, {
                address: optStr(v.address),
                goto: optStr(v.goto),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const remove = useCallback(
    async (aliasId: number) => {
      await run((id) => api.deleteAlias(id, aliasId));
      void load();
    },
    [run, api, load],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={create}
        newLabel={t(tk("aliases.new"), "New alias")}
      />
      <DataTable
        columns={[
          t(tk("aliases.address"), "Address"),
          t(tk("aliases.goto"), "Goto"),
          t(tk("active"), "Active"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.id}-${i}`,
          cells: [r.address, r.goto, yn(r.active)],
          onDelete: () => remove(r.id),
          extra: [
            { label: t(tk("view"), "View"), onClick: () => detail(r.id, r.address) },
            { label: t(tk("edit"), "Edit"), onClick: () => edit(r) },
          ],
        }))}
      />
    </SectionLayout>
  );
};

// ─── Domain aliases ────────────────────────────────────────────────────────────────

const DomainAliasesSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [rows, setRows] = useState<MailcowDomainAlias[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    const res = await run((id) => api.listDomainAliases(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = useCallback(
    async (aliasDomain: string) => {
      const res = await run((id) => api.getDomainAlias(id, aliasDomain));
      if (res) openDrawer(aliasDomain, res);
    },
    [run, api, openDrawer],
  );

  const create = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("domainAliases.new"), "New domain alias")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "alias_domain", label: t(tk("domainAliases.aliasDomain"), "Alias domain"), required: true, placeholder: "alias.example.com" },
            { key: "target_domain", label: t(tk("domainAliases.targetDomain"), "Target domain"), required: true, placeholder: "example.com" },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createDomainAlias(id, {
                alias_domain: str(v.alias_domain),
                target_domain: str(v.target_domain),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const toggle = useCallback(
    async (aliasDomain: string, active: boolean) => {
      await run((id) => api.updateDomainAlias(id, aliasDomain, active));
      void load();
    },
    [run, api, load],
  );

  const remove = useCallback(
    async (aliasDomain: string) => {
      await run((id) => api.deleteDomainAlias(id, aliasDomain));
      void load();
    },
    [run, api, load],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={create}
        newLabel={t(tk("domainAliases.new"), "New domain alias")}
      />
      <DataTable
        columns={[
          t(tk("domainAliases.aliasDomain"), "Alias domain"),
          t(tk("domainAliases.targetDomain"), "Target domain"),
          t(tk("active"), "Active"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.alias_domain}-${i}`,
          cells: [r.alias_domain, r.target_domain, yn(r.active)],
          onDelete: () => remove(r.alias_domain),
          extra: [
            { label: t(tk("view"), "View"), onClick: () => detail(r.alias_domain) },
            {
              label: r.active ? t(tk("disable"), "Disable") : t(tk("enable"), "Enable"),
              onClick: () => toggle(r.alias_domain, !r.active),
            },
          ],
        }))}
      />
    </SectionLayout>
  );
};

// ─── DKIM ────────────────────────────────────────────────────────────────────────

const DkimSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [domain, setDomain] = useState("");
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const lookup = useCallback(async () => {
    const d = domain.trim();
    if (!d) return;
    const res = await run((id) => api.getDkim(id, d));
    if (res) openDrawer(t(tk("dkim.keyFor"), "DKIM key — {{domain}}", { domain: d }), res);
  }, [run, api, domain, openDrawer, t]);

  const generate = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("dkim.generate"), "Generate DKIM key")}
          submitLabel={t(tk("dkim.generateBtn"), "Generate")}
          fields={[
            { key: "domains", label: t(tk("dkim.domains"), "Domains (comma-separated)"), required: true, defaultValue: domain },
            { key: "dkim_selector", label: t(tk("dkim.selector"), "Selector"), defaultValue: "dkim" },
            { key: "key_size", label: t(tk("dkim.keySize"), "Key size"), type: "select", options: [
              { value: "1024", label: "1024" },
              { value: "2048", label: "2048" },
              { value: "4096", label: "4096" },
            ] },
          ]}
          onSubmit={async (v) => {
            const domains = str(v.domains)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
            await run((id) =>
              api.generateDkim(id, {
                domains,
                dkim_selector: optStr(v.dkim_selector),
                key_size: num(v.key_size),
              }),
            );
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const duplicate = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("dkim.duplicate"), "Duplicate DKIM key")}
          submitLabel={t(tk("dkim.duplicateBtn"), "Duplicate")}
          fields={[
            { key: "src_domain", label: t(tk("dkim.srcDomain"), "Source domain"), required: true, defaultValue: domain },
            { key: "dst_domain", label: t(tk("dkim.dstDomain"), "Destination domain"), required: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.duplicateDkim(id, str(v.src_domain), str(v.dst_domain)),
            );
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const remove = useCallback(async () => {
    const d = domain.trim();
    if (!d) return;
    await run((id) => api.deleteDkim(id, d));
  }, [run, api, domain]);

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar isLoading={isLoading} onRefresh={lookup}>
        <input
          className={`${inputCls} w-52`}
          placeholder={t(tk("dkim.domain"), "Domain")}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
        />
        <button onClick={lookup} className={btnCls} disabled={!domain.trim()}>
          {t(tk("dkim.lookup"), "Show key")}
        </button>
        <button onClick={generate} className={primaryBtnCls}>
          <Plus size={12} />
          {t(tk("dkim.generate"), "Generate")}
        </button>
        <button onClick={duplicate} className={btnCls}>
          {t(tk("dkim.duplicate"), "Duplicate")}
        </button>
        <button onClick={remove} className={btnCls} disabled={!domain.trim()}>
          <Trash2 size={12} />
          {t(tk("dkim.delete"), "Delete key")}
        </button>
      </SectionBar>
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-textSecondary)]">
        {t(
          tk("dkim.hint"),
          "Enter a domain and choose Show key to view its DKIM record, or Generate to create one.",
        )}
      </div>
    </SectionLayout>
  );
};

// ─── Resources ─────────────────────────────────────────────────────────────────────

const RESOURCE_KINDS = ["location", "group", "thing"];

const ResourcesSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [rows, setRows] = useState<MailcowResource[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    const res = await run((id) => api.listResources(id));
    if (res) setRows(res);
  }, [run, api]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = useCallback(
    async (name: string) => {
      const res = await run((id) => api.getResource(id, name));
      if (res) openDrawer(name, res);
    },
    [run, api, openDrawer],
  );

  const kindOptions = RESOURCE_KINDS.map((k) => ({ value: k, label: k }));

  const create = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("resources.new"), "New resource")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "name", label: t(tk("resources.name"), "Name"), required: true },
            { key: "domain", label: t(tk("resources.domain"), "Domain"), required: true },
            { key: "kind", label: t(tk("resources.kind"), "Kind"), type: "select", options: kindOptions },
            { key: "description", label: t(tk("resources.description"), "Description") },
            { key: "multiple_bookings", label: t(tk("resources.multipleBookings"), "Allow multiple bookings"), type: "checkbox" },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createResource(id, {
                name: str(v.name),
                domain: str(v.domain),
                kind: str(v.kind),
                description: optStr(v.description),
                multiple_bookings: bool(v.multiple_bookings),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const edit = (r: MailcowResource) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("resources.edit"), "Edit resource")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            { key: "domain", label: t(tk("resources.domain"), "Domain"), required: true, defaultValue: r.domain },
            { key: "kind", label: t(tk("resources.kind"), "Kind"), type: "select", options: kindOptions, defaultValue: r.kind },
            { key: "description", label: t(tk("resources.description"), "Description"), defaultValue: r.description },
            { key: "multiple_bookings", label: t(tk("resources.multipleBookings"), "Allow multiple bookings"), type: "checkbox", defaultValue: r.multiple_bookings },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: r.active },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.updateResource(id, r.name, {
                name: r.name,
                domain: str(v.domain),
                kind: str(v.kind),
                description: optStr(v.description),
                multiple_bookings: bool(v.multiple_bookings),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const remove = useCallback(
    async (name: string) => {
      await run((id) => api.deleteResource(id, name));
      void load();
    },
    [run, api, load],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={create}
        newLabel={t(tk("resources.new"), "New resource")}
      />
      <DataTable
        columns={[
          t(tk("resources.name"), "Name"),
          t(tk("resources.kind"), "Kind"),
          t(tk("resources.domain"), "Domain"),
          t(tk("active"), "Active"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.name}-${i}`,
          cells: [r.name, r.kind, r.domain, yn(r.active)],
          onDelete: () => remove(r.name),
          extra: [
            { label: t(tk("view"), "View"), onClick: () => detail(r.name) },
            { label: t(tk("edit"), "Edit"), onClick: () => edit(r) },
          ],
        }))}
      />
    </SectionLayout>
  );
};

// ─── App passwords ─────────────────────────────────────────────────────────────────

const AppPasswordsSection: React.FC<{ obj: Obj }> = ({ obj }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = obj;
  const [rows, setRows] = useState<MailcowAppPassword[]>([]);
  const [username, setUsername] = useState("");
  const { overlay, setOverlay, closeModal } = useOverlay();

  const load = useCallback(async () => {
    const u = username.trim();
    if (!u) return;
    const res = await run((id) => api.listAppPasswords(id, u));
    if (res) setRows(res);
  }, [run, api, username]);

  const create = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("appPasswords.new"), "New app password")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "username", label: t(tk("appPasswords.mailbox"), "Mailbox"), required: true, defaultValue: username },
            { key: "name", label: t(tk("appPasswords.name"), "Name"), required: true, placeholder: "Thunderbird" },
            { key: "password", label: t(tk("appPasswords.password"), "Password"), type: "password", required: true },
            { key: "active", label: t(tk("active"), "Active"), type: "checkbox", defaultValue: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createAppPassword(id, {
                username: str(v.username),
                name: str(v.name),
                password: str(v.password),
                active: bool(v.active),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const remove = useCallback(
    async (appPasswordId: number) => {
      await run((id) => api.deleteAppPassword(id, appPasswordId));
      void load();
    },
    [run, api, load],
  );

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={create}
        newLabel={t(tk("appPasswords.new"), "New app password")}
      >
        <input
          className={`${inputCls} w-52`}
          placeholder={t(tk("appPasswords.mailbox"), "Mailbox (user@example.com)")}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls} disabled={!username.trim()}>
          {t(tk("apply"), "Apply")}
        </button>
      </SectionBar>
      {!username.trim() ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-textSecondary)]">
          {t(tk("appPasswords.hint"), "Enter a mailbox to list its app passwords.")}
        </div>
      ) : (
        <DataTable
          columns={[
            t(tk("appPasswords.name"), "Name"),
            t(tk("active"), "Active"),
            t(tk("appPasswords.created"), "Created"),
          ]}
          rows={rows.map((r, i) => ({
            id: `${r.id}-${i}`,
            cells: [r.name || "—", yn(r.active), r.created || "—"],
            onDelete: () => remove(r.id),
          }))}
        />
      )}
    </SectionLayout>
  );
};

// ─── Root tab ────────────────────────────────────────────────────────────────────

type GroupKey =
  | "domains"
  | "mailboxes"
  | "aliases"
  | "domainAliases"
  | "dkim"
  | "resources"
  | "appPasswords";

const GROUPS: Array<{ key: GroupKey; icon: typeof Globe; label: string }> = [
  { key: "domains", icon: Globe, label: "Domains" },
  { key: "mailboxes", icon: Mail, label: "Mailboxes" },
  { key: "aliases", icon: AtSign, label: "Aliases" },
  { key: "domainAliases", icon: Network, label: "Domain aliases" },
  { key: "dkim", icon: ShieldCheck, label: "DKIM" },
  { key: "resources", icon: Users, label: "Resources" },
  { key: "appPasswords", icon: KeyRound, label: "App passwords" },
];

const MailcowObjectsTab: React.FC<MailcowTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const obj = useMailcowObjects(connectionId);
  const [group, setGroup] = useState<GroupKey>("domains");

  const groupLabel = useMemo(
    () => ({
      domains: t(tk("groups.domains"), "Domains"),
      mailboxes: t(tk("groups.mailboxes"), "Mailboxes"),
      aliases: t(tk("groups.aliases"), "Aliases"),
      domainAliases: t(tk("groups.domainAliases"), "Domain aliases"),
      dkim: t(tk("groups.dkim"), "DKIM"),
      resources: t(tk("groups.resources"), "Resources"),
      appPasswords: t(tk("groups.appPasswords"), "App passwords"),
    }),
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Group nav */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3">
        {GROUPS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setGroup(key)}
            className={`flex items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              group === key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon size={14} />
            {groupLabel[key]}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {group === "domains" && <DomainsSection obj={obj} />}
        {group === "mailboxes" && <MailboxesSection obj={obj} />}
        {group === "aliases" && <AliasesSection obj={obj} />}
        {group === "domainAliases" && <DomainAliasesSection obj={obj} />}
        {group === "dkim" && <DkimSection obj={obj} />}
        {group === "resources" && <ResourcesSection obj={obj} />}
        {group === "appPasswords" && <AppPasswordsSection obj={obj} />}
      </div>
    </div>
  );
};

export default MailcowObjectsTab;
