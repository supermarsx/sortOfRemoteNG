import { ListVideo, Play, RefreshCw, Square, Star } from "lucide-react";
import { useMemo, useState } from "react";
import {
  useSerialQuickActions,
  type SerialQuickActionItem,
} from "../../../hooks/serial/useSerialQuickActions";
import type { ConnectionSession } from "../../../types/connection/connection";
import { quickActionReferenceKey } from "../../../utils/connection/sessionQuickActions";

interface SerialScriptBarProps {
  session: ConnectionSession;
  connected: boolean;
  /** Sends text; `\n` is mapped to the connection's line ending. */
  send: (text: string) => Promise<void>;
}

const buttonClass =
  "inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-50";

/** Favorites strip plus a script/macro picker for serial sessions. */
export function SerialScriptBar({
  session,
  connected,
  send,
}: SerialScriptBarProps) {
  const actions = useSerialQuickActions({
    session,
    connected,
    sendInput: send,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return actions.items.filter(
      (item) =>
        !needle ||
        `${item.name} ${item.description} ${item.kind}`
          .toLowerCase()
          .includes(needle),
    );
  }, [actions.items, query]);

  if (!actions.enabled) return null;

  const renderRow = (item: SerialQuickActionItem) => {
    const favorite = actions.isFavorite(item);
    return (
      <li
        key={quickActionReferenceKey(item)}
        className="flex items-center gap-2 py-1"
      >
        <button
          type="button"
          className={buttonClass}
          aria-pressed={favorite}
          aria-label={
            favorite
              ? `Remove ${item.name} from favorites`
              : `Add ${item.name} to favorites`
          }
          onClick={() => actions.toggleFavorite(item)}
        >
          <Star
            size={12}
            aria-hidden
            className={favorite ? "fill-current" : undefined}
          />
        </button>
        <span className="min-w-0 flex-1 truncate" title={item.description}>
          {item.name}
          <span className="ml-1 text-[10px] text-[var(--color-textMuted)]">
            {item.kind}
          </span>
        </span>
        <button
          type="button"
          className={buttonClass}
          disabled={!actions.canRun}
          onClick={() => void actions.run(item)}
          aria-label={`Run ${item.name}`}
        >
          <Play size={12} aria-hidden /> Run
        </button>
      </li>
    );
  };

  return (
    <div
      className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs"
      data-testid="serial-script-bar"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={buttonClass}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          disabled={!connected}
        >
          <ListVideo size={12} aria-hidden /> Scripts
        </button>
        {actions.favorites.map((item) => (
          <button
            key={quickActionReferenceKey(item)}
            type="button"
            className={buttonClass}
            disabled={!actions.canRun || item.missing}
            title={item.description}
            onClick={() => void actions.run(item)}
            data-testid="serial-favorite"
          >
            <Star size={11} aria-hidden className="fill-current" />
            {item.name}
          </button>
        ))}
        {actions.running ? (
          <>
            <span role="status" data-testid="serial-script-progress">
              Sending {actions.progress?.sent ?? 0}/
              {actions.progress?.total ?? 0}
            </span>
            <button
              type="button"
              className={`${buttonClass} border-error/40 text-error`}
              onClick={actions.abort}
            >
              <Square size={11} aria-hidden /> Stop
            </button>
          </>
        ) : null}
      </div>

      {actions.pending ? (
        <div
          className="mt-2 rounded border border-warning/40 p-2"
          role="alertdialog"
          aria-label="Review serial script"
          data-testid="serial-script-review"
        >
          <p className="mb-1">
            Send {actions.pending.lineCount} step
            {actions.pending.lineCount === 1 ? "" : "s"} from{" "}
            <strong>{actions.pending.item.name}</strong> to this device? This
            exact text will be sent:
          </p>
          <pre className="max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono">
            {actions.pending.preview}
          </pre>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => void actions.approve()}
            >
              Send
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={actions.cancel}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {actions.error ? (
        <div className="mt-1 text-error" role="alert">
          {actions.error}
        </div>
      ) : null}

      {open ? (
        <div className="mt-2 rounded border border-[var(--color-border)] p-2">
          <div className="flex items-center gap-2">
            <input
              type="search"
              className="sor-form-input flex-1"
              placeholder="Search scripts and macros"
              aria-label="Search scripts and macros"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="flex items-center gap-1">
              Delay ms
              <input
                type="number"
                min={0}
                max={60000}
                className="sor-form-input w-20"
                aria-label="Delay between lines in milliseconds"
                value={actions.lineDelayMs}
                onChange={(event) =>
                  actions.setLineDelayMs(Number(event.target.value) || 0)
                }
              />
            </label>
            <button
              type="button"
              className={buttonClass}
              onClick={() => void actions.refresh()}
              aria-label="Reload library"
            >
              <RefreshCw size={12} aria-hidden />
            </button>
          </div>
          {actions.libraryError ? (
            <p className="mt-1 text-[var(--color-textMuted)]">
              {actions.libraryError}
            </p>
          ) : null}
          <ul className="mt-1 max-h-56 overflow-auto">
            {visible.length > 0 ? (
              visible.map(renderRow)
            ) : (
              <li className="py-1 text-[var(--color-textMuted)]">
                No scripts or macros found.
              </li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default SerialScriptBar;
