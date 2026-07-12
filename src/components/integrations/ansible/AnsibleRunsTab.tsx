// AnsibleRunsTab — "Playbooks & Runs" sub-tab for the Ansible panel
// (t42-ansible-c1).
//
// Binds all 27 commands of the runs slice (inventory 9 / playbooks 7 / ad-hoc 6 /
// facts 2 / history 3) through `useAnsibleRuns`. Every command is reachable from a
// control here; reads land in the Inspector (raw JSON) and executions/mutations
// append to the activity log. `connectionId` is the live control-node session id
// passed as the `id` arg to every command that takes one (the inventory
// add/remove commands take a file `path` instead — see the two path fields).

import React, { useCallback, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileCode2,
  History,
  Play,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AnsibleTabProps } from "./registry";
import { useAnsibleRuns } from "../../../hooks/integration/ansible/useAnsibleRuns";
import type {
  AdHocOptions,
  AddGroupParams,
  AddHostParams,
  DynamicInventoryConfig,
  PlaybookRunOptions,
} from "../../../types/ansible/runs";

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-xs font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "app-bar-button flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
const primaryBtnClass =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50";
const dangerBtnClass =
  "flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-500 disabled:opacity-50";

/** Collapsible section wrapper. */
const Section: React.FC<{
  id: string;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}> = ({ id, title, icon, open, onToggle, children }) => (
  <div className="border-b border-[var(--color-border)]">
    <button
      type="button"
      onClick={() => onToggle(id)}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
    >
      {open ? (
        <ChevronDown size={14} className="text-[var(--color-textSecondary)]" />
      ) : (
        <ChevronRight size={14} className="text-[var(--color-textSecondary)]" />
      )}
      {icon}
      {title}
    </button>
    {open && <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>}
  </div>
);

/** Full-depth default for `PlaybookRunOptions` — only `playbook_path` and a few
 *  toggles are surfaced; the rest carry wire-correct defaults so the payload
 *  round-trips cleanly (note `become` is the serde-renamed `use_become`). */
function makeRunOptions(
  playbookPath: string,
  overrides: Partial<PlaybookRunOptions> = {},
): PlaybookRunOptions {
  return {
    playbook_path: playbookPath,
    inventory: null,
    limit: null,
    tags: [],
    skip_tags: [],
    extra_vars: {},
    extra_vars_files: [],
    forks: null,
    check_mode: false,
    diff_mode: false,
    start_at_task: null,
    step: false,
    flush_cache: false,
    force_handlers: false,
    become: null,
    become_user: null,
    become_method: null,
    remote_user: null,
    private_key: null,
    ssh_common_args: null,
    timeout_secs: null,
    vault_password_file: null,
    verbosity: null,
    env_vars: {},
    ...overrides,
  };
}

/** Full-depth default for `AdHocOptions`. */
function makeAdHocOptions(
  pattern: string,
  moduleName: string,
  moduleArgs: string | null,
  overrides: Partial<AdHocOptions> = {},
): AdHocOptions {
  return {
    pattern,
    module: moduleName,
    module_args: moduleArgs,
    inventory: null,
    become: null,
    become_user: null,
    become_method: null,
    remote_user: null,
    private_key: null,
    forks: null,
    extra_vars: {},
    timeout_secs: null,
    poll: null,
    background: null,
    one_line: false,
    tree: null,
    vault_password_file: null,
    verbosity: null,
    env_vars: {},
    ...overrides,
  };
}

