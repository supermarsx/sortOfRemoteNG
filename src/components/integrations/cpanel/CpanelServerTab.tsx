// cPanel/WHM — "WHM / Server Administration" sub-tab (t42-cpanel-c1).
//
// Binds all 39 server-admin commands across six grouped, collapsible sections:
//   Accounts (12) · DNS (5) · Backups (5) · Security (8) · Monitoring (4) · PHP (5)
// Mounted only when the panel shell is connected, so `connectionId` is always a
// live cPanel/WHM connection id — it is passed as the `id` arg to every command.
// Account-scope commands additionally take a cPanel account `user`; the tab owns
// its own account selector (a read-only `cpanel_list_accounts` fetch, with a
// free-text fallback via the datalist input).

import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  X,
  Users,
  Globe,
  Archive,
  ShieldAlert,
  Activity,
  Code2,
  Play,
  Pause,
  Trash2,
  KeyRound,
  Server,
} from "lucide-react";

import {
  useCpanelServer,
  type CpanelServerManager,
} from "../../../hooks/integration/cpanel/useCpanelServer";
import type { CpanelTabProps } from "./registry";
import type {
  AccountSummary,
  BackupInfo,
  BandwidthUsage,
  CpanelAccount,
  CpanelServerInfo,
  CreateAccountRequest,
  DnsZone,
  ErrorLogEntry,
  HostingPackage,
  IpBlockRule,
  ModifyAccountRequest,
  PhpConfig,
  PhpExtension,
  PhpVersion,
  ResourceUsage,
  ServerLoadStatus,
  SshKey,
} from "../../../types/cpanel/server";

// ─── Shared styling (mirrors the panel shell + sibling tabs) ────────────────────

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50";

/** Build the i18n key for a `server.*` fragment leaf. Pair with an English
 *  default at the call site so a missing key degrades gracefully pre-merge. */
const t9 = (key: string) => `integrations.cpanel.server.${key}`;

const CREATE_ACCOUNT_TEMPLATE: CreateAccountRequest = {
  username: "",
  domain: "",
  password: "",
  plan: "",
  contactemail: "",
};

const MODIFY_ACCOUNT_TEMPLATE: ModifyAccountRequest = {
  user: "",
  quota: 0,
};

const ADD_DNS_TEMPLATE = {
  domain: "",
  name: "",
  record_type: "A",
  address: "",
  ttl: 14400,
};

const EDIT_DNS_TEMPLATE = {
  domain: "",
  line: 0,
  record_type: "A",
  address: "",
  ttl: 14400,
};

const CpanelServerTab: React.FC<CpanelTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const mgr = useCpanelServer();
  const { run, isLoading, error, clearError } = mgr;

  // Shared account selector: populated read-only from `cpanel_list_accounts`,
  // with a free-text fallback (the datalist input accepts arbitrary values).
  const [accounts, setAccounts] = useState<CpanelAccount[]>([]);
  const [user, setUser] = useState("");

  const reloadAccounts = useCallback(async () => {
    const list = await run((a) => a.listAccounts(connectionId));
    if (list) {
      setAccounts(list);
      setUser((prev) => prev || list[0]?.user || "");
    }
  }, [run, connectionId]);

  useEffect(() => {
    void reloadAccounts();
  }, [reloadAccounts]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Account selector + refresh */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label className={labelClass}>
            {t(t9("account"), "Account (cPanel user)")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              list="cpanel-server-accounts"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder={t(t9("accountPlaceholder"), "cpanel-user")}
            />
            <datalist id="cpanel-server-accounts">
              {accounts.map((a) => (
                <option key={a.user} value={a.user}>
                  {a.domain}
                </option>
              ))}
            </datalist>
            <button
              className={btnClass}
              onClick={() => void reloadAccounts()}
              disabled={isLoading}
              title={t(t9("reloadAccounts"), "Reload accounts")}
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </button>
          </div>
        </div>
        <span className="pb-1 text-[10px] text-[var(--color-textSecondary)]">
          {accounts.length}{" "}
          {t(t9("accountsLoaded"), "accounts loaded")}
        </span>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          <span className="break-all">{error}</span>
          <button onClick={clearError}>
            <X size={12} />
          </button>
        </div>
      )}

      <AccountsSection mgr={mgr} id={connectionId} user={user} accounts={accounts} onAccountsChanged={reloadAccounts} />
      <DnsSection mgr={mgr} id={connectionId} />
      <BackupsSection mgr={mgr} id={connectionId} user={user} />
      <SecuritySection mgr={mgr} id={connectionId} user={user} />
      <MonitoringSection mgr={mgr} id={connectionId} user={user} />
      <PhpSection mgr={mgr} id={connectionId} user={user} />
    </div>
  );
};

