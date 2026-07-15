import { Cable } from "lucide-react";
import {
  normalizeRawSocketSettings,
  withRawSocketTransport,
  type RawSocketAddressFamily,
  type RawSocketTransport,
} from "../../../types/protocols/rawSocket";
import {
  RawSocketField,
  RawSocketSection,
  rawSocketInputClass,
  rawSocketSelectClass,
} from "./RawSocketSection";
import type { RawSocketSectionProps } from "./types";

interface ConnectionSectionProps extends RawSocketSectionProps {
  targetHost?: string;
  targetPort?: number;
}

export function ConnectionSection({
  settings,
  update,
  disabled,
  targetHost,
  targetPort,
}: ConnectionSectionProps) {
  const patchConnection = (
    patch: Partial<RawSocketSectionProps["settings"]["connection"]>,
  ) =>
    update(
      normalizeRawSocketSettings({
        ...settings,
        connection: { ...settings.connection, ...patch },
      }),
    );

  return (
    <RawSocketSection
      id="connection"
      title="Connection"
      description="Choose a normal application-payload TCP stream or UDP datagram socket."
      icon={Cable}
    >
      <div
        role="note"
        className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs leading-relaxed text-[var(--color-textSecondary)]"
      >
        Raw Socket is a netcat-style application payload client. It does not
        inject packets, craft IP/TCP/UDP headers, or request privileged
        operating-system raw sockets.
      </div>
      {(targetHost || targetPort) && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Target:{" "}
          <span className="font-mono text-[var(--color-textSecondary)]">
            {targetHost || "(host not set)"}:{targetPort || "(port not set)"}
          </span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RawSocketField id="raw-socket-transport" label="Transport">
          <select
            id="raw-socket-transport"
            value={settings.connection.transport}
            disabled={disabled}
            onChange={(event) =>
              update(
                withRawSocketTransport(
                  settings,
                  event.target.value as RawSocketTransport,
                ),
              )
            }
            className={rawSocketSelectClass}
          >
            <option value="tcp">TCP byte stream</option>
            <option value="udp">UDP datagrams</option>
          </select>
        </RawSocketField>
        <RawSocketField
          id="raw-socket-address-family"
          label="Address family"
          description="DNS results use the selected family preference with fallback where allowed."
        >
          <select
            id="raw-socket-address-family"
            value={settings.connection.addressFamily}
            disabled={disabled}
            onChange={(event) =>
              patchConnection({
                addressFamily: event.target.value as RawSocketAddressFamily,
              })
            }
            className={rawSocketSelectClass}
          >
            <option value="any">Automatic</option>
            <option value="prefer_ipv4">Prefer IPv4</option>
            <option value="prefer_ipv6">Prefer IPv6</option>
            <option value="ipv4_only">IPv4 only</option>
            <option value="ipv6_only">IPv6 only</option>
          </select>
        </RawSocketField>
        <RawSocketField
          id="raw-socket-local-bind-address"
          label="Local bind address"
          description="Optional source IPv4 or IPv6 address. Leave blank to use the operating-system route."
        >
          <input
            id="raw-socket-local-bind-address"
            value={settings.connection.localBindAddress}
            disabled={disabled}
            maxLength={64}
            placeholder="Automatic"
            spellCheck={false}
            onChange={(event) =>
              patchConnection({ localBindAddress: event.target.value })
            }
            className={rawSocketInputClass}
          />
        </RawSocketField>
        <RawSocketField
          id="raw-socket-local-bind-port"
          label="Local bind port"
          description="Use 0 for an automatically allocated ephemeral source port."
        >
          <input
            id="raw-socket-local-bind-port"
            type="number"
            min={0}
            max={65_535}
            value={settings.connection.localBindPort}
            disabled={disabled}
            onChange={(event) =>
              patchConnection({ localBindPort: Number(event.target.value) })
            }
            className={rawSocketInputClass}
          />
        </RawSocketField>
      </div>
    </RawSocketSection>
  );
}
