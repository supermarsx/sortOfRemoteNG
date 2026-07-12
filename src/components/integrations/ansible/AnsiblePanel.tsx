// AnsiblePanel — the Ansible integration panel SHELL (t42 §4b, crate lead
// t42-ansible-L). Owns the connect/config form (control-node binary paths,
// working directory, ansible.cfg, default inventory) + the connection lifecycle
// and a registry-driven sub-tab bar. The command surface itself (inventory/
// playbooks/ad-hoc/facts/history and roles/galaxy/vault/config) is bound by the
// per-category tab modules, which register themselves in `./registry.ts`; this
// shell never changes per-category.

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plug, PlugZap, RefreshCw, ServerCog } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AnsibleConnectionConfig } from "../../../types/ansible";
import { useAnsibleConnection } from "../../../hooks/integration/ansible";
import { useIntegrationConfigStore } from "../../../hooks/integrations/useIntegrationConfigStore";
import { ansibleCategoryTabs } from "./registry";

interface AnsiblePanelProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId?: string;
}

const emptyForm = {
  name: "",
  ansibleBinPath: "",
  ansiblePlaybookBinPath: "",
  ansibleVaultBinPath: "",
  ansibleGalaxyBinPath: "",
  workingDirectory: "",
  configPath: "",
  defaultInventory: "",
};

type FormState = typeof emptyForm;

