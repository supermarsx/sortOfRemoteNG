import React, { useEffect, useRef, useState } from "react";
import { Network } from "lucide-react";
import type {
  NetworkToolId,
  ToolkitReport,
} from "../../../types/network/networkToolkit";
import { useNetworkToolkit } from "../../../hooks/network/useNetworkToolkit";
import {
  NETWORK_TOOLKIT_CATALOG,
  buildToolkitRequest,
  createToolkitDraft,
  type ToolkitDraft,
} from "../../../utils/network/networkToolkitCatalog";
import { getToolkitProxyProfiles } from "../../../utils/network/networkToolkitProfiles";
import { proxyCollectionManager } from "../../../utils/connection/proxyCollectionManager";
import {
  Checkbox,
  NumberInput,
  Select,
  Textarea,
  TextInput,
} from "../../ui/forms";
import { Modal } from "../../ui/overlays/Modal";
import { DialogHeader } from "../../ui/overlays/DialogHeader";
import { ToolkitResults } from "./ToolkitResults";

export interface NetworkToolkitProps {
  isOpen: boolean;
  embedded?: boolean;
  onClose: () => void;
}

export function NetworkToolkit({
  isOpen,
  embedded = false,
  onClose,
}: NetworkToolkitProps) {
  if (!isOpen) return null;
  return embedded ? (
    <ToolkitWorkspace onClose={onClose} />
  ) : (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel="Network Toolkit"
      panelClassName="max-w-6xl"
      contentClassName="h-[85vh] max-h-[50rem] min-h-0 p-0"
    >
      <ToolkitWorkspace onClose={onClose} />
    </Modal>
  );
}

