// ExchangeClientAccessTab — the "Client Access & Protocols" category slice of the
// Exchange panel (t42-exchange-c4). Binds all 44 commands of this category, grouped
// into six sub-sections: Calendar, Public Folders, Mobile Devices, Inbox Rules,
// Client-Access Policies, and Virtual Directories & Outlook Anywhere.
//
// ⚠️ Exchange is a SINGLETON service: this tab is mounted by the shell only when
// connected, and no command takes a connection id — each runs against the one
// active connection. The tab receives only the connection `summary` via props.

import React, { useCallback, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  FolderTree,
  Globe,
  Loader2,
  Inbox,
  RefreshCw,
  Shield,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExchangeTabProps } from "./registry";
import { useExchangeClientAccess } from "../../../hooks/integration/exchange/useExchangeClientAccess";
import type {
  CalendarPermission,
  CreateInboxRuleRequest,
  InboxRule,
  MobileDevice,
  MobileDeviceMailboxPolicy,
  MobileDeviceStatistics,
  OwaMailboxPolicy,
  PublicFolder,
  PublicFolderStatistics,
  ResourceBookingConfig,
  ThrottlingPolicy,
  VirtualDirectory,
  VirtualDirectoryType,
} from "../../../types/exchange/clientaccess";

// ── shared presentational primitives ─────────────────────────────────────────

const inputCls =
  "rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const primaryBtnCls =
  "flex items-center justify-center gap-2 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const dangerBtnCls =
  "flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-danger,#f87171)] hover:bg-[var(--color-dangerBg,#3a1a1a)] disabled:opacity-50";
const thCls =
  "px-2 py-1 text-left font-medium text-[var(--color-textSecondary)]";
const tdCls = "px-2 py-1 text-[var(--color-text)]";

function useT() {
  const { t } = useTranslation();
  return t;
}

const ErrorBar: React.FC<{ error: string | null; onDismiss: () => void }> = ({
  error,
  onDismiss,
}) =>
  error ? (
    <div className="mb-2 flex items-start justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-2 text-xs text-[var(--color-danger,#f87171)]">
      <span className="flex items-center gap-1">
        <AlertTriangle size={13} /> {error}
      </span>
      <button onClick={onDismiss} className="opacity-70 hover:opacity-100">
        ×
      </button>
    </div>
  ) : null;

const SectionShell: React.FC<{
  title: string;
  loading: boolean;
  error: string | null;
  onDismiss: () => void;
  children: React.ReactNode;
}> = ({ title, loading, error, onDismiss, children }) => (
  <div className="flex flex-col gap-4 p-4">
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      {loading && <Loader2 size={14} className="animate-spin text-primary" />}
    </div>
    <ErrorBar error={error} onDismiss={onDismiss} />
    {children}
  </div>
);

/** A titled block within a section. */
const Block: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3">
    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
      {title}
    </div>
    {children}
  </div>
);

/** A one-line result banner (for string-returning mutate commands). */
const ResultLine: React.FC<{ text: string | null }> = ({ text }) =>
  text ? (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-textSecondary)]">
      {text}
    </div>
  ) : null;

// ═══════════════════════════════════════════════════════════════════════════════
// Calendar
// ═══════════════════════════════════════════════════════════════════════════════

