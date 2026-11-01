"use client";

import { FileKey2, RotateCw, X } from "lucide-react";
import type { OriginBrowserSnapshot } from "../../../types/protocols/originBrowser";
import {
  useOriginBrowserSecurity,
  websiteSecurityOrigin,
  type SecurityTransport,
} from "../../../hooks/protocol/useOriginBrowserSecurity";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import { OriginToolbarPopover } from "./OriginCredentialControls";

export interface OriginBrowserSecurityControlProps {
  snapshot: OriginBrowserSnapshot | null;
  eligible: boolean;
  scope: string;
  assertOwner: () => void;
  onOverlayChange: (open: boolean) => void;
  onOpenTrustCenter: () => void;
  transport?: SecurityTransport;
  viewId?: string | null;
}

/** Always-neutral trigger: HTTPS alone is not evidence of certificate trust. */
export default function OriginBrowserSecurityControl(
  props: OriginBrowserSecurityControlProps,
) {
  const origin = websiteSecurityOrigin(props.snapshot);
  const scope = JSON.stringify([
    props.scope,
    props.snapshot?.identity,
    origin,
    props.viewId,
  ]);
  return (
    <OriginToolbarPopover
      label="Security information"
      icon={<FileKey2 size={16} aria-hidden="true" />}
      eligible={props.eligible}
      canOpen={!!origin}
      scope={scope}
      assertOwner={props.assertOwner}
      onOverlayChange={props.onOverlayChange}
    >
      {({ anchorRef, panelRef, onClose }) => (
        <PopoverSurface
          isOpen
          anchorRef={anchorRef}
          onClose={onClose}
          className="sor-popover-panel sor-popover-panel-strong w-[min(27rem,calc(100vw-1rem))]"
        >
          <section
            ref={panelRef}
            aria-label="Website security information"
            className="max-h-[min(42rem,calc(100dvh-1rem))] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-[var(--color-text)] shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-medium">
                <FileKey2 size={18} aria-hidden="true" />
                Security information
              </h2>
              <button
                type="button"
                aria-label="Close security information"
                data-tooltip="Close security information"
                className="sor-btn sor-icon-btn-sm"
                onClick={onClose}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <SecurityDetails
              snapshot={props.snapshot}
              transport={props.transport}
              viewId={props.viewId}
            />
            <button
              type="button"
              className="sor-btn-secondary mt-4 w-full text-sm"
              onClick={() => {
                onClose();
                props.onOpenTrustCenter();
              }}
            >
              Open Trust Center
            </button>
          </section>
        </PopoverSurface>
      )}
    </OriginToolbarPopover>
  );
}

function SecurityDetails({
  snapshot,
  transport,
  viewId,
}: Pick<
  OriginBrowserSecurityControlProps,
  "snapshot" | "transport" | "viewId"
>) {
  const security = useOriginBrowserSecurity(snapshot, transport, viewId);
  const observation = security.observation;
  const plain = security.origin?.startsWith("http://");
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Current website origin
        </p>
        <p className="break-all font-mono select-text">
          {security.origin ?? "Unknown"}
        </p>
      </div>
      <p
        role="status"
        className={plain ? "text-warning" : "text-[var(--color-textSecondary)]"}
      >
        {plain
          ? "Not encrypted (HTTP)"
          : security.loading
            ? "Reading native certificate evidence…"
            : observation
              ? "HTTPS · website certificate observed"
              : "HTTPS · certificate evidence unavailable"}
      </p>
      {observation ? (
        <>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-[var(--color-textSecondary)]">
                {observation.source === "browser-navigation"
                  ? "Browser certificate status"
                  : "System certificate verification"}
              </dt>
              <dd>
                {observation.source === "browser-navigation"
                  ? observation.systemCaValid
                    ? "No certificate errors reported"
                    : "Certificate errors reported by the browser"
                  : observation.systemCaValid
                    ? "Passed on the observed handshake"
                    : "Did not pass on the observed connection"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-textSecondary)]">
                App certificate review
              </dt>
              <dd>
                {observation.reviewed === null
                  ? "Review history not reported for this navigation"
                  : observation.reviewed
                    ? "Explicit approval on this observed handshake"
                    : "Admitted under this connection’s trust policy; no prompt on this handshake"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-textSecondary)]">Observed at</dt>
              <dd>{observation.observedAt}</dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {observation.source === "browser-navigation"
              ? "Captured from this page’s native browser navigation."
              : "Captured from this attempt’s upstream website connection, separate from the app proxy certificate."}
          </p>
          {observation.chain.map((cert, index) => (
            <details
              key={`${index}:${cert.fingerprint}`}
              open={index === 0}
              className="rounded border border-[var(--color-border)] p-2 text-xs"
            >
              <summary className="cursor-pointer font-medium">
                {index === 0
                  ? "Website certificate"
                  : `Chain certificate ${index + 1}`}
              </summary>
              <dl className="mt-2 space-y-2">
                {[
                  ["Subject", cert.subject || "Not supplied"],
                  ["Issuer", cert.issuer || "Not supplied"],
                  ["SHA-256 fingerprint", cert.fingerprint],
                  ["Valid from", cert.validFrom],
                  ["Valid until", cert.validTo],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[var(--color-textSecondary)]">
                      {label}
                    </dt>
                    <dd className="break-all font-mono select-text">{value}</dd>
                  </div>
                ))}
              </dl>
              {Date.parse(cert.validTo) <= Date.now() && (
                <p className="mt-2 text-warning">
                  Certificate expired. Remembered trust and certificate expiry
                  are separate.
                </p>
              )}
            </details>
          ))}
        </>
      ) : (
        !plain &&
        !security.loading && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {security.unavailable
              ? "The current native observation could not be read."
              : "No admitted upstream certificate was captured for this origin in the current attempt."}{" "}
            A URL or a successful page load alone does not verify certificate
            trust.
          </p>
        )
      )}
      {!plain && (
        <>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-[var(--color-textSecondary)]">TLS version</dt>
              <dd>
                {observation?.tlsVersion ?? "Not reported by this connection"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-textSecondary)]">Cipher</dt>
              <dd className="break-all font-mono">
                {observation?.cipherSuite ?? "Not reported by this connection"}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="sor-btn sor-btn-secondary text-xs"
            disabled={!!security.loading}
            onClick={security.refresh}
          >
            <RotateCw size={13} aria-hidden="true" />
            Refresh security information
          </button>
        </>
      )}
    </div>
  );
}
