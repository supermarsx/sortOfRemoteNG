import { useId, useState } from "react";
import { ExternalLink, LocateFixed } from "lucide-react";
import type { VaultTextKey, VaultTx } from "./vaultText";

export interface VaultDetailItem {
  key: string;
  id: string;
  source: "vault" | "connection";
  name: string;
  typeLabels: string[];
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  storageLabels: string[];
  protocol: string | null;
  application: string | null;
  assignments: { connectionId: string; name: string; protocol: string }[];
}

type Tab = "general" | "usage" | "properties";
const TABS: [Tab, VaultTextKey][] = [
  ["general", "tabGeneral"],
  ["usage", "tabUsage"],
  ["properties", "tabProperties"],
];

function when(value: string | null, fallback: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toLocaleString();
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1 text-xs">
      <dt className="text-[var(--color-textSecondary)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Metadata only. Secret values are never rendered in this pane. */
export function VaultDetailPane({
  item,
  selectedCount,
  canNavigate,
  canOpen,
  onGo,
  onOpen,
  tx,
}: {
  item: VaultDetailItem | null;
  selectedCount: number;
  canNavigate: boolean;
  canOpen: boolean;
  onGo: (connectionId: string) => void;
  onOpen: (connectionId: string) => void;
  tx: VaultTx;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const base = useId();
  const chips = (values: string[]) =>
    values.length ? (
      <span className="flex flex-wrap gap-1">
        {values.map((value) => (
          <span
            key={value}
            className="rounded bg-[var(--color-surface)] px-1.5 py-0.5"
          >
            {value}
          </span>
        ))}
      </span>
    ) : (
      tx("none")
    );
  return (
    <aside
      aria-label={tx("detailsLabel")}
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border)]"
    >
      {!item ? (
        <p className="p-4 text-xs text-[var(--color-textSecondary)]">
          {selectedCount > 1
            ? tx("detailsMultiple", { count: selectedCount })
            : tx("detailsEmpty")}
        </p>
      ) : (
        <>
          <h3
            className="truncate border-b border-[var(--color-border)] px-3 py-2 text-sm font-semibold"
            data-tooltip={item.name}
          >
            {item.name}
          </h3>
          <div
            role="tablist"
            aria-label={tx("detailsLabel")}
            className="flex border-b border-[var(--color-border)] px-1"
          >
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${base}-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`${base}-panel`}
                tabIndex={tab === id ? 0 : -1}
                className={`px-3 py-1.5 text-xs ${tab === id ? "border-b-2 border-primary font-medium text-primary" : "text-[var(--color-textSecondary)]"}`}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  const at = TABS.findIndex(([value]) => value === tab);
                  const step =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (!step) return;
                  event.preventDefault();
                  const next = TABS[(at + step + TABS.length) % TABS.length][0];
                  setTab(next);
                  document.getElementById(`${base}-tab-${next}`)?.focus();
                }}
              >
                {tx(label)}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${base}-panel`}
            aria-labelledby={`${base}-tab-${tab}`}
            className="p-3"
          >
            {tab === "general" && (
              <dl>
                <Field label={tx("fieldName")}>{item.name}</Field>
                <Field label={tx("fieldSource")}>
                  {item.source === "vault"
                    ? tx("groupVault")
                    : tx("groupConnections")}
                </Field>
                <Field label={tx("fieldTypes")}>{chips(item.typeLabels)}</Field>
                <Field label={tx("fieldTags")}>{chips(item.tags)}</Field>
                <Field label={tx("fieldUpdated")}>
                  {when(item.updatedAt, tx("notReported"))}
                </Field>
                <Field label={tx("fieldCreated")}>
                  {when(item.createdAt, tx("notReported"))}
                </Field>
                <p className="mt-2 text-[11px] text-[var(--color-textMuted)]">
                  {tx("secretsHidden")}
                </p>
              </dl>
            )}
            {tab === "usage" &&
              (item.assignments.length ? (
                <ul className="space-y-1">
                  {item.assignments.map((row) => (
                    <li
                      key={row.connectionId}
                      className="flex items-center gap-1 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {row.name} · {row.protocol}
                      </span>
                      <button
                        type="button"
                        className="sor-icon-btn-sm"
                        aria-label={`${tx("goToConnection")}: ${row.name}`}
                        data-tooltip={tx("goToConnection")}
                        disabled={!canNavigate}
                        onClick={() => onGo(row.connectionId)}
                      >
                        <LocateFixed size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="sor-icon-btn-sm"
                        aria-label={`${tx("openConnection")}: ${row.name}`}
                        data-tooltip={tx("openConnection")}
                        disabled={!canOpen}
                        onClick={() => onOpen(row.connectionId)}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--color-textSecondary)]">
                  {tx("noAssignments")}
                </p>
              ))}
            {tab === "properties" && (
              <dl>
                <Field label={tx("fieldId")}>
                  <code className="text-[11px]">{item.id}</code>
                </Field>
                <Field label={tx("fieldStorage")}>
                  {item.storageLabels.join(" · ") || tx("notReported")}
                </Field>
                <Field label={tx("fieldProtocol")}>
                  {item.protocol ?? tx("notReported")}
                </Field>
                <Field label={tx("fieldApplication")}>
                  {item.application ?? tx("notReported")}
                </Field>
              </dl>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