const CalendarSection: React.FC = () => {
  const t = useT();
  const { api, loading, error, clearError, run } = useExchangeClientAccess();
  const [identity, setIdentity] = useState("");
  const [perms, setPerms] = useState<CalendarPermission[]>([]);
  const [user, setUser] = useState("");
  const [accessRights, setAccessRights] = useState("Reviewer");
  const [booking, setBooking] = useState<ResourceBookingConfig | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const loadPerms = useCallback(async () => {
    const p = await run(() => api.listCalendarPermissions(identity));
    if (p) setPerms(p);
  }, [api, identity, run]);

  const setPerm = useCallback(async () => {
    const r = await run(() =>
      api.setCalendarPermission(identity, user, accessRights),
    );
    if (r !== undefined) {
      setResult(r);
      loadPerms();
    }
  }, [api, identity, user, accessRights, loadPerms, run]);

  const removePerm = useCallback(
    async (targetUser: string) => {
      const r = await run(() =>
        api.removeCalendarPermission(identity, targetUser),
      );
      if (r !== undefined) {
        setResult(r);
        loadPerms();
      }
    },
    [api, identity, loadPerms, run],
  );

  const loadBooking = useCallback(async () => {
    const b = await run(() => api.getBookingConfig(identity));
    if (b) setBooking(b);
  }, [api, identity, run]);

  const saveBooking = useCallback(async () => {
    if (!booking) return;
    const r = await run(() => api.setBookingConfig(booking));
    if (r !== undefined) setResult(r);
  }, [api, booking, run]);

  return (
    <SectionShell
      title={t("integrations.exchange.clientaccess.calendar.title", "Calendar")}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.exchange.clientaccess.common.mailbox", "Mailbox")}
          <input
            className={inputCls}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="user@contoso.com"
          />
        </label>
        <button className={btnCls} onClick={loadPerms} disabled={!identity}>
          <RefreshCw size={13} />
          {t(
            "integrations.exchange.clientaccess.calendar.loadPerms",
            "Permissions",
          )}
        </button>
        <button className={btnCls} onClick={loadBooking} disabled={!identity}>
          {t(
            "integrations.exchange.clientaccess.calendar.loadBooking",
            "Booking config",
          )}
        </button>
      </div>

      <ResultLine text={result} />

      <Block
        title={t(
          "integrations.exchange.clientaccess.calendar.permissions",
          "Calendar permissions",
        )}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder={t(
              "integrations.exchange.clientaccess.calendar.user",
              "User",
            )}
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.exchange.clientaccess.calendar.accessRights",
              "Access rights",
            )}
            value={accessRights}
            onChange={(e) => setAccessRights(e.target.value)}
          />
          <button
            className={primaryBtnCls}
            onClick={setPerm}
            disabled={!identity || !user}
          >
            {t("integrations.exchange.clientaccess.common.apply", "Apply")}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>
                {t("integrations.exchange.clientaccess.calendar.user", "User")}
              </th>
              <th className={thCls}>
                {t(
                  "integrations.exchange.clientaccess.calendar.accessRights",
                  "Access rights",
                )}
              </th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {perms.map((p) => (
              <tr
                key={p.user}
                className="border-t border-[var(--color-border)]"
              >
                <td className={tdCls}>{p.user}</td>
                <td className={tdCls}>{p.accessRights}</td>
                <td className={tdCls}>
                  <button
                    className={dangerBtnCls}
                    onClick={() => removePerm(p.user)}
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      {booking && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.calendar.booking",
            "Resource booking",
          )}
        >
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={booking.autoAccept}
                onChange={(e) =>
                  setBooking({ ...booking, autoAccept: e.target.checked })
                }
              />
              {t(
                "integrations.exchange.clientaccess.calendar.autoAccept",
                "Auto-accept",
              )}
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={booking.allowConflicts}
                onChange={(e) =>
                  setBooking({ ...booking, allowConflicts: e.target.checked })
                }
              />
              {t(
                "integrations.exchange.clientaccess.calendar.allowConflicts",
                "Allow conflicts",
              )}
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={booking.allowRecurringMeetings}
                onChange={(e) =>
                  setBooking({
                    ...booking,
                    allowRecurringMeetings: e.target.checked,
                  })
                }
              />
              {t(
                "integrations.exchange.clientaccess.calendar.allowRecurring",
                "Allow recurring",
              )}
            </label>
          </div>
          <button className={primaryBtnCls} onClick={saveBooking}>
            {t("integrations.exchange.clientaccess.common.save", "Save")}
          </button>
        </Block>
      )}
    </SectionShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Public folders
// ═══════════════════════════════════════════════════════════════════════════════

