import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { useToastContext } from "../../contexts/ToastContext";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import type { WebNetworkReport } from "../../utils/protocol/webNetworkReport";
import {
  websiteScriptPermission,
  allListedWebsiteScriptPermissions,
  allowAllWebsiteScripts,
} from "../../utils/protocol/websiteScriptPermissions";
import { allowAllWebsiteRequests } from "../../utils/protocol/websiteRequestPermissions";
import { httpRedirectTrustIdentity } from "../../utils/protocol/httpRedirectTrustIdentity";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import { DatabaseManager } from "../../utils/connection/databaseManager";

interface Options {
  session: ConnectionSession;
  connection: Connection | undefined;
  policy: HttpProxyPolicy | null;
  reports: readonly WebNetworkReport[];
  documentScope: string;
  getDocumentScope: () => string;
  sharedSession: boolean;
  onReload: () => void;
}
type Review = {
  mode: "scripts" | "requests";
  documentScope: string;
  ownerScope: string;
  policy: HttpProxyPolicy | null;
  reports: readonly WebNetworkReport[];
  expected: Connection | undefined;
};
const UNAVAILABLE =
  "Open and unlock this tab's owning database, then review the website permissions again. No other database will be changed.";
const STALE =
  "The website or its saved settings changed. Review the current website permissions again.";
const SAVE_FAILED =
  "The website permission could not be confirmed as saved. Check the database's save status and review its Internal proxy controls before retrying.";

