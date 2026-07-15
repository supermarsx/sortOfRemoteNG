import { Settings2 } from "lucide-react";
import { normalizeRawSocketSettings } from "../../../types/protocols/rawSocket";
import {
  RawSocketField,
  RawSocketSection,
  rawSocketInputClass,
} from "./RawSocketSection";
import type { RawSocketSectionProps } from "./types";

export function AdvancedSection({
  settings,
  update,
  disabled,
}: RawSocketSectionProps) {
  const patchAdvanced = (
    patch: Partial<RawSocketSectionProps["settings"]["advanced"]>,
  ) =>
    update(
      normalizeRawSocketSettings({
        ...settings,
        advanced: { ...settings.advanced, ...patch },
      }),
    );
  const advanced = settings.advanced;
  const tcp = settings.connection.transport === "tcp";

  const numberField = (
    id: string,
    label: string,
    value: number,
    key: keyof typeof advanced,
    min: number,
    max: number,
    description?: string,
  ) => (
    <RawSocketField id={id} label={label} description={description}>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          patchAdvanced({ [key]: Number(event.target.value) })
        }
        className={rawSocketInputClass}
      />
    </RawSocketField>
  );

  return (
    <RawSocketSection
      id="advanced"
      title="Advanced"
      description="Bounded socket, queue, replay, and payload controls protect the application from untrusted peers."
      icon={Settings2}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {numberField(
          "raw-socket-connect-timeout",
          "Connect timeout (ms)",
          advanced.connectTimeoutMs,
          "connectTimeoutMs",
          1,
          86_400_000,
        )}
        {numberField(
          "raw-socket-write-timeout",
          "Write timeout (ms)",
          advanced.writeTimeoutMs,
          "writeTimeoutMs",
          1,
          86_400_000,
        )}
        {numberField(
          "raw-socket-idle-timeout",
          "Idle timeout (ms)",
          advanced.idleTimeoutMs,
          "idleTimeoutMs",
          1,
          86_400_000,
        )}
      </div>

      {tcp ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-textSecondary)]">
              <input
                id="raw-socket-tcp-no-delay"
                type="checkbox"
                checked={advanced.tcpNoDelay}
                disabled={disabled}
                onChange={(event) =>
                  patchAdvanced({ tcpNoDelay: event.target.checked })
                }
                className="sor-form-checkbox"
              />
              TCP no-delay (disable Nagle buffering)
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={advanced.tcpKeepaliveMs !== null}
                disabled={disabled}
                onChange={(event) =>
                  patchAdvanced({
                    tcpKeepaliveMs: event.target.checked ? 60_000 : null,
                  })
                }
                className="sor-form-checkbox"
              />
              Enable TCP keepalive
            </label>
          </div>
          {advanced.tcpKeepaliveMs !== null &&
            numberField(
              "raw-socket-tcp-keepalive",
              "TCP keepalive interval (ms)",
              advanced.tcpKeepaliveMs,
              "tcpKeepaliveMs",
              1,
              86_400_000,
            )}
        </div>
      ) : (
        <div
          role="status"
          className="rounded-md border border-[var(--color-border)] p-3 text-xs text-[var(--color-textMuted)]"
        >
          TCP no-delay, keepalive, stream framing, and write-half close do not
          apply to UDP datagrams.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {numberField(
          "raw-socket-command-queue",
          "Command queue entries",
          advanced.commandQueueCapacity,
          "commandQueueCapacity",
          1,
          256,
        )}
        {numberField(
          "raw-socket-queue-wait",
          "Queue wait timeout (ms)",
          advanced.queueWaitTimeoutMs,
          "queueWaitTimeoutMs",
          1,
          60_000,
        )}
        {numberField(
          "raw-socket-replay-frames",
          "Replay frames",
          advanced.replayFrames,
          "replayFrames",
          0,
          4_096,
        )}
        {numberField(
          "raw-socket-replay-bytes",
          "Replay bytes",
          advanced.replayBytes,
          "replayBytes",
          0,
          8_388_608,
        )}
        {numberField(
          "raw-socket-read-chunk",
          "TCP read chunk bytes",
          advanced.readChunkBytes,
          "readChunkBytes",
          1,
          65_536,
          tcp
            ? "TCP receive buffer chunk. UDP always reserves the full 65,507-byte datagram maximum."
            : "Ignored for UDP; complete datagrams are received without truncation.",
        )}
        {numberField(
          "raw-socket-max-send",
          settings.connection.transport === "udp"
            ? "Maximum datagram bytes"
            : "Maximum send bytes",
          advanced.maxSendBytes,
          "maxSendBytes",
          1,
          settings.connection.transport === "udp" ? 65_507 : 1_048_576,
        )}
      </div>
    </RawSocketSection>
  );
}