const PublicFoldersSection: React.FC = () => {
  const t = useT();
  const { api, loading, error, clearError, run } = useExchangeClientAccess();
  const [root, setRoot] = useState("");
  const [recurse, setRecurse] = useState(false);
  const [folders, setFolders] = useState<PublicFolder[]>([]);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState("");
  const [stats, setStats] = useState<PublicFolderStatistics | null>(null);
  const [detail, setDetail] = useState<PublicFolder | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const f = await run(() =>
      api.listPublicFolders(root.trim() || null, recurse),
    );
    if (f) setFolders(f);
  }, [api, root, recurse, run]);

  const view = useCallback(
    async (identity: string) => {
      const f = await run(() => api.getPublicFolder(identity));
      if (f) setDetail(f);
    },
    [api, run],
  );

  const create = useCallback(async () => {
    const f = await run(() =>
      api.createPublicFolder(newName, newPath.trim() || null),
    );
    if (f) {
      setNewName("");
      setNewPath("");
      load();
    }
  }, [api, newName, newPath, load, run]);

  const remove = useCallback(
    async (identity: string) => {
      const r = await run(() => api.removePublicFolder(identity));
      if (r !== undefined) {
        setResult(r);
        load();
      }
    },
    [api, load, run],
  );

  const toggleMail = useCallback(
    async (f: PublicFolder) => {
      const r = await run(() =>
        f.mailEnabled
          ? api.mailDisablePublicFolder(f.identity)
          : api.mailEnablePublicFolder(f.identity),
      );
      if (r !== undefined) {
        setResult(r);
        load();
      }
    },
    [api, load, run],
  );

  const loadStats = useCallback(
    async (identity: string) => {
      const s = await run(() => api.getPublicFolderStatistics(identity));
      if (s) setStats(s);
    },
    [api, run],
  );

  return (
    <SectionShell
      title={t(
        "integrations.exchange.clientaccess.pf.title",
        "Public Folders",
      )}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.exchange.clientaccess.pf.root", "Root path")}
          <input
            className={inputCls}
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="\\"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={recurse}
            onChange={(e) => setRecurse(e.target.checked)}
          />
          {t("integrations.exchange.clientaccess.pf.recurse", "Recurse")}
        </label>
        <button className={btnCls} onClick={load}>
          <RefreshCw size={13} />
          {t("integrations.exchange.clientaccess.common.load", "Load")}
        </button>
      </div>

      <ResultLine text={result} />

      <Block
        title={t("integrations.exchange.clientaccess.pf.create", "New folder")}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder={t(
              "integrations.exchange.clientaccess.common.name",
              "Name",
            )}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.exchange.clientaccess.pf.parentPath",
              "Parent path",
            )}
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button className={primaryBtnCls} onClick={create} disabled={!newName}>
            {t("integrations.exchange.clientaccess.common.create", "Create")}
          </button>
        </div>
      </Block>

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thCls}>
              {t("integrations.exchange.clientaccess.common.name", "Name")}
            </th>
            <th className={thCls}>
              {t("integrations.exchange.clientaccess.pf.parentPath", "Path")}
            </th>
            <th className={thCls}>
              {t(
                "integrations.exchange.clientaccess.pf.mailEnabled",
                "Mail-enabled",
              )}
            </th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {folders.map((f) => (
            <tr
              key={f.identity}
              className="border-t border-[var(--color-border)]"
            >
              <td className={tdCls}>{f.name}</td>
              <td className={tdCls}>{f.parentPath}</td>
              <td className={tdCls}>{f.mailEnabled ? "✓" : "—"}</td>
              <td className={`${tdCls} flex gap-1`}>
                <button className={btnCls} onClick={() => view(f.identity)}>
                  {t("integrations.exchange.clientaccess.common.view", "View")}
                </button>
                <button
                  className={btnCls}
                  onClick={() => loadStats(f.identity)}
                >
                  {t("integrations.exchange.clientaccess.pf.stats", "Stats")}
                </button>
                <button className={btnCls} onClick={() => toggleMail(f)}>
                  {f.mailEnabled
                    ? t(
                        "integrations.exchange.clientaccess.pf.mailDisable",
                        "Mail-disable",
                      )
                    : t(
                        "integrations.exchange.clientaccess.pf.mailEnable",
                        "Mail-enable",
                      )}
                </button>
                <button
                  className={dangerBtnCls}
                  onClick={() => remove(f.identity)}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.pf.detail",
            "Folder detail",
          )}
        >
          <div className="text-xs text-[var(--color-text)]">
            {detail.identity} · {detail.folderClass}
            {detail.primarySmtpAddress && ` · ${detail.primarySmtpAddress}`}
          </div>
        </Block>
      )}

      {stats && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.pf.stats",
            "Statistics",
          )}
        >
          <div className="text-xs text-[var(--color-text)]">
            {stats.identity} · {stats.itemCount}{" "}
            {t("integrations.exchange.clientaccess.pf.items", "items")}
            {stats.totalItemSize && ` · ${stats.totalItemSize}`}
          </div>
        </Block>
      )}
    </SectionShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile devices
// ═══════════════════════════════════════════════════════════════════════════════

