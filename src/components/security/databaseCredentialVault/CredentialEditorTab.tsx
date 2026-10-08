import { useContext, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { ConnectionContext } from "../../../contexts/ConnectionContextTypes";
import type { CredentialEditorRequest } from "../../../types/security/credentialEditor";
import {
  credentialVaultScopeKey,
  FACET_LABELS,
} from "../../../hooks/security/useDatabaseCredentialVault";
import { registerCredentialVaultDraft } from "../../../utils/security/credentialVaultDrafts";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import CredentialEntryForm from "./CredentialEntryForm";
import { useCredentialEditor } from "./useCredentialEditor";

interface Props {
  request: CredentialEditorRequest;
  sessionId: string;
  onClose: () => void;
}

function PrivateEditor({ request, sessionId, onClose }: Props) {
  const mgr = useCredentialEditor(request);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const previous = useRef({ entry: mgr.entry, busy: mgr.busy, revision: 0 });
  if (
    previous.current.entry !== mgr.entry ||
    previous.current.busy !== mgr.busy
  )
    previous.current = {
      entry: mgr.entry,
      busy: mgr.busy,
      revision: previous.current.revision + 1,
    };
  const state = useRef({
    databaseId: request.scope.databaseId,
    scopeKey: JSON.stringify([
      request.scope.databaseId,
      request.scope.generation,
    ]),
    dirty: mgr.dirty,
    busy: mgr.busy,
    revision: previous.current.revision,
  });
  state.current = {
    ...state.current,
    dirty: mgr.dirty,
    busy: mgr.busy,
    revision: previous.current.revision,
  };
  useEffect(
    () => registerCredentialVaultDraft(sessionId, () => state.current),
    [sessionId],
  );
  const cancel = () => {
    if (!mgr.busy) {
      if (mgr.dirty) setConfirmCancel(true);
      else onClose();
    }
  };
  const save = async () => {
    if (await mgr.save()) {
      // Close guards read synchronously, before React commits the saved state.
      state.current = {
        ...state.current,
        dirty: false,
        busy: false,
        revision: state.current.revision + 1,
      };
      onClose();
    }
  };
  const title =
    request.mode === "migrate"
      ? "Move connection credentials to vault"
      : request.mode === "create"
        ? "New vault credential"
        : "Edit vault credential";
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="Credential editor tab"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <KeyRound size={18} className="text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="ml-auto text-xs text-[var(--color-textSecondary)]">
          {mgr.dirty ? "Unsaved changes" : "Current protected database"}
        </span>
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--color-border) var(--color-background)",
          scrollbarGutter: "stable",
        }}
        role="region"
        aria-label="Credential details"
        tabIndex={0}
      >
        <div className="mx-auto max-w-3xl space-y-3">
          {mgr.loading && (
            <p role="status" className="text-sm">
              Loading private credential editor…
            </p>
          )}
          {mgr.error && (
            <p
              role="alert"
              className="rounded border border-error/40 p-3 text-sm text-error"
            >
              {mgr.error}
            </p>
          )}
          {mgr.entry &&
            (request.mode === "migrate" ? (
              <div className="space-y-4 text-sm">
                <p>
                  Move the login from <strong>{mgr.connectionName}</strong> into
                  a reusable credential in this database.
                </p>
                <label className="block space-y-1">
                  <span>Credential name</span>
                  <input
                    className="sor-form-input"
                    value={mgr.entry.name}
                    disabled={mgr.busy}
                    onChange={(event) =>
                      mgr.update({ ...mgr.entry!, name: event.target.value })
                    }
                  />
                </label>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  Includes:{" "}
                  {Object.keys(mgr.entry.facets)
                    .map(
                      (key) => FACET_LABELS[key as keyof typeof FACET_LABELS],
                    )
                    .join(", ")}
                  . Credential values are not displayed.
                </p>
                <p className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs leading-relaxed">
                  The vault write and saved connection link are verified before
                  local login fields are cleared. Proxy and gateway credentials
                  stay separate. Automatic website MFA approval is reset when
                  its credential source changes; review it again in the
                  connection editor.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    disabled={mgr.busy}
                    onClick={cancel}
                  >
                    Cancel editing
                  </button>
                  <button
                    type="button"
                    className="sor-btn sor-btn-primary"
                    disabled={mgr.busy || !mgr.entry.name.trim()}
                    onClick={() => void save()}
                  >
                    {mgr.busy
                      ? "Moving credentials…"
                      : "Save to vault and link connection"}
                  </button>
                </div>
              </div>
            ) : (
              <CredentialEntryForm
                entry={mgr.entry}
                onChange={mgr.update}
                onSave={() => void save()}
                onCancel={cancel}
                busy={mgr.busy}
              />
            ))}
          {!mgr.entry && !mgr.loading && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              onClick={onClose}
            >
              Close editor
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={confirmCancel}
        title="Discard private draft"
        message="Discard these unsaved credential changes? Cancelling does not save the draft."
        confirmText="Discard changes"
        variant="warning"
        confirmOnEnter={false}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          if (!mgr.busy) {
            state.current = {
              ...state.current,
              dirty: false,
              revision: state.current.revision + 1,
            };
            onClose();
          }
        }}
      />
    </section>
  );
}

/** A revoked tab never rebinds, even if its database is later unlocked again. */
export default function CredentialEditorTab(props: Props) {
  const context = useContext(ConnectionContext);
  const initial = useRef({
    request: JSON.stringify(props.request),
    availabilityGeneration: context?.databaseAvailability?.generation,
  });
  const retired = useRef(false);
  const expected = JSON.stringify([
    props.request.scope.databaseId,
    props.request.scope.generation,
  ]);
  if (
    initial.current.request !== JSON.stringify(props.request) ||
    credentialVaultScopeKey(context?.credentialVault) !== expected ||
    context?.databaseAvailability?.status !== "ready" ||
    context.databaseAvailability.databaseId !==
      props.request.scope.databaseId ||
    context.databaseAvailability.generation !==
      initial.current.availabilityGeneration
  )
    retired.current = true;
  if (retired.current)
    return (
      <section
        className="p-4 text-sm"
        aria-label="Credential editor unavailable"
      >
        <p role="status">
          This private editor expired because its database was locked or
          changed. Reopen the credential from its owning vault. The draft is no
          longer available.
        </p>
        <button
          type="button"
          className="sor-btn sor-btn-secondary mt-3"
          onClick={props.onClose}
        >
          Close editor
        </button>
      </section>
    );
  return <PrivateEditor {...props} />;
}
