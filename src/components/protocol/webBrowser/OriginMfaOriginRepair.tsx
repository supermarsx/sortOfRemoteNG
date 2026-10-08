import React, { useLayoutEffect, useRef, useState } from "react";
import { useConnections } from "../../../contexts/useConnections";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import {
  DatabaseManager,
  type DatabaseDataTarget,
} from "../../../utils/connection/databaseManager";
import {
  getHttpAutoMfaOrigin,
  normalizeHttpAutoMfa,
} from "../../../utils/connection/httpAutoMfa";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../../utils/connection/httpApplicationProfiles";
import { normalizeAdvancedProtocolConnection } from "../../../utils/connection/normalizeAdvancedProtocolConnection";
import { stableJsonStringify } from "../../../utils/core/stableJsonStringify";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";

export interface OriginMfaOriginRepairProps {
  session: ConnectionSession;
  connection: Connection;
  assertOwner: () => void;
  /** Verified-save notification only; never navigate, retry or submit codes. */
  onRepaired: () => void;
  onOverlayChange?: (open: boolean) => void;
}

const failed =
  "The origin change could not be confirmed saved. Check this database's save status and review the connection before retrying. No login was started.";
const changed = () => new Error("The reviewed connection or database changed.");

function reviewedOrigins(connection: Connection) {
  const config = normalizeHttpAutoMfa(connection.httpAutoMfa);
  const app = normalizeHttpApplicationSettings(connection.httpApplication);
  const profile = app && getHttpApplicationProfile(app.id);
  const challenge = profile?.totpChallenges?.find(
    (item) => item.id === config.challengeId,
  );
  if (
    connection.isGroup ||
    connection.httpVerifySsl === false ||
    !config.enabled ||
    !config.origin ||
    !app ||
    !profile ||
    app.invalid ||
    app.loginMode !== "form" ||
    !challenge
  )
    throw changed();
  const expected = getHttpAutoMfaOrigin(connection);
  const source = getHttpAutoMfaOrigin({
    ...connection,
    httpApplication: undefined,
  });
  if (
    expected === config.origin ||
    [config.origin, expected].some((origin) =>
      new URL(origin).hostname.includes("*"),
    ) ||
    (profile.hostedLoginUrl &&
      new URL(profile.hostedLoginUrl).origin !== source) ||
    (challenge.origins && !challenge.origins.includes(expected))
  )
    throw changed();
  // Presence/identity only. Do not resolve a vault facet or generate a code.
  if (connection.credentialSource?.kind === "vault") {
    if (connection.credentialSource.totpId !== config.totpConfigId)
      throw changed();
  } else if (
    (connection.credentialSource &&
      connection.credentialSource.kind !== "local") ||
    connection.totpConfigs?.filter((entry) => entry.id === config.totpConfigId)
      .length !== 1
  ) {
    throw changed();
  }
  return { old: config.origin, expected };
}

type Review = {
  row: Connection;
  signature: string;
  origins: ReturnType<typeof reviewedOrigins>;
  databaseId: string;
  generation: number;
  sessionId: string;
  target: DatabaseDataTarget;
};