const MobileDevicesSection: React.FC = () => {
  const t = useT();
  const { api, loading, error, clearError, run } = useExchangeClientAccess();
  const [mailbox, setMailbox] = useState("");
  const [resultSize, setResultSize] = useState("");
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [stats, setStats] = useState<MobileDeviceStatistics | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const loadForMailbox = useCallback(async () => {
    const d = await run(() => api.listMobileDevices(mailbox));
    if (d) setDevices(d);
  }, [api, mailbox, run]);

  const loadAll = useCallback(async () => {
    const size = resultSize.trim() ? Number(resultSize.trim()) : null;
    const d = await run(() =>
      api.listAllMobileDevices(Number.isFinite(size as number) ? size : null),
    );
    if (d) setDevices(d);
  }, [api, resultSize, run]);

  const loadStats = useCallback(
    async (identity: string) => {
      const s = await run(() => api.getMobileDeviceStatistics(identity));
      if (s) setStats(s);
    },
    [api, run],
  );

  const act = useCallback(
    async (
      identity: string,
      action: "wipe" | "block" | "allow" | "remove",
    ) => {
      const fn =
        action === "wipe"
          ? () => api.wipeMobileDevice(identity)
          : action === "block"
            ? () => api.blockMobileDevice(identity)
            : action === "allow"
              ? () => api.allowMobileDevice(identity)
              : () => api.removeMobileDevice(identity);
      const r = await run(fn);
      if (r !== undefined) {
        setResult(r);
        if (mailbox) loadForMailbox();
      }
    },
    [api, mailbox, loadForMailbox, run],
  );

  return (
    <SectionShell
      title={t(
        "integrations.exchange.clientaccess.mobile.title",
        "Mobile Devices",
      )}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.exchange.clientaccess.common.mailbox", "Mailbox")}
          <input
            className={inputCls}
            value={mailbox}
            onChange={(e) => setMailbox(e.target.value)}
            placeholder="user@contoso.com"
          />
        </label>
        <button className={btnCls} onClick={loadForMailbox} disabled={!mailbox}>
          <RefreshCw size={13} />
          {t(
            "integrations.exchange.clientaccess.mobile.forMailbox",
            "For mailbox",
          )}
        </button>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.exchange.clientaccess.common.resultSize",
            "Result size",
          )}
          <input
            className={inputCls}
            value={resultSize}
            onChange={(e) => setResultSize(e.target.value)}
            inputMode="numeric"
            placeholder="1000"
          />
        </label>
        <button className={btnCls} onClick={loadAll}>
          {t("integrations.exchange.clientaccess.mobile.all", "All devices")}
        </button>
      </div>

      <ResultLine text={result} />

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thCls}>
              {t(
                "integrations.exchange.clientaccess.mobile.device",
                "Device",
              )}
            </th>
            <th className={thCls}>
              {t("integrations.exchange.clientaccess.mobile.model", "Model")}
            </th>
            <th className={thCls}>
              {t("integrations.exchange.clientaccess.mobile.state", "State")}
            </th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr
              key={d.identity || d.deviceId}
              className="border-t border-[var(--color-border)]"
            >
              <td className={tdCls}>{d.deviceFriendlyName || d.deviceId}</td>
              <td className={tdCls}>{d.deviceModel || d.deviceType}</td>
              <td className={tdCls}>{d.deviceAccessState}</td>
              <td className={`${tdCls} flex flex-wrap gap-1`}>
                <button
                  className={btnCls}
                  onClick={() => loadStats(d.identity)}
                >
                  {t("integrations.exchange.clientaccess.pf.stats", "Stats")}
                </button>
                <button
                  className={btnCls}
                  onClick={() => act(d.identity, "allow")}
                >
                  {t(
                    "integrations.exchange.clientaccess.mobile.allow",
                    "Allow",
                  )}
                </button>
                <button
                  className={btnCls}
                  onClick={() => act(d.identity, "block")}
                >
                  {t(
                    "integrations.exchange.clientaccess.mobile.block",
                    "Block",
                  )}
                </button>
                <button
                  className={dangerBtnCls}
                  onClick={() => act(d.identity, "wipe")}
                >
                  {t("integrations.exchange.clientaccess.mobile.wipe", "Wipe")}
                </button>
                <button
                  className={dangerBtnCls}
                  onClick={() => act(d.identity, "remove")}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {stats && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.mobile.statistics",
            "Device statistics",
          )}
        >
          <div className="text-xs text-[var(--color-text)]">
            {stats.deviceId} · {stats.status ?? "—"} ·{" "}
            {stats.numberOfFoldersSynced}{" "}
            {t(
              "integrations.exchange.clientaccess.mobile.foldersSynced",
              "folders synced",
            )}
          </div>
        </Block>
      )}
    </SectionShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Inbox rules
// ═══════════════════════════════════════════════════════════════════════════════

