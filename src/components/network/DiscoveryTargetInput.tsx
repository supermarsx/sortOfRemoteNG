import { useId, useRef, useState } from "react";
import { ChevronDown, History, Network, RefreshCw, Trash2 } from "lucide-react";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";

type Manager = ReturnType<typeof useNetworkDiscovery>;

export function DiscoveryTargetInput({ mgr }: { mgr: Manager }) {
  const { targets } = mgr;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const showing = open && !mgr.isScanning;
  const [active, setActive] = useState(-1);
  const [caret, setCaret] = useState(mgr.config.ipRange.length);
  const id = useId();
  const value = mgr.config.ipRange;
  const start = value.slice(0, caret).search(/[^,;\s]*$/);
  const tail = value.slice(caret).search(/[,;\s]/);
  const end = tail < 0 ? value.length : caret + tail;
  const query = value.slice(start, end).toLowerCase();
  const options = [
    ...targets.history.map((target) => ({
      target,
      detail: "Recent target",
      kind: "history" as const,
    })),
    ...targets.interfaces.map((iface) => ({
      target: iface.target,
      detail: `${iface.interfaceName} · ${iface.address}${iface.isSlice ? ` · slice of ${iface.cidr}` : ""}`,
      kind: "interface" as const,
    })),
  ].filter((option) =>
    `${option.target} ${option.detail}`.toLowerCase().includes(query),
  );

  const show = () => {
    setOpen(true);
    if (targets.interfaceStatus === "idle") void targets.refreshInterfaces();
  };
  const select = (target: string) => {
    if (mgr.isScanning) return;
    const next = `${value.slice(0, start)}${target}${value.slice(end)}`;
    mgr.setConfig((current) => ({ ...current, ipRange: next }));
    targets.remember(target);
    setOpen(false);
    setActive(-1);
    setCaret(start + target.length);
    inputRef.current?.focus();
    requestAnimationFrame(() =>
      inputRef.current?.setSelectionRange(
        start + target.length,
        start + target.length,
      ),
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-sm font-medium" htmlFor={`${id}-input`}>
          {mgr.t("networkDiscovery.ipRange")}
        </label>
        {targets.history.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            onClick={targets.clearHistory}
            title="Clear recent IP/CIDR targets"
          >
            <Trash2 size={12} aria-hidden="true" /> Clear recent
          </button>
        )}
      </div>
      <div
        className="relative"
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setOpen(false);
            setActive(-1);
            targets.remember(value);
          }
        }}
      >
        <textarea
          ref={inputRef}
          id={`${id}-input`}
          role="combobox"
          aria-label={mgr.t("networkDiscovery.ipRange")}
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={showing ? `${id}-options` : undefined}
          aria-activedescendant={
            showing && active >= 0 && active < options.length
              ? `${id}-option-${active}`
              : undefined
          }
          aria-describedby={`${id}-help`}
          autoComplete="off"
          spellCheck={false}
          rows={2}
          className="sor-form-input w-full resize-y font-mono text-xs"
          style={{ paddingRight: "2.25rem" }}
          placeholder={"192.168.1.0/24, 10.0.0.5\n2001:db8::/120"}
          value={value}
          onChange={(event) => {
            mgr.setConfig((current) => ({
              ...current,
              ipRange: event.target.value,
            }));
            setCaret(event.target.selectionStart);
            setActive(-1);
            show();
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onFocus={show}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              show();
              setActive((index) =>
                options.length
                  ? (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                    options.length
                  : -1,
              );
            } else if (
              event.key === "Enter" &&
              open &&
              active >= 0 &&
              options[active]
            ) {
              event.preventDefault();
              select(options[active].target);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        <button
          type="button"
          className="absolute right-2 top-2 rounded p-1 hover:bg-[var(--color-surfaceHover)]"
          aria-label="Show recent targets and interface subnets"
          aria-expanded={showing}
          onClick={() => {
            if (open) setOpen(false);
            else {
              inputRef.current?.focus();
              show();
            }
          }}
        >
          <ChevronDown size={15} />
        </button>
        {showing && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs">
              <span>Recent targets &amp; interface subnets</span>
              {mgr.native && (
                <button
                  type="button"
                  disabled={targets.interfaceStatus === "loading"}
                  className="rounded p-1 hover:bg-[var(--color-surfaceHover)] disabled:opacity-50"
                  aria-label="Refresh interface subnets"
                  onClick={() => void targets.refreshInterfaces()}
                >
                  <RefreshCw
                    size={13}
                    className={
                      targets.interfaceStatus === "loading"
                        ? "animate-spin"
                        : ""
                    }
                  />
                </button>
              )}
            </div>
            <ul
              id={`${id}-options`}
              role="listbox"
              aria-label="IP and CIDR suggestions"
              className="max-h-60 overflow-y-auto p-1"
            >
              {options.map((option, index) => {
                const Icon = option.kind === "history" ? History : Network;
                return (
                  <li
                    key={`${option.kind}-${option.target}-${option.detail}`}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={active === index}
                    className={`flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs hover:bg-[var(--color-surfaceHover)] ${active === index ? "bg-primary/15" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActive(index)}
                    onClick={() => select(option.target)}
                  >
                    <Icon
                      size={14}
                      className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block font-mono">{option.target}</span>
                      <span className="block break-words text-[var(--color-textSecondary)]">
                        {option.detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div
              className="border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-textSecondary)]"
              role="status"
            >
              {targets.interfaceStatus === "loading"
                ? "Detecting local interfaces…"
                : targets.interfaceStatus === "error"
                  ? "Could not detect interfaces. Refresh to retry; manual targets still work."
                  : options.length === 0
                    ? "No matching suggestions. Enter an IP address or CIDR."
                    : "Interface subnets are locally attached; host reachability is checked only during a scan."}
              {!mgr.native &&
                " Interface detection is available in the native scanner tab."}
            </div>
          </div>
        )}
      </div>
      <p
        id={`${id}-help`}
        className="text-xs text-[var(--color-textSecondary)]"
      >
        {mgr.native
          ? "Multiple IPs / CIDRs: separate with commas or new lines. Up to 10,000 unique hosts."
          : "One CIDR range (/24 to /30 for IPv4). Multiple targets and extended ranges are available in the native scanner tab."}{" "}
        Only scans when you press Start Scan.
      </p>
    </section>
  );
}