/** Parent mounts only for the exact create failure on an active saved tab. */
export default function OriginMfaOriginRepair(
  props: OriginMfaOriginRepairProps,
) {
  const context = useConnections();
  const manager = DatabaseManager.getInstance();
  const latest = useRef({ context, props });
  latest.current = { context, props };
  const mounted = useRef(false);
  const operation = useRef<object | null>(null);
  const replacement = useRef<Connection | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current = null;
      latest.current.props.onOverlayChange?.(false);
    };
  }, []);

  const assertScope = (snapshot: Review) => {
    const current = latest.current;
    const availability = current.context.databaseAvailability;
    if (
      !mounted.current ||
      availability?.status !== "ready" ||
      availability.databaseId !== snapshot.databaseId ||
      availability.generation !== snapshot.generation ||
      current.props.session.id !== snapshot.sessionId ||
      current.props.session.ownerDatabaseId !== snapshot.databaseId ||
      current.props.session.connectionId !== snapshot.row.id ||
      current.props.session.reattachOnly ||
      manager.getCurrentDatabase()?.id !== snapshot.databaseId ||
      snapshot.target.databaseId !== snapshot.databaseId ||
      !snapshot.target.assertAccessible ||
      !snapshot.target.readCurrent ||
      !current.context.getCurrentConnections
    )
      throw changed();
    snapshot.target.assertAccessible();
    return current.context;
  };
  const currentRow = (snapshot: Review) => {
    const rows = assertScope(snapshot).getCurrentConnections!({
      databaseId: snapshot.databaseId,
      generation: snapshot.generation,
    }).filter((row) => row.id === snapshot.row.id);
    if (rows.length !== 1) throw changed();
    return rows[0];
  };
  const assertReviewed = (snapshot: Review) => {
    latest.current.props.assertOwner();
    if (
      currentRow(snapshot) !== snapshot.row ||
      latest.current.props.connection !== snapshot.row ||
      stableJsonStringify(snapshot.row) !== snapshot.signature
    )
      throw changed();
  };
  const readSaved = async (snapshot: Review, expected: Connection) => {
    assertScope(snapshot);
    const data = await snapshot.target.readCurrent!();
    assertScope(snapshot);
    const rows = data?.connections.filter((row) => row.id === expected.id);
    // Apply the same pure normalization used on Provider load/update. Nothing
    // from this read advances the writer's CAS baseline or replaces UI state.
    if (
      rows?.length !== 1 ||
      stableJsonStringify(normalizeAdvancedProtocolConnection(rows[0])) !==
        stableJsonStringify(expected)
    )
      throw changed();
  };

  let eligible = false;
  try {
    const availability = context.databaseAvailability;
    const rows =
      availability?.status === "ready" &&
      availability.databaseId === props.session.ownerDatabaseId &&
      context
        .getCurrentConnections?.({
          databaseId: availability.databaseId!,
          generation: availability.generation,
        })
        .filter((row) => row.id === props.session.connectionId);
    if (
      rows &&
      rows.length === 1 &&
      rows[0] === props.connection &&
      !props.session.reattachOnly &&
      props.session.ownerDatabaseId
    ) {
      reviewedOrigins(props.connection);
      eligible = true;
    }
  } catch {
    /* Unreviewed data never becomes a repair button or display string. */
  }

  let visibleReview = false;
  if (review) {
    try {
      const row = currentRow(review);
      visibleReview =
        row === review.row ||
        (!!operation.current &&
          !!replacement.current &&
          stableJsonStringify(row) ===
            stableJsonStringify(replacement.current));
    } catch {
      /* A lock, scope switch or deleted row closes the prompt. */
    }
  }
  const onOverlayChange = props.onOverlayChange;
  useLayoutEffect(() => {
    onOverlayChange?.(!!review && visibleReview);
    if (review && !visibleReview) setReview(null);
  }, [review, visibleReview, onOverlayChange]);

  const close = () => {
    if (operation.current) return;
    setReview(null);
    setError(false);
  };
  const confirm = async () => {
    if (!review || operation.current) return;
    const token = {};
    operation.current = token;
    setBusy(true);
    setError(false);
    const assertOperation = () => {
      assertScope(review);
      if (operation.current !== token) throw changed();
    };
    try {
      assertReviewed(review);
      await latest.current.context.flushPendingSave();
      assertOperation();
      assertReviewed(review);
      await readSaved(review, review.row);
      assertOperation();
      assertReviewed(review);
      // No await between the last authoritative row check and the Provider's
      // synchronous dispatch. The whole payload differs in exactly one field.
      const updated: Connection = {
        ...review.row,
        httpAutoMfa: {
          ...review.row.httpAutoMfa!,
          origin: review.origins.expected,
        },
      };
      replacement.current = updated;
      await latest.current.context.dispatchAndFlush({
        type: "UPDATE_CONNECTION",
        payload: updated,
      });
      assertOperation();
      if (
        stableJsonStringify(currentRow(review)) !== stableJsonStringify(updated)
      )
        throw changed();
      await readSaved(review, updated);
      assertOperation();
      if (
        stableJsonStringify(currentRow(review)) !== stableJsonStringify(updated)
      )
        throw changed();
      // Do NOT call the pre-write UI assertOwner here: our own row update
      // invalidates it. The captured lease, scope and persisted row are proof.
      setReview(null);
      latest.current.props.onRepaired();
    } catch {
      if (mounted.current && operation.current === token) setError(true);
    } finally {
      if (operation.current === token) {
        operation.current = null;
        replacement.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <>
      {eligible && (
        <button
          type="button"
          className="sor-btn sor-btn-primary text-xs"
          disabled={busy}
          onClick={() => {
            try {
              props.assertOwner();
              const availability = context.databaseAvailability!;
              const target = manager.captureCurrentDatabaseDataTarget();
              if (!target) return;
              const snapshot: Review = {
                row: props.connection,
                signature: stableJsonStringify(props.connection),
                origins: reviewedOrigins(props.connection),
                databaseId: props.session.ownerDatabaseId!,
                generation: availability.generation,
                sessionId: props.session.id,
                target,
              };
              assertReviewed(snapshot);
              setError(false);
              setReview(snapshot);
            } catch {
              setError(true);
            }
          }}
        >
          Review and fix MFA origin
        </button>
      )}
      {error && !visibleReview && (
        <p role="alert" className="text-xs text-error">
          {failed}
        </p>
      )}
      <Modal
        isOpen={!!review && visibleReview}
        onClose={close}
        closeOnBackdrop={false}
        closeOnEscape={!busy}
        initialFocusRef={cancelRef}
        ariaLabel="Fix automatic MFA origin"
        panelClassName="max-w-lg"
      >
        <ModalHeader
          title="Fix automatic MFA origin"
          onClose={busy ? undefined : close}
        />
        <ModalBody>
          <p className="text-sm">
            Approve automatic authenticator codes for this application's
            reviewed HTTPS login origin.
          </p>
          <dl className="my-3 grid gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-textSecondary)]">
                Saved origin
              </dt>
              <dd className="break-all font-mono">{review?.origins.old}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-textSecondary)]">
                Reviewed login origin
              </dt>
              <dd className="break-all font-mono">
                {review?.origins.expected}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Only the saved MFA origin changes. Your password, authenticator,
            credential source and other settings stay unchanged. No code is
            generated or sent, and login is not retried.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-error">
              {failed}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            ref={cancelRef}
            type="button"
            className="sor-btn sor-btn-secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? "Saving…" : "Approve and save origin"}
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
}