const InboxRulesSection: React.FC = () => {
  const t = useT();
  const { api, loading, error, clearError, run } = useExchangeClientAccess();
  const [mailbox, setMailbox] = useState("");
  const [rules, setRules] = useState<InboxRule[]>([]);
  const [detail, setDetail] = useState<InboxRule | null>(null);
  const [newName, setNewName] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await run(() => api.listInboxRules(mailbox));
    if (r) setRules(r);
  }, [api, mailbox, run]);

  const view = useCallback(
    async (ruleId: string) => {
      const r = await run(() => api.getInboxRule(mailbox, ruleId));
      if (r) setDetail(r);
    },
    [api, mailbox, run],
  );

  const create = useCallback(async () => {
    const request: CreateInboxRuleRequest = {
      mailbox,
      name: newName,
      moveToFolder: moveTo.trim() || null,
    };
    const r = await run(() => api.createInboxRule(request));
    if (r) {
      setNewName("");
      setMoveTo("");
      load();
    }
  }, [api, mailbox, newName, moveTo, load, run]);

  const toggle = useCallback(
    async (rule: InboxRule) => {
      const r = await run(() =>
        rule.enabled
          ? api.disableInboxRule(mailbox, rule.ruleId)
          : api.enableInboxRule(mailbox, rule.ruleId),
      );
      if (r !== undefined) {
        setResult(r);
        load();
      }
    },
    [api, mailbox, load, run],
  );

  const rename = useCallback(
    async (rule: InboxRule) => {
      const next = window.prompt(
        t(
          "integrations.exchange.clientaccess.inbox.renamePrompt",
          "New rule name",
        ),
        rule.name,
      );
      if (next == null) return;
      const r = await run(() =>
        api.updateInboxRule(mailbox, rule.ruleId, { name: next }),
      );
      if (r !== undefined) {
        setResult(r);
        load();
      }
    },
    [api, mailbox, load, run, t],
  );

  const remove = useCallback(
    async (ruleId: string) => {
      const r = await run(() => api.removeInboxRule(mailbox, ruleId));
      if (r !== undefined) {
        setResult(r);
        load();
      }
    },
    [api, mailbox, load, run],
  );

  return (
    <SectionShell
      title={t(
        "integrations.exchange.clientaccess.inbox.title",
        "Inbox Rules",
      )}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.exchange.clientaccess.common.mailbox", "Mailbox")}
          <input
            className={inputCls}
            value={mailbox}
            onChange={(e) => setMailbox(e.target.value)}
            placeholder="user@contoso.com"
          />
        </label>
        <button className={btnCls} onClick={load} disabled={!mailbox}>
          <RefreshCw size={13} />
          {t("integrations.exchange.clientaccess.common.load", "Load")}
        </button>
      </div>

      <ResultLine text={result} />

      <Block
        title={t("integrations.exchange.clientaccess.inbox.create", "New rule")}
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={inputCls}
            placeholder={t(
              "integrations.exchange.clientaccess.common.name",
              "Name",
            )}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder={t(
              "integrations.exchange.clientaccess.inbox.moveTo",
              "Move to folder",
            )}
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
          />
          <button
            className={primaryBtnCls}
            onClick={create}
            disabled={!mailbox || !newName}
          >
            {t("integrations.exchange.clientaccess.common.create", "Create")}
          </button>
        </div>
      </Block>

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thCls}>
              {t(
                "integrations.exchange.clientaccess.inbox.priority",
                "Priority",
              )}
            </th>
            <th className={thCls}>
              {t("integrations.exchange.clientaccess.common.name", "Name")}
            </th>
            <th className={thCls}>
              {t(
                "integrations.exchange.clientaccess.common.enabled",
                "Enabled",
              )}
            </th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr
              key={r.ruleId}
              className="border-t border-[var(--color-border)]"
            >
              <td className={tdCls}>{r.priority}</td>
              <td className={tdCls}>{r.name}</td>
              <td className={tdCls}>{r.enabled ? "✓" : "—"}</td>
              <td className={`${tdCls} flex flex-wrap gap-1`}>
                <button className={btnCls} onClick={() => view(r.ruleId)}>
                  {t("integrations.exchange.clientaccess.common.view", "View")}
                </button>
                <button className={btnCls} onClick={() => toggle(r)}>
                  {r.enabled
                    ? t(
                        "integrations.exchange.clientaccess.common.disable",
                        "Disable",
                      )
                    : t(
                        "integrations.exchange.clientaccess.common.enable",
                        "Enable",
                      )}
                </button>
                <button className={btnCls} onClick={() => rename(r)}>
                  {t(
                    "integrations.exchange.clientaccess.inbox.rename",
                    "Rename",
                  )}
                </button>
                <button
                  className={dangerBtnCls}
                  onClick={() => remove(r.ruleId)}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.inbox.detail",
            "Rule detail",
          )}
        >
          <div className="text-xs text-[var(--color-text)]">
            {detail.name}
            {detail.description && ` · ${detail.description}`}
            {detail.moveToFolder &&
              ` · → ${detail.moveToFolder}`}
          </div>
        </Block>
      )}
    </SectionShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Client-access policies (OWA / mobile device / throttling)
// ═══════════════════════════════════════════════════════════════════════════════

