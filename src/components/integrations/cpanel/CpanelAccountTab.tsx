// cPanel Account Services tab (t42-cpanel-c2).
//
// Single-account management surface: Domains, Email, Databases, Files, SSL, FTP
// and Cron. Binds all 44 account-scope `cpanel_*` commands through
// `useCpanelAccount` / `cpanelAccountApi`. A category tab per the shell contract —
// mounted only once the shell holds a live connection, so `connectionId` is
// always usable. Account-scope commands additionally need a cPanel `user`; this
// tab owns its own account picker (populated from the read-only
// `cpanel_list_accounts`, with a free-text fallback).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  FileText,
  Globe,
  Loader2,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Server,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CpanelTabProps } from "./registry";
import type {
  CpanelDatabase,
  CronJob,
  DatabaseUser,
  DomainInfo,
  EmailAccount,
  FileItem,
  FtpAccount,
  SslCertificate,
} from "../../../types/cpanel/account";
import {
  useCpanelAccount,
  type CpanelAccountRef,
} from "../../../hooks/integration/cpanel/useCpanelAccount";

// ─── Shared primitives ─────────────────────────────────────────────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-60";
const primaryBtnCls =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

const tk = (key: string) => `integrations.cpanel.account.${key}`;

type Acct = ReturnType<typeof useCpanelAccount>;

/** Side drawer showing a formatted JSON payload (spam settings, disk usage,
 *  CSR result, AutoSSL check, FTP sessions …). */
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

type FieldType = "text" | "password" | "number" | "checkbox" | "select";

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

/** Guard rendered by account-scope sections when no user is selected yet. */
const NoUser: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--color-textSecondary)]">
      {t(tk("selectUserHint"), "Select a cPanel account above to manage it.")}
    </div>
  );
};

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

// ─── Domains ─────────────────────────────────────────────────────────────────────

