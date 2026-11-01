"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  CheckCircle2,
  Info,
  LoaderCircle,
  Palette,
  Puzzle,
  WandSparkles,
  X,
} from "lucide-react";
import type { NativeBrowserExtensionsController } from "../../../hooks/protocol/useNativeBrowserExtensions";
import { CHROMIUM_EXTENSION_UNAVAILABLE } from "../../../types/protocols/nativeBrowserExtensions";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { Select } from "../../ui/forms/Select";
import { CheckboxField } from "../../ui/forms/Checkbox";
import NativeBrowserAppearanceFields from "./NativeBrowserAppearanceFields";
import type { NativeAppearanceReceipt } from "../../../hooks/protocol/useNativeBrowserAppearance";
import { reclaimShellFocus } from "../../../utils/window/reclaimShellFocus";

type AppearanceStatus = {
  receipt: NativeAppearanceReceipt | null;
  error: string | null;
} | null;
interface PanelProps {
  controller: NativeBrowserExtensionsController;
  appearanceStatus?: AppearanceStatus;
}
const tabs = [
  { id: "automation", label: "Automation", icon: WandSparkles },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "about", label: "About", icon: Info },
] as const;
type Tab = (typeof tabs)[number]["id"];

export function NativeBrowserExtensionPanel(props: PanelProps) {
  return <ExtensionPanel key={props.controller.owner} {...props} />;
}
function ExtensionPanel({ controller, appearanceStatus }: PanelProps) {
  const [active, setActive] = useState<Tab>("automation");
  const id = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const disabled = !controller.available || controller.busy;
  return (
    <div ref={setPortalContainer} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-3 text-xs text-[var(--color-textSecondary)]">
        Changes apply to this saved connection. The tab reconnects after saving.
        <div className="mt-2" aria-live="polite" aria-atomic="true">
          {controller.busy ? (
            <p role="status" className="flex items-center gap-2">
              <LoaderCircle
                size={14}
                className="animate-spin"
                aria-hidden="true"
              />
              Saving changes…
            </p>
          ) : controller.saved ? (
            <p role="status" className="flex items-center gap-2 text-success">
              <CheckCircle2 size={14} aria-hidden="true" />
              Saved. Reconnecting this tab to apply your changes…
            </p>
          ) : controller.reason ? (
            <p
              role="status"
              className="rounded border border-warning/30 bg-warning/10 p-2 text-warning"
            >
              {controller.reason}
            </p>
          ) : (
            <p>Settings are ready. Automation switches save immediately.</p>
          )}
          {controller.error && (
            <p role="alert" className="mt-2 text-error">
              {controller.error}
            </p>
          )}
        </div>
      </div>
      <div
        role="tablist"
        aria-label="Website extension settings"
        className="flex shrink-0 border-b border-[var(--color-border)] px-3"
      >
        {tabs.map(({ id: tab, label, icon: Icon }, index) => (
          <button
            key={tab}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${id}-${tab}-tab`}
            aria-controls={`${id}-${tab}-panel`}
            aria-selected={active === tab}
            tabIndex={active === tab ? 0 : -1}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-sm ${active === tab ? "border-primary text-primary" : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"}`}
            onClick={() => setActive(tab)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setActive(tabs[next].id);
              tabRefs.current[next]?.focus();
            }}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div
          role="tabpanel"
          id={`${id}-automation-panel`}
          aria-labelledby={`${id}-automation-tab`}
          hidden={active !== "automation"}
        >
          <div className="space-y-4">
            <section className="space-y-2" aria-label="Automation availability">
              <h4 className="text-sm font-semibold">
                App login and website automation
              </h4>
              <Select
                label="Automation for this connection"
                portalContainer={portalContainer}
                variant="form"
                disabled={disabled}
                className="w-full"
                value={
                  controller.requested.app === undefined
                    ? "inherit"
                    : String(controller.requested.app)
                }
                onChange={(value) =>
                  void controller.save({
                    kind: "app",
                    enabled: value === "inherit" ? undefined : value === "true",
                  })
                }
                options={[
                  {
                    value: "inherit",
                    label: `Use app default (${controller.globalEnabled ? "on" : "off"})`,
                  },
                  { value: "true", label: "On for this connection" },
                  { value: "false", label: "Off for this connection" },
                ]}
              />
              <p className="text-xs text-[var(--color-textMuted)]">
                Choose which app features this website can use. Saving a
                selection never runs a script or grants sign-in consent.
              </p>
            </section>
            <fieldset
              disabled={disabled}
              className="space-y-1 rounded-lg border border-[var(--color-border)] p-3"
            >
              <legend className="px-1 text-xs font-medium text-[var(--color-textSecondary)]">
                Features for this connection
              </legend>
              {(
                [
                  [
                    "login",
                    "Automatic form login",
                    "Fill the saved login form after the required approval.",
                  ],
                  [
                    "scripts",
                    "User scripts",
                    "Allow your saved website scripts, subject to their approvals.",
                  ],
                  [
                    "macros",
                    "Interaction macros",
                    "Allow saved click and typing sequences, subject to their approvals.",
                  ],
                ] as const
              ).map(([kind, label, description]) => (
                <CheckboxField
                  key={kind}
                  label={label}
                  aria-label={label}
                  description={description}
                  reverse
                  variant="settings"
                  wrapperClassName="rounded px-1 py-2"
                  checked={controller.requested[kind]}
                  disabled={
                    disabled ||
                    (kind === "login" && !controller.loginConfigurable)
                  }
                  onChange={(enabled) =>
                    void controller.save({ kind, enabled })
                  }
                />
              ))}
            </fieldset>
            {!controller.loginConfigurable && (
              <p className="rounded bg-[var(--color-surface)] p-3 text-xs text-[var(--color-textSecondary)]">
                This website uses HTTP authentication. Change its login method
                in the connection editor.
              </p>
            )}
            {!controller.effectiveEnabled && (
              <p className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                Automation is off. Your feature selections are kept, but stay
                inactive until you turn it on.
              </p>
            )}
            {controller.activeEnabled !== null && (
              <p className="text-xs text-[var(--color-textMuted)]">
                Current page: automation{" "}
                {controller.activeEnabled
                  ? "available, subject to approval"
                  : "off"}
                .
              </p>
            )}
          </div>
        </div>
        {/* Mounted while hidden: subtabs and reconnects must not discard a draft. */}
        <div
          role="tabpanel"
          id={`${id}-appearance-panel`}
          aria-labelledby={`${id}-appearance-tab`}
          hidden={active !== "appearance"}
        >
          <NativeBrowserAppearanceFields
            key={`${controller.owner}:${JSON.stringify(controller.appearance.configuration)}:${controller.appearance.enabled}`}
            controller={controller}
          />
          {appearanceStatus?.error && (
            <p role="status" className="mt-3 text-xs text-warning">
              {appearanceStatus.error}
            </p>
          )}
          {appearanceStatus?.receipt && (
            <p
              role="status"
              className="mt-3 text-xs text-[var(--color-textMuted)]"
            >
              Current page: appearance{" "}
              {appearanceStatus.receipt.status === "off"
                ? "off"
                : appearanceStatus.receipt.status === "fallback"
                  ? "using simplified styles"
                  : "applied"}
              .{" "}
              {appearanceStatus.receipt.followingAppTheme
                ? "Following app theme colors."
                : "Using saved website colors."}
            </p>
          )}
        </div>
        <div
          role="tabpanel"
          id={`${id}-about-panel`}
          aria-labelledby={`${id}-about-tab`}
          hidden={active !== "about"}
        >
          <div className="space-y-4 text-sm">
            <section className="space-y-2">
              <h4 className="font-semibold">Built-in website tools</h4>
              <p className="text-[var(--color-textSecondary)]">
                Manage app automation and website appearance here. Settings are
                saved with this connection in its owning database.
              </p>
              <p className="text-xs text-[var(--color-textMuted)]">
                Website traffic continues through this connection’s private app
                proxy. These settings do not change certificate trust or
                credential approvals.
              </p>
            </section>
            <section
              aria-label="Chromium extensions"
              className="space-y-2 rounded-lg border border-[var(--color-border)] p-3"
            >
              <h4 className="font-medium">Chrome / Chromium add-ons</h4>
              <p className="text-xs text-[var(--color-textSecondary)]">
                {CHROMIUM_EXTENSION_UNAVAILABLE}
              </p>
              <p className="text-xs text-[var(--color-textMuted)]">
                Installing CRX files or loading unpacked browser add-ons is not
                available.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
function ExtensionPopover({ controller, appearanceStatus }: PanelProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(true);
  useEffect(() => {
    if (!open) return;
    reclaimShellFocus();
    const trigger = anchorRef.current?.querySelector("button");
    // Wait for PopoverSurface to measure and reveal before moving focus.
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
  }, [open]);
  return (
    <div
      ref={anchorRef}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          !controller.busy &&
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
        aria-label="Website extensions"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={controller.busy}
        className="sor-icon-btn-sm"
        onClick={() => {
          restoreFocus.current = true;
          setOpen(!open);
        }}
      >
        <Puzzle size={16} />
      </button>
      <PopoverSurface
        isOpen={open}
        onClose={controller.busy ? undefined : () => setOpen(false)}
        anchorRef={anchorRef}
        align="end"
        offset={4}
        className="sor-popover-panel sor-popover-panel-strong z-[99999] flex w-[30rem] max-w-[calc(100vw-1rem)] max-h-[85dvh] flex-col overflow-hidden"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="false"
          aria-label="Website extensions"
          className="flex min-h-0 max-h-[85dvh] flex-col"
        >
          <div className="flex shrink-0 items-center justify-between p-4 pb-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <Puzzle size={17} className="text-primary" aria-hidden="true" />
              Website extensions
            </h3>
            <button
              type="button"
              aria-label="Close extension settings"
              disabled={controller.busy}
              className="sor-icon-btn-sm"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <NativeBrowserExtensionPanel
            controller={controller}
            appearanceStatus={appearanceStatus}
          />
        </div>
      </PopoverSurface>
    </div>
  );
}
export default function NativeBrowserExtensionControls({
  visible = true,
  ...props
}: PanelProps & { visible?: boolean }) {
  // Portals escape inactive-tab CSS. Hard visibility/owner changes unmount open
  // intent. A same-owner reconnect alone keeps the popup and its drafts.
  return visible ? (
    <ExtensionPopover key={props.controller.owner} {...props} />
  ) : null;
}
