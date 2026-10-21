"use client";

import { useEffect, useRef, useState } from "react";
import { Cable, X } from "lucide-react";
import type { OriginConnectionHealth } from "../../utils/protocol/originConnectionHealth";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";

const colors = {
  connecting: "bg-primary",
  healthy: "bg-success",
  degraded: "bg-warning",
  disconnected: "bg-error",
  unknown: "bg-[var(--color-textSecondary)]",
};

export default function SessionConnectionHealthControl({
  health,
  scope,
}: {
  health: OriginConnectionHealth;
  scope: string;
}) {
  const { isActive } = useSessionRenderActivity();
  const [opened, setOpened] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = isActive && opened === scope;
  useEffect(() => {
    if (!isActive || opened !== scope) setOpened(null);
  }, [isActive, scope, opened]);
  const close = () => {
    if (panelRef.current?.contains(document.activeElement))
      anchorRef.current?.focus({ preventScroll: true });
    setOpened(null);
  };
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        aria-label={`Connection health: ${health.label}`}
        aria-expanded={open}
        data-tooltip={`Connection health: ${health.label}`}
        className="app-bar-button relative rounded p-2"
        onClick={() => {
          if (open) close();
          else if (isActive) setOpened(scope);
        }}
      >
        <Cable size={14} aria-hidden="true" />
        <span
          className={`absolute right-0 top-0 h-2 w-2 rounded-full ${colors[health.status]}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <PopoverSurface
          isOpen
          anchorRef={anchorRef}
          onClose={close}
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
                className="app-bar-button rounded p-1"
                aria-label="Close connection health"
                data-tooltip="Close connection health"
                onClick={close}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <p role="status" className="text-sm font-medium">
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
                            className={`h-2 w-2 shrink-0 rounded-full ${colors[hop.status]}`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 break-words font-medium">
                            {hop.label}
                          </span>
                          <span className="ml-auto shrink-0 capitalize">
                            {hop.stateLabel ?? hop.status}
                          </span>
                        </div>
                        <p className="mt-1">{hop.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        </PopoverSurface>
      )}
    </>
  );
}