const AnsibleRunsTab: React.FC<AnsibleTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const r = useAnsibleRuns(connectionId);
  const id = connectionId;

  const [open, setOpen] = useState<Record<string, boolean>>({
    inventory: true,
    playbooks: true,
    adhoc: false,
    facts: false,
    history: false,
  });
  const toggle = useCallback(
    (sid: string) => setOpen((o) => ({ ...o, [sid]: !o[sid] })),
    [],
  );

  // Inspector (raw JSON of the last read) + activity log (last actions).
  const [detail, setDetail] = useState<{ label: string; body: unknown } | null>(
    null,
  );
  const [log, setLog] = useState<string[]>([]);
  const note = useCallback((msg: string) => {
    setLog((l) =>
      [`${new Date().toLocaleTimeString()}  ${msg}`, ...l].slice(0, 30),
    );
  }, []);
  const show = useCallback(
    (label: string, body: unknown) => setDetail({ label, body }),
    [],
  );

  /** Wrap an action: run it, surface a note, swallow the rethrow (error state is
   *  already set by the hook's `run`). */
  const act = useCallback(
    async <T,>(label: string, op: () => Promise<T>): Promise<T | undefined> => {
      try {
        const res = await op();
        note(`${label} ✓`);
        return res;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        note(`${label} ✗ ${msg}`);
        return undefined;
      }
    },
    [note],
  );

  // ── Form state ────────────────────────────────────────────────────────────────
  // Inventory
  const [invSource, setInvSource] = useState("");
  const [invPattern, setInvPattern] = useState("all");
  const [invHost, setInvHost] = useState("");
  const [invPath, setInvPath] = useState("");
  const [invHostName, setInvHostName] = useState("");
  const [invHostGroups, setInvHostGroups] = useState("");
  const [invRemoveHost, setInvRemoveHost] = useState("");
  const [invGroupName, setInvGroupName] = useState("");
  const [invRemoveGroup, setInvRemoveGroup] = useState("");
  const [dynScript, setDynScript] = useState("");

  // Playbooks
  const [pbDir, setPbDir] = useState("");
  const [pbParsePath, setPbParsePath] = useState("");
  const [pbRunPath, setPbRunPath] = useState("");
  const [pbInventory, setPbInventory] = useState("");
  const [pbLimit, setPbLimit] = useState("");
  const [pbTags, setPbTags] = useState("");
  const [pbCheck, setPbCheck] = useState(false);
  const [pbDiff, setPbDiff] = useState(false);
  const [pbBecome, setPbBecome] = useState(false);

  // Ad-hoc
  const [ahPattern, setAhPattern] = useState("all");
  const [ahInventory, setAhInventory] = useState("");
  const [ahModule, setAhModule] = useState("command");
  const [ahArgs, setAhArgs] = useState("");
  const [ahBecome, setAhBecome] = useState(false);
  const [ahShellCmd, setAhShellCmd] = useState("");
  const [ahCopySrc, setAhCopySrc] = useState("");
  const [ahCopyDest, setAhCopyDest] = useState("");
  const [ahServiceName, setAhServiceName] = useState("");
  const [ahServiceState, setAhServiceState] = useState("started");
  const [ahPackage, setAhPackage] = useState("");
  const [ahPackageState, setAhPackageState] = useState("present");

  // Facts
  const [factPattern, setFactPattern] = useState("all");
  const [factInventory, setFactInventory] = useState("");
  const [factFilter, setFactFilter] = useState("");

  // History
  const [histExecId, setHistExecId] = useState("");

  const inv = (s: string) => (s.trim() ? s.trim() : undefined);

  // ── Playbook run/check/diff dispatch ──────────────────────────────────────────
  const runPlaybook = useCallback(
    (mode: "run" | "check" | "diff") => {
      const options = makeRunOptions(pbRunPath, {
        inventory: pbInventory.trim() || null,
        limit: pbLimit.trim() || null,
        tags: pbTags.trim() ? pbTags.split(",").map((x) => x.trim()) : [],
        check_mode: pbCheck,
        diff_mode: pbDiff,
        become: pbBecome ? true : null,
      });
      const call =
        mode === "run"
          ? r.api.playbookRun(id, options)
          : mode === "check"
            ? r.api.playbookCheck(id, options)
            : r.api.playbookDiff(id, options);
      void act(`playbook ${mode}`, () => call).then((res) => {
        if (res) {
          r.recordResult(res);
          show(`playbook:${mode}`, res);
          void r.refreshHistory();
        }
      });
    },
    [
      pbRunPath,
      pbInventory,
      pbLimit,
      pbTags,
      pbCheck,
      pbDiff,
      pbBecome,
      r,
      id,
      act,
      show,
    ],
  );

  return (
    <div className="flex flex-col text-[var(--color-text)]">
      {/* ── Inventory ─────────────────────────────────────────────────────────── */}
      <Section
        id="inventory"
        title={t("integrations.ansible.runs.inventory.title", "Inventory")}
        icon={<Server size={14} className="text-primary" />}
        open={open.inventory}
        onToggle={toggle}
      >
        <div>
          <label className={labelClass}>
            {t(
              "integrations.ansible.runs.inventory.source",
              "Inventory source (file / dir / host list)",
            )}
          </label>
          <input
            className={inputClass}
            value={invSource}
            placeholder="/etc/ansible/hosts"
            onChange={(e) => setInvSource(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={btnClass}
            disabled={!invSource}
            onClick={() =>
              act("inventory parse", () =>
                r.api.inventoryParse(id, invSource),
              ).then((res) => res && show("inventory", res))
            }
          >
            <RefreshCw size={12} />
            {t("integrations.ansible.runs.inventory.parse", "Parse")}
          </button>
          <button
            className={btnClass}
            disabled={!invSource}
            onClick={() =>
              act("inventory graph", () =>
                r.api.inventoryGraph(id, invSource),
              ).then((res) => res !== undefined && show("inventoryGraph", res))
            }
          >
            <Boxes size={12} />
            {t("integrations.ansible.runs.inventory.graph", "Graph")}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={invPattern}
            placeholder={t(
              "integrations.ansible.runs.inventory.pattern",
              "Host pattern",
            )}
            onChange={(e) => setInvPattern(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!invSource}
            onClick={() =>
              act("inventory list hosts", () =>
                r.api.inventoryListHosts(id, invSource, invPattern),
              ).then((res) => res && show("hosts", res))
            }
          >
            {t("integrations.ansible.runs.inventory.listHosts", "List hosts")}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={invHost}
            placeholder={t(
              "integrations.ansible.runs.inventory.host",
              "Host name (for vars)",
            )}
            onChange={(e) => setInvHost(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!invSource || !invHost}
            onClick={() =>
              act("inventory host vars", () =>
                r.api.inventoryHostVars(id, invSource, invHost),
              ).then((res) => res && show(`hostVars:${invHost}`, res))
            }
          >
            {t("integrations.ansible.runs.inventory.hostVars", "Host vars")}
          </button>
        </div>

        {/* Dynamic inventory */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={dynScript}
            placeholder={t(
              "integrations.ansible.runs.inventory.dynamicScript",
              "Dynamic inventory script path",
            )}
            onChange={(e) => setDynScript(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!dynScript}
            onClick={() => {
              const config: DynamicInventoryConfig = {
                script_path: dynScript,
                args: [],
                env: {},
                cache_ttl_secs: null,
              };
              void act("inventory dynamic", () =>
                r.api.inventoryDynamic(id, config),
              ).then((res) => res && show("dynamicInventory", res));
            }}
          >
            {t("integrations.ansible.runs.inventory.dynamic", "Run dynamic")}
          </button>
        </div>

        {/* File-path mutations (operate on a file path, NOT the session id) */}
        <div className="rounded border border-[var(--color-border)] p-2">
          <p className={labelClass}>
            {t(
              "integrations.ansible.runs.inventory.editFile",
              "Edit inventory file (path-based)",
            )}
          </p>
          <input
            className={inputClass}
            value={invPath}
            placeholder={t(
              "integrations.ansible.runs.inventory.filePath",
              "Inventory file path",
            )}
            onChange={(e) => setInvPath(e.target.value)}
          />
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className={inputClass}
              value={invHostName}
              placeholder={t(
                "integrations.ansible.runs.inventory.addHostName",
                "New host name",
              )}
              onChange={(e) => setInvHostName(e.target.value)}
            />
            <input
              className={inputClass}
              value={invHostGroups}
              placeholder={t(
                "integrations.ansible.runs.inventory.addHostGroups",
                "Groups (comma sep)",
              )}
              onChange={(e) => setInvHostGroups(e.target.value)}
            />
            <button
              className={primaryBtnClass}
              disabled={!invPath || !invHostName}
              onClick={() => {
                const params: AddHostParams = {
                  name: invHostName,
                  ansible_host: null,
                  ansible_port: null,
                  ansible_user: null,
                  ansible_connection: null,
                  groups: invHostGroups.trim()
                    ? invHostGroups.split(",").map((x) => x.trim())
                    : [],
                  variables: {},
                };
                void act("inventory add host", () =>
                  r.api.inventoryAddHost(invPath, params),
                );
              }}
            >
              <Plus size={12} />
              {t("integrations.ansible.runs.inventory.addHost", "Add host")}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              className={inputClass}
              value={invRemoveHost}
              placeholder={t(
                "integrations.ansible.runs.inventory.removeHostName",
                "Host to remove",
              )}
              onChange={(e) => setInvRemoveHost(e.target.value)}
            />
            <button
              className={dangerBtnClass}
              disabled={!invPath || !invRemoveHost}
              onClick={() =>
                act("inventory remove host", () =>
                  r.api.inventoryRemoveHost(invPath, invRemoveHost),
                )
              }
            >
              <Trash2 size={12} />
              {t("integrations.ansible.runs.inventory.removeHost", "Remove host")}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              className={inputClass}
              value={invGroupName}
              placeholder={t(
                "integrations.ansible.runs.inventory.addGroupName",
                "New group name",
              )}
              onChange={(e) => setInvGroupName(e.target.value)}
            />
            <button
              className={primaryBtnClass}
              disabled={!invPath || !invGroupName}
              onClick={() => {
                const params: AddGroupParams = {
                  name: invGroupName,
                  children: [],
                  variables: {},
                };
                void act("inventory add group", () =>
                  r.api.inventoryAddGroup(invPath, params),
                );
              }}
            >
              <Plus size={12} />
              {t("integrations.ansible.runs.inventory.addGroup", "Add group")}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              className={inputClass}
              value={invRemoveGroup}
              placeholder={t(
                "integrations.ansible.runs.inventory.removeGroupName",
                "Group to remove",
              )}
              onChange={(e) => setInvRemoveGroup(e.target.value)}
            />
            <button
              className={dangerBtnClass}
              disabled={!invPath || !invRemoveGroup}
              onClick={() =>
                act("inventory remove group", () =>
                  r.api.inventoryRemoveGroup(invPath, invRemoveGroup),
                )
              }
            >
              <Trash2 size={12} />
              {t(
                "integrations.ansible.runs.inventory.removeGroup",
                "Remove group",
              )}
            </button>
          </div>
        </div>
      </Section>

      {/* ── Playbooks ─────────────────────────────────────────────────────────── */}
      <Section
        id="playbooks"
        title={t("integrations.ansible.runs.playbooks.title", "Playbooks")}
        icon={<FileCode2 size={14} className="text-primary" />}
        open={open.playbooks}
        onToggle={toggle}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={pbDir}
            placeholder={t(
              "integrations.ansible.runs.playbooks.dir",
              "Playbooks directory",
            )}
            onChange={(e) => setPbDir(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!pbDir}
            onClick={() =>
              act("playbook list", () => r.refreshPlaybooks(pbDir))
            }
          >
            <RefreshCw size={12} />
            {t("integrations.ansible.runs.playbooks.list", "List")}
          </button>
        </div>
        {r.playbooks.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {r.playbooks.map((p) => (
              <li key={p} className="px-2 py-1">
                <button
                  className="truncate text-left text-xs hover:text-primary"
                  onClick={() => {
                    setPbParsePath(p);
                    setPbRunPath(p);
                  }}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            className={inputClass}
            value={pbParsePath}
            placeholder={t(
              "integrations.ansible.runs.playbooks.path",
              "Playbook path",
            )}
            onChange={(e) => setPbParsePath(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!pbParsePath}
            onClick={() =>
              act("playbook parse", () => r.api.playbookParse(pbParsePath)).then(
                (res) => res && show("playbook", res),
              )
            }
          >
            {t("integrations.ansible.runs.playbooks.parse", "Parse")}
          </button>
          <span className="flex gap-1">
            <button
              className={btnClass}
              disabled={!pbParsePath}
              onClick={() =>
                act("playbook syntax check", () =>
                  r.api.playbookSyntaxCheck(id, pbParsePath),
                ).then((res) => res && show("syntaxCheck", res))
              }
            >
              {t("integrations.ansible.runs.playbooks.syntax", "Syntax")}
            </button>
            <button
              className={btnClass}
              disabled={!pbParsePath}
              onClick={() =>
                act("playbook lint", () =>
                  r.api.playbookLint(id, pbParsePath),
                ).then((res) => res && show("lint", res))
              }
            >
              {t("integrations.ansible.runs.playbooks.lint", "Lint")}
            </button>
          </span>
        </div>

        {/* Run / check / diff */}
        <div className="rounded border border-[var(--color-border)] p-2">
          <input
            className={inputClass}
            value={pbRunPath}
            placeholder={t(
              "integrations.ansible.runs.playbooks.runPath",
              "Playbook to run",
            )}
            onChange={(e) => setPbRunPath(e.target.value)}
          />
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              className={inputClass}
              value={pbInventory}
              placeholder={t(
                "integrations.ansible.runs.playbooks.inventory",
                "Inventory (optional)",
              )}
              onChange={(e) => setPbInventory(e.target.value)}
            />
            <input
              className={inputClass}
              value={pbLimit}
              placeholder={t(
                "integrations.ansible.runs.playbooks.limit",
                "Limit (optional)",
              )}
              onChange={(e) => setPbLimit(e.target.value)}
            />
          </div>
          <input
            className={`${inputClass} mt-2`}
            value={pbTags}
            placeholder={t(
              "integrations.ansible.runs.playbooks.tags",
              "Tags (comma sep, optional)",
            )}
            onChange={(e) => setPbTags(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--color-textSecondary)]">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={pbCheck}
                onChange={(e) => setPbCheck(e.target.checked)}
              />
              {t("integrations.ansible.runs.playbooks.checkMode", "Check mode")}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={pbDiff}
                onChange={(e) => setPbDiff(e.target.checked)}
              />
              {t("integrations.ansible.runs.playbooks.diffMode", "Diff mode")}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={pbBecome}
                onChange={(e) => setPbBecome(e.target.checked)}
              />
              {t("integrations.ansible.runs.playbooks.become", "Become")}
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={primaryBtnClass}
              disabled={!pbRunPath}
              onClick={() => runPlaybook("run")}
            >
              <Play size={12} />
              {t("integrations.ansible.runs.playbooks.run", "Run")}
            </button>
            <button
              className={btnClass}
              disabled={!pbRunPath}
              onClick={() => runPlaybook("check")}
            >
              {t("integrations.ansible.runs.playbooks.check", "Check")}
            </button>
            <button
              className={btnClass}
              disabled={!pbRunPath}
              onClick={() => runPlaybook("diff")}
            >
              {t("integrations.ansible.runs.playbooks.diff", "Diff")}
            </button>
          </div>
        </div>
      </Section>

      {/* ── Ad-hoc ────────────────────────────────────────────────────────────── */}
      <Section
        id="adhoc"
        title={t("integrations.ansible.runs.adhoc.title", "Ad-hoc Commands")}
        icon={<Terminal size={14} className="text-primary" />}
        open={open.adhoc}
        onToggle={toggle}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            value={ahPattern}
            placeholder={t(
              "integrations.ansible.runs.adhoc.pattern",
              "Host pattern",
            )}
            onChange={(e) => setAhPattern(e.target.value)}
          />
          <input
            className={inputClass}
            value={ahInventory}
            placeholder={t(
              "integrations.ansible.runs.adhoc.inventory",
              "Inventory (optional)",
            )}
            onChange={(e) => setAhInventory(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={ahBecome}
            onChange={(e) => setAhBecome(e.target.checked)}
          />
          {t("integrations.ansible.runs.adhoc.become", "Become (privilege escalation)")}
        </label>

        {/* Ping */}
        <button
          className={btnClass}
          disabled={!ahPattern}
          onClick={() =>
            act("adhoc ping", () =>
              r.api.adhocPing(id, ahPattern, inv(ahInventory)),
            ).then((res) => {
              if (res) {
                r.recordResult(res);
                show("adhoc:ping", res);
              }
            })
          }
        >
          {t("integrations.ansible.runs.adhoc.ping", "Ping")}
        </button>

        {/* Generic module run */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className={inputClass}
            value={ahModule}
            placeholder={t("integrations.ansible.runs.adhoc.module", "Module")}
            onChange={(e) => setAhModule(e.target.value)}
          />
          <input
            className={inputClass}
            value={ahArgs}
            placeholder={t(
              "integrations.ansible.runs.adhoc.moduleArgs",
              "Module args",
            )}
            onChange={(e) => setAhArgs(e.target.value)}
          />
          <button
            className={primaryBtnClass}
            disabled={!ahPattern || !ahModule}
            onClick={() => {
              const options = makeAdHocOptions(
                ahPattern,
                ahModule,
                ahArgs.trim() || null,
                {
                  inventory: ahInventory.trim() || null,
                  become: ahBecome ? true : null,
                },
              );
              void act("adhoc run", () => r.api.adhocRun(id, options)).then(
                (res) => {
                  if (res) {
                    r.recordResult(res);
                    show("adhoc:run", res);
                    void r.refreshHistory();
                  }
                },
              );
            }}
          >
            <Play size={12} />
            {t("integrations.ansible.runs.adhoc.run", "Run module")}
          </button>
        </div>

        {/* Shell */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={ahShellCmd}
            placeholder={t(
              "integrations.ansible.runs.adhoc.shellCmd",
              "Shell command",
            )}
            onChange={(e) => setAhShellCmd(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!ahPattern || !ahShellCmd}
            onClick={() =>
              act("adhoc shell", () =>
                r.api.adhocShell(
                  id,
                  ahPattern,
                  ahShellCmd,
                  inv(ahInventory),
                  ahBecome,
                ),
              ).then((res) => {
                if (res) {
                  r.recordResult(res);
                  show("adhoc:shell", res);
                }
              })
            }
          >
            {t("integrations.ansible.runs.adhoc.shell", "Shell")}
          </button>
        </div>

        {/* Copy */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className={inputClass}
            value={ahCopySrc}
            placeholder={t("integrations.ansible.runs.adhoc.copySrc", "Src")}
            onChange={(e) => setAhCopySrc(e.target.value)}
          />
          <input
            className={inputClass}
            value={ahCopyDest}
            placeholder={t("integrations.ansible.runs.adhoc.copyDest", "Dest")}
            onChange={(e) => setAhCopyDest(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!ahPattern || !ahCopySrc || !ahCopyDest}
            onClick={() =>
              act("adhoc copy", () =>
                r.api.adhocCopy(
                  id,
                  ahPattern,
                  ahCopySrc,
                  ahCopyDest,
                  inv(ahInventory),
                  ahBecome,
                ),
              ).then((res) => {
                if (res) {
                  r.recordResult(res);
                  show("adhoc:copy", res);
                }
              })
            }
          >
            {t("integrations.ansible.runs.adhoc.copy", "Copy")}
          </button>
        </div>

        {/* Service */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className={inputClass}
            value={ahServiceName}
            placeholder={t(
              "integrations.ansible.runs.adhoc.serviceName",
              "Service name",
            )}
            onChange={(e) => setAhServiceName(e.target.value)}
          />
          <input
            className={inputClass}
            value={ahServiceState}
            placeholder={t(
              "integrations.ansible.runs.adhoc.serviceState",
              "State (started/stopped/restarted)",
            )}
            onChange={(e) => setAhServiceState(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!ahPattern || !ahServiceName}
            onClick={() =>
              act("adhoc service", () =>
                r.api.adhocService(
                  id,
                  ahPattern,
                  ahServiceName,
                  ahServiceState,
                  inv(ahInventory),
                ),
              ).then((res) => {
                if (res) {
                  r.recordResult(res);
                  show("adhoc:service", res);
                }
              })
            }
          >
            {t("integrations.ansible.runs.adhoc.service", "Service")}
          </button>
        </div>

        {/* Package */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className={inputClass}
            value={ahPackage}
            placeholder={t(
              "integrations.ansible.runs.adhoc.package",
              "Package name",
            )}
            onChange={(e) => setAhPackage(e.target.value)}
          />
          <input
            className={inputClass}
            value={ahPackageState}
            placeholder={t(
              "integrations.ansible.runs.adhoc.packageState",
              "State (present/absent/latest)",
            )}
            onChange={(e) => setAhPackageState(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!ahPattern || !ahPackage}
            onClick={() =>
              act("adhoc package", () =>
                r.api.adhocPackage(
                  id,
                  ahPattern,
                  ahPackage,
                  ahPackageState,
                  inv(ahInventory),
                ),
              ).then((res) => {
                if (res) {
                  r.recordResult(res);
                  show("adhoc:package", res);
                }
              })
            }
          >
            {t("integrations.ansible.runs.adhoc.packageBtn", "Package")}
          </button>
        </div>
      </Section>

      {/* ── Facts ─────────────────────────────────────────────────────────────── */}
      <Section
        id="facts"
        title={t("integrations.ansible.runs.facts.title", "Facts")}
        icon={<Cpu size={14} className="text-primary" />}
        open={open.facts}
        onToggle={toggle}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            value={factPattern}
            placeholder={t(
              "integrations.ansible.runs.facts.pattern",
              "Host pattern",
            )}
            onChange={(e) => setFactPattern(e.target.value)}
          />
          <input
            className={inputClass}
            value={factInventory}
            placeholder={t(
              "integrations.ansible.runs.facts.inventory",
              "Inventory (optional)",
            )}
            onChange={(e) => setFactInventory(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            className={inputClass}
            value={factFilter}
            placeholder={t(
              "integrations.ansible.runs.facts.filter",
              "Filter (optional, e.g. ansible_*)",
            )}
            onChange={(e) => setFactFilter(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!factPattern}
            onClick={() =>
              act("facts gather", () =>
                r.api.factsGather(
                  id,
                  factPattern,
                  inv(factInventory),
                  inv(factFilter),
                ),
              ).then((res) => res && show("facts", res))
            }
          >
            {t("integrations.ansible.runs.facts.gather", "Gather")}
          </button>
          <button
            className={btnClass}
            disabled={!factPattern}
            onClick={() =>
              act("facts gather min", () =>
                r.api.factsGatherMin(id, factPattern, inv(factInventory)),
              ).then((res) => res && show("factsMin", res))
            }
          >
            {t("integrations.ansible.runs.facts.gatherMin", "Gather (min)")}
          </button>
        </div>
      </Section>

      {/* ── History ───────────────────────────────────────────────────────────── */}
      <Section
        id="history"
        title={t("integrations.ansible.runs.history.title", "Execution History")}
        icon={<History size={14} className="text-primary" />}
        open={open.history}
        onToggle={toggle}
      >
        <div className="flex flex-wrap gap-2">
          <button
            className={btnClass}
            onClick={() => act("history list", () => r.refreshHistory())}
          >
            <RefreshCw size={12} />
            {t("integrations.ansible.runs.history.refresh", "Refresh")}
          </button>
          <button
            className={dangerBtnClass}
            onClick={() =>
              act("history clear", () => r.api.historyClear()).then(() =>
                r.refreshHistory(),
              )
            }
          >
            <Trash2 size={12} />
            {t("integrations.ansible.runs.history.clear", "Clear")}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={inputClass}
            value={histExecId}
            placeholder={t(
              "integrations.ansible.runs.history.execId",
              "Execution id",
            )}
            onChange={(e) => setHistExecId(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={!histExecId}
            onClick={() =>
              act("history get", () => r.api.historyGet(histExecId)).then(
                (res) => res && show(`history:${histExecId}`, res),
              )
            }
          >
            {t("integrations.ansible.runs.history.get", "Get")}
          </button>
        </div>
        {r.history.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {r.history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-2 px-2 py-1 text-xs"
              >
                <button
                  className="truncate text-left hover:text-primary"
                  onClick={() => show(`history:${h.id}`, h)}
                >
                  {h.command_type}
                  <span className="ml-2 text-[var(--color-textSecondary)]">
                    {h.status}
                  </span>
                </button>
                <span className="shrink-0 text-[var(--color-textSecondary)]">
                  {h.ok}/{h.changed}/{h.failed}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Inspector + activity log ──────────────────────────────────────────── */}
      {(detail || r.error) && (
        <div className="border-t border-[var(--color-border)] p-4">
          {r.error && <p className="mb-2 text-xs text-red-500">{r.error}</p>}
          {detail && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-textSecondary)]">
                  {t("integrations.ansible.runs.inspector", "Inspector")}:{" "}
                  {detail.label}
                </span>
                <button
                  className="text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
                  onClick={() => setDetail(null)}
                >
                  {t("integrations.ansible.runs.close", "Close")}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[11px] leading-tight text-[var(--color-text)]">
                {JSON.stringify(detail.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
      {log.length > 0 && (
        <div className="border-t border-[var(--color-border)] p-4">
          <span className="text-xs font-medium text-[var(--color-textSecondary)]">
            {t("integrations.ansible.runs.activity", "Activity")}
          </span>
          <ul className="mt-1 max-h-32 overflow-auto text-[11px] text-[var(--color-textSecondary)]">
            {log.map((line, i) => (
              <li key={i} className="font-mono">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AnsibleRunsTab;