export function useBlockedWebsiteScripts(options: Options) {
  const context = useConnections();
  const { toast } = useToastContext();
  const available = context.databaseAvailability;
  const notificationScope = JSON.stringify([
    options.session.id,
    options.session.connectionId,
    options.session.ownerDatabaseId,
  ]);
  const ownerScope = JSON.stringify([
    options.session.id,
    options.session.connectionId,
    options.session.ownerDatabaseId,
    available?.databaseId,
    available?.generation,
    available?.status,
  ]);
  const latest = useRef({
    options,
    context,
    ownerScope,
    notificationScope,
    toast,
  });
  latest.current = { options, context, ownerScope, notificationScope, toast };
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const notification = useRef<{ scope: string; id: string } | null>(null);
  const reloadToast = useRef<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const reviewRef = useRef<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptPolicyChange, setAcceptPolicyChange] = useState(false);
  const [acceptAllScripts, setAcceptAllScripts] = useState(false);
  const [acceptAllRequests, setAcceptAllRequests] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (notification.current)
        latest.current.toast.remove(notification.current.id);
      if (reloadToast.current) latest.current.toast.remove(reloadToast.current);
      notification.current = null;
      reviewRef.current = null;
    };
  }, []);

  const openReview = useCallback((mode: Review["mode"] = "scripts") => {
    const { options: current, ownerScope: owner } = latest.current;
    if (
      !mounted.current ||
      busyRef.current ||
      current.getDocumentScope() !== current.documentScope
    )
      return;
    const reports = current.reports.filter(
      (report) => mode === "requests" || report.kind === "script",
    );
    if (!reports.length) return;
    setError(null);
    setAcceptPolicyChange(false);
    setAcceptAllScripts(false);
    setAcceptAllRequests(false);
    const next = {
      mode,
      documentScope: current.documentScope,
      ownerScope: owner,
      policy: current.policy,
      reports,
      expected: current.connection,
    };
    reviewRef.current = next;
    setReview(next);
  }, []);

  const hasBlockedScripts = options.reports.some(
    (report) => report.kind === "script",
  );
  useEffect(() => {
    if (
      notification.current &&
      notification.current.scope !== notificationScope
    ) {
      toast.remove(notification.current.id);
      notification.current = null;
    }
    // Once per tab/owning database, not once per script, database switch or reload. The bell
    // keeps the review action available after dismissal and across navigation.
    if (!hasBlockedScripts || notification.current) return;
    const id = toast.warning(
      `Scripts were blocked on ${options.session.name || "this website"}. Some features may not work.`,
      12000,
    );
    notification.current = { scope: notificationScope, id };
    toast.update(id, {
      action: {
        label: "Review blocked scripts",
        icon: ShieldCheck,
        onClick: () => {
          if (
            mounted.current &&
            latest.current.notificationScope === notificationScope
          )
            openReview();
        },
      },
    });
  }, [
    hasBlockedScripts,
    notificationScope,
    options.session.name,
    toast,
    openReview,
  ]);

  const currentReview =
    review?.ownerScope === ownerScope &&
    review.documentScope === options.documentScope
      ? review
      : null;
  const policyChangeRequired =
    !!currentReview?.policy &&
    (currentReview.policy.sameOriginOnly ||
      currentReview.policy.pageScripts !== "allow");

  const allowReports = async (
    reports: readonly WebNetworkReport[],
    grant: "sources" | "scripts" | "requests" = "sources",
  ) => {
    const captured = currentReview;
    if (!captured || captured !== reviewRef.current || busyRef.current) return;
    if (
      !reports.length ||
      reports.some((report) => !captured.reports.includes(report))
    )
      return;
    if (grant === "scripts" && !acceptAllScripts) return;
    if (
      grant === "requests" &&
      (captured.mode !== "requests" || !acceptAllRequests)
    )
      return;
    const proposed =
      grant === "requests"
        ? allowAllWebsiteRequests(captured.policy)
        : grant === "scripts"
          ? allowAllWebsiteScripts(captured.policy)
          : reports.length === 1
            ? websiteScriptPermission(reports[0], captured.policy).policy
            : allListedWebsiteScriptPermissions(reports, captured.policy)
                .policy;
    if (!proposed) return;
    if (policyChangeRequired && !acceptPolicyChange) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let dispatched = false;
    try {
      const current = latest.current;
      const { context: provider, options: source } = current;
      const availability = provider.databaseAvailability;
      const databaseId = source.session.ownerDatabaseId;
      const manager = DatabaseManager.getInstance();
      const target = manager.captureCurrentDatabaseDataTarget();
      const assertOwner = () => {
        if (
          !mounted.current ||
          latest.current.ownerScope !== captured.ownerScope ||
          !databaseId ||
          availability?.status !== "ready" ||
          availability.databaseId !== databaseId ||
          manager.getCurrentDatabase()?.id !== databaseId ||
          target?.databaseId !== databaseId ||
          !target.assertAccessible ||
          !target.readCurrent ||
          !provider.getCurrentConnections
        )
          throw new Error(UNAVAILABLE);
        target.assertAccessible();
      };
      assertOwner();
      if (
        source.sharedSession ||
        !captured.expected ||
        source.getDocumentScope() !== captured.documentScope ||
        stableJsonStringify(source.policy) !==
          stableJsonStringify(captured.policy)
      )
        throw new Error(STALE);
      const records = provider.getCurrentConnections!({
        databaseId: databaseId!,
        generation: availability!.generation,
      });
      const matches = records.filter(
        (record) => record.id === source.session.connectionId,
      );
      const saved = matches[0];
      if (
        matches.length !== 1 ||
        saved.isGroup ||
        httpRedirectTrustIdentity(saved) !==
          httpRedirectTrustIdentity(captured.expected)
      )
        throw new Error(STALE);
      // Read the guarded synchronous Provider snapshot immediately before
      // dispatch, preserving unrelated edits and refusing changed security data.
      const updated = { ...saved, httpProxyPolicy: proposed };
      dispatched = true;
      await provider.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: updated,
      });
      assertOwner();
      const persisted = await target!.readCurrent!();
      assertOwner();
      const verified =
        persisted?.connections.filter((record) => record.id === saved.id) ?? [];
      if (
        verified.length !== 1 ||
        httpRedirectTrustIdentity(verified[0]) !==
          httpRedirectTrustIdentity(updated)
      )
        throw new Error(SAVE_FAILED);
      setReview(null);
      reviewRef.current = null;
      if (reloadToast.current) current.toast.remove(reloadToast.current);
      const id = current.toast.info(
        `${grant === "requests" ? "Website request" : "Script"} permission saved for this connection. Reload the website to apply it; you may need to sign in again.`,
        15000,
      );
      reloadToast.current = id;
      current.toast.update(id, {
        action: {
          label: "Reload website",
          onClick: () => {
            try {
              assertOwner();
              if (
                !latest.current.options.connection ||
                httpRedirectTrustIdentity(latest.current.options.connection) !==
                  httpRedirectTrustIdentity(updated)
              )
                return;
              // Use the new render's callback; never replay the blocked request
              // or reuse the old policy/navigation closure.
              latest.current.options.onReload();
              latest.current.toast.remove(id);
            } catch {
              /* A stale toast is never authority to change another tab. */
            }
          },
        },
      });
    } catch (cause) {
      if (mounted.current) {
        const message =
          !dispatched &&
          cause instanceof Error &&
          [UNAVAILABLE, STALE].includes(cause.message)
            ? cause.message
            : dispatched
              ? SAVE_FAILED
              : UNAVAILABLE;
        setError(message);
        // Saving may retire the old document and close its review dialog.
        if (dispatched) latest.current.toast.error(message);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return {
    hasBlockedScripts,
    hasBlockedRequests: options.reports.length > 0,
    openReview,
    openRequestReview: () => openReview("requests"),
    review: currentReview
      ? {
          mode: currentReview.mode,
          documentScope: currentReview.documentScope,
          connectionName: currentReview.expected?.name,
          reports: currentReview.reports,
          policy: currentReview.policy,
        }
      : null,
    busy,
    error,
    policyChangeRequired,
    acceptPolicyChange,
    setAcceptPolicyChange,
    acceptAllScripts,
    setAcceptAllScripts,
    acceptAllRequests,
    setAcceptAllRequests,
    allowSource: (report: WebNetworkReport) => allowReports([report]),
    allowAllListed: () => allowReports(currentReview?.reports ?? []),
    allowAllScripts: () =>
      allowReports(currentReview?.reports ?? [], "scripts"),
    allowAllRequests: () =>
      allowReports(currentReview?.reports ?? [], "requests"),
    closeReview: () => {
      if (!busyRef.current) {
        reviewRef.current = null;
        setReview(null);
      }
    },
    sharedSession: options.sharedSession,
  };
}
