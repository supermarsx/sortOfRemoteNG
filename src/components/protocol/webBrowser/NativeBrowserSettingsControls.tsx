"use client";

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Settings2, X, LoaderCircle } from "lucide-react";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import type { WebBrowserSettingsConfig } from "../../../types/settings/webBrowser";
import type { BrowserSessionOverrides } from "../../../types/settings/browserSession";
import type { HttpProxyPolicy } from "../../../types/connection/httpProxyPolicy";
import type { WebsiteDomainPermissionsSettings } from "../../../types/settings/websiteDomainPermissions";
import {
  normalizeBrowserSessionOverrides,
  resolveConnectionBrowserSettings,
  DEFAULT_BROWSER_SESSION_RETENTION,
} from "../../../utils/settings/browserSessionSettings";
import { normalizeHttpProxyPolicy } from "../../../utils/connection/httpProxyPolicy";
import { normalizeWebsiteDomainPermissions } from "../../../utils/settings/websiteDomainPermissions";
import {
  nativeBrowsingMode,
  nativeBrowsingPreset,
  NATIVE_BROWSING_MODE_OPTIONS,
  NATIVE_BROWSING_MODE_HELP,
} from "../../../utils/connection/nativeBrowsingDefaults";
import { useBrowserRetentionCapabilities } from "../../../hooks/protocol/useBrowserRetentionCapabilities";
import { reclaimShellFocus } from "../../../utils/window/reclaimShellFocus";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { Select } from "../../ui/forms/Select";
import { OriginConnectionPermissions } from "../../SettingsDialog/sections/webBrowser/OriginBrowserPreferences";
import {
  TLS_INTERCEPTION_HELP,
  TLS_INTERCEPTION_OPTION_LABELS,
} from "../../SettingsDialog/sections/webBrowser/browserTlsInterceptionCopy";

export interface NativeBrowserSettingsChanges {
  browserSession?: BrowserSessionOverrides;
  httpProxyPolicy?: HttpProxyPolicy;
  websiteDomainPermissions?: WebsiteDomainPermissionsSettings;
}
/** Persistence/restart failed after closing the current browser. Keep the draft for retry. */
// eslint-disable-next-line react-refresh/only-export-components -- shared save callback error contract
export class NativeBrowserSettingsSaveAfterCloseError extends Error {}
export interface NativeBrowserSettingsControlsProps {
  session: ConnectionSession;
  connection: Connection;
  config: WebBrowserSettingsConfig;
  owner: string;
  visible: boolean;
  available: boolean;
  open?: boolean;
  initialTab?: "General" | "Permissions";
  onOpenChange?: (open: boolean) => void;
  onSave: (
    changes: NativeBrowserSettingsChanges,
    reconnect: boolean,
  ) => Promise<void>;
}
const tabs = [
  "General",
  "Privacy",
  "Network",
  "Automation",
  "Permissions",
] as const;
type Tab = (typeof tabs)[number];
const booleanFields = {
  General: [
    ["showBookmarksBar", "Bookmarks bar"],
    ["showSecurityInfo", "Security information"],
    ["showLoadingProgress", "Loading progress"],
  ],
  Privacy: [
    ["cookiesEnabled", "Website cookies"],
    ["restoreCookies", "Restore saved cookies"],
    ["localStorageEnabled", "Temporary site storage"],
    ["mediaStreamEnabled", "Camera and microphone requests"],
  ],
  Automation: [
    ["websiteExtensionsEnabled", "App login and website automation"],
    ["manualFormSubmit", "Require manual form submission"],
  ],
} as const;
const numberFields = {
  General: [
    ["defaultZoomPercent", "Default zoom (%)", 50, 200],
    ["initialLoadTimeoutSeconds", "Browser startup timeout (seconds)", 10, 120],
    ["documentReadyTimeoutSeconds", "Page loading timeout (seconds)", 30, 240],
  ],
  Automation: [
    ["minimumFormFillDelayMs", "Delay before filling forms (ms)", 0, 30000],
    [
      "minimumFormSubmitDelayMs",
      "Delay before submitting forms (ms)",
      0,
      30000,
    ],
  ],
} as const;
const initialChanges = (
  connection: Connection,
): NativeBrowserSettingsChanges => ({
  browserSession: connection.browserSession,
  httpProxyPolicy: connection.httpProxyPolicy,
  websiteDomainPermissions: connection.websiteDomainPermissions,
});

