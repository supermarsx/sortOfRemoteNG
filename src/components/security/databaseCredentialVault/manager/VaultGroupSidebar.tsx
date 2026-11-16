import { Folder, FolderOpen, KeyRound, Layers, Unplug } from "lucide-react";
import type { VaultGroupCounts } from "../../../../utils/security/vaultManager/vaultQuickFilters";
import type { VaultTx } from "./vaultText";

export type VaultGroupId = "all" | "vault" | "connections" | { tag: string };

function GroupButton({
  active,
  icon,
  label,
  count,
  onClick,
  depth = 0,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  depth?: number;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--color-surfaceHover)] ${active ? "bg-[color-mix(in_srgb,var(--color-primary)_16%,transparent)] font-medium text-primary" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onClick}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate" data-tooltip={label}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-[var(--color-textMuted)]">
        {count}
      </span>
    </button>
  );
}

/** Groups are the real, metadata-level ways entries are organised: where
 * they live and the category tags the user assigned. */
export function VaultGroupSidebar({
  counts,
  active,
  onSelect,
  tx,
}: {
  counts: VaultGroupCounts;
  active: VaultGroupId;
  onSelect: (group: VaultGroupId) => void;
  tx: VaultTx;
}) {
  return (
    <nav
      aria-label={tx("groupsLabel")}
      className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--color-border)] p-2"
    >
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
        {tx("groupsTitle")}
      </h3>
      <GroupButton
        active={active === "all"}
        icon={<Layers size={14} />}
        label={tx("groupAll")}
        count={counts.all}
        onClick={() => onSelect("all")}
      />
      <GroupButton
        active={active === "vault"}
        icon={<KeyRound size={14} />}
        label={tx("groupVault")}
        count={counts.vault}
        depth={1}
        onClick={() => onSelect("vault")}
      />
      <GroupButton
        active={active === "connections"}
        icon={<Unplug size={14} />}
        label={tx("groupConnections")}
        count={counts.connections}
        depth={1}
        onClick={() => onSelect("connections")}
      />
      <h3 className="mt-2 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-textMuted)]">
        {tx("groupTags")}
      </h3>
      {counts.tags.length === 0 && (
        <p className="px-2 text-[11px] text-[var(--color-textMuted)]">
          {tx("groupNoTags")}
        </p>
      )}
      {counts.tags.map(({ tag, count }) => {
        const isActive = typeof active !== "string" && active.tag === tag;
        return (
          <GroupButton
            key={tag}
            active={isActive}
            icon={isActive ? <FolderOpen size={14} /> : <Folder size={14} />}
            label={tag}
            count={count}
            depth={1}
            onClick={() => onSelect({ tag })}
          />
        );
      })}
    </nav>
  );
}
