// ExchangeRecipientsTab — "Recipients & Mailboxes" category tab (t42 `c1`).
//
// A single, section-driven console over all 49 recipient commands:
//   • Mailboxes          list / get / create / update / remove / enable /
//                        disable / statistics / permissions (+add/-remove) /
//                        forwarding / OOO (get/set) / convert type
//   • Groups             list / dynamic / get / create / update / remove /
//                        members (list/+add/-remove)
//   • Mail contacts      list / get / create / update / remove
//   • Mail users         list / get / create / remove
//   • Shared & resource  shared / room / equipment / room-lists +
//                        automapping, send-as, send-on-behalf (+add/-remove)
//   • Archive            info / statistics / enable / disable /
//                        auto-expanding / set-quota (keyed by a typed identity)
//
// Typed create/update bodies are edited as raw JSON (a skeleton is prefilled per
// request type); simple string-arg actions use a small field prompt; reads land
// in a JSON inspector drawer. Exchange is a SINGLETON service, so no id is ever
// passed — every command runs against the shell's live connection.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Boxes,
  Contact,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExchangeTabProps } from "../../../types/exchange";
import type {
  MailboxType,
  OutOfOfficeSettings,
  UpdateGroupRequest,
  UpdateMailboxRequest,
} from "../../../types/exchange/recipients";
import {
  exchangeRecipientsApi as exApi,
  useExchangeRecipients,
  type ExchangeParams,
} from "../../../hooks/integration/exchange/useExchangeRecipients";

type Row = Record<string, unknown>;

const MAILBOX_TYPES: MailboxType[] = [
  "userMailbox",
  "sharedMailbox",
  "roomMailbox",
  "equipmentMailbox",
  "linkedMailbox",
  "discoveryMailbox",
  "schedulingMailbox",
];

/** Render a possibly-object/array/scalar field as a short label. */
function label(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  if (Array.isArray(v)) return v.map(label).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const pick = o.displayName ?? o.primarySmtpAddress ?? o.name ?? o.identity;
    return pick != null ? String(pick) : JSON.stringify(v);
  }
  return String(v);
}

const text = (k: string) => (row: Row) => label(row[k]);

interface Column {
  key: string;
  labelDefault: string;
  get: (row: Row) => string;
}

const col = (
  key: string,
  labelDefault: string,
  get: (row: Row) => string = text(key),
): Column => ({ key, labelDefault, get });

type SectionKey =
  | "mailboxes"
  | "groups"
  | "contacts"
  | "users"
  | "shared"
  | "archive";

interface SectionDef {
  key: SectionKey;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<{ size?: number }>;
}

const SECTIONS: SectionDef[] = [
  {
    key: "mailboxes",
    labelKey: "integrations.exchange.recipients.sections.mailboxes",
    labelDefault: "Mailboxes",
    icon: Inbox,
  },
  {
    key: "groups",
    labelKey: "integrations.exchange.recipients.sections.groups",
    labelDefault: "Groups",
    icon: Users,
  },
  {
    key: "contacts",
    labelKey: "integrations.exchange.recipients.sections.contacts",
    labelDefault: "Mail Contacts",
    icon: Contact,
  },
  {
    key: "users",
    labelKey: "integrations.exchange.recipients.sections.users",
    labelDefault: "Mail Users",
    icon: UserRound,
  },
  {
    key: "shared",
    labelKey: "integrations.exchange.recipients.sections.shared",
    labelDefault: "Shared & Resource",
    icon: Boxes,
  },
  {
    key: "archive",
    labelKey: "integrations.exchange.recipients.sections.archive",
    labelDefault: "Archive",
    icon: Archive,
  },
];