const DomainsSection: React.FC<{ acct: Acct; user: string }> = ({
  acct,
  user,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [rows, setRows] = useState<DomainInfo[]>([]);
  const [allServer, setAllServer] = useState(false);
  const { overlay, setOverlay, closeModal } = useOverlay();

  const load = useCallback(async () => {
    if (!user && !allServer) return;
    const res = await run((id) =>
      allServer ? api.listAllDomains(id) : api.listDomains(id, user),
    );
    if (res) setRows(res);
  }, [run, api, user, allServer]);

  useEffect(() => {
    void load();
  }, [load]);

  const newAddon = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("domains.newAddon"), "New addon domain")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "domain", label: t(tk("domains.domain"), "Domain"), required: true },
            {
              key: "subdomain",
              label: t(tk("domains.subdomain"), "Subdomain"),
              required: true,
            },
            {
              key: "document_root",
              label: t(tk("domains.documentRoot"), "Document root"),
              required: true,
              placeholder: "public_html/example.com",
            },
            {
              key: "password",
              label: t(tk("domains.ftpPassword"), "FTP password (optional)"),
              type: "password",
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createAddonDomain(id, user, {
                domain: str(v.domain),
                subdomain: str(v.subdomain),
                document_root: str(v.document_root),
                password: optStr(v.password),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const newSubdomain = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("domains.newSubdomain"), "New subdomain")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            {
              key: "subdomain",
              label: t(tk("domains.subdomain"), "Subdomain"),
              required: true,
            },
            {
              key: "root_domain",
              label: t(tk("domains.rootDomain"), "Root domain"),
              required: true,
            },
            {
              key: "document_root",
              label: t(tk("domains.documentRoot"), "Document root (optional)"),
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createSubdomain(id, user, {
                subdomain: str(v.subdomain),
                root_domain: str(v.root_domain),
                document_root: optStr(v.document_root),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const park = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("domains.parkDomain"), "Park a domain")}
          submitLabel={t(tk("domains.park"), "Park")}
          fields={[
            { key: "domain", label: t(tk("domains.domain"), "Domain"), required: true },
          ]}
          onSubmit={async (v) => {
            await run((id) => api.parkDomain(id, user, str(v.domain)));
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const removeRow = useCallback(
    async (d: DomainInfo) => {
      await run((id) => {
        switch (d.domain_type) {
          case "addon":
            // Addon removal needs the parked subdomain form (…_<mainuser>); best
            // effort from the domain label when the API omits an explicit field.
            return api.removeAddonDomain(id, user, d.domain, d.domain);
          case "sub":
            return api.removeSubdomain(id, user, d.domain);
          case "parked":
            return api.unparkDomain(id, user, d.domain);
          default:
            return Promise.resolve("");
        }
      });
      void load();
    },
    [run, api, user, load],
  );

  if (!user && !allServer) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <SectionBar isLoading={isLoading} onRefresh={load}>
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={allServer}
              onChange={(e) => setAllServer(e.target.checked)}
            />
            {t(tk("domains.allServer"), "All domains (server-wide)")}
          </label>
        </SectionBar>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={newAddon}
        newLabel={t(tk("domains.newAddon"), "New addon domain")}
      >
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={allServer}
            onChange={(e) => setAllServer(e.target.checked)}
          />
          {t(tk("domains.allServer"), "All domains (server-wide)")}
        </label>
        <button onClick={newSubdomain} className={btnCls}>
          <Plus size={12} />
          {t(tk("domains.newSubdomain"), "Subdomain")}
        </button>
        <button onClick={park} className={btnCls}>
          <Plus size={12} />
          {t(tk("domains.park"), "Park")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(tk("domains.domain"), "Domain"),
          t(tk("domains.type"), "Type"),
          t(tk("domains.documentRoot"), "Document root"),
          t(tk("domains.php"), "PHP"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.domain}-${i}`,
          cells: [
            r.domain,
            r.domain_type,
            r.documentroot ?? "—",
            r.php_version ?? "—",
          ],
          onDelete:
            r.domain_type !== "main" ? () => removeRow(r) : undefined,
          deleteTitle:
            r.domain_type === "parked"
              ? t(tk("domains.unpark"), "Unpark")
              : t(tk("delete"), "Delete"),
        }))}
      />
    </SectionLayout>
  );
};

// ─── Email ───────────────────────────────────────────────────────────────────────

type EmailSub = "accounts" | "forwarders" | "autoresponders" | "lists" | "mx";

const EmailSection: React.FC<{ acct: Acct; user: string }> = ({
  acct,
  user,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [sub, setSub] = useState<EmailSub>("accounts");
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [domain, setDomain] = useState("");
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const loadAccounts = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listEmailAccounts(id, user));
    if (res) setAccounts(res);
  }, [run, api, user]);

  const loadDomainScoped = useCallback(async () => {
    if (!user || !domain.trim()) return;
    const d = domain.trim();
    const res = await run((id) => {
      switch (sub) {
        case "forwarders":
          return api.listForwarders(id, user, d) as Promise<unknown>;
        case "autoresponders":
          return api.listAutoresponders(id, user, d) as Promise<unknown>;
        case "lists":
          return api.listMailingLists(id, user, d) as Promise<unknown>;
        case "mx":
          return api.listMxRecords(id, user, d) as Promise<unknown>;
        default:
          return Promise.resolve([]);
      }
    });
    if (res) setRows(res as Array<Record<string, unknown>>);
  }, [run, api, user, domain, sub]);

  useEffect(() => {
    if (sub === "accounts") void loadAccounts();
    else setRows([]);
  }, [sub, loadAccounts]);

  const newAccount = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("email.newAccount"), "New email account")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            {
              key: "email",
              label: t(tk("email.address"), "Email address"),
              required: true,
              placeholder: "user@example.com",
            },
            {
              key: "password",
              label: t(tk("email.password"), "Password"),
              type: "password",
              required: true,
            },
            {
              key: "quota",
              label: t(tk("email.quotaMb"), "Quota (MB, 0 = unlimited)"),
              type: "number",
            },
            {
              key: "send_welcome",
              label: t(tk("email.sendWelcome"), "Send welcome email"),
              type: "checkbox",
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createEmailAccount(id, user, {
                email: str(v.email),
                password: str(v.password),
                quota: num(v.quota),
                send_welcome: Boolean(v.send_welcome),
              }),
            );
            closeModal();
            void loadAccounts();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const changePassword = (email: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("email.changePassword"), "Change password")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            {
              key: "password",
              label: t(tk("email.password"), "Password"),
              type: "password",
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.changeEmailPassword(id, user, email, str(v.password)),
            );
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const setQuota = (email: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("email.setQuota"), "Set quota")}
          submitLabel={t(tk("save"), "Save")}
          fields={[
            {
              key: "quota",
              label: t(tk("email.quotaMb"), "Quota (MB, 0 = unlimited)"),
              type: "number",
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.setEmailQuota(id, user, email, num(v.quota) ?? 0),
            );
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const deleteAccount = useCallback(
    async (email: string) => {
      await run((id) => api.deleteEmailAccount(id, user, email));
      void loadAccounts();
    },
    [run, api, user, loadAccounts],
  );

  const newForwarder = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("email.newForwarder"), "New forwarder")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            {
              key: "domain",
              label: t(tk("email.domain"), "Domain"),
              required: true,
              defaultValue: domain,
            },
            {
              key: "email",
              label: t(tk("email.sourceAddress"), "Source address"),
              required: true,
              placeholder: "info@example.com",
            },
            {
              key: "fwdopt",
              label: t(tk("email.fwdopt"), "Action"),
              type: "select",
              options: [
                { value: "fwd", label: t(tk("email.optForward"), "Forward to address") },
                { value: "fail", label: t(tk("email.optFail"), "Discard (fail)") },
              ],
            },
            {
              key: "fwdemail",
              label: t(tk("email.destination"), "Destination"),
              placeholder: "dest@example.com",
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.addForwarder(
                id,
                user,
                str(v.domain),
                str(v.email),
                str(v.fwdopt),
                str(v.fwdemail),
              ),
            );
            closeModal();
            void loadDomainScoped();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const deleteForwarder = useCallback(
    async (address: string, dest: string) => {
      await run((id) => api.deleteForwarder(id, user, address, dest));
      void loadDomainScoped();
    },
    [run, api, user, loadDomainScoped],
  );

  const spamSettings = useCallback(async () => {
    const res = await run((id) => api.getSpamSettings(id, user));
    if (res) openDrawer(t(tk("email.spamSettings"), "Spam settings"), res);
  }, [run, api, user, openDrawer, t]);

  const subTabs: Array<{ key: EmailSub; label: string }> = [
    { key: "accounts", label: t(tk("email.accounts"), "Accounts") },
    { key: "forwarders", label: t(tk("email.forwarders"), "Forwarders") },
    { key: "autoresponders", label: t(tk("email.autoresponders"), "Autoresponders") },
    { key: "lists", label: t(tk("email.mailingLists"), "Mailing lists") },
    { key: "mx", label: t(tk("email.mx"), "MX records") },
  ];

  if (!user) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1">
        {subTabs.map((st) => (
          <button
            key={st.key}
            onClick={() => setSub(st.key)}
            className={`border-b-2 px-2 py-1 text-xs ${
              sub === st.key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {sub === "accounts" ? (
        <>
          <SectionBar
            count={accounts.length}
            isLoading={isLoading}
            onRefresh={loadAccounts}
            onNew={newAccount}
            newLabel={t(tk("email.newAccount"), "New account")}
          >
            <button onClick={spamSettings} className={btnCls}>
              {t(tk("email.spamSettings"), "Spam settings")}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t(tk("email.address"), "Email"),
              t(tk("email.used"), "Used"),
              t(tk("email.quota"), "Quota"),
            ]}
            rows={accounts.map((r, i) => ({
              id: `${r.email}-${i}`,
              cells: [
                r.email,
                r.humandiskused ?? String(r.diskused ?? "—"),
                r.humandiskquota ?? String(r.diskquota ?? "—"),
              ],
              onDelete: () => deleteAccount(r.email),
              extra: [
                {
                  label: t(tk("email.password"), "Password"),
                  onClick: () => changePassword(r.email),
                },
                {
                  label: t(tk("email.quota"), "Quota"),
                  onClick: () => setQuota(r.email),
                },
              ],
            }))}
          />
        </>
      ) : (
        <>
          <SectionBar
            count={rows.length}
            isLoading={isLoading}
            onRefresh={loadDomainScoped}
            onNew={sub === "forwarders" ? newForwarder : undefined}
            newLabel={t(tk("email.newForwarder"), "New forwarder")}
          >
            <input
              className={inputCls}
              placeholder={t(tk("email.domain"), "Domain")}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadDomainScoped()}
            />
            <button onClick={loadDomainScoped} className={btnCls}>
              {t(tk("apply"), "Apply")}
            </button>
          </SectionBar>
          {sub === "forwarders" ? (
            <DataTable
              columns={[
                t(tk("email.sourceAddress"), "Source"),
                t(tk("email.destination"), "Destination"),
              ]}
              rows={rows.map((r, i) => ({
                id: `${String(r.dest)}-${i}`,
                cells: [String(r.dest ?? "—"), String(r.forward ?? "—")],
                onDelete: () =>
                  deleteForwarder(String(r.dest ?? ""), String(r.forward ?? "")),
              }))}
            />
          ) : (
            <DataTable
              columns={[t(tk("email.entry"), "Entry"), t(tk("email.detail"), "Detail")]}
              rows={rows.map((r, i) => ({
                id: `row-${i}`,
                cells: [
                  String(
                    r.email ?? r.list ?? r.exchanger ?? r.domain ?? `#${i}`,
                  ),
                  String(
                    r.subject ??
                      r.accesstype ??
                      (r.priority != null ? `pri ${r.priority}` : "—"),
                  ),
                ],
              }))}
            />
          )}
        </>
      )}
    </SectionLayout>
  );
};

// ─── Databases ───────────────────────────────────────────────────────────────────

type DbSub = "databases" | "users";

const DatabasesSection: React.FC<{ acct: Acct; user: string }> = ({
  acct,
  user,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [sub, setSub] = useState<DbSub>("databases");
  const [dbs, setDbs] = useState<CpanelDatabase[]>([]);
  const [dbUsers, setDbUsers] = useState<DatabaseUser[]>([]);
  const { overlay, setOverlay, closeModal } = useOverlay();

  const loadDbs = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listDatabases(id, user));
    if (res) setDbs(res);
  }, [run, api, user]);

  const loadUsers = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listDatabaseUsers(id, user));
    if (res) setDbUsers(res);
  }, [run, api, user]);

  useEffect(() => {
    if (sub === "databases") void loadDbs();
    else void loadUsers();
  }, [sub, loadDbs, loadUsers]);

  const newDatabase = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("db.newDatabase"), "New database")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "name", label: t(tk("db.name"), "Name"), required: true },
          ]}
          onSubmit={async (v) => {
            await run((id) => api.createDatabase(id, user, str(v.name)));
            closeModal();
            void loadDbs();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const newUser = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("db.newUser"), "New database user")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "dbUser", label: t(tk("db.username"), "Username"), required: true },
            {
              key: "password",
              label: t(tk("db.password"), "Password"),
              type: "password",
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createDatabaseUser(id, user, str(v.dbUser), str(v.password)),
            );
            closeModal();
            void loadUsers();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const grant = (dbUser: string) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("db.grant"), "Grant privileges")}
          submitLabel={t(tk("db.grant"), "Grant")}
          fields={[
            { key: "db", label: t(tk("db.database"), "Database"), required: true },
            {
              key: "privileges",
              label: t(tk("db.privileges"), "Privileges"),
              defaultValue: "ALL PRIVILEGES",
              required: true,
            },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.grantDatabasePrivileges(
                id,
                user,
                dbUser,
                str(v.db),
                str(v.privileges),
              ),
            );
            closeModal();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const deleteDb = useCallback(
    async (name: string) => {
      await run((id) => api.deleteDatabase(id, user, name));
      void loadDbs();
    },
    [run, api, user, loadDbs],
  );

  const deleteUser = useCallback(
    async (dbuser: string) => {
      await run((id) => api.deleteDatabaseUser(id, user, dbuser));
      void loadUsers();
    },
    [run, api, user, loadUsers],
  );

  const subTabs: Array<{ key: DbSub; label: string }> = [
    { key: "databases", label: t(tk("db.databases"), "Databases") },
    { key: "users", label: t(tk("db.users"), "Users") },
  ];

  if (!user) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1">
        {subTabs.map((st) => (
          <button
            key={st.key}
            onClick={() => setSub(st.key)}
            className={`border-b-2 px-2 py-1 text-xs ${
              sub === st.key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {sub === "databases" ? (
        <>
          <SectionBar
            count={dbs.length}
            isLoading={isLoading}
            onRefresh={loadDbs}
            onNew={newDatabase}
            newLabel={t(tk("db.newDatabase"), "New database")}
          />
          <DataTable
            columns={[
              t(tk("db.name"), "Name"),
              t(tk("db.engine"), "Engine"),
              t(tk("db.users"), "Users"),
              t(tk("db.size"), "Size"),
            ]}
            rows={dbs.map((r, i) => ({
              id: `${r.db}-${i}`,
              cells: [
                r.db,
                r.engine,
                String(r.users.length),
                r.disk_usage ?? String(r.size ?? "—"),
              ],
              onDelete: () => deleteDb(r.db),
            }))}
          />
        </>
      ) : (
        <>
          <SectionBar
            count={dbUsers.length}
            isLoading={isLoading}
            onRefresh={loadUsers}
            onNew={newUser}
            newLabel={t(tk("db.newUser"), "New user")}
          />
          <DataTable
            columns={[
              t(tk("db.username"), "Username"),
              t(tk("db.engine"), "Engine"),
              t(tk("db.databases"), "Databases"),
            ]}
            rows={dbUsers.map((r, i) => ({
              id: `${r.user}-${i}`,
              cells: [r.user, r.engine, r.databases.join(", ") || "—"],
              onDelete: () => deleteUser(r.user),
              extra: [
                {
                  label: t(tk("db.grant"), "Grant"),
                  onClick: () => grant(r.user),
                },
              ],
            }))}
          />
        </>
      )}
    </SectionLayout>
  );
};

// ─── Files ───────────────────────────────────────────────────────────────────────

const FilesSection: React.FC<{ acct: Acct; user: string }> = ({
  acct,
  user,
}) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [path, setPath] = useState("public_html");
  const [rows, setRows] = useState<FileItem[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listFiles(id, user, path.trim() || "."));
    if (res) setRows(res);
  }, [run, api, user, path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const newDir = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("files.newDir"), "New directory")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "name", label: t(tk("files.name"), "Name"), required: true },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createDirectory(id, user, path.trim() || ".", str(v.name)),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const diskUsage = useCallback(async () => {
    const res = await run((id) => api.getDiskUsage(id, user));
    if (res) openDrawer(t(tk("files.diskUsage"), "Disk usage"), res);
  }, [run, api, user, openDrawer, t]);

  const remove = useCallback(
    async (item: FileItem) => {
      await run((id) => api.deleteFile(id, user, item.path));
      void load();
    },
    [run, api, user, load],
  );

  if (!user) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={newDir}
        newLabel={t(tk("files.newDir"), "New directory")}
      >
        <input
          className={`${inputCls} w-64`}
          placeholder={t(tk("files.path"), "Path")}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button onClick={load} className={btnCls}>
          {t(tk("apply"), "Apply")}
        </button>
        <button onClick={diskUsage} className={btnCls}>
          {t(tk("files.diskUsage"), "Disk usage")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(tk("files.name"), "Name"),
          t(tk("files.type"), "Type"),
          t(tk("files.size"), "Size"),
          t(tk("files.permissions"), "Perms"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.path}-${i}`,
          cells: [
            r.name,
            r.file_type,
            r.humansize ?? String(r.size ?? "—"),
            r.permissions ?? "—",
          ],
          onDelete: () => remove(r),
        }))}
      />
    </SectionLayout>
  );
};

