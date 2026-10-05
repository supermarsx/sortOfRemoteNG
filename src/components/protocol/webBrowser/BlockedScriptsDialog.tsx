import React from "react";
import { ShieldCheck } from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { CheckboxField } from "../../ui/forms/Checkbox";
import {
  websiteScriptPermission,
  allListedWebsiteScriptPermissions,
  allowAllWebsiteScripts,
  allWebsiteScriptsAllowed,
} from "../../../utils/protocol/websiteScriptPermissions";
import type { useBlockedWebsiteScripts } from "../../../hooks/protocol/useBlockedWebsiteScripts";

export default function BlockedScriptsDialog({
  scripts,
}: {
  scripts: ReturnType<typeof useBlockedWebsiteScripts>;
}) {
  const review = scripts.review;
  if (!review) return null;
  const allListed = allListedWebsiteScriptPermissions(
    review.reports,
    review.policy,
  );
  return (
    <Modal
      isOpen
      onClose={scripts.closeReview}
      ariaLabel="Blocked website scripts"
      panelClassName="max-w-xl mx-4"
    >
      <ModalHeader
        title="Blocked website scripts"
        onClose={scripts.closeReview}
      />
      <ModalBody className="p-6 space-y-5">
        <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
          Review sources for{" "}
          <strong>{review.connectionName || "this website"}</strong>. Only allow
          publishers you trust: their scripts can read and change this page,
          including information you enter. A block does not necessarily mean the
          site is broken.
        </p>
        {scripts.sharedSession && (
          <p className="text-sm text-warning">
            This tab shares its source tab's session. Review permissions from
            the original saved connection.
          </p>
        )}
        {scripts.policyChangeRequired && (
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm">
            <p className="mb-3 text-warning">
              Allowing a source also enables website scripts and turns off
              same-origin-only restrictions for this connection. Other
              previously configured source permissions become active too.
            </p>
            <CheckboxField
              checked={scripts.acceptPolicyChange}
              onChange={scripts.setAcceptPolicyChange}
              disabled={scripts.busy}
              label="I approve these connection policy changes"
            />
          </div>
        )}
        {!scripts.sharedSession && !allWebsiteScriptsAllowed(review.policy) && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3">
            <h3 className="text-sm font-medium">Trust all website scripts</h3>
            <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
              Includes inline scripts, eval and future HTTPS script sources,
              even when no source was reported. Overrides script-specific
              website CSP for this connection. Scripts can read information you
              enter on this page.
            </p>
            <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
              Downloads stay on the proxy. This does not allow malformed URLs,
              insecure external HTTP scripts, other blocked network resources or
              browser sandbox access. Saved credentials and login consent are
              unchanged.
            </p>
            <CheckboxField
              checked={scripts.acceptAllScripts}
              onChange={scripts.setAcceptAllScripts}
              disabled={scripts.busy}
              label="I trust all current and future scripts on this connection"
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className="sor-btn sor-btn-primary gap-2"
                disabled={
                  !allowAllWebsiteScripts(review.policy) ||
                  !scripts.acceptAllScripts ||
                  scripts.busy ||
                  (scripts.policyChangeRequired && !scripts.acceptPolicyChange)
                }
                onClick={() => void scripts.allowAllScripts()}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                Allow all website scripts
              </button>
            </div>
          </div>
        )}
        {!scripts.sharedSession && allListed.count > 1 && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3">
            <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
              {allListed.explanation}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className="sor-btn sor-btn-primary gap-2"
                disabled={
                  !allListed.policy ||
                  scripts.busy ||
                  (scripts.policyChangeRequired && !scripts.acceptPolicyChange)
                }
                onClick={() => void scripts.allowAllListed()}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                Allow all listed sources
                {allListed.count ? ` (${allListed.count})` : ""}
              </button>
            </div>
          </div>
        )}
        <ul className="space-y-3">
          {review.reports.map((report) => {
            const proposal = websiteScriptPermission(report, review.policy);
            return (
              <li
                key={`${report.reason}:${report.origin}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3"
              >
                <p className="font-mono text-sm break-all text-[var(--color-text)]">
                  {report.origin ?? "Inline or unknown source"}
                </p>
                <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
                  {proposal.explanation}
                </p>
                {proposal.policy && !scripts.sharedSession && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      className="sor-btn sor-btn-primary gap-2"
                      disabled={
                        scripts.busy ||
                        (scripts.policyChangeRequired &&
                          !scripts.acceptPolicyChange)
                      }
                      onClick={() => void scripts.allowSource(report)}
                      aria-label={`Allow scripts from ${report.origin}`}
                    >
                      <ShieldCheck size={14} aria-hidden="true" />
                      {scripts.busy ? "Saving permission…" : "Allow source"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {scripts.error && (
          <p role="alert" className="text-sm text-error">
            {scripts.error}
          </p>
        )}
        <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
          Changes apply only to this saved connection, not global defaults.
          After saving, use Reload website to apply them. Manage or remove
          grants in the connection's Internal proxy controls → Allow all website
          scripts or External scripts and stylesheets.
        </p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="sor-modal-cancel"
          disabled={scripts.busy}
          onClick={scripts.closeReview}
        >
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