const MAILBOX_COLS: Column[] = [
  col("displayName", "Display name"),
  col("primarySmtpAddress", "Primary SMTP"),
  col("alias", "Alias"),
  col("mailboxType", "Type"),
  col("isEnabled", "Enabled"),
  col("database", "Database"),
];
const GROUP_COLS: Column[] = [
  col("displayName", "Display name"),
  col("primarySmtpAddress", "Primary SMTP"),
  col("alias", "Alias"),
  col("groupType", "Type"),
  col("memberCount", "Members"),
];
const CONTACT_COLS: Column[] = [
  col("displayName", "Display name"),
  col("alias", "Alias"),
  col("externalEmailAddress", "External address"),
  col("primarySmtpAddress", "Primary SMTP"),
];
const USER_COLS: Column[] = [
  col("displayName", "Display name"),
  col("alias", "Alias"),
  col("userPrincipalName", "UPN"),
  col("externalEmailAddress", "External address"),
  col("isEnabled", "Enabled"),
];

/** The identity string a command should target for a given row/section. */
function identityOf(row: Row): string {
  return String(
    row.primarySmtpAddress || row.alias || row.identity || row.id || "",
  );
}

// ─── Modal state shapes ───────────────────────────────────────────────────────

interface EditorState {
  title: string;
  json: string;
  hint?: string;
  submit: (body: ExchangeParams) => Promise<unknown>;
}

interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  value: string;
  options?: string[];
}

interface PromptState {
  title: string;
  fields: PromptField[];
  submit: (values: Record<string, string>) => Promise<unknown>;
}

interface InspectorState {
  title: string;
  data: unknown;
}

// Skeleton bodies prefilled into the JSON editor for create actions.
const CREATE_MAILBOX_SKELETON = JSON.stringify(
  {
    displayName: "",
    alias: "",
    primarySmtpAddress: "",
    mailboxType: "userMailbox",
    password: null,
  },
  null,
  2,
);
const CREATE_GROUP_SKELETON = JSON.stringify(
  {
    displayName: "",
    alias: "",
    primarySmtpAddress: "",
    groupType: "distribution",
    members: [],
  },
  null,
  2,
);
const CREATE_CONTACT_SKELETON = JSON.stringify(
  { displayName: "", alias: "", externalEmailAddress: "" },
  null,
  2,
);
const CREATE_USER_SKELETON = JSON.stringify(
  {
    displayName: "",
    alias: "",
    externalEmailAddress: "",
    userPrincipalName: "",
    password: "",
  },
  null,
  2,
);

const btn =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50";