// ─── Collapsible titled group ───────────────────────────────────────────────---

const Group: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen, children }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded border border-[var(--color-border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-[var(--color-text)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        {title}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-2">
          {children}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Accounts (12)
// ═══════════════════════════════════════════════════════════════════════════════

const AccountsSection: React.FC<{
  mgr: CpanelServerManager;
  id: string;
  user: string;
  accounts: CpanelAccount[];
  onAccountsChanged: () => Promise<void>;
}> = ({ mgr, id, user, accounts, onAccountsChanged }) => {
  const { t } = useTranslation();
  const { run } = mgr;

  const [detail, setDetail] = useState<CpanelAccount | null>(null);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [serverInfo, setServerInfo] = useState<CpanelServerInfo | null>(null);
  const [packages, setPackages] = useState<HostingPackage[] | null>(null);
  const [suspended, setSuspended] = useState<CpanelAccount[] | null>(null);
  const [reason, setReason] = useState("");
  const [keepDns, setKeepDns] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [createJson, setCreateJson] = useState(() =>
    JSON.stringify(CREATE_ACCOUNT_TEMPLATE, null, 2),
  );
  const [modifyJson, setModifyJson] = useState(() =>
    JSON.stringify(MODIFY_ACCOUNT_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Group
      title={t(t9("accounts.title"), "Accounts")}
      icon={<Users size={12} />}
      defaultOpen
    >
      {/* Read views */}
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!user}
          onClick={() =>
            run((a) => a.getAccount(id, user)).then((d) => d && setDetail(d))
          }
        >
          {t(t9("accounts.load"), "Load account")}
        </button>
        <button
          className={btnClass}
          disabled={!user}
          onClick={() =>
            run((a) => a.getAccountSummary(id, user)).then(
              (s) => s && setSummary(s),
            )
          }
        >
          {t(t9("accounts.summary"), "Load summary")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getServerInfo(id)).then((s) => s && setServerInfo(s))
          }
        >
          <Server size={12} />
          {t(t9("accounts.serverInfo"), "Server info")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listPackages(id)).then((p) => p && setPackages(p))
          }
        >
          {t(t9("accounts.packages"), "List packages")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listSuspendedAccounts(id)).then(
              (s) => s && setSuspended(s),
            )
          }
        >
          {t(t9("accounts.suspendedList"), "Show suspended")}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("accounts.stat.disk"), "Disk MB")} value={summary.disk_used_mb} />
          <Stat label={t(t9("accounts.stat.bw"), "BW MB")} value={summary.bandwidth_used_mb} />
          <Stat label={t(t9("accounts.stat.email"), "Email")} value={summary.email_accounts} />
          <Stat label={t(t9("accounts.stat.db"), "DBs")} value={summary.databases} />
          <Stat label={t(t9("accounts.stat.addon"), "Addons")} value={summary.addon_domains} />
          <Stat label={t(t9("accounts.stat.sub"), "Subs")} value={summary.subdomains} />
          <Stat label={t(t9("accounts.stat.parked"), "Parked")} value={summary.parked_domains} />
          <Stat label={t(t9("accounts.stat.ftp"), "FTP")} value={summary.ftp_accounts} />
        </div>
      )}
      {serverInfo && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("accounts.stat.host"), "Host")} value={serverInfo.hostname} />
          <Stat label={t(t9("accounts.stat.ver"), "Version")} value={serverInfo.version} />
          <Stat label={t(t9("accounts.stat.os"), "OS")} value={serverInfo.os} />
          <Stat label={t(t9("accounts.stat.accts"), "Accounts")} value={serverInfo.current_accounts} />
        </div>
      )}
      {detail && <Json value={detail} />}
      {packages && (
        <RowList
          items={packages.map((p) => ({ key: p.name, primary: p.name, secondary: `${p.quota ?? "∞"} MB` }))}
        />
      )}
      {suspended && (
        <RowList
          items={suspended.map((s) => ({
            key: s.user,
            primary: s.user,
            secondary: s.suspend_reason ?? s.domain,
          }))}
        />
      )}

      {/* Mutations against the selected account */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("accounts.suspendReason"), "Suspend reason (optional)")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              className={btnClass}
              disabled={!user}
              onClick={() =>
                run((a) => a.suspendAccount(id, user, reason.trim() || undefined))
                  .then(() => setReason(""))
                  .then(onAccountsChanged)
              }
            >
              <Pause size={12} />
              {t(t9("accounts.suspend"), "Suspend")}
            </button>
            <button
              className={btnClass}
              disabled={!user}
              onClick={() =>
                run((a) => a.unsuspendAccount(id, user)).then(onAccountsChanged)
              }
            >
              <Play size={12} />
              {t(t9("accounts.unsuspend"), "Unsuspend")}
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("accounts.newPassword"), "New password")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="off"
            />
            <button
              className={btnClass}
              disabled={!user || !newPassword}
              onClick={() =>
                run((a) => a.changeAccountPassword(id, user, newPassword)).then(
                  () => setNewPassword(""),
                )
              }
            >
              <KeyRound size={12} />
              {t(t9("accounts.setPassword"), "Change")}
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-textSecondary)]">
            <input
              type="checkbox"
              checked={keepDns}
              onChange={(e) => setKeepDns(e.target.checked)}
            />
            {t(t9("accounts.keepDns"), "Keep DNS zone on terminate")}
          </label>
          <button
            className={`${btnClass} mt-1 border-red-500/40 text-red-500`}
            disabled={!user}
            onClick={() =>
              run((a) => a.terminateAccount(id, user, keepDns)).then(
                onAccountsChanged,
              )
            }
          >
            <Trash2 size={12} />
            {t(t9("accounts.terminate"), "Terminate account")}
          </button>
        </div>
      </div>

      {/* Create + modify (JSON request bodies — snake_case struct fields) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("accounts.createReq"), "Create account (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={7}
            value={createJson}
            onChange={(e) => setCreateJson(e.target.value)}
          />
          <button
            className={`${primaryBtn} mt-1`}
            onClick={() => {
              let req: CreateAccountRequest;
              try {
                req = JSON.parse(createJson) as CreateAccountRequest;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.createAccount(id, req)).then(onAccountsChanged);
            }}
          >
            {t(t9("accounts.create"), "Create")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("accounts.modifyReq"), "Modify account (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={7}
            value={modifyJson}
            onChange={(e) => setModifyJson(e.target.value)}
          />
          <button
            className={`${btnClass} mt-1`}
            onClick={() => {
              let req: ModifyAccountRequest;
              try {
                req = JSON.parse(modifyJson) as ModifyAccountRequest;
              } catch (e) {
                setParseError((e as Error).message);
                return;
              }
              setParseError(null);
              void run((a) => a.modifyAccount(id, req)).then(onAccountsChanged);
            }}
          >
            {t(t9("accounts.modify"), "Apply changes")}
          </button>
        </div>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DNS (5)
// ═══════════════════════════════════════════════════════════════════════════════

const DnsSection: React.FC<{ mgr: CpanelServerManager; id: string }> = ({
  mgr,
  id,
}) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [zones, setZones] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [zone, setZone] = useState<DnsZone | null>(null);
  const [removeLine, setRemoveLine] = useState("");
  const [addJson, setAddJson] = useState(() =>
    JSON.stringify(ADD_DNS_TEMPLATE, null, 2),
  );
  const [editJson, setEditJson] = useState(() =>
    JSON.stringify(EDIT_DNS_TEMPLATE, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const loadZone = useCallback(
    (d: string) => run((a) => a.getDnsZone(id, d)).then((z) => z && setZone(z)),
    [run, id],
  );

  return (
    <Group title={t(t9("dns.title"), "DNS Zones")} icon={<Globe size={12} />}>
      <div className="flex flex-wrap items-end gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listDnsZones(id)).then((z) => z && setZones(z))
          }
        >
          {t(t9("dns.listZones"), "List zones")}
        </button>
        <input
          className={`${inputClass} max-w-[200px]`}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder={t(t9("dns.domain"), "example.com")}
          list="cpanel-dns-zones"
        />
        <datalist id="cpanel-dns-zones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        <button
          className={btnClass}
          disabled={!domain.trim()}
          onClick={() => void loadZone(domain.trim())}
        >
          {t(t9("dns.loadZone"), "Load zone")}
        </button>
      </div>

      {zones.length > 0 && (
        <RowList
          items={zones.map((z) => ({
            key: z,
            primary: z,
            onClick: () => {
              setDomain(z);
              void loadZone(z);
            },
          }))}
        />
      )}

      {zone && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[var(--color-textSecondary)]">
              <tr>
                <th className="px-1 py-0.5">{t(t9("dns.col.line"), "Line")}</th>
                <th className="px-1 py-0.5">{t(t9("dns.col.name"), "Name")}</th>
                <th className="px-1 py-0.5">{t(t9("dns.col.type"), "Type")}</th>
                <th className="px-1 py-0.5">{t(t9("dns.col.value"), "Value")}</th>
              </tr>
            </thead>
            <tbody>
              {zone.records.map((r, i) => (
                <tr key={`${r.line ?? i}`} className="border-t border-[var(--color-border)]">
                  <td className="px-1 py-0.5">{r.line ?? "—"}</td>
                  <td className="px-1 py-0.5">{r.name}</td>
                  <td className="px-1 py-0.5">{r.record_type}</td>
                  <td className="px-1 py-0.5 break-all">
                    {r.address ?? r.cname ?? r.exchange ?? r.txtdata ?? r.target ?? r.raw ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("dns.addReq"), "Add record (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={6}
            value={addJson}
            onChange={(e) => setAddJson(e.target.value)}
          />
          <button
            className={`${primaryBtn} mt-1`}
            onClick={() => {
              try {
                const req = JSON.parse(addJson);
                setParseError(null);
                void run((a) => a.addDnsRecord(id, req)).then(() =>
                  domain.trim() ? loadZone(domain.trim()) : undefined,
                );
              } catch (e) {
                setParseError((e as Error).message);
              }
            }}
          >
            {t(t9("dns.add"), "Add record")}
          </button>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("dns.editReq"), "Edit record (JSON)")}
          </label>
          <textarea
            className={`${inputClass} font-mono`}
            rows={6}
            value={editJson}
            onChange={(e) => setEditJson(e.target.value)}
          />
          <button
            className={`${btnClass} mt-1`}
            onClick={() => {
              try {
                const req = JSON.parse(editJson);
                setParseError(null);
                void run((a) => a.editDnsRecord(id, req)).then(() =>
                  domain.trim() ? loadZone(domain.trim()) : undefined,
                );
              } catch (e) {
                setParseError((e as Error).message);
              }
            }}
          >
            {t(t9("dns.edit"), "Save record")}
          </button>
        </div>
      </div>

      <div className="flex items-end gap-1">
        <div className="flex-1">
          <label className={labelClass}>
            {t(t9("dns.removeLine"), "Remove record (zone + line)")}
          </label>
          <div className="flex gap-1">
            <input
              className={inputClass}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={t(t9("dns.domain"), "example.com")}
            />
            <input
              className={`${inputClass} max-w-[100px]`}
              type="number"
              value={removeLine}
              onChange={(e) => setRemoveLine(e.target.value)}
              placeholder="line"
            />
            <button
              className={`${btnClass} border-red-500/40 text-red-500`}
              disabled={!domain.trim() || !removeLine}
              onClick={() =>
                run((a) =>
                  a.removeDnsRecord(id, domain.trim(), Number(removeLine)),
                ).then(() =>
                  domain.trim() ? loadZone(domain.trim()) : undefined,
                )
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>
      {parseError && <p className="text-[11px] text-red-500">{parseError}</p>}
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Backups (5)
// ═══════════════════════════════════════════════════════════════════════════════

const BackupsSection: React.FC<{
  mgr: CpanelServerManager;
  id: string;
  user: string;
}> = ({ mgr, id, user }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [config, setConfig] = useState<unknown>(null);
  const [dest, setDest] = useState("");
  const [email, setEmail] = useState("");
  const [restoreBackup, setRestoreBackup] = useState("");
  const [restorePath, setRestorePath] = useState("");

  return (
    <Group title={t(t9("backups.title"), "Backups")} icon={<Archive size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!user}
          onClick={() =>
            run((a) => a.listBackups(id, user)).then((b) => b && setBackups(b))
          }
        >
          {t(t9("backups.list"), "List backups")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getBackupConfig(id)).then((c) => setConfig(c ?? null))
          }
        >
          {t(t9("backups.config"), "Backup config")}
        </button>
        <button
          className={btnClass}
          onClick={() => void run((a) => a.triggerServerBackup(id))}
        >
          {t(t9("backups.trigger"), "Trigger server backup")}
        </button>
      </div>

      {backups && (
        <RowList
          items={backups.map((b, i) => ({
            key: b.backup_id ?? `${i}`,
            primary: b.backup_id ?? b.backup_type,
            secondary: `${b.backup_type} · ${b.status ?? ""} ${b.created_at ?? ""}`,
          }))}
        />
      )}
      {config != null && <Json value={config} />}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>
            {t(t9("backups.createFull"), "Create full backup (account)")}
          </label>
          <div className="flex flex-col gap-1">
            <input
              className={inputClass}
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder={t(t9("backups.dest"), "destination (optional)")}
            />
            <input
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(t9("backups.email"), "notify email (optional)")}
            />
            <button
              className={primaryBtn}
              disabled={!user}
              onClick={() =>
                run((a) =>
                  a.createFullBackup(
                    id,
                    user,
                    dest.trim() || undefined,
                    email.trim() || undefined,
                  ),
                )
              }
            >
              {t(t9("backups.create"), "Create full backup")}
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {t(t9("backups.restore"), "Restore file from backup")}
          </label>
          <div className="flex flex-col gap-1">
            <input
              className={inputClass}
              value={restoreBackup}
              onChange={(e) => setRestoreBackup(e.target.value)}
              placeholder={t(t9("backups.backupId"), "backup id / path")}
            />
            <input
              className={inputClass}
              value={restorePath}
              onChange={(e) => setRestorePath(e.target.value)}
              placeholder={t(t9("backups.path"), "path to restore")}
            />
            <button
              className={btnClass}
              disabled={!user || !restoreBackup.trim() || !restorePath.trim()}
              onClick={() =>
                run((a) =>
                  a.restoreFile(
                    id,
                    user,
                    restoreBackup.trim(),
                    restorePath.trim(),
                  ),
                )
              }
            >
              {t(t9("backups.restoreBtn"), "Restore")}
            </button>
          </div>
        </div>
      </div>
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Security (8)
// ═══════════════════════════════════════════════════════════════════════════════

const SecuritySection: React.FC<{
  mgr: CpanelServerManager;
  id: string;
  user: string;
}> = ({ mgr, id, user }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [blocked, setBlocked] = useState<IpBlockRule[] | null>(null);
  const [keys, setKeys] = useState<SshKey[] | null>(null);
  const [ip, setIp] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyType, setKeyType] = useState("rsa");
  const [keyBody, setKeyBody] = useState("");
  const [modsecDomain, setModsecDomain] = useState("");
  const [modsecStatus, setModsecStatus] = useState<boolean | null>(null);

  const reloadBlocked = useCallback(
    () => run((a) => a.listBlockedIps(id, user)).then((b) => b && setBlocked(b)),
    [run, id, user],
  );
  const reloadKeys = useCallback(
    () => run((a) => a.listSshKeys(id, user)).then((k) => k && setKeys(k)),
    [run, id, user],
  );

  return (
    <Group
      title={t(t9("security.title"), "Server Security")}
      icon={<ShieldAlert size={12} />}
    >
      {/* Blocked IPs */}
      <div>
        <label className={labelClass}>
          {t(t9("security.blockedIps"), "Blocked IPs")}
        </label>
        <div className="flex gap-1">
          <input
            className={inputClass}
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="203.0.113.5"
          />
          <button
            className={btnClass}
            disabled={!user || !ip.trim()}
            onClick={() =>
              run((a) => a.blockIp(id, user, ip.trim()))
                .then(() => setIp(""))
                .then(reloadBlocked)
            }
          >
            {t(t9("security.block"), "Block")}
          </button>
          <button
            className={btnClass}
            disabled={!user || !ip.trim()}
            onClick={() =>
              run((a) => a.unblockIp(id, user, ip.trim()))
                .then(() => setIp(""))
                .then(reloadBlocked)
            }
          >
            {t(t9("security.unblock"), "Unblock")}
          </button>
          <button className={btnClass} disabled={!user} onClick={reloadBlocked}>
            <RefreshCw size={12} />
          </button>
        </div>
        {blocked && (
          <RowList
            items={blocked.map((b) => ({
              key: b.ip,
              primary: b.ip,
              secondary: b.comment,
            }))}
          />
        )}
      </div>

      {/* SSH keys */}
      <div>
        <label className={labelClass}>
          {t(t9("security.sshKeys"), "SSH keys")}
        </label>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          <input
            className={inputClass}
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder={t(t9("security.keyName"), "key name")}
          />
          <input
            className={inputClass}
            value={keyType}
            onChange={(e) => setKeyType(e.target.value)}
            placeholder={t(t9("security.keyType"), "key type (rsa/ed25519)")}
          />
          <div className="flex gap-1">
            <button className={btnClass} disabled={!user} onClick={reloadKeys}>
              <RefreshCw size={12} />
              {t(t9("security.listKeys"), "List")}
            </button>
            <button
              className={`${btnClass} border-red-500/40 text-red-500`}
              disabled={!user || !keyName.trim()}
              onClick={() =>
                run((a) => a.deleteSshKey(id, user, keyName.trim(), keyType.trim()))
                  .then(() => setKeyName(""))
                  .then(reloadKeys)
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        <textarea
          className={`${inputClass} mt-1 font-mono`}
          rows={3}
          value={keyBody}
          onChange={(e) => setKeyBody(e.target.value)}
          placeholder={t(t9("security.keyBody"), "public/private key body")}
        />
        <button
          className={`${primaryBtn} mt-1`}
          disabled={!user || !keyName.trim() || !keyBody.trim()}
          onClick={() =>
            run((a) =>
              a.importSshKey(id, user, keyName.trim(), keyBody, keyType.trim()),
            )
              .then(() => setKeyBody(""))
              .then(reloadKeys)
          }
        >
          <KeyRound size={12} />
          {t(t9("security.importKey"), "Import key")}
        </button>
        {keys && (
          <RowList
            items={keys.map((k) => ({
              key: k.name,
              primary: k.name,
              secondary: `${k.key_type ?? ""} ${k.fingerprint ?? ""} ${k.authorized ? "✓" : ""}`,
            }))}
          />
        )}
      </div>

      {/* ModSecurity */}
      <div>
        <label className={labelClass}>
          {t(t9("security.modsec"), "ModSecurity (per domain)")}
        </label>
        <div className="flex gap-1">
          <input
            className={inputClass}
            value={modsecDomain}
            onChange={(e) => setModsecDomain(e.target.value)}
            placeholder={t(t9("dns.domain"), "example.com")}
          />
          <button
            className={btnClass}
            disabled={!modsecDomain.trim()}
            onClick={() =>
              run((a) => a.getModsecStatus(id, modsecDomain.trim())).then(
                (s) => s !== undefined && setModsecStatus(s),
              )
            }
          >
            {t(t9("security.modsecCheck"), "Check")}
          </button>
          <button
            className={btnClass}
            disabled={!modsecDomain.trim()}
            onClick={() =>
              run((a) => a.setModsec(id, modsecDomain.trim(), true)).then(() =>
                setModsecStatus(true),
              )
            }
          >
            {t(t9("security.modsecOn"), "Enable")}
          </button>
          <button
            className={btnClass}
            disabled={!modsecDomain.trim()}
            onClick={() =>
              run((a) => a.setModsec(id, modsecDomain.trim(), false)).then(() =>
                setModsecStatus(false),
              )
            }
          >
            {t(t9("security.modsecOff"), "Disable")}
          </button>
        </div>
        {modsecStatus !== null && (
          <p className="mt-1 text-[11px] text-[var(--color-textSecondary)]">
            {t(t9("security.modsecState"), "ModSecurity")}:{" "}
            {modsecStatus
              ? t(t9("security.enabled"), "enabled")
              : t(t9("security.disabled"), "disabled")}
          </p>
        )}
      </div>
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Monitoring (4)
// ═══════════════════════════════════════════════════════════════════════════════

const MonitoringSection: React.FC<{
  mgr: CpanelServerManager;
  id: string;
  user: string;
}> = ({ mgr, id, user }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [bandwidth, setBandwidth] = useState<BandwidthUsage | null>(null);
  const [resource, setResource] = useState<ResourceUsage | null>(null);
  const [load, setLoad] = useState<ServerLoadStatus | null>(null);
  const [errors, setErrors] = useState<ErrorLogEntry[] | null>(null);
  const [lines, setLines] = useState("100");

  return (
    <Group
      title={t(t9("monitoring.title"), "Monitoring")}
      icon={<Activity size={12} />}
    >
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          disabled={!user}
          onClick={() =>
            run((a) => a.getBandwidth(id, user)).then((b) => b && setBandwidth(b))
          }
        >
          {t(t9("monitoring.bandwidth"), "Bandwidth")}
        </button>
        <button
          className={btnClass}
          disabled={!user}
          onClick={() =>
            run((a) => a.getResourceUsage(id, user)).then(
              (r) => r && setResource(r),
            )
          }
        >
          {t(t9("monitoring.resources"), "Resource usage")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getServerLoad(id)).then((l) => l && setLoad(l))
          }
        >
          {t(t9("monitoring.load"), "Server load")}
        </button>
      </div>

      {load && (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
          <Stat label="1m" value={load.one} />
          <Stat label="5m" value={load.five} />
          <Stat label="15m" value={load.fifteen} />
          <Stat label={t(t9("monitoring.cpus"), "CPUs")} value={load.cpu_count} />
          <Stat label={t(t9("monitoring.running"), "Running")} value={load.running_procs} />
          <Stat label={t(t9("monitoring.total"), "Total")} value={load.total_procs} />
        </div>
      )}
      {bandwidth && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label={t(t9("monitoring.used"), "Used bytes")} value={bandwidth.used_bytes} />
          <Stat label={t(t9("monitoring.limit"), "Limit bytes")} value={bandwidth.limit_bytes} />
          <Stat label="HTTP" value={bandwidth.http_bytes} />
          <Stat label="SMTP" value={bandwidth.smtp_bytes} />
        </div>
      )}
      {resource && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          <Stat label="CPU%" value={resource.cpu_usage} />
          <Stat label={t(t9("monitoring.mem"), "Mem MB")} value={resource.memory_mb} />
          <Stat label={t(t9("monitoring.procs"), "Procs")} value={resource.processes} />
          <Stat label="IO" value={resource.io_usage} />
        </div>
      )}

      <div>
        <label className={labelClass}>
          {t(t9("monitoring.errorLog"), "Error log (lines)")}
        </label>
        <div className="flex gap-1">
          <input
            className={`${inputClass} max-w-[120px]`}
            type="number"
            value={lines}
            onChange={(e) => setLines(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!user}
            onClick={() =>
              run((a) => a.getErrorLog(id, user, Number(lines) || 100)).then(
                (e) => e && setErrors(e),
              )
            }
          >
            {t(t9("monitoring.loadLog"), "Load log")}
          </button>
        </div>
        {errors && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
            {errors
              .map((e) => `[${e.level ?? ""}] ${e.timestamp ?? ""} ${e.message}`)
              .join("\n")}
          </pre>
        )}
      </div>
    </Group>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHP (5)