// ─── SSL ─────────────────────────────────────────────────────────────────────────

type SslSub = "certs" | "status";

const SslSection: React.FC<{ acct: Acct; user: string }> = ({ acct, user }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [sub, setSub] = useState<SslSub>("certs");
  const [certs, setCerts] = useState<SslCertificate[]>([]);
  const [status, setStatus] = useState<Array<Record<string, unknown>>>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const loadCerts = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listSslCerts(id, user));
    if (res) setCerts(res);
  }, [run, api, user]);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.getSslStatus(id, user));
    if (res) setStatus(res as unknown as Array<Record<string, unknown>>);
  }, [run, api, user]);

  useEffect(() => {
    if (sub === "certs") void loadCerts();
    else void loadStatus();
  }, [sub, loadCerts, loadStatus]);

  const install = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("ssl.install"), "Install certificate")}
          submitLabel={t(tk("ssl.install"), "Install")}
          fields={[
            { key: "domain", label: t(tk("ssl.domain"), "Domain"), required: true },
            { key: "cert", label: t(tk("ssl.cert"), "Certificate (PEM)"), required: true },
            { key: "key", label: t(tk("ssl.key"), "Private key (PEM)"), required: true },
            { key: "cabundle", label: t(tk("ssl.cabundle"), "CA bundle (optional)") },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.installSsl(id, {
                domain: str(v.domain),
                cert: str(v.cert),
                key: str(v.key),
                cabundle: optStr(v.cabundle),
              }),
            );
            closeModal();
            void loadCerts();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const genCsr = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("ssl.generateCsr"), "Generate CSR")}
          submitLabel={t(tk("ssl.generate"), "Generate")}
          fields={[
            { key: "domain", label: t(tk("ssl.domain"), "Domain"), required: true },
            { key: "country", label: t(tk("ssl.country"), "Country (2-letter)") },
            { key: "state", label: t(tk("ssl.state"), "State") },
            { key: "city", label: t(tk("ssl.city"), "City") },
            { key: "company", label: t(tk("ssl.company"), "Company") },
            { key: "email", label: t(tk("ssl.email"), "Email") },
            { key: "key_size", label: t(tk("ssl.keySize"), "Key size"), type: "number" },
          ]}
          onSubmit={async (v) => {
            const res = await run((id) =>
              api.generateCsr(id, user, {
                domain: str(v.domain),
                country: optStr(v.country),
                state: optStr(v.state),
                city: optStr(v.city),
                company: optStr(v.company),
                email: optStr(v.email),
                key_size: num(v.key_size),
              }),
            );
            closeModal();
            if (res) openDrawer(t(tk("ssl.csrResult"), "CSR result"), res);
          }}
          onClose={closeModal}
        />
      ),
    }));

  const autossl = useCallback(async () => {
    const res = await run((id) => api.autosslCheck(id, user));
    if (res !== undefined)
      openDrawer(t(tk("ssl.autosslCheck"), "AutoSSL check"), res);
  }, [run, api, user, openDrawer, t]);

  const subTabs: Array<{ key: SslSub; label: string }> = [
    { key: "certs", label: t(tk("ssl.certs"), "Certificates") },
    { key: "status", label: t(tk("ssl.status"), "Status") },
  ];

  if (!user) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 pt-1">
        {subTabs.map((st) => (
          <button
            key={st.key}
            onClick={() => setSub(st.key)}
            className={`border-b-2 px-2 py-1 text-xs ${
              sub === st.key
                ? "border-primary text-[var(--color-text)]"
                : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {sub === "certs" ? (
        <>
          <SectionBar
            count={certs.length}
            isLoading={isLoading}
            onRefresh={loadCerts}
            onNew={install}
            newLabel={t(tk("ssl.install"), "Install")}
          >
            <button onClick={genCsr} className={btnCls}>
              {t(tk("ssl.generateCsr"), "Generate CSR")}
            </button>
            <button onClick={autossl} className={btnCls}>
              {t(tk("ssl.autosslCheck"), "AutoSSL check")}
            </button>
          </SectionBar>
          <DataTable
            columns={[
              t(tk("ssl.domain"), "Domain"),
              t(tk("ssl.issuer"), "Issuer"),
              t(tk("ssl.expires"), "Expires"),
              t(tk("ssl.installed"), "Installed"),
            ]}
            rows={certs.map((r, i) => ({
              id: `${r.domain}-${i}`,
              cells: [
                r.domain,
                r.issuer ?? "—",
                r.not_after ?? "—",
                r.installed ? "✓" : "✗",
              ],
            }))}
          />
        </>
      ) : (
        <>
          <SectionBar
            count={status.length}
            isLoading={isLoading}
            onRefresh={loadStatus}
          />
          <DataTable
            columns={[
              t(tk("ssl.domain"), "Domain"),
              t(tk("ssl.sslEnabled"), "SSL"),
              t(tk("ssl.autossl"), "AutoSSL"),
            ]}
            rows={status.map((r, i) => ({
              id: `${String(r.domain)}-${i}`,
              cells: [
                String(r.domain ?? "—"),
                r.ssl_enabled ? "✓" : "✗",
                r.autossl_enabled ? "✓" : "✗",
              ],
            }))}
          />
        </>
      )}
    </SectionLayout>
  );
};

// ─── FTP ─────────────────────────────────────────────────────────────────────────

const FtpSection: React.FC<{ acct: Acct; user: string }> = ({ acct, user }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [rows, setRows] = useState<FtpAccount[]>([]);
  const { overlay, setOverlay, closeModal, openDrawer } = useOverlay();

  const load = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listFtpAccounts(id, user));
    if (res) setRows(res);
  }, [run, api, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const newAccount = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("ftp.newAccount"), "New FTP account")}
          submitLabel={t(tk("create"), "Create")}
          fields={[
            { key: "user", label: t(tk("ftp.username"), "Username"), required: true },
            {
              key: "password",
              label: t(tk("ftp.password"), "Password"),
              type: "password",
              required: true,
            },
            {
              key: "quota",
              label: t(tk("ftp.quotaMb"), "Quota (MB, 0 = unlimited)"),
              type: "number",
            },
            { key: "homedir", label: t(tk("ftp.homedir"), "Home directory (optional)") },
          ]}
          onSubmit={async (v) => {
            await run((id) =>
              api.createFtpAccount(id, user, {
                user: str(v.user),
                password: str(v.password),
                quota: num(v.quota),
                homedir: optStr(v.homedir),
              }),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const sessions = useCallback(async () => {
    const res = await run((id) => api.listFtpSessions(id));
    if (res) openDrawer(t(tk("ftp.sessions"), "FTP sessions"), res);
  }, [run, api, openDrawer, t]);

  const remove = useCallback(
    async (ftpUser: string) => {
      // `destroy: true` also removes the account's home directory.
      await run((id) => api.deleteFtpAccount(id, user, ftpUser, true));
      void load();
    },
    [run, api, user, load],
  );

  if (!user) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={newAccount}
        newLabel={t(tk("ftp.newAccount"), "New FTP account")}
      >
        <button onClick={sessions} className={btnCls}>
          {t(tk("ftp.sessions"), "Sessions")}
        </button>
      </SectionBar>
      <DataTable
        columns={[
          t(tk("ftp.username"), "User"),
          t(tk("ftp.directory"), "Directory"),
          t(tk("ftp.quota"), "Quota"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.user}-${i}`,
          cells: [r.login || r.user, r.dir, String(r.quota ?? "—")],
          onDelete: () => remove(r.user),
        }))}
      />
    </SectionLayout>
  );
};