/** Empty string in the form → `null` on the wire (Ansible auto-detects). */
const orNull = (v: string): string | null => {
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const AnsiblePanel: React.FC<AnsiblePanelProps> = ({ isOpen, instanceId }) => {
  const { t } = useTranslation();
  const {
    isLoading: storeLoading,
    instancesFor,
    createInstance,
    updateInstance,
  } = useIntegrationConfigStore();
  const { connectionId, info, connecting, error, connect, disconnect } =
    useAnsibleConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [activeTab, setActiveTab] = useState<string | null>(
    ansibleCategoryTabs[0]?.categoryKey ?? null,
  );

  // Prefill the form from a persisted instance when opened against one.
  useEffect(() => {
    if (!instanceId || storeLoading) return;
    const instance = instancesFor("ansible").find((i) => i.id === instanceId);
    if (!instance) return;
    const fields = instance.fields ?? {};
    setForm({
      name: instance.name,
      ansibleBinPath: fields.ansibleBinPath ?? "",
      ansiblePlaybookBinPath: fields.ansiblePlaybookBinPath ?? "",
      ansibleVaultBinPath: fields.ansibleVaultBinPath ?? "",
      ansibleGalaxyBinPath: fields.ansibleGalaxyBinPath ?? "",
      workingDirectory: fields.workingDirectory ?? "",
      configPath: fields.configPath ?? "",
      defaultInventory: fields.defaultInventory ?? "",
    });
  }, [instanceId, storeLoading, instancesFor]);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const buildConfig = useCallback(
    (id: string, name: string): AnsibleConnectionConfig => {
      const now = new Date().toISOString();
      return {
        id,
        name,
        ansible_bin_path: orNull(form.ansibleBinPath),
        ansible_playbook_bin_path: orNull(form.ansiblePlaybookBinPath),
        ansible_vault_bin_path: orNull(form.ansibleVaultBinPath),
        ansible_galaxy_bin_path: orNull(form.ansibleGalaxyBinPath),
        working_directory: orNull(form.workingDirectory),
        config_path: orNull(form.configPath),
        default_inventory: orNull(form.defaultInventory),
        remote_user: null,
        private_key_path: null,
        ssh_common_args: null,
        env_vars: {},
        vault_password_file: null,
        ask_vault_pass: false,
        verbosity: 0,
        created_at: now,
        updated_at: now,
        labels: {},
      };
    },
    [form],
  );

  const handleConnect = useCallback(async () => {
    const name = form.name.trim() || "Ansible";
    const fields: Record<string, string> = {
      ansibleBinPath: form.ansibleBinPath.trim(),
      ansiblePlaybookBinPath: form.ansiblePlaybookBinPath.trim(),
      ansibleVaultBinPath: form.ansibleVaultBinPath.trim(),
      ansibleGalaxyBinPath: form.ansibleGalaxyBinPath.trim(),
      workingDirectory: form.workingDirectory.trim(),
      configPath: form.configPath.trim(),
      defaultInventory: form.defaultInventory.trim(),
    };

    // Persist config (no secret — Ansible auth is SSH keys/agent, not a stored
    // secret) and use the instance id as the stable connection id.
    let id = instanceId ?? null;
    try {
      if (id) {
        await updateInstance(id, { integrationKey: "ansible", name, fields });
      } else {
        const created = await createInstance({
          integrationKey: "ansible",
          name,
          fields,
        });
        id = created.id;
      }
    } catch {
      // Persistence failed (e.g. storage unavailable) — still attempt to connect
      // with an ephemeral id so the panel is usable.
      id = id ?? `ansible-${Date.now()}`;
    }

    const ok = await connect(id, buildConfig(id, name));
    if (ok) setActiveTab(ansibleCategoryTabs[0]?.categoryKey ?? null);
  }, [buildConfig, form, instanceId, createInstance, updateInstance, connect]);

  const ActiveTab = useMemo(() => {
    if (!connectionId || !activeTab) return null;
    const tab = ansibleCategoryTabs.find((tt) => tt.categoryKey === activeTab);
    if (!tab) return null;
    return React.lazy(tab.importTab);
  }, [connectionId, activeTab]);

  if (!isOpen) return null;

  const connected = Boolean(connectionId);

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
          <ServerCog className="h-5 w-5 text-primary" />
          {t("integrations.ansible.title", "Ansible")}
          {info && (
            <span className="text-xs font-normal text-[var(--color-textSecondary)]">
              {info.version} · Python {info.python_version}
            </span>
          )}
        </h2>
        {connected && (
          <button
            onClick={disconnect}
            className="app-bar-button flex items-center gap-1 px-2 py-1 text-xs"
            title={t("integrations.ansible.disconnect", "Disconnect")}
          >
            <PlugZap size={14} />
            {t("integrations.ansible.disconnect", "Disconnect")}
          </button>
        )}
      </div>

      {error && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-4 py-2 text-xs text-[var(--color-danger,#f87171)]">
          {error}
        </div>
      )}

      {!connected ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-md flex-col gap-3">
            <p className="text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.ansible.connectHint",
                "Point at an Ansible control node. Binary paths auto-detect on PATH when left blank.",
              )}
            </p>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.ansible.fields.name", "Name")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="control-node"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.ansible.fields.ansibleBinPath", "ansible binary path")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.ansibleBinPath}
                onChange={(e) => setField("ansibleBinPath", e.target.value)}
                placeholder="/usr/bin/ansible"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.ansible.fields.ansiblePlaybookBinPath",
                "ansible-playbook binary path",
              )}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.ansiblePlaybookBinPath}
                onChange={(e) =>
                  setField("ansiblePlaybookBinPath", e.target.value)
                }
                placeholder="/usr/bin/ansible-playbook"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t(
                  "integrations.ansible.fields.ansibleVaultBinPath",
                  "ansible-vault path",
                )}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.ansibleVaultBinPath}
                  onChange={(e) =>
                    setField("ansibleVaultBinPath", e.target.value)
                  }
                  placeholder="/usr/bin/ansible-vault"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
                {t(
                  "integrations.ansible.fields.ansibleGalaxyBinPath",
                  "ansible-galaxy path",
                )}
                <input
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                  value={form.ansibleGalaxyBinPath}
                  onChange={(e) =>
                    setField("ansibleGalaxyBinPath", e.target.value)
                  }
                  placeholder="/usr/bin/ansible-galaxy"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.ansible.fields.workingDirectory",
                "Working directory",
              )}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.workingDirectory}
                onChange={(e) => setField("workingDirectory", e.target.value)}
                placeholder="/etc/ansible"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t("integrations.ansible.fields.configPath", "ansible.cfg path")}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.configPath}
                onChange={(e) => setField("configPath", e.target.value)}
                placeholder="/etc/ansible/ansible.cfg"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
              {t(
                "integrations.ansible.fields.defaultInventory",
                "Default inventory",
              )}
              <input
                className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-sm text-[var(--color-text)]"
                value={form.defaultInventory}
                onChange={(e) => setField("defaultInventory", e.target.value)}
                placeholder="/etc/ansible/hosts"
              />
            </label>

            <button
              onClick={handleConnect}
              disabled={connecting}
              className="mt-2 flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plug size={16} />
              )}
              {t("integrations.ansible.connect", "Connect")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {ansibleCategoryTabs.length > 0 ? (
            <>
              <div className="flex gap-1 border-b border-[var(--color-border)] px-2">
                {ansibleCategoryTabs.map((tab) => (
                  <button
                    key={tab.categoryKey}
                    onClick={() => setActiveTab(tab.categoryKey)}
                    className={`px-3 py-2 text-sm ${
                      activeTab === tab.categoryKey
                        ? "border-b-2 border-primary text-[var(--color-text)]"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {t(`integrations.ansible.tabs.${tab.categoryKey}`, tab.label)}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  }
                >
                  {ActiveTab && connectionId && (
                    <ActiveTab connectionId={connectionId} />
                  )}
                </Suspense>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-[var(--color-textSecondary)]">
              <RefreshCw className="h-8 w-8 opacity-50" />
              <p className="text-sm">
                {t(
                  "integrations.ansible.noTabs",
                  "Connected. Management sections load here once registered.",
                )}
              </p>
              {info && (
                <p className="text-xs">
                  {info.executable} · {info.version}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AnsiblePanel;