// ═══════════════════════════════════════════════════════════════════════════════

const PhpSection: React.FC<{
  mgr: CpanelServerManager;
  id: string;
  user: string;
}> = ({ mgr, id, user }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [versions, setVersions] = useState<PhpVersion[] | null>(null);
  const [domain, setDomain] = useState("");
  const [domainVersion, setDomainVersion] = useState("");
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [configVersion, setConfigVersion] = useState("");
  const [config, setConfig] = useState<PhpConfig | null>(null);
  const [extensions, setExtensions] = useState<PhpExtension[] | null>(null);

  return (
    <Group title={t(t9("php.title"), "PHP")} icon={<Code2 size={12} />}>
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.listPhpVersions(id)).then((v) => v && setVersions(v))
          }
        >
          {t(t9("php.listVersions"), "List versions")}
        </button>
      </div>
      {versions && (
        <RowList
          items={versions.map((v) => ({
            key: v.version,
            primary: v.version,
            secondary: `${v.handler ?? ""} ${v.is_default ? "(default)" : ""}`,
          }))}
        />
      )}

      <div>
        <label className={labelClass}>
          {t(t9("php.domainVersion"), "Per-domain PHP version")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[200px]`}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t(t9("dns.domain"), "example.com")}
          />
          <input
            className={`${inputClass} max-w-[140px]`}
            value={domainVersion}
            onChange={(e) => setDomainVersion(e.target.value)}
            placeholder={t(t9("php.version"), "ea-php82")}
          />
          <button
            className={btnClass}
            disabled={!user || !domain.trim()}
            onClick={() =>
              run((a) => a.getDomainPhpVersion(id, user, domain.trim())).then(
                (v) => v !== undefined && setCurrentVersion(v),
              )
            }
          >
            {t(t9("php.get"), "Get")}
          </button>
          <button
            className={primaryBtn}
            disabled={!user || !domain.trim() || !domainVersion.trim()}
            onClick={() =>
              run((a) =>
                a.setDomainPhpVersion(
                  id,
                  user,
                  domain.trim(),
                  domainVersion.trim(),
                ),
              ).then(() => setCurrentVersion(domainVersion.trim()))
            }
          >
            {t(t9("php.set"), "Set")}
          </button>
        </div>
        {currentVersion !== null && (
          <p className="mt-1 text-[11px] text-[var(--color-textSecondary)]">
            {t(t9("php.current"), "Current")}: {currentVersion || "—"}
          </p>
        )}
      </div>

      <div>
        <label className={labelClass}>
          {t(t9("php.configExt"), "Config / extensions (by version)")}
        </label>
        <div className="flex flex-wrap gap-1">
          <input
            className={`${inputClass} max-w-[160px]`}
            value={configVersion}
            onChange={(e) => setConfigVersion(e.target.value)}
            placeholder={t(t9("php.version"), "ea-php82")}
          />
          <button
            className={btnClass}
            disabled={!user || !configVersion.trim()}
            onClick={() =>
              run((a) => a.getPhpConfig(id, user, configVersion.trim())).then(
                (c) => c && setConfig(c),
              )
            }
          >
            {t(t9("php.loadConfig"), "Load config")}
          </button>
          <button
            className={btnClass}
            disabled={!user || !configVersion.trim()}
            onClick={() =>
              run((a) =>
                a.listPhpExtensions(id, user, configVersion.trim()),
              ).then((e) => e && setExtensions(e))
            }
          >
            {t(t9("php.loadExt"), "Load extensions")}
          </button>
        </div>
        {config && (
          <div className="mt-1 max-h-40 overflow-auto">
            <RowList
              items={config.directives.map((d) => ({
                key: d.key,
                primary: d.key,
                secondary: d.value,
              }))}
            />
          </div>
        )}
        {extensions && (
          <div className="mt-1 flex flex-wrap gap-1">
            {extensions.map((e) => (
              <span
                key={e.name}
                className={`rounded border px-1 py-0.5 text-[10px] ${
                  e.enabled
                    ? "border-green-500/40 text-green-500"
                    : "border-[var(--color-border)] text-[var(--color-textSecondary)]"
                }`}
              >
                {e.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Group>
  );
};

// ─── Small presentational helpers ──────────────────────────────────────────────

const Stat: React.FC<{ label: string; value?: number | string | null }> = ({
  label,
  value,
}) => (
  <div className="rounded border border-[var(--color-border)] px-1.5 py-1">
    <div className="text-[10px] text-[var(--color-textSecondary)]">{label}</div>
    <div className="truncate text-[11px] font-medium text-[var(--color-text)]">
      {value ?? "—"}
    </div>
  </div>
);

interface Row {
  key: string;
  primary: string;
  secondary?: string;
  onClick?: () => void;
}

const RowList: React.FC<{ items: Row[] }> = ({ items }) => (
  <ul className="flex flex-col gap-0.5">
    {items.length === 0 && (
      <li className="px-1 py-1 text-[11px] text-[var(--color-textSecondary)]">—</li>
    )}
    {items.map((r) => (
      <li key={r.key}>
        <button
          onClick={r.onClick}
          disabled={!r.onClick}
          className="flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border)] px-1.5 py-1 text-left text-[11px] hover:bg-[var(--color-surfaceHover)] disabled:cursor-default disabled:hover:bg-transparent"
        >
          <span className="font-medium text-[var(--color-text)]">{r.primary}</span>
          {r.secondary && (
            <span className="truncate text-[var(--color-textSecondary)]">
              {r.secondary}
            </span>
          )}
        </button>
      </li>
    ))}
  </ul>
);

const Json: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="max-h-48 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

export default CpanelServerTab;
