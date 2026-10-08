"use client";

import React, { useRef, useState } from "react";
import { Puzzle, X } from "lucide-react";
import type { NativeBrowserExtensionsController } from "../../../hooks/protocol/useNativeBrowserExtensions";
import { CHROMIUM_EXTENSION_UNAVAILABLE } from "../../../types/protocols/nativeBrowserExtensions";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { Select } from "../../ui/forms/Select";
import { CheckboxField } from "../../ui/forms/Checkbox";
import NativeBrowserAppearanceFields from "./NativeBrowserAppearanceFields";
import type { NativeAppearanceReceipt } from "../../../hooks/protocol/useNativeBrowserAppearance";

type AppearanceStatus = {
  receipt: NativeAppearanceReceipt | null;
  error: string | null;
} | null;

export function NativeBrowserExtensionPanel({
  controller,
  appearanceStatus,
}: {
  controller: NativeBrowserExtensionsController;
  appearanceStatus?: AppearanceStatus;
}) {
  const disabled = !controller.available || controller.busy;
  return (
    <div className="space-y-4 p-4">
      <p className="text-sm">
        These settings belong to this saved connection and its database. Changes
        apply when you reopen the website; they do not grant credential consent
        or run scripts.
      </p>
      {controller.reason && <p role="status">{controller.reason}</p>}
      {controller.error && (
        <p role="alert" className="text-error">
          {controller.error}
        </p>
      )}
      {controller.saved && (
        <p role="status">
          Saved to this connection. Reopen the website to apply.
        </p>
      )}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="font-semibold">App website extensions</legend>
        <label className="block">
          App login and website automation
          <Select
            label="App login and website automation"
            variant="form"
            disabled={disabled}
            className="block w-full"
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
        </label>
        {(
          [
            ["login", "Automatic form login"],
            ["scripts", "User scripts"],
            ["macros", "Interaction macros"],
          ] as const
        ).map(([kind, label]) => (
          <CheckboxField
            key={kind}
            label={label}
            variant="settings"
            checked={controller.requested[kind]}
            disabled={
              disabled || (kind === "login" && !controller.loginConfigurable)
            }
            onChange={(enabled) => void controller.save({ kind, enabled })}
          />
        ))}
      </fieldset>
      {!controller.loginConfigurable && (
        <p className="text-sm">
          This connection uses HTTP authentication. Configure its login method
          in the connection editor.
        </p>
      )}
      {!controller.effectiveEnabled && (
        <p className="text-sm">
          Saved login, script and macro selections are inactive while app
          extensions are off.
        </p>
      )}
      {controller.activeEnabled !== null && (
        <p className="text-sm">
          Current native attempt: app extensions{" "}
          {controller.activeEnabled ? "allowed, subject to consent" : "off"}.
        </p>
      )}
      <NativeBrowserAppearanceFields
        key={`${controller.scope}:${JSON.stringify(controller.appearance.configuration)}:${controller.appearance.enabled}`}
        controller={controller}
      />
      {appearanceStatus?.error && (
        <p role="status" className="text-sm text-warning">
          {appearanceStatus.error}
        </p>
      )}
      {appearanceStatus?.receipt && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          Current website appearance:{" "}
          {appearanceStatus.receipt.status === "off"
            ? "off"
            : appearanceStatus.receipt.status === "fallback"
              ? "simplified styles"
              : "applied"}
          .
          {appearanceStatus.receipt.followingAppTheme
            ? " Following app theme colors."
            : " Using saved website colors."}
        </p>
      )}
      <section aria-label="Chromium extensions">
        <h4 className="font-semibold">Chromium extensions</h4>
        <p className="text-sm">{CHROMIUM_EXTENSION_UNAVAILABLE}</p>
        <p className="text-xs mt-2">
          Extension install, enable, disable, update and removal are
          unsupported. Website traffic continues through this connection's
          private app proxy.
        </p>
      </section>
    </div>
  );
}

export default function NativeBrowserExtensionControls({
  controller,
  appearanceStatus,
}: {
  controller: NativeBrowserExtensionsController;
  appearanceStatus?: AppearanceStatus;
}) {
  const [openScope, setOpenScope] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const open = openScope === controller.scope;
  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        aria-label="Website extensions"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="sor-icon-btn-sm"
        onClick={() => setOpenScope(open ? null : controller.scope)}
      >
        <Puzzle size={16} />
      </button>
      <PopoverSurface
        isOpen={open}
        onClose={controller.busy ? undefined : () => setOpenScope(null)}
        anchorRef={anchorRef}
        align="end"
        offset={4}
        className="sor-popover-panel sor-popover-panel-strong z-[99999] w-[30rem] max-w-[calc(100vw-2rem)] max-h-[85dvh] overflow-y-auto"
      >
        <div role="dialog" aria-label="Native website extensions">
          <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
            <h3 className="font-semibold">Website extensions</h3>
            <button
              type="button"
              aria-label="Close extension settings"
              disabled={controller.busy}
              className="sor-icon-btn-sm"
              onClick={() => setOpenScope(null)}
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