function ToolkitWorkspace({ onClose }: { onClose: () => void }) {
  const toolkit = useNetworkToolkit();
  const [selected, setSelected] = useState<NetworkToolId>("ping");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<
    Partial<Record<NetworkToolId, ToolkitDraft>>
  >({});
  const [validation, setValidation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [keepHistory, setKeepHistory] = useState(false);
  const [history, setHistory] = useState<ToolkitReport[]>([]);
  const [historical, setHistorical] = useState<ToolkitReport | null>(null);
  const [profiles, setProfiles] = useState(getToolkitProxyProfiles);
  useEffect(
    () =>
      proxyCollectionManager.subscribe(() =>
        setProfiles(getToolkitProxyProfiles()),
      ),
    [],
  );
  const busyRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const cancelRef = useRef(toolkit.cancel);
  useEffect(() => {
    cancelRef.current = toolkit.cancel;
  }, [toolkit.cancel]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRef.current();
    };
  }, []);
  useEffect(() => {
    if (
      !keepHistory ||
      !toolkit.report ||
      new TextEncoder().encode(JSON.stringify(toolkit.report)).length >
        128 * 1024
    )
      return;
    const report = toolkit.report;
    setHistory((previous) =>
      [report, ...previous.filter((item) => item.jobId !== report.jobId)].slice(
        0,
        8,
      ),
    );
  }, [keepHistory, toolkit.report]);
  const tool = NETWORK_TOOLKIT_CATALOG.find((entry) => entry.id === selected)!;
  const draft = drafts[selected] ?? createToolkitDraft(tool);
  const busy = submitting || toolkit.running;
  const cancel = () => {
    generation.current++;
    busyRef.current = false;
    setSubmitting(false);
    toolkit.cancel();
  };
  const update = (patch: Partial<ToolkitDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [selected]: {
        ...(previous[selected] ?? createToolkitDraft(tool)),
        ...patch,
      },
    }));
    setValidation("");
  };
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current || toolkit.running) return;
    let request;
    try {
      if (draft.route === "httpProxy" && draft.proxyProfileId) {
        const profile = getToolkitProxyProfiles().find(
          (item) => item.id === draft.proxyProfileId,
        );
        if (!profile || profile.disabled || profile.url !== draft.proxyUrl)
          throw new Error(
            "The selected proxy profile changed or is unavailable. Review and reselect it before running.",
          );
      }
      request = buildToolkitRequest(tool, draft);
    } catch (error) {
      setValidation(
        error instanceof Error ? error.message : "Review the diagnostic input.",
      );
      return;
    }
    busyRef.current = true;
    const attempt = ++generation.current;
    setSubmitting(true);
    setValidation("");
    setHistorical(null);
    if (tool.trafficConfirmation) update({ confirmTraffic: false });
    try {
      await toolkit.run(request);
    } catch (error) {
      if (mounted.current && generation.current === attempt)
        setValidation(
          error instanceof Error
            ? error.message
            : "Diagnostic failed. No fallback was attempted.",
        );
    } finally {
      if (generation.current === attempt) {
        busyRef.current = false;
        if (mounted.current) setSubmitting(false);
      }
    }
  };
  const filtered = NETWORK_TOOLKIT_CATALOG.filter((entry) =>
    `${entry.label} ${entry.id} ${entry.group} ${entry.description}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-background)] text-[var(--color-text)]"
      data-testid="network-toolkit"
    >
      <DialogHeader
        icon={Network}
        title="Network Toolkit"
        subtitle="Explicit routes · bounded diagnostics · session-only results"
        variant="compact"
        onClose={onClose}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)] max-sm:grid-cols-1">
        <nav
          aria-label="Network tools"
          className="space-y-3 overflow-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-2 max-sm:max-h-44"
        >
          <TextInput
            variant="form-sm"
            label="Search tools"
            placeholder="Search tools…"
            value={search}
            onChange={setSearch}
            className="w-full"
          />
          {[...new Set(filtered.map((entry) => entry.group))].map((group) => (
            <section key={group} aria-label={group}>
              <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
                {group}
              </h3>
              {filtered
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    data-tool-id={entry.id}
                    aria-pressed={selected === entry.id}
                    disabled={busy}
                    onClick={() => {
                      setSelected(entry.id);
                      setValidation("");
                    }}
                    className={`w-full rounded px-2 py-1.5 text-left text-xs disabled:opacity-50 ${selected === entry.id ? "bg-[var(--color-surfaceHover)] font-semibold text-[var(--color-primary)]" : "hover:bg-[var(--color-surfaceHover)]"}`}
                  >
                    {entry.label}
                  </button>
                ))}
            </section>
          ))}
          {!filtered.length && (
            <p className="p-2 text-xs text-[var(--color-textMuted)]">
              No matching tools.
            </p>
          )}
        </nav>
        <main
          className="min-h-0 min-w-0 space-y-3 overflow-auto p-3"
          aria-label="Diagnostic workspace"
        >
          <div>
            <h3 className="text-sm font-semibold">{tool.label}</h3>
            <p className="text-xs text-[var(--color-textSecondary)]">
              {tool.description}
            </p>
          </div>
          <p className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs text-[var(--color-textSecondary)]">
            No saved browser credentials or cookies are used. TLS validation
            stays strict. There is no automatic route fallback. Only test
            systems you are authorized to access.
          </p>
          <form
            onSubmit={(event) => void run(event)}
            noValidate
            className="space-y-3"
          >
            <fieldset
              disabled={busy}
              className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            >
              {tool.target !== "none" && (
                <label className="col-span-full space-y-1 text-xs">
                  {tool.targetLabel ?? "Target hostname or IP address"}
                  {tool.target === "text" ? (
                    <Textarea
                      variant="form-sm"
                      label={tool.targetLabel}
                      value={draft.target}
                      onChange={(target) => update({ target })}
                      maxLength={65536}
                      rows={3}
                      className="w-full font-mono"
                    />
                  ) : (
                    <TextInput
                      variant="form-sm"
                      label={
                        tool.targetLabel ?? "Target hostname or IP address"
                      }
                      value={draft.target}
                      onChange={(target) => update({ target })}
                      placeholder={tool.placeholder ?? "host.example.org"}
                      maxLength={2048}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full font-mono"
                    />
                  )}
                </label>
              )}
              {tool.route === "local" ? (
                <p className="col-span-full text-xs text-[var(--color-textMuted)]">
                  Local computation only. No routing choice or network access is
                  needed.
                </p>
              ) : (
                <>
                  <div className="space-y-1 text-xs">
                    <span>Routing for this tool</span>
                    <Select
                      label="Routing for this tool"
                      value={draft.route}
                      onChange={(route) =>
                        update({ route: route as ToolkitDraft["route"] })
                      }
                      variant="form-sm"
                      options={[
                        { value: "", label: "Choose a route…", disabled: true },
                        { value: "direct", label: "Direct / local network" },
                        {
                          value: "httpProxy",
                          label:
                            tool.route === "proxy"
                              ? "HTTP proxy"
                              : "HTTP proxy — unsupported",
                          disabled: tool.route !== "proxy",
                        },
                      ]}
                    />
                  </div>
                  {tool.route === "direct" && (
                    <p className="self-end text-xs text-[var(--color-textMuted)]">
                      Direct-only protocol or local system tool. An HTTP proxy
                      cannot carry this operation.
                    </p>
                  )}
                  {draft.route === "httpProxy" && (
                    <>
                      <div className="space-y-1 text-xs">
                        <span>Saved proxy profile</span>
                        <Select
                          label="Saved proxy profile"
                          variant="form-sm"
                          value={draft.proxyProfileId}
                          onChange={(id) => {
                            if (!id) {
                              update({ proxyProfileId: "" });
                              return;
                            }
                            const profile = profiles.find(
                              (item) => item.id === id,
                            );
                            if (profile && !profile.disabled)
                              update({
                                proxyProfileId: id,
                                proxyUrl: profile.url,
                              });
                          }}
                          options={[
                            { value: "", label: "Manual proxy URL" },
                            ...profiles.map((profile) => ({
                              value: profile.id,
                              label: profile.name,
                              disabled: profile.disabled,
                              description: profile.reason,
                            })),
                          ]}
                        />
                      </div>
                      <label className="space-y-1 text-xs">
                        HTTP proxy URL
                        <TextInput
                          variant="form-sm"
                          label="HTTP proxy URL"
                          value={draft.proxyUrl}
                          onChange={(proxyUrl) =>
                            update({ proxyUrl, proxyProfileId: "" })
                          }
                          placeholder="http://127.0.0.1:8080"
                          maxLength={2048}
                          autoComplete="off"
                          spellCheck={false}
                          className="w-full font-mono"
                        />
                        <span className="block text-[var(--color-textMuted)]">
                          HTTP/HTTPS/HTTP-CONNECT endpoints only. Authenticated
                          profiles, SOCKS and tunnel chains are unsupported;
                          credentials are never silently dropped.
                        </span>
                      </label>
                      {profiles.some((profile) => profile.disabled) && (
                        <details className="col-span-full text-xs">
                          <summary>Unavailable proxy profiles</summary>
                          <ul className="space-y-1 pt-1">
                            {profiles
                              .filter((profile) => profile.disabled)
                              .map((profile) => (
                                <li key={profile.id}>
                                  {profile.name}:{" "}
                                  {profile.reason ?? "Unsupported profile."}
                                </li>
                              ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </>
              )}
              <label className="space-y-1 text-xs">
                Timeout (ms)
                <NumberInput
                  label="Timeout (ms)"
                  variant="form-sm"
                  value={draft.timeoutMs}
                  onChange={(timeoutMs) => update({ timeoutMs })}
                  min={500}
                  max={60000}
                  step={500}
                  clamp={false}
                  className="w-full"
                />
              </label>
              {tool.fields.map((field) => (
                <div key={field.key} className="space-y-1 text-xs">
                  <span>{field.label}</span>
                  {field.kind === "select" ? (
                    <Select
                      label={field.label}
                      variant="form-sm"
                      value={draft.options[field.key] ?? ""}
                      onChange={(value) =>
                        update({
                          options: { ...draft.options, [field.key]: value },
                        })
                      }
                      options={field.choices ?? []}
                    />
                  ) : (
                    <TextInput
                      variant="form-sm"
                      label={field.label}
                      inputMode={field.kind === "number" ? "numeric" : "text"}
                      value={draft.options[field.key] ?? ""}
                      onChange={(value) =>
                        update({
                          options: { ...draft.options, [field.key]: value },
                        })
                      }
                      maxLength={4096}
                      className="w-full"
                    />
                  )}
                  {field.help && (
                    <p className="text-[var(--color-textMuted)]">
                      {field.help}
                    </p>
                  )}
                </div>
              ))}
              {tool.trafficConfirmation && (
                <label className="col-span-full flex items-start gap-2 text-xs">
                  <Checkbox
                    checked={draft.confirmTraffic}
                    onChange={(confirmTraffic) => update({ confirmTraffic })}
                  />
                  <span>
                    I authorize this tool to generate network traffic.
                  </span>
                </label>
              )}
            </fieldset>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="sor-btn-primary-sm"
              >
                Run
              </button>
              <button
                type="button"
                disabled={!busy}
                className="sor-btn-secondary-sm"
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="sor-btn-secondary-sm"
                onClick={() => {
                  toolkit.clear();
                  setHistory([]);
                  setHistorical(null);
                  setValidation("");
                }}
              >
                Clear results
              </button>
              <span
                role="status"
                className="ml-auto text-xs text-[var(--color-textMuted)]"
              >
                {busy ? "Running…" : "Ready"}
              </span>
            </div>
          </form>
          {(validation || toolkit.error) && (
            <p
              role="alert"
              className="sor-alert-error whitespace-pre-wrap break-words p-2 text-sm"
            >
              {validation || toolkit.error}
            </p>
          )}
          <div className="space-y-2 border-t border-[var(--color-border)] pt-2">
            <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
              <Checkbox
                checked={keepHistory}
                onChange={(value) => {
                  setKeepHistory(value);
                  if (!value) {
                    setHistory([]);
                    setHistorical(null);
                  }
                }}
              />
              Keep up to 8 reports in this session (128 KiB each maximum)
            </label>
            {keepHistory && (
              <p className="text-xs text-[var(--color-textMuted)]">
                History is never persisted; closing this panel clears it.
                Reports may contain sensitive diagnostic data. Oversized reports
                are not added.
              </p>
            )}
            {keepHistory && history.length > 0 && (
              <div
                className="flex flex-wrap gap-1"
                aria-label="Session report history"
              >
                {history.map((item, index) => (
                  <button
                    key={item.jobId}
                    type="button"
                    className="sor-btn-secondary-sm"
                    onClick={() => setHistorical(item)}
                  >
                    {index + 1}. {item.tool}
                  </button>
                ))}
                <button
                  type="button"
                  className="sor-btn-secondary-sm"
                  onClick={() => setHistorical(null)}
                >
                  Latest report
                </button>
              </div>
            )}
            {historical && (
              <p className="text-xs text-[var(--color-textMuted)]">
                Viewing a session report. Selecting history does not run a tool.
              </p>
            )}
          </div>
          <ToolkitResults
            key={(historical ?? toolkit.report)?.jobId ?? "empty"}
            report={historical ?? toolkit.report}
          />
        </main>
      </div>
    </div>
  );
}

export default NetworkToolkit;