const PoliciesSection: React.FC = () => {
  const t = useT();
  const { api, loading, error, clearError, run } = useExchangeClientAccess();
  const [owa, setOwa] = useState<OwaMailboxPolicy[]>([]);
  const [mdm, setMdm] = useState<MobileDeviceMailboxPolicy[]>([]);
  const [throttling, setThrottling] = useState<ThrottlingPolicy[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const loadOwa = useCallback(async () => {
    const p = await run(() => api.listOwaPolicies());
    if (p) setOwa(p);
  }, [api, run]);

  const loadMdm = useCallback(async () => {
    const p = await run(() => api.listMobileDevicePolicies());
    if (p) setMdm(p);
  }, [api, run]);

  const loadThrottling = useCallback(async () => {
    const p = await run(() => api.listThrottlingPolicies());
    if (p) setThrottling(p);
  }, [api, run]);

  const viewOwa = useCallback(
    async (identity: string) => {
      const p = await run(() => api.getOwaPolicy(identity));
      if (p)
        setDetail(
          `${p.name}: rules=${p.rulesEnabled}, calendar=${p.calendarEnabled}, contacts=${p.contactsEnabled}`,
        );
    },
    [api, run],
  );

  const viewMdm = useCallback(
    async (identity: string) => {
      const p = await run(() => api.getMobileDevicePolicy(identity));
      if (p)
        setDetail(
          `${p.name}: passwordRequired=${p.devicePasswordEnabled}, minLen=${p.minPasswordLength ?? "—"}`,
        );
    },
    [api, run],
  );

  const viewThrottling = useCallback(
    async (identity: string) => {
      const p = await run(() => api.getThrottlingPolicy(identity));
      if (p)
        setDetail(
          `${p.name}: EWS=${p.ewsMaxConcurrency ?? "—"}, OWA=${p.owaMaxConcurrency ?? "—"}`,
        );
    },
    [api, run],
  );

  const toggleOwaRules = useCallback(
    async (p: OwaMailboxPolicy) => {
      const r = await run(() =>
        api.setOwaPolicy(p.name, { rulesEnabled: !p.rulesEnabled }),
      );
      if (r !== undefined) {
        setResult(r);
        loadOwa();
      }
    },
    [api, loadOwa, run],
  );

  const toggleMdmPassword = useCallback(
    async (p: MobileDeviceMailboxPolicy) => {
      const r = await run(() =>
        api.setMobileDevicePolicy(p.name, {
          devicePasswordEnabled: !p.devicePasswordEnabled,
        }),
      );
      if (r !== undefined) {
        setResult(r);
        loadMdm();
      }
    },
    [api, loadMdm, run],
  );

  return (
    <SectionShell
      title={t(
        "integrations.exchange.clientaccess.policies.title",
        "Client-Access Policies",
      )}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap gap-2">
        <button className={btnCls} onClick={loadOwa}>
          <RefreshCw size={13} />
          {t("integrations.exchange.clientaccess.policies.owa", "OWA policies")}
        </button>
        <button className={btnCls} onClick={loadMdm}>
          {t(
            "integrations.exchange.clientaccess.policies.mdm",
            "Mobile device policies",
          )}
        </button>
        <button className={btnCls} onClick={loadThrottling}>
          {t(
            "integrations.exchange.clientaccess.policies.throttling",
            "Throttling policies",
          )}
        </button>
      </div>

      <ResultLine text={result} />
      {detail && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]">
          {detail}
        </div>
      )}

      {owa.length > 0 && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.policies.owa",
            "OWA policies",
          )}
        >
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>
                  {t("integrations.exchange.clientaccess.common.name", "Name")}
                </th>
                <th className={thCls}>
                  {t(
                    "integrations.exchange.clientaccess.policies.default",
                    "Default",
                  )}
                </th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {owa.map((p) => (
                <tr
                  key={p.id || p.name}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className={tdCls}>{p.name}</td>
                  <td className={tdCls}>{p.isDefault ? "✓" : "—"}</td>
                  <td className={`${tdCls} flex gap-1`}>
                    <button className={btnCls} onClick={() => viewOwa(p.name)}>
                      {t(
                        "integrations.exchange.clientaccess.common.view",
                        "View",
                      )}
                    </button>
                    <button
                      className={btnCls}
                      onClick={() => toggleOwaRules(p)}
                    >
                      {t(
                        "integrations.exchange.clientaccess.policies.toggleRules",
                        "Toggle rules",
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}

      {mdm.length > 0 && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.policies.mdm",
            "Mobile device policies",
          )}
        >
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>
                  {t("integrations.exchange.clientaccess.common.name", "Name")}
                </th>
                <th className={thCls}>
                  {t(
                    "integrations.exchange.clientaccess.policies.default",
                    "Default",
                  )}
                </th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {mdm.map((p) => (
                <tr
                  key={p.id || p.name}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className={tdCls}>{p.name}</td>
                  <td className={tdCls}>{p.isDefault ? "✓" : "—"}</td>
                  <td className={`${tdCls} flex gap-1`}>
                    <button className={btnCls} onClick={() => viewMdm(p.name)}>
                      {t(
                        "integrations.exchange.clientaccess.common.view",
                        "View",
                      )}
                    </button>
                    <button
                      className={btnCls}
                      onClick={() => toggleMdmPassword(p)}
                    >
                      {t(
                        "integrations.exchange.clientaccess.policies.togglePassword",
                        "Toggle password",
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}

      {throttling.length > 0 && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.policies.throttling",
            "Throttling policies",
          )}
        >
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={thCls}>
                  {t("integrations.exchange.clientaccess.common.name", "Name")}
                </th>
                <th className={thCls}>
                  {t(
                    "integrations.exchange.clientaccess.policies.default",
                    "Default",
                  )}
                </th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {throttling.map((p) => (
                <tr
                  key={p.id || p.name}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className={tdCls}>{p.name}</td>
                  <td className={tdCls}>{p.isDefault ? "✓" : "—"}</td>
                  <td className={tdCls}>
                    <button
                      className={btnCls}
                      onClick={() => viewThrottling(p.name)}
                    >
                      {t(
                        "integrations.exchange.clientaccess.common.view",
                        "View",
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )}
    </SectionShell>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// Virtual directories & Outlook Anywhere
// ═══════════════════════════════════════════════════════════════════════════════

const VDIR_KINDS: {
  key: string;
  labelKey: string;
  fallback: string;
  vdirType: VirtualDirectoryType;
  load: (
    api: ReturnType<typeof useExchangeClientAccess>["api"],
    server: string | null,
  ) => Promise<VirtualDirectory[]>;
}[] = [
  {
    key: "owa",
    labelKey: "integrations.exchange.clientaccess.vdir.owa",
    fallback: "OWA",
    vdirType: "owa",
    load: (api, s) => api.listOwaVirtualDirectories(s),
  },
  {
    key: "ecp",
    labelKey: "integrations.exchange.clientaccess.vdir.ecp",
    fallback: "ECP",
    vdirType: "ecp",
    load: (api, s) => api.listEcpVirtualDirectories(s),
  },
  {
    key: "activesync",
    labelKey: "integrations.exchange.clientaccess.vdir.activesync",
    fallback: "ActiveSync",
    vdirType: "activeSync",
    load: (api, s) => api.listActivesyncVirtualDirectories(s),
  },
  {
    key: "ews",
    labelKey: "integrations.exchange.clientaccess.vdir.ews",
    fallback: "EWS",
    vdirType: "ews",
    load: (api, s) => api.listEwsVirtualDirectories(s),
  },
  {
    key: "mapi",
    labelKey: "integrations.exchange.clientaccess.vdir.mapi",
    fallback: "MAPI",
    vdirType: "mapi",
    load: (api, s) => api.listMapiVirtualDirectories(s),
  },
  {
    key: "autodiscover",
    labelKey: "integrations.exchange.clientaccess.vdir.autodiscover",
    fallback: "Autodiscover",
    vdirType: "autoDiscover",
    load: (api, s) => api.listAutodiscoverVirtualDirectories(s),
  },
  {
    key: "powershell",
    labelKey: "integrations.exchange.clientaccess.vdir.powershell",
    fallback: "PowerShell",
    vdirType: "powerShell",
    load: (api, s) => api.listPowershellVirtualDirectories(s),
  },
  {
    key: "oab",
    labelKey: "integrations.exchange.clientaccess.vdir.oab",
    fallback: "OAB",
    vdirType: "oab",
    load: (api, s) => api.listOabVirtualDirectories(s),
  },
  {
    key: "outlookAnywhere",
    labelKey: "integrations.exchange.clientaccess.vdir.outlookAnywhere",
    fallback: "Outlook Anywhere",
    vdirType: "outlookAnywhere",
    load: (api, s) => api.listOutlookAnywhere(s),
  },
];

const VirtualDirectoriesSection: React.FC = () => {
  const t = useT();
  const { api, loading, error, clearError, run } = useExchangeClientAccess();
  const [server, setServer] = useState("");
  const [kind, setKind] = useState(VDIR_KINDS[0].key);
  const [vdirs, setVdirs] = useState<VirtualDirectory[]>([]);
  const [editing, setEditing] = useState<VirtualDirectory | null>(null);
  const [internalUrl, setInternalUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const spec = VDIR_KINDS.find((k) => k.key === kind) ?? VDIR_KINDS[0];
    const v = await run(() => spec.load(api, server.trim() || null));
    if (v) setVdirs(v);
  }, [api, kind, server, run]);

  const startEdit = useCallback((v: VirtualDirectory) => {
    setEditing(v);
    setInternalUrl(v.internalUrl ?? "");
    setExternalUrl(v.externalUrl ?? "");
  }, []);

  const saveUrls = useCallback(async () => {
    if (!editing) return;
    const r = await run(() =>
      api.setVirtualDirectoryUrls(
        editing.vdirType,
        editing.identity,
        internalUrl.trim() || null,
        externalUrl.trim() || null,
      ),
    );
    if (r !== undefined) {
      setResult(r);
      setEditing(null);
      load();
    }
  }, [api, editing, internalUrl, externalUrl, load, run]);

  return (
    <SectionShell
      title={t(
        "integrations.exchange.clientaccess.vdir.title",
        "Virtual Directories & Outlook Anywhere",
      )}
      loading={loading}
      error={error}
      onDismiss={clearError}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.exchange.clientaccess.common.server", "Server")}
          <input
            className={inputCls}
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder={t(
              "integrations.exchange.clientaccess.vdir.allServers",
              "All servers",
            )}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
          {t("integrations.exchange.clientaccess.vdir.kind", "Type")}
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {VDIR_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {t(k.labelKey, k.fallback)}
              </option>
            ))}
          </select>
        </label>
        <button className={btnCls} onClick={load}>
          <RefreshCw size={13} />
          {t("integrations.exchange.clientaccess.common.load", "Load")}
        </button>
      </div>

      <ResultLine text={result} />

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={thCls}>
              {t("integrations.exchange.clientaccess.common.server", "Server")}
            </th>
            <th className={thCls}>
              {t(
                "integrations.exchange.clientaccess.vdir.internalUrl",
                "Internal URL",
              )}
            </th>
            <th className={thCls}>
              {t(
                "integrations.exchange.clientaccess.vdir.externalUrl",
                "External URL",
              )}
            </th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {vdirs.map((v) => (
            <tr
              key={v.identity}
              className="border-t border-[var(--color-border)]"
            >
              <td className={tdCls}>{v.server}</td>
              <td className={tdCls}>{v.internalUrl ?? "—"}</td>
              <td className={tdCls}>{v.externalUrl ?? "—"}</td>
              <td className={tdCls}>
                <button className={btnCls} onClick={() => startEdit(v)}>
                  {t(
                    "integrations.exchange.clientaccess.vdir.editUrls",
                    "Edit URLs",
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <Block
          title={t(
            "integrations.exchange.clientaccess.vdir.editUrls",
            "Edit URLs",
          )}
        >
          <div className="text-xs text-[var(--color-textSecondary)]">
            {editing.identity}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.clientaccess.vdir.internalUrl",
                "Internal URL",
              )}
              value={internalUrl}
              onChange={(e) => setInternalUrl(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder={t(
                "integrations.exchange.clientaccess.vdir.externalUrl",
                "External URL",
              )}
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
            />
            <button className={primaryBtnCls} onClick={saveUrls}>
              {t("integrations.exchange.clientaccess.common.save", "Save")}
            </button>
            <button className={btnCls} onClick={() => setEditing(null)}>
              {t("integrations.exchange.clientaccess.common.cancel", "Cancel")}
            </button>
          </div>
        </Block>
      )}
    </SectionShell>
  );
};

// ── Tab shell ────────────────────────────────────────────────────────────────

type SectionKey =
  | "calendar"
  | "publicFolders"
  | "mobile"
  | "inbox"
  | "policies"
  | "vdir";

const SECTIONS: {
  key: SectionKey;
  labelKey: string;
  fallback: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  Component: React.FC;
}[] = [
  {
    key: "calendar",
    labelKey: "integrations.exchange.clientaccess.calendar.title",
    fallback: "Calendar",
    icon: CalendarDays,
    Component: CalendarSection,
  },
  {
    key: "publicFolders",
    labelKey: "integrations.exchange.clientaccess.pf.title",
    fallback: "Public Folders",
    icon: FolderTree,
    Component: PublicFoldersSection,
  },
  {
    key: "mobile",
    labelKey: "integrations.exchange.clientaccess.mobile.title",
    fallback: "Mobile Devices",
    icon: Smartphone,
    Component: MobileDevicesSection,
  },
  {
    key: "inbox",
    labelKey: "integrations.exchange.clientaccess.inbox.title",
    fallback: "Inbox Rules",
    icon: Inbox,
    Component: InboxRulesSection,
  },
  {
    key: "policies",
    labelKey: "integrations.exchange.clientaccess.policies.title",
    fallback: "Client-Access Policies",
    icon: Shield,
    Component: PoliciesSection,
  },
  {
    key: "vdir",
    labelKey: "integrations.exchange.clientaccess.vdir.title",
    fallback: "Virtual Directories",
    icon: Globe,
    Component: VirtualDirectoriesSection,
  },
];

const ExchangeClientAccessTab: React.FC<ExchangeTabProps> = () => {
  const t = useT();
  const [active, setActive] = useState<SectionKey>("calendar");
  const current = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];
  const Active = current.Component;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2 py-1">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                active === s.key
                  ? "bg-[var(--color-surfaceHover)] text-[var(--color-text)]"
                  : "text-[var(--color-textSecondary)]"
              }`}
            >
              <Icon size={13} />
              {t(s.labelKey, s.fallback)}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Active />
      </div>
    </div>
  );
};

export default ExchangeClientAccessTab;
