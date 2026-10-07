import { ShieldCheck } from "lucide-react";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { CheckboxField } from "../../ui/forms/Checkbox";
import type { useBlockedWebsiteScripts } from "../../../hooks/protocol/useBlockedWebsiteScripts";
import {
  allWebsiteRequestsAllowed,
  allowAllWebsiteRequests,
} from "../../../utils/protocol/websiteRequestPermissions";

export default function BlockedRequestsDialog({
  permissions,
}: {
  permissions: ReturnType<typeof useBlockedWebsiteScripts>;
}) {
  const review = permissions.review;
  if (!review || review.mode !== "requests") return null;
  const active = allWebsiteRequestsAllowed(review.policy);
  return (
    <Modal
      isOpen
      onClose={permissions.closeReview}
      ariaLabel="Website request permissions"
      panelClassName="max-w-xl mx-4"
    >
      <ModalHeader
        title="Website request permissions"
        onClose={permissions.closeReview}
      />
      <ModalBody className="p-6 space-y-5">
        <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
          Review blocked requests for{" "}
          <strong>{review.connectionName || "this website"}</strong>.
          Script-source grants alone do not permit navigation, API calls, fonts
          or other resource types.
        </p>
        <ul aria-label="Blocked website requests" className="space-y-3">
          {review.reports.map((report) => (
            <li
              key={`${report.kind}:${report.reason}:${report.origin}`}
              className="rounded-lg border border-[var(--color-border)] p-4 space-y-2"
            >
              <p className="font-mono text-sm break-all">
                {report.origin ?? "Inline or unknown destination"}
              </p>
              <p className="text-xs text-[var(--color-textMuted)]">
                {report.kind} · {report.reason}
              </p>
            </li>
          ))}
        </ul>
        {permissions.sharedSession ? (
          <p className="text-sm text-warning">
            This tab shares its source tab's session. Review permissions from
            the original saved connection.
          </p>
        ) : active ? (
          <p
            role="status"
            className="text-sm text-[var(--color-textSecondary)]"
          >
            All-request trust is already enabled. Reload the website to apply
            it. Expired sessions, certificate failures, invalid URLs and
            unsupported request types still require their own repair; this
            setting cannot bypass them.
          </p>
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3">
            <h3 className="text-sm font-medium">Allow all website requests</h3>
            <p className="text-sm leading-relaxed text-warning">
              Trust all current and future destinations for this connection, not
              just the list above. Includes website resources, API requests,
              navigation and scripts. Scripts and forms can send information you
              enter to other destinations.
            </p>
            <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
              Requests stay on the internal proxy. This does not approve saved
              credentials or automatic login on other origins. Certificate
              checks, HTTPS requirements, browser isolation and
              unsupported-request protections remain in force.
            </p>
            <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
              HTTP(S) resources and anonymous API requests are supported.
              Cross-origin pages open through isolated anonymous navigation.
              Cross-origin form posts, embedded documents, WebSockets and event
              streams still require a supported dedicated route.
            </p>
            {permissions.policyChangeRequired && (
              <CheckboxField
                checked={permissions.acceptPolicyChange}
                onChange={permissions.setAcceptPolicyChange}
                disabled={permissions.busy}
                label="I approve enabling website scripts and disabling same-origin-only restrictions"
              />
            )}
            <CheckboxField
              checked={permissions.acceptAllRequests}
              onChange={permissions.setAcceptAllRequests}
              disabled={permissions.busy}
              label="I trust all current and future request destinations for this connection"
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className="sor-btn sor-btn-primary gap-2"
                disabled={
                  permissions.busy ||
                  !permissions.acceptAllRequests ||
                  !allowAllWebsiteRequests(review.policy) ||
                  (permissions.policyChangeRequired &&
                    !permissions.acceptPolicyChange)
                }
                onClick={() => void permissions.allowAllRequests()}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                {permissions.busy
                  ? "Saving permission…"
                  : "Allow all website requests"}
              </button>
            </div>
          </div>
        )}
        {permissions.error && (
          <p role="alert" className="text-sm text-error">
            {permissions.error}
          </p>
        )}
        <p className="text-xs leading-relaxed text-[var(--color-textMuted)]">
          Applies only to this saved connection. Save, then use Reload website
          to start a fresh session; blocked requests are not replayed
          automatically. Turn this off in Connection settings → Internal proxy
          controls → Allow all website requests. Individual source lists are
          preserved.
        </p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className="sor-modal-cancel"
          disabled={permissions.busy}
          onClick={permissions.closeReview}
        >
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