export default function NativeBrowserSettingsControls(
  props: NativeBrowserSettingsControlsProps,
) {
  // A portal must disappear immediately on owner/active-tab loss. Reconnects do
  // not change this owner key, so they retain open intent and unfinished edits.
  return props.visible ? (
    <SettingsPopover key={props.owner} {...props} />
  ) : null;
}
function SettingsPopover({
  connection,
  config,
  available,
  open: controlledOpen,
  onOpenChange,
  onSave,
  initialTab = "General",
}: NativeBrowserSettingsControlsProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const [draft, setDraft] = useState(() => initialChanges(connection));
  const [tab, setTab] = useState<Tab>("General");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  const alive = useRef(true);
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const capabilities = useBrowserRetentionCapabilities(open);
  const original = useRef(JSON.stringify(initialChanges(connection)));
  const originalConfig = useRef(JSON.stringify(config));
  const dirty = JSON.stringify(draft) !== original.current;
  const disabled = pending || !available;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => () => openChangeRef.current?.(false), []);
  useEffect(() => {
    if (!open) return;
    setDraft(initialChanges(connection));
    original.current = JSON.stringify(initialChanges(connection));
    originalConfig.current = JSON.stringify(config);
    setError(null);
    // Only a new opening adopts saved changes; same-owner reconnects and
    // incoming row updates while editing must not erase an unfinished draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    reclaimShellFocus();
    const trigger = anchorRef.current?.querySelector("button");
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        dialogRef.current
          ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?.focus(),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      if (restoreFocus.current) trigger?.focus({ preventScroll: true });
    };
  }, [open, initialTab]);
  const update = (changes: Partial<NativeBrowserSettingsChanges>) => {
    setDraft((previous) => ({ ...previous, ...changes }));
    setError(null);
  };
  const sessionValue = draft.browserSession ?? { version: 1 as const };
  const session = (key: keyof BrowserSessionOverrides, value: unknown) => {
    const next = { ...sessionValue, [key]: value };
    if (value === undefined) delete next[key];
    update({
      browserSession: Object.keys(next).length === 1 ? undefined : next,
    });
  };
  const policy = draft.httpProxyPolicy ?? config.defaultPolicy;
  const policyUpdate = (changes: Partial<HttpProxyPolicy>) =>
    update({ httpProxyPolicy: { ...policy, ...changes } });
  const defaults = resolveConnectionBrowserSettings(config, undefined);
  const select = (
    label: string,
    value: string,
    options: Array<{ value: string; label: string; disabled?: boolean }>,
    change: (value: string) => void,
    extraDisabled = false,
  ) => (
    <div className="space-y-1.5" key={label}>
      <span className="block text-xs font-medium">{label}</span>
      <Select
        label={label}
        variant="form"
        className="w-full"
        portalContainer={portalContainer}
        value={value}
        options={options}
        disabled={disabled || extraDisabled}
        onChange={change}
      />
    </div>
  );
  const bool = (key: keyof BrowserSessionOverrides, label: string) =>
    select(
      label,
      sessionValue[key] === undefined ? "inherit" : String(sessionValue[key]),
      [
        {
          value: "inherit",
          label: `Use app default (${defaults[key as keyof typeof defaults] === false ? "off" : "on"})`,
        },
        { value: "true", label: "On for this connection" },
        { value: "false", label: "Off for this connection" },
      ],
      (value) =>
        session(key, value === "inherit" ? undefined : value === "true"),
    );
  const number = (
    key: keyof BrowserSessionOverrides,
    label: string,
    min: number,
    max: number,
  ) => (
    <div
      key={key}
      className="space-y-2 rounded border border-[var(--color-border)] p-3"
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={disabled}
          checked={sessionValue[key] !== undefined}
          onChange={(event) =>
            session(
              key,
              event.target.checked
                ? defaults[key as keyof typeof defaults]
                : undefined,
            )
          }
        />
        Override {label.toLowerCase()}
      </label>
      <label className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-textSecondary)]">
        <span>
          {label} · app default {String(defaults[key as keyof typeof defaults])}
        </span>
        <input
          aria-label={label}
          className="sor-settings-input w-24"
          type="number"
          min={min}
          max={max}
          step={1}
          disabled={disabled || sessionValue[key] === undefined}
          value={
            sessionValue[key] === undefined
              ? Number(defaults[key as keyof typeof defaults])
              : Number.isNaN(sessionValue[key])
                ? ""
                : Number(sessionValue[key])
          }
          onChange={(event) =>
            session(
              key,
              event.target.value === "" ? NaN : Number(event.target.value),
            )
          }
        />
      </label>
    </div>
  );
  const save = async (reconnect: boolean) => {
    if (pendingRef.current || !available) return;
    let changes: NativeBrowserSettingsChanges;
    try {
      const browserSession = normalizeBrowserSessionOverrides(
        draft.browserSession,
      );
      resolveConnectionBrowserSettings(config, browserSession);
      const httpProxyPolicy =
        draft.httpProxyPolicy === undefined
          ? undefined
          : normalizeHttpProxyPolicy(draft.httpProxyPolicy);
      if ((httpProxyPolicy ?? config.defaultPolicy).pageScripts !== "allow")
        throw new Error();
      const websiteDomainPermissions =
        draft.websiteDomainPermissions === undefined
          ? undefined
          : normalizeWebsiteDomainPermissions(draft.websiteDomainPermissions);
      if (JSON.stringify(config) !== originalConfig.current) {
        setError(
          "App browser defaults changed while you were editing. Close and reopen settings before saving.",
        );
        return;
      }
      changes = { browserSession, httpProxyPolicy, websiteDomainPermissions };
      const current = JSON.stringify(initialChanges(connection));
      if (current !== original.current && current !== JSON.stringify(changes)) {
        setError(
          "Nothing was saved. This connection's browser settings changed while you were editing. Close and reopen settings to review the latest values.",
        );
        return;
      }
    } catch {
      setError(
        "Check your settings before saving. Use whole numbers within the shown limits; combined form delays must not exceed 52,000 ms. Unsupported script policies must be changed in the connection editor.",
      );
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(changes, reconnect);
      if (alive.current) setOpen(false);
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof NativeBrowserSettingsSaveAfterCloseError
            ? "The browser was closed, but saving or reconnecting did not finish. Your draft is kept. Retry saving or reopen the connection."
            : "Nothing was saved. Your draft is kept; check that this connection is still available and retry.",
        );
    } finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  };
  const retention =
    sessionValue.sessionRetention ??
    config.sessionRetention ??
    DEFAULT_BROWSER_SESSION_RETENTION;
  const retentionUpdate = (changes: Partial<typeof retention>) =>
    session("sessionRetention", { ...retention, ...changes });
  return (
    <div
      ref={anchorRef}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          !pendingRef.current &&
          next instanceof Node &&
          !dialogRef.current?.contains(next) &&
          !anchorRef.current?.contains(next)
        ) {
          restoreFocus.current = false;
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="sor-btn sor-icon-btn-sm shrink-0"
        data-tooltip="Browser settings"
        aria-label="Browser settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={pending || (!available && !open)}
        onClick={() => {
          restoreFocus.current = true;
          setOpen(!open);
        }}
      >
        <Settings2 size={16} aria-hidden="true" />
      </button>
      <PopoverSurface
        isOpen={open}
        anchorRef={anchorRef}
        align="end"
        offset={4}
        onClose={pending ? undefined : () => setOpen(false)}
        className="sor-popover-panel sor-popover-panel-strong z-[99999] flex w-[35rem] max-w-[calc(100vw-1rem)] max-h-[85dvh] flex-col overflow-hidden"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="false"
          aria-label="Browser settings"
          className="flex min-h-0 max-h-[85dvh] flex-col"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 p-4 pb-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-semibold">
                <Settings2
                  size={17}
                  className="text-primary"
                  aria-hidden="true"
                />
                Browser settings
              </h3>
              <p className="mt-1 truncate text-xs text-[var(--color-textSecondary)]">
                {connection.name} · settings for this saved connection
              </p>
            </div>
            <button
              type="button"
              className="sor-icon-btn-sm"
              aria-label="Close browser settings"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <div
            role="tablist"
            aria-label="Browser settings sections"
            className="flex shrink-0 overflow-x-auto border-b border-[var(--color-border)] px-2"
          >
            {tabs.map((name, index) => (
              <button
                key={name}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${id}-${name}-tab`}
                aria-controls={`${id}-${name}-panel`}
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                className={`flex-1 whitespace-nowrap border-b-2 px-2 py-2.5 text-xs ${tab === name ? "border-primary text-primary" : "border-transparent text-[var(--color-textSecondary)]"}`}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  let next: number;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft")
                    next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  setTab(tabs[next]);
                  tabRefs.current[next]?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div
            ref={setPortalContainer}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
          >
            {tabs.map((name) => (
              <div
                key={name}
                role="tabpanel"
                id={`${id}-${name}-panel`}
                aria-labelledby={`${id}-${name}-tab`}
                hidden={tab !== name}
                className="space-y-4"
              >
                {name === "General" && (
                  <>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      Choose how this website opens and how its browser toolbar
                      looks. Unchanged fields follow app defaults.
                    </p>
                    {numberFields.General.map(([key, label, min, max]) =>
                      number(key, label, min, max),
                    )}
                    {booleanFields.General.map(([key, label]) =>
                      bool(key, label),
                    )}
                  </>
                )}
                {name === "Privacy" && (
                  <>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      Camera and microphone access still requires approval.
                      Temporary site storage is isolated and is not included in
                      saved cookies.
                    </p>
                    {booleanFields.Privacy.map(([key, label]) =>
                      bool(key, label),
                    )}
                    <section className="space-y-3 border-t border-[var(--color-border)] pt-3">
                      <h4 className="text-sm font-semibold">
                        Saved sign-in cookies
                      </h4>
                      {select(
                        "Cookie retention",
                        sessionValue.sessionRetention === undefined
                          ? "inherit"
                          : retention.mode,
                        [
                          {
                            value: "inherit",
                            label: `Use app default (${defaults.sessionRetention.mode})`,
                          },
                          {
                            value: "ephemeral",
                            label: "Do not retain after closing",
                          },
                          {
                            value: "memory",
                            label: "Keep in memory",
                            disabled: !capabilities.memory,
                          },
                          {
                            value: "encrypted-database",
                            label: "Save in encrypted database",
                            disabled: !capabilities.encryptedDatabase,
                          },
                        ],
                        (value) =>
                          session(
                            "sessionRetention",
                            value === "inherit"
                              ? undefined
                              : { ...retention, mode: value },
                          ),
                      )}
                      <p className="text-xs text-[var(--color-textMuted)]">
                        Retention covers cookie snapshots only. Database
                        retention is included in database sync and exports.
                      </p>
                      {sessionValue.sessionRetention &&
                        retention.mode !== "ephemeral" && (
                          <>
                            {capabilities.policyExpiration && (
                              <>
                                {(
                                  [
                                    [
                                      "idleTimeoutMinutes",
                                      "Expire idle cookies after (minutes)",
                                      0,
                                      10080,
                                    ],
                                    [
                                      "maxAgeHours",
                                      "Maximum cookie age (hours)",
                                      1,
                                      8760,
                                    ],
                                  ] as const
                                ).map(([key, label, min, max]) => (
                                  <label
                                    key={key}
                                    className="flex items-center justify-between gap-3 text-xs"
                                  >
                                    {label}
                                    <input
                                      aria-label={label}
                                      className="sor-settings-input w-24"
                                      type="number"
                                      min={min}
                                      max={max}
                                      step={1}
                                      disabled={disabled}
                                      value={
                                        Number.isNaN(retention[key])
                                          ? ""
                                          : retention[key]
                                      }
                                      onChange={(event) =>
                                        retentionUpdate({
                                          [key]:
                                            event.target.value === ""
                                              ? NaN
                                              : Number(event.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                ))}
                              </>
                            )}
                            {capabilities.clearOnDatabaseLock &&
                              select(
                                "Clear saved cookies on database lock",
                                String(retention.clearOnDatabaseLock),
                                [
                                  { value: "true", label: "Clear on lock" },
                                  {
                                    value: "false",
                                    label: "Keep until expiry",
                                  },
                                ],
                                (value) =>
                                  retentionUpdate({
                                    clearOnDatabaseLock: value === "true",
                                  }),
                              )}
                          </>
                        )}
                      {!capabilities.memory &&
                        !capabilities.encryptedDatabase && (
                          <p role="status" className="text-xs text-warning">
                            Saved-cookie retention is unavailable in this
                            runtime. Existing preferences are kept.
                          </p>
                        )}
                    </section>
                  </>
                )}
                {name === "Network" && (
                  <>
                    {select(
                      "Browsing mode",
                      draft.httpProxyPolicy === undefined
                        ? "inherit"
                        : nativeBrowsingMode(policy),
                      [
                        {
                          value: "inherit",
                          label: `Use app request defaults (${nativeBrowsingMode(config.defaultPolicy)})`,
                        },
                        ...NATIVE_BROWSING_MODE_OPTIONS,
                      ],
                      (value) =>
                        value === "inherit"
                          ? update({ httpProxyPolicy: undefined })
                          : policyUpdate(
                              nativeBrowsingPreset(
                                value as NonNullable<
                                  HttpProxyPolicy["nativeBrowsingMode"]
                                >,
                              ),
                            ),
                    )}
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      {NATIVE_BROWSING_MODE_HELP}
                    </p>
                    <p className="text-xs text-[var(--color-textMuted)]">
                      Choosing app request defaults clears this connection's
                      request-policy overrides. Destination permission rules are
                      kept separately. Request options are saved together; use
                      app request defaults above to follow future app changes.
                    </p>
                    {select(
                      "HTTPS handling",
                      sessionValue.tlsInterception ?? "inherit",
                      [
                        {
                          value: "inherit",
                          label: `Use app default (${TLS_INTERCEPTION_OPTION_LABELS[config.tlsInterception ?? "auto"]})`,
                        },
                        ...Object.entries(TLS_INTERCEPTION_OPTION_LABELS).map(
                          ([value, label]) => ({ value, label }),
                        ),
                      ],
                      (value) =>
                        session(
                          "tlsInterception",
                          value === "inherit" ? undefined : value,
                        ),
                    )}
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      {TLS_INTERCEPTION_HELP}
                    </p>
                    {select(
                      "Require HTTPS requests",
                      String(policy.httpsOnly),
                      [
                        { value: "true", label: "HTTPS only" },
                        { value: "false", label: "Allow HTTP and HTTPS" },
                      ],
                      (value) =>
                        policyUpdate({
                          httpsOnly: value === "true",
                        }),
                    )}
                    {bool(
                      "crossOriginRequestsEnabled",
                      "Cross-origin website requests",
                    )}
                    {select(
                      "Request cache",
                      policy.cacheMode,
                      [
                        {
                          value: "normal",
                          label: "Follow website cache headers",
                        },
                        { value: "bypass", label: "Bypass cached responses" },
                      ],
                      (value) =>
                        policyUpdate({
                          cacheMode: value as HttpProxyPolicy["cacheMode"],
                        }),
                    )}
                    {capabilities.httpDiskCache && (
                      <section className="space-y-3 border-t border-[var(--color-border)] pt-3">
                        <h4 className="text-sm font-semibold">
                          Device page cache
                        </h4>
                        {select(
                          "Disk page cache",
                          sessionValue.httpCache?.enabled === undefined
                            ? "inherit"
                            : String(sessionValue.httpCache.enabled),
                          [
                            {
                              value: "inherit",
                              label: `Use app default (${config.httpCache?.enabled ? "on" : "off"})`,
                            },
                            { value: "true", label: "Enabled" },
                            { value: "false", label: "Disabled" },
                          ],
                          (value) => {
                            const next = { ...sessionValue.httpCache };
                            if (value === "inherit") delete next.enabled;
                            else next.enabled = value === "true";
                            session(
                              "httpCache",
                              Object.keys(next).length ? next : undefined,
                            );
                          },
                          !capabilities.httpDiskCache.available,
                        )}
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            disabled={
                              disabled || !capabilities.httpDiskCache.available
                            }
                            checked={
                              sessionValue.httpCache?.perConnectionMb !==
                              undefined
                            }
                            onChange={(event) => {
                              const next = { ...sessionValue.httpCache };
                              if (event.target.checked)
                                next.perConnectionMb =
                                  defaults.httpCache.perConnectionMb;
                              else delete next.perConnectionMb;
                              session(
                                "httpCache",
                                Object.keys(next).length ? next : undefined,
                              );
                            }}
                          />
                          Override page cache size
                        </label>
                        <label className="flex items-center justify-between gap-3 text-xs text-[var(--color-textSecondary)]">
                          Page cache limit (MiB) · app default{" "}
                          {defaults.httpCache.perConnectionMb}
                          <input
                            type="number"
                            aria-label="Page cache limit (MiB)"
                            className="sor-settings-input w-24"
                            min={16}
                            max={1024}
                            step={1}
                            disabled={
                              disabled ||
                              !capabilities.httpDiskCache.available ||
                              sessionValue.httpCache?.perConnectionMb ===
                                undefined
                            }
                            value={
                              Number.isNaN(
                                sessionValue.httpCache?.perConnectionMb,
                              )
                                ? ""
                                : (sessionValue.httpCache?.perConnectionMb ??
                                  defaults.httpCache.perConnectionMb)
                            }
                            onChange={(event) =>
                              session("httpCache", {
                                ...sessionValue.httpCache,
                                perConnectionMb:
                                  event.target.value === ""
                                    ? NaN
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <p className="text-xs text-[var(--color-textMuted)]">
                          Device-local cache follows website headers and
                          requires HTTPS inspection. It is never synced or
                          exported.
                          {!capabilities.httpDiskCache.available
                            ? " Unavailable in this runtime."
                            : ""}
                        </p>
                      </section>
                    )}
                  </>
                )}
                {name === "Automation" && (
                  <>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      Timing and form behavior only. These settings do not grant
                      sign-in consent or run saved scripts.
                    </p>
                    {booleanFields.Automation.map(([key, label]) =>
                      bool(key, label),
                    )}
                    {numberFields.Automation.map(([key, label, min, max]) =>
                      number(key, label, min, max),
                    )}
                    <p className="text-xs text-[var(--color-textMuted)]">
                      The two form delays together must not exceed 52,000 ms.
                    </p>
                  </>
                )}
                {name === "Permissions" && (
                  <OriginConnectionPermissions
                    settings={draft.websiteDomainPermissions}
                    sharedSettings={config.domainPermissions}
                    disabled={disabled}
                    portalContainer={portalContainer}
                    onChange={(websiteDomainPermissions) =>
                      update({ websiteDomainPermissions })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <footer className="shrink-0 space-y-3 border-t border-[var(--color-border)] p-3">
            <div
              aria-live="polite"
              className="text-xs text-[var(--color-textSecondary)]"
            >
              {pending ? (
                <span role="status" className="flex items-center gap-2">
                  <LoaderCircle size={13} className="animate-spin" />
                  Saving settings…
                </span>
              ) : !available ? (
                <span role="status">
                  This connection is temporarily unavailable. Your draft is
                  kept.
                </span>
              ) : dirty ? (
                "Unsaved changes · reconnect to apply now."
              ) : (
                "Following saved settings. Changes apply when this tab reconnects."
              )}
            </div>
            {error && (
              <p role="alert" className="text-xs text-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="sor-btn sor-btn-secondary text-xs"
                disabled={disabled}
                onClick={() => void save(false)}
              >
                Save for next connection
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-primary text-xs"
                disabled={disabled}
                onClick={() => void save(true)}
              >
                Save and reconnect
              </button>
            </div>
          </footer>
        </div>
      </PopoverSurface>
    </div>
  );
}
