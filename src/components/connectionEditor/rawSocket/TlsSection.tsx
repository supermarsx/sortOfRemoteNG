import { ShieldCheck } from "lucide-react";
import {
  getRawSocketTlsCapability,
  normalizeRawSocketSettings,
  type RawSocketTlsMode,
  type RawSocketTrustPolicy,
} from "../../../types/protocols/rawSocket";
import {
  RawSocketField,
  RawSocketSection,
  rawSocketInputClass,
  rawSocketSelectClass,
} from "./RawSocketSection";
import type { RawSocketSectionProps } from "./types";

export function TlsSection({
  settings,
  update,
  disabled,
}: RawSocketSectionProps) {
  const patchTls = (patch: Partial<RawSocketSectionProps["settings"]["tls"]>) =>
    update(
      normalizeRawSocketSettings({
        ...settings,
        tls: { ...settings.tls, ...patch },
      }),
    );
  const capability = getRawSocketTlsCapability(
    settings.connection.transport,
    settings.tls.mode,
  );
  const udp = settings.connection.transport === "udp";

  return (
    <RawSocketSection
      id="tls"
      title="TLS"
      description="TLS modes are explicit and never silently downgraded to a plain socket."
      icon={ShieldCheck}
    >
      <RawSocketField id="raw-socket-tls-mode" label="TLS mode">
        <select
          id="raw-socket-tls-mode"
          value={settings.tls.mode}
          disabled={disabled || udp}
          onChange={(event) =>
            patchTls({ mode: event.target.value as RawSocketTlsMode })
          }
          className={rawSocketSelectClass}
        >
          <option value="disabled">Disabled</option>
          <option value="direct">Direct TLS from connect</option>
          <option value="starttls_manual">Manual STARTTLS upgrade</option>
        </select>
      </RawSocketField>

      <div
        role="status"
        className={`rounded-md border p-3 text-xs leading-relaxed ${
          capability.runtimeSupported
            ? "border-primary/30 bg-primary/10 text-[var(--color-textSecondary)]"
            : "border-warning/40 bg-warning/10 text-warning"
        }`}
      >
        {capability.message}
      </div>

      {udp && (
        <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
          DTLS is not supported. UDP settings are normalized back to TLS
          disabled, and no TCP TLS mode is substituted.
        </p>
      )}

      {!udp && settings.tls.mode !== "disabled" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RawSocketField
            id="raw-socket-tls-server-name"
            label="TLS server name"
            description="Optional SNI and certificate hostname override."
          >
            <input
              id="raw-socket-tls-server-name"
              value={settings.tls.serverName}
              disabled={disabled}
              maxLength={253}
              spellCheck={false}
              onChange={(event) => patchTls({ serverName: event.target.value })}
              className={rawSocketInputClass}
            />
          </RawSocketField>
          <RawSocketField
            id="raw-socket-trust-policy"
            label="Certificate trust policy"
          >
            <select
              id="raw-socket-trust-policy"
              value={settings.tls.trustPolicy}
              disabled={disabled}
              onChange={(event) =>
                patchTls({
                  trustPolicy: event.target.value as RawSocketTrustPolicy,
                })
              }
              className={rawSocketSelectClass}
            >
              <option value="system">System trust store</option>
              <option value="tofu">Trust on first use</option>
              <option value="always_trust">Always trust (unsafe)</option>
            </select>
          </RawSocketField>
        </div>
      )}
    </RawSocketSection>
  );
}