// ─── Cron ────────────────────────────────────────────────────────────────────────

const CRON_FIELDS: FieldSpec[] = [
  { key: "command", label: "Command", required: true, placeholder: "/usr/bin/php cron.php" },
  { key: "minute", label: "Minute", defaultValue: "*", required: true },
  { key: "hour", label: "Hour", defaultValue: "*", required: true },
  { key: "day", label: "Day", defaultValue: "*", required: true },
  { key: "month", label: "Month", defaultValue: "*", required: true },
  { key: "weekday", label: "Weekday", defaultValue: "*", required: true },
];

const CronSection: React.FC<{ acct: Acct; user: string }> = ({ acct, user }) => {
  const { t } = useTranslation();
  const { api, run, isLoading, error } = acct;
  const [rows, setRows] = useState<CronJob[]>([]);
  const { overlay, setOverlay, closeModal } = useOverlay();

  const load = useCallback(async () => {
    if (!user) return;
    const res = await run((id) => api.listCronJobs(id, user));
    if (res) setRows(res);
  }, [run, api, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const cronFields = (job?: CronJob): FieldSpec[] =>
    CRON_FIELDS.map((f) => ({
      ...f,
      label: t(tk(`cron.${f.key}`), f.label),
      defaultValue: job
        ? (job[f.key as keyof CronJob] as string | undefined) ?? f.defaultValue
        : f.defaultValue,
    }));

  const buildReq = (v: FormValues) => ({
    command: str(v.command),
    minute: str(v.minute),
    hour: str(v.hour),
    day: str(v.day),
    month: str(v.month),
    weekday: str(v.weekday),
  });

  const newJob = () =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("cron.newJob"), "New cron job")}
          submitLabel={t(tk("create"), "Create")}
          fields={cronFields()}
          onSubmit={async (v) => {
            await run((id) => api.addCronJob(id, user, buildReq(v)));
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const editJob = (job: CronJob) =>
    setOverlay((s) => ({
      ...s,
      modal: (
        <FormModal
          title={t(tk("cron.editJob"), "Edit cron job")}
          submitLabel={t(tk("save"), "Save")}
          fields={cronFields(job)}
          onSubmit={async (v) => {
            await run((id) =>
              api.editCronJob(id, user, job.linekey ?? "", buildReq(v)),
            );
            closeModal();
            void load();
          }}
          onClose={closeModal}
        />
      ),
    }));

  const remove = useCallback(
    async (job: CronJob) => {
      await run((id) => api.deleteCronJob(id, user, job.linekey ?? ""));
      void load();
    },
    [run, api, user, load],
  );

  if (!user) {
    return (
      <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
        <NoUser />
      </SectionLayout>
    );
  }

  return (
    <SectionLayout overlay={overlay} setOverlay={setOverlay} error={error}>
      <SectionBar
        count={rows.length}
        isLoading={isLoading}
        onRefresh={load}
        onNew={newJob}
        newLabel={t(tk("cron.newJob"), "New cron job")}
      />
      <DataTable
        columns={[
          t(tk("cron.schedule"), "Schedule"),
          t(tk("cron.command"), "Command"),
        ]}
        rows={rows.map((r, i) => ({
          id: `${r.linekey ?? r.line ?? i}`,
          cells: [
            `${r.minute} ${r.hour} ${r.day} ${r.month} ${r.weekday}`,
            r.command,
          ],
          onDelete: r.linekey ? () => remove(r) : undefined,
          extra: r.linekey
            ? [{ label: t(tk("edit"), "Edit"), onClick: () => editJob(r) }]
            : undefined,
        }))}
      />
    </SectionLayout>
  );
};

// ─── Root tab ────────────────────────────────────────────────────────────────────

type GroupKey = "domains" | "email" | "databases" | "files" | "ssl" | "ftp" | "cron";

const GROUPS: Array<{ key: GroupKey; icon: typeof Globe; label: string }> = [
  { key: "domains", icon: Globe, label: "Domains" },
  { key: "email", icon: Mail, label: "Email" },
  { key: "databases", icon: Database, label: "Databases" },
  { key: "files", icon: FileText, label: "Files" },
  { key: "ssl", icon: Lock, label: "SSL/TLS" },
  { key: "ftp", icon: Server, label: "FTP" },
  { key: "cron", icon: Timer, label: "Cron" },
];

const CpanelAccountTab: React.FC<CpanelTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const acct = useCpanelAccount(connectionId);
  const [group, setGroup] = useState<GroupKey>("domains");
  const [accounts, setAccounts] = useState<CpanelAccountRef[]>([]);
  const [user, setUser] = useState("");
  const [freeText, setFreeText] = useState("");

  // Populate the account picker once from the (read-only) server account list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await acct.run((id) => acct.api.listAccounts(id));
      if (!cancelled && res) {
        setAccounts(res);
        setUser((prev) => prev || res[0]?.user || "");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const groupLabel = useMemo(
    () => ({
      domains: t(tk("groups.domains"), "Domains"),
      email: t(tk("groups.email"), "Email"),
      databases: t(tk("groups.databases"), "Databases"),
      files: t(tk("groups.files"), "Files"),
      ssl: t(tk("groups.ssl"), "SSL/TLS"),
      ftp: t(tk("groups.ftp"), "FTP"),
      cron: t(tk("groups.cron"), "Cron"),
    }),
    [t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Account picker */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--color-textSecondary)]">
          {t(tk("account"), "Account")}
        </span>
        {accounts.length > 0 ? (
          <select
            className={inputCls}
            value={user}
            onChange={(e) => setUser(e.target.value)}
          >
            <option value="">{t(tk("selectUser"), "Select account…")}</option>
            {accounts.map((a) => (
              <option key={a.user} value={a.user}>
                {a.user} ({a.domain})
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-[var(--color-textMuted)]">
            {t(tk("noAccounts"), "No account list — enter a username")}
          </span>
        )}
        <input
          className={`${inputCls} w-40`}
          placeholder={t(tk("usernameFallback"), "or type a username")}
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && freeText.trim()) setUser(freeText.trim());
          }}
        />
        <button
          onClick={() => freeText.trim() && setUser(freeText.trim())}
          className={btnCls}
          disabled={!freeText.trim()}
        >
          {t(tk("useUser"), "Use")}
        </button>
        {user && (
          <span className="ml-auto text-xs text-[var(--color-textMuted)]">
            {t(tk("managing"), "Managing")}: {user}
          </span>
        )}
      </div>

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
        {group === "domains" && <DomainsSection acct={acct} user={user} />}
        {group === "email" && <EmailSection acct={acct} user={user} />}
        {group === "databases" && <DatabasesSection acct={acct} user={user} />}
        {group === "files" && <FilesSection acct={acct} user={user} />}
        {group === "ssl" && <SslSection acct={acct} user={user} />}
        {group === "ftp" && <FtpSection acct={acct} user={user} />}
        {group === "cron" && <CronSection acct={acct} user={user} />}
      </div>
    </div>
  );
};

export default CpanelAccountTab;
