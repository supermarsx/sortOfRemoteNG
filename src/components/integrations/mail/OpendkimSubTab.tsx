// OpendkimSubTab — self-contained "OpenDKIM (signing)" sub-tab for the unified
// Mail Server panel (t42 Wave M, exec t42-mail-opendkim).
//
// Independent SSH-managed daemon: this tab owns its OWN connect form + connection
// lifecycle + persistence (`useIntegrationConfigStore`, integrationKey
// "mail.opendkim") and binds all 49 `dkim_*` commands full-depth across grouped
// sections (keys, signing table, key table, trusted/internal hosts, config,
// stats, service). The mail shell passes NO connectionId — the tab connects
// itself with the persisted instance id.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  KeyRound,
  Plug,
  PlugZap,
  Loader2,
  Save,
  RefreshCw,
  Trash2,
  Plus,
  ShieldCheck,
  FileCog,
  Activity,
  Server,
  Play,
  Square,
  RotateCcw,
  Globe,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MailSubTabProps } from "./registry";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { useOpendkim } from "../../../hooks/integration/mail/useOpendkim";
import {
  defaultOpendkimConnectionConfig,
  type OpendkimConnectionConfig,
  type DkimKey,
  type CreateKeyRequest,
  type RotateKeyRequest,
  type SigningTableEntry,
  type KeyTableEntry,
  type TrustedHost,
  type InternalHost,
  type OpendkimConfig,
  type OpendkimStats,
  type OpendkimInfo,
} from "../../../types/mail/opendkim";

const INTEGRATION_KEY = "mail.opendkim";

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";
const btnPrimary =
  "flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-60";
const btnGhost =
  "app-bar-button flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-60";
const btnSmall =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-60";

// ─── Small primitives ─────────────────────────────────────────────────────────

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}> = ({ label, value, onChange, placeholder, type }) => (
  <div>
    <label className={labelClass}>{label}</label>
    <input
      className={inputClass}
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
);

const SectionShell: React.FC<{
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, actions, children }) => (
  <div className="rounded border border-[var(--color-border)] p-3">
    <div className="mb-2 flex items-center justify-between">
      <h4 className="text-sm font-semibold text-[var(--color-text)]">{title}</h4>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
    {children}
  </div>
);

