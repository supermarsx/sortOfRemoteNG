"use client";

import React, { useMemo, useState } from "react";
import { Eraser, PlugZap, Send, StopCircle } from "lucide-react";
import type { ConnectionSession } from "../../types/connection/connection";
import type { RawSocketPayloadEncoding } from "../../types/protocols/rawSocket";
import {
  decodeRawSocketPayload,
  encodeRawSocketPayload,
} from "../../utils/protocols/rawSocket/codecs";
import { useRawSocketSession } from "../../hooks/protocol/useRawSocketSession";

const visibleText = (value: string): string =>
  [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      if (character === "\n" || character === "\r" || character === "\t") {
        return character;
      }
      return code < 0x20 || code === 0x7f
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : character;
    })
    .join("");

const formatPayload = (
  data: Uint8Array,
  encoding: RawSocketPayloadEncoding,
): string => {
  const decoded = decodeRawSocketPayload(data, encoding);
  return encoding === "text" ? visibleText(decoded) : decoded;
};

const formatTimestamp = (timestampMs: number): string =>
  new Date(timestampMs).toLocaleTimeString();

export const RawSocketClient: React.FC<{ session: ConnectionSession }> = ({
  session,
}) => {
  const model = useRawSocketSession(session);
  const [composer, setComposer] = useState("");
  const [inputEncoding, setInputEncoding] = useState<RawSocketPayloadEncoding>(
    model.settings.data.inputEncoding,
  );
  const [displayEncoding, setDisplayEncoding] =
    useState<RawSocketPayloadEncoding>(model.settings.data.displayEncoding);
  const [actionError, setActionError] = useState<string | null>(null);
  const isWritable = model.status === "connected";
  const isTcp = model.settings.connection.transport === "tcp";

  const transcriptRows = useMemo(
    () =>
      model.transcript.entries.map((entry) => ({
        ...entry,
        display: formatPayload(entry.data, displayEncoding),
      })),
    [displayEncoding, model.transcript.entries],
  );

  const sendPayload = async () => {
    try {
      setActionError(null);
      const bytes = encodeRawSocketPayload(composer, inputEncoding, {
        lineEnding: model.settings.data.lineEnding,
        maxBytes: model.settings.advanced.maxSendBytes,
      });
      await model.send(bytes);
      setComposer("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const halfClose = async () => {
    try {
      setActionError(null);
      await model.shutdownWrite();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={`Raw Socket session to ${session.hostname}`}
      data-testid="raw-socket-client"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <span
          className="rounded-full border border-[var(--color-border)] px-2 py-1 font-medium uppercase"
          role="status"
          aria-live="polite"
        >
          {model.status.replace("_", " ")}
        </span>
        <span>{model.settings.connection.transport.toUpperCase()}</span>
        {model.localAddress && model.remoteAddress ? (
          <span className="truncate text-[var(--color-textMuted)]">
            {model.localAddress} → {model.remoteAddress}
          </span>
        ) : null}
        <span className="ml-auto text-[var(--color-textMuted)]">
          {model.stats
            ? `${model.stats.bytesReceived} B received · ${model.stats.bytesSent} B sent`
            : "Waiting for exact transport statistics"}
        </span>
      </header>

      {(model.error || actionError) && (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {actionError || model.error}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <label className="text-xs" htmlFor={`raw-display-${session.id}`}>
          Display
        </label>
        <select
          id={`raw-display-${session.id}`}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
          value={displayEncoding}
          onChange={(event) =>
            setDisplayEncoding(event.target.value as RawSocketPayloadEncoding)
          }
        >
          <option value="text">Text</option>
          <option value="hex">Hex</option>
          <option value="base64">Base64</option>
        </select>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--color-surfaceHover)]"
          onClick={model.clearTranscript}
        >
          <Eraser size={13} aria-hidden /> Clear transcript
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs"
        role="log"
        aria-label="Raw Socket transcript"
        aria-live="polite"
      >
        {transcriptRows.length === 0 ? (
          <p className="font-sans text-[var(--color-textMuted)]">
            No application payload chunks received or sent yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {transcriptRows.map((entry) => (
              <li
                key={entry.id}
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
                data-direction={entry.direction}
                data-sequence={entry.sequence}
              >
                <div className="mb-1 flex flex-wrap gap-2 text-[10px] uppercase text-[var(--color-textMuted)]">
                  <span>#{entry.sequence}</span>
                  <span>{entry.direction}</span>
                  <span>
                    {entry.transport === "udp" ? "datagram" : "TCP chunk"}
                  </span>
                  <span>{entry.data.length} B</span>
                  <span>{formatTimestamp(entry.timestampMs)}</span>
                </div>
                <pre className="whitespace-pre-wrap break-all">
                  {entry.display}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <label className="text-xs" htmlFor={`raw-input-mode-${session.id}`}>
            Composer format
          </label>
          <select
            id={`raw-input-mode-${session.id}`}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs"
            value={inputEncoding}
            onChange={(event) =>
              setInputEncoding(event.target.value as RawSocketPayloadEncoding)
            }
          >
            <option value="text">Text</option>
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
          </select>
        </div>
        <label className="sr-only" htmlFor={`raw-composer-${session.id}`}>
          Raw Socket payload
        </label>
        <textarea
          id={`raw-composer-${session.id}`}
          className="min-h-20 w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 font-mono text-xs"
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          placeholder={`Enter ${inputEncoding} payload`}
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            onClick={() => void sendPayload()}
            disabled={!isWritable}
          >
            <Send size={14} aria-hidden /> Send payload
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            onClick={() => void halfClose()}
            disabled={!isTcp || !isWritable}
            title={isTcp ? "Close the TCP write half" : "UDP has no write half"}
          >
            <PlugZap size={14} aria-hidden /> Half-close write
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-error/40 px-3 py-1.5 text-xs text-error disabled:opacity-50"
            onClick={() => void model.disconnect()}
            disabled={model.status === "disconnected"}
          >
            <StopCircle size={14} aria-hidden /> Disconnect
          </button>
        </div>
      </footer>
    </section>
  );
};

export default RawSocketClient;
