import { useState } from "react";
import type { InternalProxySettings } from "../../../types/settings/webBrowser";
import { Select } from "../../ui/forms";
import { Card, Toggle } from "../../ui/settings/SettingsPrimitives";

const ERRORS = [
  [
    "TLS hostname rejected",
    "tls-server-name-rejected",
    "The server rejected the TLS server name (SNI, alert 112). Check the DNS hostname, port and server virtual-host configuration.",
  ],
  [
    "TLS version mismatch",
    "tls-version-mismatch",
    "Client and device could not agree on an SSL/TLS version. Review the connection's upstream TLS profile.",
  ],
  [
    "No shared cipher",
    "tls-cipher-mismatch",
    "The device and selected TLS engine have no compatible cipher suite.",
  ],
  [
    "Signature or key exchange",
    "tls-signature-algorithm / tls-key-exchange",
    "The peers have no compatible signature algorithm or key exchange parameters.",
  ],
  [
    "Handshake refused",
    "tls-peer-handshake-failure",
    "The server sent alert 40 without a precise cause. Its logs may identify cipher, signature or client-certificate requirements.",
  ],
  [
    "TLS application protocol",
    "tls-alpn-mismatch",
    "The peers could not agree on the application protocol (ALPN).",
  ],
  [
    "Malformed TLS",
    "tls-invalid-handshake / tls-decryption-failed",
    "The server sent invalid handshake data or failed integrity checks. Check that the HTTPS port actually serves TLS.",
  ],
  [
    "Weak certificate",
    "certificate-weak-key",
    "The device uses obsolete key or signature cryptography. A per-connection weak-certificate option is available; trust review still applies.",
  ],
  [
    "Certificate refused",
    "certificate-denied / review-timeout",
    "Trust policy refused the certificate, or the certificate review was not completed in time.",
  ],
  [
    "Invalid certificate",
    "certificate-revoked / certificate-bad-signature / certificate-malformed",
    "The certificate is revoked, has an invalid signature, or cannot be decoded. Repair the server certificate.",
  ],
  [
    "Connection ended",
    "tls-connection-reset / tls-unexpected-eof",
    "The connection ended during TLS without a more precise cause. Check the destination service and route.",
  ],
  [
    "Route or DNS",
    "route-failed / route-timeout",
    "The route could not reach the destination. Check DNS, the proxy, VPN, jump host and service availability.",
  ],
  [
    "Request or response timeout",
    "request-timeout / response-timeout / tls-handshake-timeout",
    "The named stage exceeded its time budget. Review its timeout and service health.",
  ],
  [
    "Invalid HTTP response",
    "http-transport / response-framing",
    "The upstream HTTP exchange ended or supplied conflicting framing. Check the website's reverse proxy.",
  ],
  [
    "Relay capacity",
    "proxy-capacity",
    "The relay reached its concurrent client limit. Review the client and per-host connection limits.",
  ],
  [
    "Legacy engine unavailable",
    "tls-legacy-unavailable / tls-legacy-engine",
    "The selected legacy TLS helper is missing or rejected the handshake. Review runtime diagnostics and the device profile.",
  ],
  [
    "Website HTTP errors",
    "upstream-http-401 / 403 / 404 / 429 / 502 / 503 / 504",
    "These statuses came from the website: authentication, access, path, rate limit, gateway failure, unavailability or gateway timeout. The proxy preserves the status.",
  ],
] as const;

export default function InternalProxyErrorSettings({
  config,
  onChange,
  disabled,
}: {
  config: InternalProxySettings;
  onChange: (patch: Partial<InternalProxySettings>) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  return (
    <Card>
      <h3 className="text-sm font-medium">Error pages & diagnostics</h3>
      <fieldset disabled={disabled} className="space-y-4 min-w-0">
        <label
          data-setting-key="internalProxy.httpErrorConversion"
          className="block space-y-1 text-sm"
        >
          Convert website HTTP errors
          <Select
            label="Convert website HTTP errors"
            value={config.httpErrorConversion}
            onChange={(value) =>
              onChange({
                httpErrorConversion:
                  value as InternalProxySettings["httpErrorConversion"],
              })
            }
            options={[
              { value: "off", label: "Keep website error pages" },
              { value: "server-errors", label: "Use app pages for HTTP 5xx" },
              {
                value: "all-errors",
                label: "Use app pages for HTTP 4xx and 5xx",
              },
            ]}
          />
        </label>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Network and TLS failures always get an app error page. Converting
          website responses replaces their body, preserving the status,
          authentication challenges, cookies and retry guidance. Requests are
          never replayed.
        </p>
        <Toggle
          settingKey="internalProxy.includeErrorTrace"
          label="Include native traces in error reports"
          description="Controls the backtrace shown in details and Copy full report. Credentials and private request data stay excluded."
          checked={config.includeErrorTrace}
          onChange={(includeErrorTrace) => onChange({ includeErrorTrace })}
        />
        <Toggle
          settingKey="internalProxy.expandErrorDetails"
          label="Expand technical details by default"
          checked={config.expandErrorDetails}
          onChange={(expandErrorDetails) => onChange({ expandErrorDetails })}
        />
      </fieldset>
      <details className="mt-4 border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer text-sm">Common errors</summary>
        <input
          className="sor-form-input mt-3 w-full"
          aria-label="Find a proxy error"
          placeholder="Find a failure code or message…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <dl className="mt-3 space-y-3 max-h-80 overflow-y-auto">
          {ERRORS.filter((row) =>
            row.join(" ").toLowerCase().includes(query.toLowerCase()),
          ).map(([name, code, explanation]) => (
            <div key={code}>
              <dt className="text-sm font-medium">{name}</dt>
              <dd className="text-xs text-[var(--color-textSecondary)]">
                <code className="break-words">{code}</code>
                <p className="mt-1">{explanation}</p>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}