/** Tracks a one-shot async action's loading/error state and last string result. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(typeof e === "string" ? e : (e as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, setError, run };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sections
// ═══════════════════════════════════════════════════════════════════════════════

type Api = ReturnType<typeof useOpendkim>["api"];

interface SectionProps {
  id: string;
  api: Api;
  t: (k: string, d: string) => string;
}

// ── Keys ────────────────────────────────────────────────────────────────────

const KeysSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, setError, run } = useAction();
  const [keys, setKeys] = useState<DkimKey[]>([]);
  const [form, setForm] = useState<CreateKeyRequest>({
    selector: "default",
    domain: "",
    key_type: "rsa",
    bits: 2048,
  });
  const [rotateFor, setRotateFor] = useState<DkimKey | null>(null);
  const [newSelector, setNewSelector] = useState("");
  const [detail, setDetail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await run(() => api.listKeys(id));
    if (r) setKeys(r);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = async () => {
    const r = await run(() => api.generateKey(id, form));
    if (r) await refresh();
  };

  const rotate = async () => {
    if (!rotateFor) return;
    const req: RotateKeyRequest = {
      selector: rotateFor.selector,
      domain: rotateFor.domain,
      new_selector: newSelector,
      key_type: rotateFor.key_type,
      bits: rotateFor.bits,
    };
    const r = await run(() => api.rotateKey(id, req));
    if (r) {
      setRotateFor(null);
      setNewSelector("");
      await refresh();
    }
  };

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.keys.title", "DKIM Keys")}
      actions={
        <button className={btnSmall} onClick={refresh} disabled={busy}>
          <RefreshCw size={12} />
          {t("integrations.mail.opendkim.actions.refresh", "Refresh")}
        </button>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field
          label={t("integrations.mail.opendkim.keys.selector", "Selector")}
          value={form.selector}
          onChange={(v) => setForm((f) => ({ ...f, selector: v }))}
        />
        <Field
          label={t("integrations.mail.opendkim.keys.domain", "Domain")}
          value={form.domain}
          onChange={(v) => setForm((f) => ({ ...f, domain: v }))}
          placeholder="example.com"
        />
        <div>
          <label className={labelClass}>
            {t("integrations.mail.opendkim.keys.keyType", "Key type")}
          </label>
          <select
            className={inputClass}
            value={form.key_type ?? "rsa"}
            onChange={(e) =>
              setForm((f) => ({ ...f, key_type: e.target.value }))
            }
          >
            <option value="rsa">rsa</option>
            <option value="ed25519">ed25519</option>
          </select>
        </div>
        <Field
          label={t("integrations.mail.opendkim.keys.bits", "Bits (RSA)")}
          type="number"
          value={String(form.bits ?? "")}
          onChange={(v) =>
            setForm((f) => ({ ...f, bits: Number(v) || undefined }))
          }
        />
      </div>
      <button
        className={btnPrimary}
        onClick={generate}
        disabled={busy || !form.domain}
      >
        <Plus size={14} />
        {t("integrations.mail.opendkim.keys.generate", "Generate key")}
      </button>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 space-y-1">
        {keys.map((k) => (
          <div
            key={`${k.selector}._${k.domain}`}
            className="flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span className="font-mono text-[var(--color-text)]">
              {k.selector}._domainkey.{k.domain}
            </span>
            <span className="text-[var(--color-textSecondary)]">
              {k.key_type}
              {k.bits ? ` ${k.bits}` : ""}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                className={btnSmall}
                onClick={async () => {
                  const r = await run(() =>
                    api.getKey(id, k.selector, k.domain),
                  );
                  if (r) setDetail(JSON.stringify(r, null, 2));
                }}
                disabled={busy}
              >
                {t("integrations.mail.opendkim.keys.details", "Details")}
              </button>
              <button
                className={btnSmall}
                onClick={async () => {
                  const r = await run(() =>
                    api.getDnsRecord(id, k.selector, k.domain),
                  );
                  if (r) setDetail(r.value);
                }}
                disabled={busy}
              >
                <Globe size={12} />
                {t("integrations.mail.opendkim.keys.dns", "DNS")}
              </button>
              <button
                className={btnSmall}
                onClick={async () => {
                  const r = await run(() =>
                    api.verifyDns(id, k.selector, k.domain),
                  );
                  if (r !== undefined)
                    setDetail(
                      r
                        ? t(
                            "integrations.mail.opendkim.keys.dnsOk",
                            "DNS record verified",
                          )
                        : t(
                            "integrations.mail.opendkim.keys.dnsMismatch",
                            "DNS record does not match",
                          ),
                    );
                }}
                disabled={busy}
              >
                <ShieldCheck size={12} />
                {t("integrations.mail.opendkim.keys.verify", "Verify")}
              </button>
              <button
                className={btnSmall}
                onClick={async () => {
                  const r = await run(() =>
                    api.exportPublicKey(id, k.selector, k.domain),
                  );
                  if (r) setDetail(r);
                }}
                disabled={busy}
              >
                {t("integrations.mail.opendkim.keys.export", "Export")}
              </button>
              <button
                className={btnSmall}
                onClick={() => {
                  setRotateFor(k);
                  setNewSelector("");
                }}
                disabled={busy}
              >
                <RotateCcw size={12} />
                {t("integrations.mail.opendkim.keys.rotate", "Rotate")}
              </button>
              <button
                className={`${btnSmall} text-red-500`}
                onClick={async () => {
                  await run(() => api.deleteKey(id, k.selector, k.domain));
                  await refresh();
                }}
                disabled={busy}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {keys.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.mail.opendkim.keys.empty", "No keys.")}
          </p>
        )}
      </div>

      {rotateFor && (
        <div className="mt-3 rounded border border-[var(--color-border)] p-2">
          <p className="mb-2 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.mail.opendkim.keys.rotating", "Rotating")}{" "}
            <span className="font-mono">
              {rotateFor.selector}._domainkey.{rotateFor.domain}
            </span>
          </p>
          <div className="flex items-end gap-2">
            <Field
              label={t(
                "integrations.mail.opendkim.keys.newSelector",
                "New selector",
              )}
              value={newSelector}
              onChange={setNewSelector}
            />
            <button
              className={btnPrimary}
              onClick={rotate}
              disabled={busy || !newSelector}
            >
              {t("integrations.mail.opendkim.keys.confirmRotate", "Rotate")}
            </button>
            <button
              className={btnGhost}
              onClick={() => setRotateFor(null)}
              disabled={busy}
            >
              {t("integrations.mail.opendkim.actions.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      {detail && (
        <pre className="mt-3 max-h-48 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2 text-xs text-[var(--color-text)]">
          {detail}
          <button
            className="ml-2 underline"
            onClick={() => setDetail(null)}
          >
            {t("integrations.mail.opendkim.actions.close", "close")}
          </button>
        </pre>
      )}
    </SectionShell>
  );
};

// ── Signing Table ────────────────────────────────────────────────────────────

const SigningTableSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, run } = useAction();
  const [rows, setRows] = useState<SigningTableEntry[]>([]);
  const [form, setForm] = useState<SigningTableEntry>({
    pattern: "",
    key_name: "",
    comment: "",
  });

  const refresh = useCallback(async () => {
    const r = await run(() => api.listSigningTable(id));
    if (r) setRows(r);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    await run(() => api.addSigningEntry(id, form));
    setForm({ pattern: "", key_name: "", comment: "" });
    await refresh();
  };

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.signing.title", "Signing Table")}
      actions={
        <>
          <button
            className={btnSmall}
            onClick={async () => {
              await run(() => api.rebuildSigningTable(id));
            }}
            disabled={busy}
          >
            {t("integrations.mail.opendkim.actions.rebuild", "Rebuild")}
          </button>
          <button className={btnSmall} onClick={refresh} disabled={busy}>
            <RefreshCw size={12} />
          </button>
        </>
      }
    >
      <div className="mb-2 grid grid-cols-3 gap-2">
        <Field
          label={t("integrations.mail.opendkim.signing.pattern", "Pattern")}
          value={form.pattern}
          onChange={(v) => setForm((f) => ({ ...f, pattern: v }))}
          placeholder="*@example.com"
        />
        <Field
          label={t("integrations.mail.opendkim.signing.keyName", "Key name")}
          value={form.key_name}
          onChange={(v) => setForm((f) => ({ ...f, key_name: v }))}
        />
        <Field
          label={t("integrations.mail.opendkim.signing.comment", "Comment")}
          value={form.comment ?? ""}
          onChange={(v) => setForm((f) => ({ ...f, comment: v }))}
        />
      </div>
      <button
        className={btnPrimary}
        onClick={add}
        disabled={busy || !form.pattern || !form.key_name}
      >
        <Plus size={14} />
        {t("integrations.mail.opendkim.actions.add", "Add")}
      </button>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <div className="mt-3 space-y-1">
        {rows.map((r) => (
          <div
            key={r.pattern}
            className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span className="font-mono text-[var(--color-text)]">
              {r.pattern}
            </span>
            <span className="text-[var(--color-textSecondary)]">
              → {r.key_name}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                className={btnSmall}
                onClick={async () => {
                  const cmt =
                    window.prompt(
                      t(
                        "integrations.mail.opendkim.signing.updatePrompt",
                        "New key name",
                      ),
                      r.key_name,
                    ) ?? r.key_name;
                  await run(() =>
                    api.updateSigningEntry(id, r.pattern, {
                      ...r,
                      key_name: cmt,
                    }),
                  );
                  await refresh();
                }}
                disabled={busy}
              >
                {t("integrations.mail.opendkim.actions.edit", "Edit")}
              </button>
              <button
                className={`${btnSmall} text-red-500`}
                onClick={async () => {
                  await run(() => api.removeSigningEntry(id, r.pattern));
                  await refresh();
                }}
                disabled={busy}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.mail.opendkim.signing.empty", "No entries.")}
          </p>
        )}
      </div>
    </SectionShell>
  );
};

// ── Key Table ────────────────────────────────────────────────────────────────

const KeyTableSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, run } = useAction();
  const [rows, setRows] = useState<KeyTableEntry[]>([]);
  const [form, setForm] = useState<KeyTableEntry>({
    key_name: "",
    domain: "",
    selector: "",
    private_key_path: "",
  });

  const refresh = useCallback(async () => {
    const r = await run(() => api.listKeyTable(id));
    if (r) setRows(r);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    await run(() => api.addKeyEntry(id, form));
    setForm({ key_name: "", domain: "", selector: "", private_key_path: "" });
    await refresh();
  };

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.keyTable.title", "Key Table")}
      actions={
        <>
          <button
            className={btnSmall}
            onClick={async () => {
              await run(() => api.rebuildKeyTable(id));
            }}
            disabled={busy}
          >
            {t("integrations.mail.opendkim.actions.rebuild", "Rebuild")}
          </button>
          <button className={btnSmall} onClick={refresh} disabled={busy}>
            <RefreshCw size={12} />
          </button>
        </>
      }
    >
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field
          label={t("integrations.mail.opendkim.keyTable.keyName", "Key name")}
          value={form.key_name}
          onChange={(v) => setForm((f) => ({ ...f, key_name: v }))}
        />
        <Field
          label={t("integrations.mail.opendkim.keyTable.domain", "Domain")}
          value={form.domain}
          onChange={(v) => setForm((f) => ({ ...f, domain: v }))}
        />
        <Field
          label={t("integrations.mail.opendkim.keyTable.selector", "Selector")}
          value={form.selector}
          onChange={(v) => setForm((f) => ({ ...f, selector: v }))}
        />
        <Field
          label={t("integrations.mail.opendkim.keyTable.path", "Key path")}
          value={form.private_key_path}
          onChange={(v) => setForm((f) => ({ ...f, private_key_path: v }))}
        />
      </div>
      <button
        className={btnPrimary}
        onClick={add}
        disabled={busy || !form.key_name}
      >
        <Plus size={14} />
        {t("integrations.mail.opendkim.actions.add", "Add")}
      </button>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <div className="mt-3 space-y-1">
        {rows.map((r) => (
          <div
            key={r.key_name}
            className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span className="font-mono text-[var(--color-text)]">
              {r.key_name}
            </span>
            <span className="text-[var(--color-textSecondary)]">
              {r.selector}._domainkey.{r.domain}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                className={btnSmall}
                onClick={async () => {
                  const path =
                    window.prompt(
                      t(
                        "integrations.mail.opendkim.keyTable.updatePrompt",
                        "New key path",
                      ),
                      r.private_key_path,
                    ) ?? r.private_key_path;
                  await run(() =>
                    api.updateKeyEntry(id, r.key_name, {
                      ...r,
                      private_key_path: path,
                    }),
                  );
                  await refresh();
                }}
                disabled={busy}
              >
                {t("integrations.mail.opendkim.actions.edit", "Edit")}
              </button>
              <button
                className={`${btnSmall} text-red-500`}
                onClick={async () => {
                  await run(() => api.removeKeyEntry(id, r.key_name));
                  await refresh();
                }}
                disabled={busy}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.mail.opendkim.keyTable.empty", "No entries.")}
          </p>
        )}
      </div>
    </SectionShell>
  );
};

// ── Trusted / Internal Hosts ──────────────────────────────────────────────────

const HostsSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, run } = useAction();
  const [trusted, setTrusted] = useState<TrustedHost[]>([]);
  const [internal, setInternal] = useState<InternalHost[]>([]);
  const [trustedInput, setTrustedInput] = useState("");
  const [internalInput, setInternalInput] = useState("");

  const refresh = useCallback(async () => {
    const tr = await run(() => api.listTrustedHosts(id));
    if (tr) setTrusted(tr);
    const it = await run(() => api.listInternalHosts(id));
    if (it) setInternal(it);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hostList = (
    kind: "trusted" | "internal",
    rows: TrustedHost[],
    input: string,
    setInput: (v: string) => void,
    add: () => Promise<void>,
    remove: (h: string) => Promise<void>,
    label: string,
  ) => (
    <div>
      <p className="mb-1 text-xs font-medium text-[var(--color-textSecondary)]">
        {label}
      </p>
      <div className="mb-2 flex items-end gap-2">
        <input
          className={inputClass}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="127.0.0.1, ::1, host.example.com"
        />
        <button
          className={btnPrimary}
          onClick={add}
          disabled={busy || !input}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div
            key={`${kind}-${r.host}`}
            className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span className="font-mono text-[var(--color-text)]">{r.host}</span>
            <button
              className={`${btnSmall} ml-auto text-red-500`}
              onClick={() => remove(r.host)}
              disabled={busy}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.mail.opendkim.hosts.empty", "None.")}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.hosts.title", "Trusted / Internal Hosts")}
      actions={
        <button className={btnSmall} onClick={refresh} disabled={busy}>
          <RefreshCw size={12} />
        </button>
      }
    >
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {hostList(
          "trusted",
          trusted,
          trustedInput,
          setTrustedInput,
          async () => {
            await run(() => api.addTrustedHost(id, { host: trustedInput }));
            setTrustedInput("");
            await refresh();
          },
          async (h) => {
            await run(() => api.removeTrustedHost(id, h));
            await refresh();
          },
          t("integrations.mail.opendkim.hosts.trusted", "Trusted (external) hosts"),
        )}
        {hostList(
          "internal",
          internal,
          internalInput,
          setInternalInput,
          async () => {
            await run(() => api.addInternalHost(id, { host: internalInput }));
            setInternalInput("");
            await refresh();
          },
          async (h) => {
            await run(() => api.removeInternalHost(id, h));
            await refresh();
          },
          t("integrations.mail.opendkim.hosts.internal", "Internal hosts"),
        )}
      </div>
    </SectionShell>
  );
};

// ── Config ───────────────────────────────────────────────────────────────────

const ConfigSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, run } = useAction();
  const [rows, setRows] = useState<OpendkimConfig[]>([]);
  const [paramKey, setParamKey] = useState("");
  const [paramValue, setParamValue] = useState("");
  const [mode, setMode] = useState("");
  const [socket, setSocket] = useState("");
  const [testOut, setTestOut] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await run(() => api.getConfig(id));
    if (r) setRows(r);
    const m = await run(() => api.getMode(id));
    if (m !== undefined) setMode(m);
    const s = await run(() => api.getSocket(id));
    if (s !== undefined) setSocket(s);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.config.title", "Configuration")}
      actions={
        <>
          <button
            className={btnSmall}
            onClick={async () => {
              const r = await run(() => api.testConfig(id));
              if (r)
                setTestOut(
                  `${r.success ? "OK" : "FAIL"}\n${r.output}\n${r.errors.join("\n")}`,
                );
            }}
            disabled={busy}
          >
            <FileCog size={12} />
            {t("integrations.mail.opendkim.config.test", "Test config")}
          </button>
          <button className={btnSmall} onClick={refresh} disabled={busy}>
            <RefreshCw size={12} />
          </button>
        </>
      }
    >
      {/* Mode + socket */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={labelClass}>
              {t("integrations.mail.opendkim.config.mode", "Mode (s/v/sv)")}
            </label>
            <input
              className={inputClass}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            />
          </div>
          <button
            className={btnGhost}
            onClick={async () => {
              await run(() => api.setMode(id, mode));
            }}
            disabled={busy}
          >
            <Save size={12} />
          </button>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={labelClass}>
              {t("integrations.mail.opendkim.config.socket", "Socket")}
            </label>
            <input
              className={inputClass}
              value={socket}
              onChange={(e) => setSocket(e.target.value)}
            />
          </div>
          <button
            className={btnGhost}
            onClick={async () => {
              await run(() => api.setSocket(id, socket));
            }}
            disabled={busy}
          >
            <Save size={12} />
          </button>
        </div>
      </div>

      {/* Set/lookup param */}
      <div className="mb-2 flex items-end gap-2">
        <Field
          label={t("integrations.mail.opendkim.config.paramKey", "Parameter")}
          value={paramKey}
          onChange={setParamKey}
          placeholder="Canonicalization"
        />
        <Field
          label={t("integrations.mail.opendkim.config.paramValue", "Value")}
          value={paramValue}
          onChange={setParamValue}
        />
        <button
          className={btnPrimary}
          onClick={async () => {
            await run(() => api.setConfigParam(id, paramKey, paramValue));
            await refresh();
          }}
          disabled={busy || !paramKey}
        >
          <Save size={14} />
          {t("integrations.mail.opendkim.actions.set", "Set")}
        </button>
        <button
          className={btnGhost}
          onClick={async () => {
            const r = await run(() => api.getConfigParam(id, paramKey));
            if (r) setParamValue(r.value);
          }}
          disabled={busy || !paramKey}
        >
          {t("integrations.mail.opendkim.config.lookup", "Lookup")}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      {testOut && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2 text-xs">
          {testOut}
        </pre>
      )}

      <div className="mt-3 space-y-1">
        {rows.map((r) => (
          <div
            key={r.key}
            className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <span className="font-mono text-[var(--color-text)]">{r.key}</span>
            <span className="text-[var(--color-textSecondary)]">{r.value}</span>
            <button
              className={`${btnSmall} ml-auto text-red-500`}
              onClick={async () => {
                await run(() => api.deleteConfigParam(id, r.key));
                await refresh();
              }}
              disabled={busy}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {t("integrations.mail.opendkim.config.empty", "No parameters.")}
          </p>
        )}
      </div>
    </SectionShell>
  );
};

