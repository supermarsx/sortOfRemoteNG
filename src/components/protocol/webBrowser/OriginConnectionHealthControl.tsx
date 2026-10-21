"use client";

import { Cable, X } from "lucide-react";
import type { OriginConnectionHealth } from "../../../utils/protocol/originConnectionHealth";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { OriginToolbarPopover } from "./OriginCredentialControls";

const statusColors = {
  connecting: "bg-primary",
  healthy: "bg-success",
  degraded: "bg-warning",
  disconnected: "bg-error",
  unknown: "bg-[var(--color-textSecondary)]",
};

export default function OriginConnectionHealthControl({
  health,
  eligible,
  scope,
  assertOwner,
  onOverlayChange,
}: {
  health: OriginConnectionHealth;
  eligible: boolean;
  scope: string;
  assertOwner: () => void;
  onOverlayChange: (open: boolean) => void;
}) {
  if (!health.visible) return null;
  return (
    <OriginToolbarPopover
      label={`Connection health: ${health.label}`}
      icon={
        <>
          <Cable size={16} aria-hidden="true" />
          <span
            aria-hidden="true"
            className={`absolute right-0 top-0 h-2 w-2 rounded-full ${statusColors[health.status]}`}
          />
        </>
      }
      eligible={eligible}
      canOpen={eligible}
      scope={scope}
      assertOwner={assertOwner}
      onOverlayChange={onOverlayChange}
    >
      {({ anchorRef, panelRef, onClose }) => (
        <PopoverSurface
          isOpen
          anchorRef={anchorRef}
          onClose={onClose}
          className="w-[min(25rem,calc(100vw-1rem))]"
        >
          <section
            ref={panelRef}
            aria-label="Connection health details"
            className="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-[var(--color-text)] shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="font-medium">Connection health</h2>
              <button
                type="button"
                aria-label="Close connection health"
                data-tooltip="Close connection health"
                onClick={onClose}
                className="sor-btn sor-icon-btn-sm"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm font-medium" role="status">
              {health.label}
            </p>
            <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
              {health.summary}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {health.details.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-[var(--color-textSecondary)]">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {[
              { label: "Connection route", hops: health.hops },
              {
                label: "Owned VPN prerequisites",
                hops: health.prerequisites ?? [],
              },
            ]
              .filter((section) => section.hops.length > 0)
              .map((section) => (
                <div key={section.label} className="mt-4">
                  <h3 className="mb-2 text-sm font-medium">{section.label}</h3>
                  <ul className="space-y-2">
                    {section.hops.map((hop) => (
                      <li
                        key={hop.key}
                        className="rounded border border-[var(--color-border)] p-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 shrink-0 rounded-full ${statusColors[hop.status]}`}
                          />
                          <span className="min-w-0 break-words font-medium">
                            {hop.label}
                          </span>
                          <span className="ml-auto shrink-0 capitalize text-[var(--color-textSecondary)]">
                            {hop.stateLabel ?? hop.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[var(--color-textSecondary)]">
                          {hop.kind}
                        </p>
                        <p className="mt-1 break-words">{hop.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        </PopoverSurface>
      )}
    </OriginToolbarPopover>
  );
}