const ExchangeRecipientsTab: React.FC<ExchangeTabProps> = () => {
  const { t } = useTranslation();
  const { items, loading, busy, error, loadList, run, clearItems, clearError } =
    useExchangeRecipients();

  const [activeKey, setActiveKey] = useState<SectionKey>("mailboxes");
  const [resultSize, setResultSize] = useState("100");
  const [filter, setFilter] = useState("");
  // Sub-modes for sections with multiple list variants.
  const [groupMode, setGroupMode] = useState<"all" | "dynamic">("all");
  const [sharedMode, setSharedMode] = useState<
    "shared" | "room" | "equipment" | "roomLists"
  >("shared");
  // Archive section is keyed by a typed identity (no list command).
  const [archiveId, setArchiveId] = useState("");

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [inspector, setInspector] = useState<InspectorState | null>(null);

  const rsNum = useCallback((): number | undefined => {
    const n = Number(resultSize.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [resultSize]);

  // ── list loading ────────────────────────────────────────────────────────
  const reload = useCallback(() => {
    switch (activeKey) {
      case "mailboxes":
        return loadList(() =>
          exApi.listMailboxes(rsNum(), filter.trim() || undefined),
        );
      case "groups":
        return loadList(() =>
          groupMode === "dynamic"
            ? exApi.listDynamicGroups()
            : exApi.listGroups(rsNum()),
        );
      case "contacts":
        return loadList(() => exApi.listMailContacts(rsNum()));
      case "users":
        return loadList(() => exApi.listMailUsers(rsNum()));
      case "shared":
        return loadList(() => {
          switch (sharedMode) {
            case "room":
              return exApi.listRoomMailboxes();
            case "equipment":
              return exApi.listEquipmentMailboxes();
            case "roomLists":
              return exApi.listRoomLists();
            default:
              return exApi.listSharedMailboxes(rsNum());
          }
        });
      case "archive":
        clearItems();
        return Promise.resolve();
    }
  }, [
    activeKey,
    groupMode,
    sharedMode,
    filter,
    rsNum,
    loadList,
    clearItems,
  ]);

  // Reset filters and load defaults on section / mode change.
  useEffect(() => {
    if (activeKey !== "archive") void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, groupMode, sharedMode]);

  const rows = items as Row[];

  const columns = useMemo<Column[]>(() => {
    switch (activeKey) {
      case "mailboxes":
        return MAILBOX_COLS;
      case "groups":
        return GROUP_COLS;
      case "contacts":
        return CONTACT_COLS;
      case "users":
        return USER_COLS;
      case "shared":
        return sharedMode === "roomLists" ? GROUP_COLS : MAILBOX_COLS;
      default:
        return [];
    }
  }, [activeKey, sharedMode]);

  // ── helpers ─────────────────────────────────────────────────────────────
  const openInspect = useCallback(
    async (title: string, action: () => Promise<unknown>) => {
      const data = await run(action);
      if (data !== null) setInspector({ title, data });
    },
    [run],
  );

  const afterMutate = useCallback(
    async (action: () => Promise<unknown>) => {
      const res = await run(action);
      if (res !== null && activeKey !== "archive") void reload();
      return res;
    },
    [run, reload, activeKey],
  );

  const confirmDelete = useCallback(
    (item: string) =>
      window.confirm(
        t("integrations.exchange.recipients.confirmDelete", "Delete {{item}}?", {
          item,
        }),
      ),
    [t],
  );

  const submitEditor = useCallback(async () => {
    if (!editor) return;
    let body: ExchangeParams;
    try {
      body = JSON.parse(editor.json) as ExchangeParams;
    } catch {
      window.alert(
        t(
          "integrations.exchange.recipients.invalidJson",
          "Request body is not valid JSON.",
        ),
      );
      return;
    }
    const res = await run(() => editor.submit(body));
    if (res !== null) {
      setEditor(null);
      if (activeKey !== "archive") void reload();
    }
  }, [editor, run, reload, activeKey, t]);

  const submitPrompt = useCallback(async () => {
    if (!prompt) return;
    const values: Record<string, string> = {};
    for (const f of prompt.fields) values[f.key] = f.value;
    const res = await run(() => prompt.submit(values));
    if (res !== null) {
      setPrompt(null);
      if (activeKey !== "archive") void reload();
    }
  }, [prompt, run, reload, activeKey]);

  // ── row action sets per section ─────────────────────────────────────────
  const renderRowActions = useCallback(
    (row: Row) => {
      const id = identityOf(row);
      switch (activeKey) {
        case "mailboxes":
          return (
            <>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getMailbox(id))}>
                {t("integrations.exchange.recipients.view", "View")}
              </button>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getMailboxStatistics(id))}>
                {t("integrations.exchange.recipients.stats", "Stats")}
              </button>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getMailboxPermissions(id))}>
                {t("integrations.exchange.recipients.perms", "Perms")}
              </button>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getForwarding(id))}>
                {t("integrations.exchange.recipients.forwarding", "Fwd")}
              </button>
              <button className={btn} onClick={() => openMailboxPermission(id, true)}>+perm</button>
              <button className={btn} onClick={() => openMailboxPermission(id, false)}>-perm</button>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getOoo(id))}>
                {t("integrations.exchange.recipients.ooo", "OOO")}
              </button>
              <button className={btn} onClick={() => openSetOoo(id)}>set-OOO</button>
              <button className={btn} onClick={() => openUpdateMailbox(id)}>
                {t("integrations.exchange.recipients.edit", "Edit")}
              </button>
              <button className={btn} onClick={() => openConvert(id)}>convert</button>
              <button className={btn} onClick={() => openEnable(id)}>enable</button>
              <button className={btn} onClick={() => void afterMutate(() => exApi.disableMailbox(id))}>disable</button>
              <button
                className={btn}
                onClick={() =>
                  confirmDelete(id) && void afterMutate(() => exApi.removeMailbox(id))
                }
              >
                <Trash2 size={12} />
              </button>
            </>
          );
        case "groups":
          return (
            <>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getGroup(id))}>
                {t("integrations.exchange.recipients.view", "View")}
              </button>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.listGroupMembers(id))}>
                {t("integrations.exchange.recipients.members", "Members")}
              </button>
              <button className={btn} onClick={() => openGroupMember(id, true)}>+member</button>
              <button className={btn} onClick={() => openGroupMember(id, false)}>-member</button>
              <button className={btn} onClick={() => openUpdateGroup(id)}>
                {t("integrations.exchange.recipients.edit", "Edit")}
              </button>
              <button
                className={btn}
                onClick={() =>
                  confirmDelete(id) && void afterMutate(() => exApi.removeGroup(id))
                }
              >
                <Trash2 size={12} />
              </button>
            </>
          );
        case "contacts":
          return (
            <>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getMailContact(id))}>
                {t("integrations.exchange.recipients.view", "View")}
              </button>
              <button className={btn} onClick={() => openUpdateContact(id)}>
                {t("integrations.exchange.recipients.edit", "Edit")}
              </button>
              <button
                className={btn}
                onClick={() =>
                  confirmDelete(id) && void afterMutate(() => exApi.removeMailContact(id))
                }
              >
                <Trash2 size={12} />
              </button>
            </>
          );
        case "users":
          return (
            <>
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getMailUser(id))}>
                {t("integrations.exchange.recipients.view", "View")}
              </button>
              <button
                className={btn}
                onClick={() =>
                  confirmDelete(id) && void afterMutate(() => exApi.removeMailUser(id))
                }
              >
                <Trash2 size={12} />
              </button>
            </>
          );
        case "shared":
          if (sharedMode === "roomLists") {
            return (
              <button className={btn} onClick={() => void openInspect(id, () => exApi.getGroup(id))}>
                {t("integrations.exchange.recipients.view", "View")}
              </button>
            );
          }
          return (
            <>
              <button className={btn} onClick={() => openTrustee(id, "automap", true)}>+automap</button>
              <button className={btn} onClick={() => openTrustee(id, "automap", false)}>-automap</button>
              <button className={btn} onClick={() => openTrustee(id, "sendAs", true)}>+sendAs</button>
              <button className={btn} onClick={() => openTrustee(id, "sendAs", false)}>-sendAs</button>
              <button className={btn} onClick={() => openTrustee(id, "sob", true)}>+onBehalf</button>
              <button className={btn} onClick={() => openTrustee(id, "sob", false)}>-onBehalf</button>
            </>
          );
        default:
          return null;
      }
    },
    // handlers are stable closures defined below; deps kept minimal on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeKey, sharedMode, t, openInspect, afterMutate, confirmDelete],
  );

  // ── action openers (editors / prompts) ──────────────────────────────────
  const openCreate = useCallback(() => {
    switch (activeKey) {
      case "mailboxes":
        setEditor({
          title: t("integrations.exchange.recipients.editor.createMailbox", "Create mailbox"),
          json: CREATE_MAILBOX_SKELETON,
          submit: (body) => exApi.createMailbox(body as never),
        });
        break;
      case "groups":
        setEditor({
          title: t("integrations.exchange.recipients.editor.createGroup", "Create group"),
          json: CREATE_GROUP_SKELETON,
          submit: (body) => exApi.createGroup(body as never),
        });
        break;
      case "contacts":
        setEditor({
          title: t("integrations.exchange.recipients.editor.createContact", "Create mail contact"),
          json: CREATE_CONTACT_SKELETON,
          submit: (body) => exApi.createMailContact(body as never),
        });
        break;
      case "users":
        setEditor({
          title: t("integrations.exchange.recipients.editor.createUser", "Create mail user"),
          json: CREATE_USER_SKELETON,
          submit: (body) => exApi.createMailUser(body as never),
        });
        break;
    }
  }, [activeKey, t]);

  const openUpdateMailbox = useCallback(
    (id: string) =>
      setEditor({
        title: t("integrations.exchange.recipients.editor.updateMailbox", "Update mailbox {{id}}", { id }),
        json: JSON.stringify({ identity: id, displayName: null, alias: null }, null, 2),
        submit: (body) =>
          exApi.updateMailbox({ ...body, identity: id } as UpdateMailboxRequest),
      }),
    [t],
  );
  const openUpdateGroup = useCallback(
    (id: string) =>
      setEditor({
        title: t("integrations.exchange.recipients.editor.updateGroup", "Update group {{id}}", { id }),
        json: JSON.stringify({ identity: id, displayName: null, description: null }, null, 2),
        submit: (body) =>
          exApi.updateGroup({ ...body, identity: id } as UpdateGroupRequest),
      }),
    [t],
  );
  const openUpdateContact = useCallback(
    (id: string) =>
      setEditor({
        title: t("integrations.exchange.recipients.editor.updateContact", "Update contact {{id}}", { id }),
        json: JSON.stringify({ DisplayName: "" }, null, 2),
        hint: t(
          "integrations.exchange.recipients.editor.paramsHint",
          "Raw Set-MailContact parameters (PascalCase Exchange property names).",
        ),
        submit: (body) => exApi.updateMailContact(id, body),
      }),
    [t],
  );
  const openSetOoo = useCallback(
    (id: string) => {
      void run(() => exApi.getOoo(id)).then((current) => {
        setEditor({
          title: t("integrations.exchange.recipients.editor.setOoo", "Set Out-of-Office {{id}}", { id }),
          json: JSON.stringify(
            current ?? {
              identity: id,
              autoReplyState: "enabled",
              internalMessage: "",
              externalMessage: "",
              externalAudience: "all",
            },
            null,
            2,
          ),
          submit: (body) =>
            exApi.setOoo({ ...body, identity: id } as OutOfOfficeSettings),
        });
      });
    },
    [run, t],
  );

  const openMailboxPermission = useCallback(
    (id: string, add: boolean) =>
      setPrompt({
        title: add
          ? t("integrations.exchange.recipients.prompt.addPerm", "Add mailbox permission — {{id}}", { id })
          : t("integrations.exchange.recipients.prompt.removePerm", "Remove mailbox permission — {{id}}", { id }),
        fields: [
          { key: "user", label: t("integrations.exchange.recipients.prompt.user", "User"), value: "", placeholder: "user@contoso.com" },
          { key: "accessRights", label: t("integrations.exchange.recipients.prompt.accessRights", "Access rights"), value: "FullAccess", placeholder: "FullAccess" },
        ],
        submit: (v) =>
          add
            ? exApi.addMailboxPermission(id, v.user, v.accessRights)
            : exApi.removeMailboxPermission(id, v.user, v.accessRights),
      }),
    [t],
  );
  const openGroupMember = useCallback(
    (id: string, add: boolean) =>
      setPrompt({
        title: add
          ? t("integrations.exchange.recipients.prompt.addMember", "Add group member — {{id}}", { id })
          : t("integrations.exchange.recipients.prompt.removeMember", "Remove group member — {{id}}", { id }),
        fields: [
          { key: "member", label: t("integrations.exchange.recipients.prompt.member", "Member"), value: "", placeholder: "user@contoso.com" },
        ],
        submit: (v) =>
          add ? exApi.addGroupMember(id, v.member) : exApi.removeGroupMember(id, v.member),
      }),
    [t],
  );
  const openTrustee = useCallback(
    (mailbox: string, kind: "automap" | "sendAs" | "sob", add: boolean) =>
      setPrompt({
        title: t("integrations.exchange.recipients.prompt.trustee", "{{kind}} — {{id}}", {
          kind: `${add ? "+" : "-"}${kind}`,
          id: mailbox,
        }),
        fields: [
          { key: "who", label: t("integrations.exchange.recipients.prompt.who", "User / trustee"), value: "", placeholder: "user@contoso.com" },
        ],
        submit: (v) => {
          const who = v.who;
          if (kind === "automap")
            return add ? exApi.addAutomapping(mailbox, who) : exApi.removeAutomapping(mailbox, who);
          if (kind === "sendAs")
            return add ? exApi.addSendAs(mailbox, who) : exApi.removeSendAs(mailbox, who);
          return add ? exApi.addSendOnBehalf(mailbox, who) : exApi.removeSendOnBehalf(mailbox, who);
        },
      }),
    [t],
  );
  const openEnable = useCallback(
    (id: string) =>
      setPrompt({
        title: t("integrations.exchange.recipients.prompt.enable", "Enable mailbox — {{id}}", { id }),
        fields: [
          { key: "database", label: t("integrations.exchange.recipients.prompt.database", "Database (optional)"), value: "", placeholder: "DB01" },
        ],
        submit: (v) => exApi.enableMailbox(id, v.database.trim() || undefined),
      }),
    [t],
  );
  const openConvert = useCallback(
    (id: string) =>
      setPrompt({
        title: t("integrations.exchange.recipients.prompt.convert", "Convert mailbox — {{id}}", { id }),
        fields: [
          {
            key: "targetType",
            label: t("integrations.exchange.recipients.prompt.targetType", "Target type"),
            value: "sharedMailbox",
            options: MAILBOX_TYPES,
          },
        ],
        submit: (v) =>
          exApi.convertMailbox({ identity: id, targetType: v.targetType as MailboxType }),
      }),
    [t],
  );

  const canCreate =
    activeKey === "mailboxes" ||
    activeKey === "groups" ||
    activeKey === "contacts" ||
    activeKey === "users";
  const showResultSize = activeKey !== "archive" && !(activeKey === "shared" && sharedMode !== "shared") && !(activeKey === "groups" && groupMode === "dynamic");

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Section selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = s.key === activeKey;
          return (
            <button
              key={s.key}
              onClick={() => setActiveKey(s.key)}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
                active
                  ? "bg-primary text-white"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {t(s.labelKey, s.labelDefault)}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      {activeKey !== "archive" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
          <button onClick={() => void reload()} className={btn} disabled={loading}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t("integrations.exchange.recipients.refresh", "Refresh")}
          </button>

          {activeKey === "groups" && (
            <select
              value={groupMode}
              onChange={(e) => setGroupMode(e.target.value as "all" | "dynamic")}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-1.5 py-1 text-xs text-[var(--color-text)]"
            >
              <option value="all">{t("integrations.exchange.recipients.groups.all", "All groups")}</option>
              <option value="dynamic">{t("integrations.exchange.recipients.groups.dynamic", "Dynamic")}</option>
            </select>
          )}

          {activeKey === "shared" && (
            <select
              value={sharedMode}
              onChange={(e) =>
                setSharedMode(e.target.value as "shared" | "room" | "equipment" | "roomLists")
              }
              className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-1.5 py-1 text-xs text-[var(--color-text)]"
            >
              <option value="shared">{t("integrations.exchange.recipients.shared.shared", "Shared")}</option>
              <option value="room">{t("integrations.exchange.recipients.shared.room", "Rooms")}</option>
              <option value="equipment">{t("integrations.exchange.recipients.shared.equipment", "Equipment")}</option>
              <option value="roomLists">{t("integrations.exchange.recipients.shared.roomLists", "Room lists")}</option>
            </select>
          )}

          {activeKey === "mailboxes" && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void reload()}
              placeholder={t("integrations.exchange.recipients.filterPlaceholder", "OPATH filter…")}
              className="w-44 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
            />
          )}

          {showResultSize && (
            <label className="flex items-center gap-1 text-xs text-[var(--color-textMuted)]">
              {t("integrations.exchange.recipients.resultSize", "Limit")}
              <input
                value={resultSize}
                onChange={(e) => setResultSize(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void reload()}
                inputMode="numeric"
                className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
              />
            </label>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("integrations.exchange.recipients.count", "{{n}} items", { n: rows.length })}
            </span>
            {canCreate && (
              <button
                onClick={openCreate}
                className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
              >
                <Plus size={12} />
                {t("integrations.exchange.recipients.new", "New")}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{error}</span>
          <button onClick={clearError} className="shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {activeKey === "archive" ? (
          <ArchivePanel
            identity={archiveId}
            setIdentity={setArchiveId}
            busy={busy}
            run={run}
            inspect={(title, data) => setInspector({ title, data })}
            prompt={setPrompt}
          />
        ) : loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-[var(--color-textSecondary)]">
            {t("integrations.exchange.recipients.empty", "No records.")}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)]">
              <tr className="border-b border-[var(--color-border)]">
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {t(`integrations.exchange.recipients.col.${c.key}`, c.labelDefault)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">
                  {t("integrations.exchange.recipients.col.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={label(row.id) || label(row.identity) || i}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
                >
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-1.5 text-[var(--color-text)]">
                      {c.get(row)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {renderRowActions(row)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* JSON editor modal */}
      {editor && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-6">
          <div className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">{editor.title}</h3>
              <button onClick={() => setEditor(null)} className="text-[var(--color-textSecondary)]">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <textarea
                value={editor.json}
                onChange={(e) => setEditor({ ...editor, json: e.target.value })}
                spellCheck={false}
                className="h-64 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 font-mono text-xs text-[var(--color-text)]"
              />
              <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
                {editor.hint ??
                  t(
                    "integrations.exchange.recipients.editor.hint",
                    "Raw request body. Fields map 1:1 to the command's camelCase params.",
                  )}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
              <button onClick={() => setEditor(null)} className={btn}>
                {t("integrations.exchange.recipients.cancel", "Cancel")}
              </button>
              <button
                onClick={() => void submitEditor()}
                disabled={busy}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t("integrations.exchange.recipients.save", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Field prompt modal */}
      {prompt && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-6">
          <div className="flex w-full max-w-sm flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
              <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{prompt.title}</h3>
              <button onClick={() => setPrompt(null)} className="text-[var(--color-textSecondary)]">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {prompt.fields.map((f, idx) => (
                <label key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--color-textSecondary)]">{f.label}</span>
                  {f.options ? (
                    <select
                      value={f.value}
                      onChange={(e) => {
                        const fields = [...prompt.fields];
                        fields[idx] = { ...f, value: e.target.value };
                        setPrompt({ ...prompt, fields });
                      }}
                      className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                    >
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={f.value}
                      placeholder={f.placeholder}
                      onChange={(e) => {
                        const fields = [...prompt.fields];
                        fields[idx] = { ...f, value: e.target.value };
                        setPrompt({ ...prompt, fields });
                      }}
                      className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
              <button onClick={() => setPrompt(null)} className={btn}>
                {t("integrations.exchange.recipients.cancel", "Cancel")}
              </button>
              <button
                onClick={() => void submitPrompt()}
                disabled={busy}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t("integrations.exchange.recipients.apply", "Apply")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspector drawer */}
      {inspector && (
        <div className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{inspector.title}</h3>
            <button onClick={() => setInspector(null)} className="text-[var(--color-textSecondary)]">
              <X size={16} />
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-[var(--color-text)]">
            {JSON.stringify(inspector.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

// ─── Archive sub-panel (identity-keyed, no list command) ──────────────────────

interface ArchivePanelProps {
  identity: string;
  setIdentity: (v: string) => void;
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T | null>;
  inspect: (title: string, data: unknown) => void;
  prompt: (p: PromptState) => void;
}

const ArchivePanel: React.FC<ArchivePanelProps> = ({
  identity,
  setIdentity,
  busy,
  run,
  inspect,
  prompt,
}) => {
  const { t } = useTranslation();
  const id = identity.trim();
  const act = btn;

  const guarded = (fn: () => Promise<unknown>) => {
    if (!id) return;
    void fn();
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--color-textSecondary)]">
          {t("integrations.exchange.recipients.archive.identity", "Mailbox identity")}
        </span>
        <input
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder="user@contoso.com"
          className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1.5 text-sm text-[var(--color-text)]"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          className={act}
          disabled={!id || busy}
          onClick={() =>
            guarded(async () => {
              const d = await run(() => exApi.getArchiveInfo(id));
              if (d !== null) inspect(t("integrations.exchange.recipients.archive.info", "Archive info"), d);
            })
          }
        >
          {t("integrations.exchange.recipients.archive.info", "Archive info")}
        </button>
        <button
          className={act}
          disabled={!id || busy}
          onClick={() =>
            guarded(async () => {
              const d = await run(() => exApi.getArchiveStatistics(id));
              if (d !== null) inspect(t("integrations.exchange.recipients.archive.stats", "Archive stats"), d);
            })
          }
        >
          {t("integrations.exchange.recipients.archive.stats", "Archive stats")}
        </button>
        <button
          className={act}
          disabled={!id || busy}
          onClick={() =>
            prompt({
              title: t("integrations.exchange.recipients.archive.enable", "Enable archive — {{id}}", { id }),
              fields: [
                { key: "database", label: t("integrations.exchange.recipients.prompt.database", "Database (optional)"), value: "", placeholder: "ArchiveDB01" },
              ],
              submit: (v) => exApi.enableArchive(id, v.database.trim() || undefined),
            })
          }
        >
          {t("integrations.exchange.recipients.archive.enableBtn", "Enable")}
        </button>
        <button
          className={act}
          disabled={!id || busy}
          onClick={() => guarded(() => run(() => exApi.disableArchive(id)))}
        >
          {t("integrations.exchange.recipients.archive.disableBtn", "Disable")}
        </button>
        <button
          className={act}
          disabled={!id || busy}
          onClick={() => guarded(() => run(() => exApi.enableAutoExpandingArchive(id)))}
        >
          {t("integrations.exchange.recipients.archive.autoExpand", "Auto-expanding")}
        </button>
        <button
          className={act}
          disabled={!id || busy}
          onClick={() =>
            prompt({
              title: t("integrations.exchange.recipients.archive.setQuota", "Set archive quota — {{id}}", { id }),
              fields: [
                { key: "quota", label: t("integrations.exchange.recipients.archive.quota", "Quota"), value: "100GB", placeholder: "100GB" },
                { key: "warningQuota", label: t("integrations.exchange.recipients.archive.warningQuota", "Warning quota"), value: "90GB", placeholder: "90GB" },
              ],
              submit: (v) => exApi.setArchiveQuota(id, v.quota, v.warningQuota),
            })
          }
        >
          {t("integrations.exchange.recipients.archive.quotaBtn", "Set quota")}
        </button>
      </div>

      <p className="text-[11px] text-[var(--color-textMuted)]">
        {t(
          "integrations.exchange.recipients.archive.hint",
          "Archive operations act on the mailbox identity above. Results open in the inspector.",
        )}
      </p>
    </div>
  );
};

export default ExchangeRecipientsTab;