// ── Stats ────────────────────────────────────────────────────────────────────

const StatsSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, run } = useAction();
  const [stats, setStats] = useState<OpendkimStats | null>(null);
  const [messages, setMessages] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const s = await run(() => api.getStats(id));
    if (s) setStats(s);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.stats.title", "Statistics")}
      actions={
        <>
          <button
            className={btnSmall}
            onClick={async () => {
              const r = await run(() => api.getLastMessages(id, 50));
              if (r) setMessages(r);
            }}
            disabled={busy}
          >
            {t("integrations.mail.opendkim.stats.lastMessages", "Last messages")}
          </button>
          <button
            className={btnSmall}
            onClick={async () => {
              await run(() => api.resetStats(id));
              await refresh();
            }}
            disabled={busy}
          >
            {t("integrations.mail.opendkim.stats.reset", "Reset")}
          </button>
          <button className={btnSmall} onClick={refresh} disabled={busy}>
            <RefreshCw size={12} />
          </button>
        </>
      }
    >
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              ["messages_signed", "Signed"],
              ["messages_verified", "Verified"],
              ["signatures_good", "Good sigs"],
              ["signatures_bad", "Bad sigs"],
              ["signatures_error", "Sig errors"],
              ["dns_queries", "DNS queries"],
            ] as const
          ).map(([k, lbl]) => (
            <div
              key={k}
              className="rounded border border-[var(--color-border)] p-2"
            >
              <p className="text-xs text-[var(--color-textSecondary)]">
                {t(`integrations.mail.opendkim.stats.${k}`, lbl)}
              </p>
              <p className="text-lg font-semibold text-[var(--color-text)]">
                {stats[k]}
              </p>
            </div>
          ))}
        </div>
      )}
      {messages.length > 0 && (
        <pre className="mt-3 max-h-40 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2 text-xs">
          {messages.join("\n")}
        </pre>
      )}
    </SectionShell>
  );
};

// ── Service ──────────────────────────────────────────────────────────────────

const ServiceSection: React.FC<SectionProps> = ({ id, api, t }) => {
  const { busy, error, run } = useAction();
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [info, setInfo] = useState<OpendkimInfo | null>(null);

  const refresh = useCallback(async () => {
    const s = await run(() => api.status(id));
    if (s !== undefined) setStatus(s);
    const v = await run(() => api.version(id));
    if (v !== undefined) setVersion(v);
    const i = await run(() => api.info(id));
    if (i) setInfo(i);
  }, [api, id, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ctl = (label: string, icon: React.ReactNode, fn: () => Promise<void>) => (
    <button
      className={btnGhost}
      onClick={async () => {
        await run(fn);
        await refresh();
      }}
      disabled={busy}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <SectionShell
      title={t("integrations.mail.opendkim.service.title", "Service")}
      actions={
        <button className={btnSmall} onClick={refresh} disabled={busy}>
          <RefreshCw size={12} />
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {ctl(
          t("integrations.mail.opendkim.service.start", "Start"),
          <Play size={14} />,
          () => api.start(id),
        )}
        {ctl(
          t("integrations.mail.opendkim.service.stop", "Stop"),
          <Square size={14} />,
          () => api.stop(id),
        )}
        {ctl(
          t("integrations.mail.opendkim.service.restart", "Restart"),
          <RotateCcw size={14} />,
          () => api.restart(id),
        )}
        {ctl(
          t("integrations.mail.opendkim.service.reload", "Reload"),
          <RefreshCw size={14} />,
          () => api.reload(id),
        )}
      </div>
      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
      <div className="space-y-1 text-xs">
        {status && (
          <p>
            <span className="text-[var(--color-textSecondary)]">
              {t("integrations.mail.opendkim.service.status", "Status")}:{" "}
            </span>
            <span className="font-mono text-[var(--color-text)]">{status}</span>
          </p>
        )}
        {version && (
          <p>
            <span className="text-[var(--color-textSecondary)]">
              {t("integrations.mail.opendkim.service.version", "Version")}:{" "}
            </span>
            <span className="font-mono text-[var(--color-text)]">{version}</span>
          </p>
        )}
        {info && (
          <pre className="max-h-40 overflow-auto rounded bg-[var(--color-surfaceHover)] p-2">
            {JSON.stringify(info, null, 2)}
          </pre>
        )}
      </div>
    </SectionShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-tab shell (connect form + section nav)
// ═══════════════════════════════════════════════════════════════════════════════

type SectionKey =
  | "keys"
  | "signing"
  | "keyTable"
  | "hosts"
  | "config"
  | "stats"
  | "service";

const OpendkimSubTab: React.FC<MailSubTabProps> = () => {
  const { t } = useTranslation();
  const tt = t as unknown as (k: string, d: string) => string;
  const { instancesFor, createInstance, updateInstance, readSecret } =
    useIntegrationConfigStore();
  const conn = useOpendkim();

  const [config, setConfig] = useState<OpendkimConnectionConfig>(() =>
    defaultOpendkimConnectionConfig(),
  );
  const [name, setName] = useState("");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionKey>("keys");
  const [knownConnections, setKnownConnections] = useState<string[]>([]);
  const hydrated = useRef(false);

  // Hydrate from the first persisted "mail.opendkim" instance (if any).
  const instances = instancesFor(INTEGRATION_KEY);
  useEffect(() => {
    if (hydrated.current) return;
    const inst = instances[0];
    if (!inst) return;
    hydrated.current = true;
    const fields = (inst.fields ?? {}) as Record<string, string>;
    setInstanceId(inst.id);
    setName(inst.name);
    (async () => {
      const secret = await readSecret(inst);
      setConfig({
        host: inst.host ?? "",
        port: Number(fields.port) || 22,
        ssh_user: fields.ssh_user || "",
        ssh_password: secret ?? "",
        ssh_key: fields.ssh_key || "",
        opendkim_bin: fields.opendkim_bin || "",
        config_path: fields.config_path || "",
        key_dir: fields.key_dir || "",
        timeout_secs: Number(fields.timeout_secs) || 30,
      });
    })();
  }, [instances, readSecret]);

  const set = useCallback(
    <K extends keyof OpendkimConnectionConfig>(
      key: K,
      value: OpendkimConnectionConfig[K],
    ) => {
      setConfig((c) => ({ ...c, [key]: value }));
      setSaved(false);
    },
    [],
  );

  /** Persist the non-secret config (+ vaulted ssh password) and return the id. */
  const persist = useCallback(async (): Promise<string | null> => {
    const fields: Record<string, string> = {
      port: String(config.port ?? 22),
      ssh_user: config.ssh_user ?? "",
      ssh_key: config.ssh_key ?? "",
      opendkim_bin: config.opendkim_bin ?? "",
      config_path: config.config_path ?? "",
      key_dir: config.key_dir ?? "",
      timeout_secs: String(config.timeout_secs ?? 30),
    };
    const input = {
      integrationKey: INTEGRATION_KEY,
      name: name.trim() || config.host || "OpenDKIM",
      host: config.host,
      fields,
      secret: config.ssh_password || undefined,
    };
    if (instanceId && instances.some((i) => i.id === instanceId)) {
      await updateInstance(instanceId, input);
      return instanceId;
    }
    const created = await createInstance(input);
    setInstanceId(created.id);
    return created.id;
  }, [config, name, instanceId, instances, createInstance, updateInstance]);

  const handleSave = useCallback(async () => {
    if (!config.host) {
      setFormError(
        tt("integrations.mail.opendkim.errors.hostRequired", "Host is required"),
      );
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await persist();
      setSaved(true);
    } catch (e) {
      setFormError(typeof e === "string" ? e : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [config.host, persist, tt]);

  const handleConnect = useCallback(async () => {
    if (!config.host) {
      setFormError(
        tt("integrations.mail.opendkim.errors.hostRequired", "Host is required"),
      );
      return;
    }
    setFormError(null);
    // Persist first so commands use a stable id (= the saved instance id).
    const id = (await persist()) ?? instanceId;
    if (!id) return;
    await conn.connect(id, config);
    try {
      setKnownConnections(await conn.api.listConnections());
    } catch {
      /* non-fatal */
    }
  }, [config, persist, instanceId, conn, tt]);

  const handleDisconnect = useCallback(async () => {
    if (instanceId) await conn.disconnect(instanceId);
  }, [conn, instanceId]);

  const sections: { key: SectionKey; label: string; icon: React.ReactNode }[] =
    useMemo(
      () => [
        {
          key: "keys",
          label: tt("integrations.mail.opendkim.tabs.keys", "Keys"),
          icon: <KeyRound size={14} />,
        },
        {
          key: "signing",
          label: tt("integrations.mail.opendkim.tabs.signing", "Signing"),
          icon: <FileCog size={14} />,
        },
        {
          key: "keyTable",
          label: tt("integrations.mail.opendkim.tabs.keyTable", "Key table"),
          icon: <KeyRound size={14} />,
        },
        {
          key: "hosts",
          label: tt("integrations.mail.opendkim.tabs.hosts", "Hosts"),
          icon: <ShieldCheck size={14} />,
        },
        {
          key: "config",
          label: tt("integrations.mail.opendkim.tabs.config", "Config"),
          icon: <FileCog size={14} />,
        },
        {
          key: "stats",
          label: tt("integrations.mail.opendkim.tabs.stats", "Stats"),
          icon: <Activity size={14} />,
        },
        {
          key: "service",
          label: tt("integrations.mail.opendkim.tabs.service", "Service"),
          icon: <Server size={14} />,
        },
      ],
      [tt],
    );

  const activeId = instanceId;

  return (
    <div className="flex h-full flex-col">
      {/* Header / status */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {tt("integrations.mail.opendkim.title", "OpenDKIM (signing)")}
            </h3>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {tt(
                "integrations.mail.opendkim.subtitle",
                "Manage DKIM keys, signing/key tables, trusted hosts, and the milter.",
              )}
            </p>
          </div>
        </div>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            conn.connected
              ? "bg-green-500/15 text-green-500"
              : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          }`}
        >
          {conn.connected ? (
            <CheckCircle2 size={12} />
          ) : (
            <AlertCircle size={12} />
          )}
          {conn.connected
            ? tt("integrations.mail.opendkim.connected", "Connected")
            : tt("integrations.mail.opendkim.disconnected", "Not connected")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Connect / config form */}
        <div className="mb-4 rounded border border-[var(--color-border)] p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              label={tt("integrations.mail.opendkim.form.name", "Instance name")}
              value={name}
              onChange={(v) => {
                setName(v);
                setSaved(false);
              }}
              placeholder="dkim.example.com"
            />
            <Field
              label={tt("integrations.mail.opendkim.form.host", "SSH host")}
              value={config.host}
              onChange={(v) => set("host", v)}
              placeholder="10.0.0.1"
            />
            <Field
              label={tt("integrations.mail.opendkim.form.port", "SSH port")}
              type="number"
              value={String(config.port ?? 22)}
              onChange={(v) => set("port", Number(v) || 22)}
            />
            <Field
              label={tt("integrations.mail.opendkim.form.sshUser", "SSH user")}
              value={config.ssh_user ?? ""}
              onChange={(v) => set("ssh_user", v)}
            />
            <Field
              label={tt(
                "integrations.mail.opendkim.form.sshPassword",
                "SSH password",
              )}
              type="password"
              value={config.ssh_password ?? ""}
              onChange={(v) => set("ssh_password", v)}
            />
            <Field
              label={tt(
                "integrations.mail.opendkim.form.sshKey",
                "SSH private key path",
              )}
              value={config.ssh_key ?? ""}
              onChange={(v) => set("ssh_key", v)}
            />
            <Field
              label={tt(
                "integrations.mail.opendkim.form.opendkimBin",
                "opendkim binary",
              )}
              value={config.opendkim_bin ?? ""}
              onChange={(v) => set("opendkim_bin", v)}
              placeholder="/usr/sbin/opendkim"
            />
            <Field
              label={tt(
                "integrations.mail.opendkim.form.configPath",
                "opendkim.conf path",
              )}
              value={config.config_path ?? ""}
              onChange={(v) => set("config_path", v)}
              placeholder="/etc/opendkim.conf"
            />
            <Field
              label={tt("integrations.mail.opendkim.form.keyDir", "Key directory")}
              value={config.key_dir ?? ""}
              onChange={(v) => set("key_dir", v)}
              placeholder="/etc/opendkim/keys"
            />
            <Field
              label={tt(
                "integrations.mail.opendkim.form.timeout",
                "Timeout (seconds)",
              )}
              type="number"
              value={String(config.timeout_secs ?? 30)}
              onChange={(v) => set("timeout_secs", Number(v) || 30)}
            />
          </div>

          {(formError || conn.error) && (
            <p className="mt-3 text-xs text-red-500">
              {formError || conn.error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            {conn.connected ? (
              <button
                className={btnGhost}
                onClick={handleDisconnect}
                disabled={conn.isLoading}
              >
                <PlugZap size={14} />
                {tt("integrations.mail.opendkim.disconnect", "Disconnect")}
              </button>
            ) : (
              <button
                className={btnPrimary}
                onClick={handleConnect}
                disabled={conn.isLoading}
              >
                {conn.isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plug size={14} />
                )}
                {tt("integrations.mail.opendkim.connect", "Connect")}
              </button>
            )}
            {conn.connected && activeId && (
              <button
                className={btnGhost}
                onClick={() => conn.ping(activeId)}
                disabled={conn.isLoading}
              >
                <Activity size={14} />
                {tt("integrations.mail.opendkim.ping", "Ping")}
              </button>
            )}
            <button className={btnGhost} onClick={handleSave} disabled={saving}>
              <Save size={14} />
              {saved
                ? tt("integrations.mail.opendkim.form.saved", "Saved")
                : tt("integrations.mail.opendkim.form.save", "Save")}
            </button>
            {knownConnections.length > 0 && (
              <span className="text-xs text-[var(--color-textSecondary)]">
                {tt(
                  "integrations.mail.opendkim.sessions",
                  "Active sessions",
                )}
                : {knownConnections.length}
              </span>
            )}
          </div>
          {conn.summary && (
            <p className="mt-2 text-xs text-[var(--color-textSecondary)]">
              {conn.summary.host}
              {conn.summary.version ? ` · v${conn.summary.version}` : ""}
              {conn.summary.mode ? ` · ${conn.summary.mode}` : ""}
            </p>
          )}
        </div>

        {/* Management sections — only once connected */}
        {conn.connected && activeId ? (
          <>
            <div className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
              {sections.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium ${
                    section === s.key
                      ? "border-b-2 border-primary text-[var(--color-text)]"
                      : "text-[var(--color-textSecondary)]"
                  }`}
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>
            {section === "keys" && (
              <KeysSection id={activeId} api={conn.api} t={tt} />
            )}
            {section === "signing" && (
              <SigningTableSection id={activeId} api={conn.api} t={tt} />
            )}
            {section === "keyTable" && (
              <KeyTableSection id={activeId} api={conn.api} t={tt} />
            )}
            {section === "hosts" && (
              <HostsSection id={activeId} api={conn.api} t={tt} />
            )}
            {section === "config" && (
              <ConfigSection id={activeId} api={conn.api} t={tt} />
            )}
            {section === "stats" && (
              <StatsSection id={activeId} api={conn.api} t={tt} />
            )}
            {section === "service" && (
              <ServiceSection id={activeId} api={conn.api} t={tt} />
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-[var(--color-textSecondary)]">
            <KeyRound className="h-8 w-8 opacity-50" />
            <p className="text-sm">
              {tt(
                "integrations.mail.opendkim.connectHint",
                "Connect to an OpenDKIM host to manage keys, tables, and the signing service.",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpendkimSubTab;
