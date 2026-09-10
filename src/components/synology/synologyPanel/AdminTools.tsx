import { useEffect, useId, useState } from "react";
import { Modal, ModalBody, ModalFooter } from "../../ui/overlays/Modal";
import { DialogHeader } from "../../ui/overlays/DialogHeader";
import { Settings2 } from "lucide-react";
import type { SubProps } from "./types";
import { SYNOLOGY_ADMIN_ACTIONS } from "./adminActions";
import AdminTable from "./AdminTable";

function CameraImage({ value }: { value: unknown }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!value || typeof value !== "object") return;
    const { mimeType, dataBase64 } = value as Record<string, unknown>;
    if (
      (mimeType !== "image/jpeg" && mimeType !== "image/png") ||
      typeof dataBase64 !== "string" ||
      dataBase64.length > 4 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)
    )
      return;
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
    } catch {
      return;
    }
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png =
      Array.from(bytes.slice(0, 8)).join(",") === "137,80,78,71,13,10,26,10";
    if (
      (mimeType === "image/jpeg" && !jpeg) ||
      (mimeType === "image/png" && !png)
    )
      return;
    const next = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], {
        type: mimeType,
      }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [value]);
  return url ? (
    <img
      src={url}
      alt="Current camera snapshot"
      className="max-h-96 max-w-full rounded"
    />
  ) : (
    <p role="alert">The camera did not return a bounded PNG or JPEG image.</p>
  );
}
function ActionForm({ mgr }: { mgr: SubProps["mgr"] }) {
  const review = mgr.actions.review!;
  const { action } = review;
  const id = useId();
  const [values, setValues] = useState<Record<string, string | boolean>>(
    () => ({
      ...Object.fromEntries(
        action.fields.map((field) => [
          field.key,
          field.type === "checkbox"
            ? false
            : field.key === "limit"
              ? "25"
              : field.key === "offset"
                ? "0"
                : "",
        ]),
      ),
      ...review.values,
    }),
  );
  return (
    <Modal
      isOpen
      ariaLabel={action.label}
      onClose={mgr.actions.cancel}
      closeOnEscape={!mgr.actions.busy}
      closeOnBackdrop={!mgr.actions.busy}
      panelClassName="max-w-lg max-h-[calc(100dvh-2rem)] overflow-hidden"
      contentClassName="flex min-h-0 flex-col p-0"
    >
      <DialogHeader
        title={action.label}
        icon={Settings2}
        variant="compact"
        onClose={mgr.actions.busy ? undefined : mgr.actions.cancel}
      />
      <form
        className="min-h-0 flex flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void mgr.actions.execute(values);
        }}
      >
        <ModalBody className="space-y-4 overflow-y-auto p-5">
          <p className="text-xs text-text-muted">
            NAS: {mgr.host}:{mgr.port}. This action is bound to this signed-in
            session.
          </p>
          <p
            className={
              action.mutation
                ? "text-sm text-warning"
                : "text-sm text-text-muted"
            }
          >
            {action.help}
          </p>
          {action.fields.map((field) => (
            <label
              key={field.key}
              htmlFor={`${id}-${field.key}`}
              className="block text-sm space-y-1"
            >
              <span>
                {field.label}
                {field.optional ? " (optional)" : ""}
              </span>
              {field.type === "checkbox" ? (
                <input
                  id={`${id}-${field.key}`}
                  type="checkbox"
                  className="ml-2"
                  checked={values[field.key] === true}
                  disabled={mgr.actions.busy}
                  onChange={(e) =>
                    setValues({ ...values, [field.key]: e.target.checked })
                  }
                />
              ) : (
                <input
                  id={`${id}-${field.key}`}
                  className="sor-form-input"
                  type={field.type ?? "text"}
                  autoComplete={
                    field.type === "password" ? "new-password" : "off"
                  }
                  required={!field.optional}
                  maxLength={field.maxLength ?? 255}
                  min={field.type === "number" ? 0 : undefined}
                  value={String(values[field.key] ?? "")}
                  disabled={mgr.actions.busy}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setValues({ ...values, [field.key]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
          {mgr.actions.error && (
            <p role="alert" className="text-sm text-error">
              {mgr.actions.error}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={mgr.actions.busy}
            onClick={mgr.actions.cancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`sor-btn ${action.mutation ? "sor-btn-danger" : "sor-btn-primary"}`}
            disabled={mgr.actions.busy}
          >
            {mgr.actions.busy
              ? "Working…"
              : action.mutation
                ? `Confirm ${action.label.toLowerCase()}`
                : "Load details"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
export default function AdminTools({ mgr }: SubProps) {
  const actions = SYNOLOGY_ADMIN_ACTIONS.filter(
    (action) => action.tab === mgr.activeTab,
  );
  const result = mgr.actions.result;
  return (
    <>
      <div className="shrink-0 border-b border-border p-3 space-y-2">
        <div
          className="flex flex-wrap gap-1.5"
          aria-label="NAS actions and details"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              className="sor-btn-secondary-sm"
              disabled={mgr.actions.busy}
              data-tooltip={action.help}
              onClick={() => mgr.actions.open(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
        {mgr.actions.message && (
          <p role="status" className="text-xs text-success">
            {mgr.actions.message}
          </p>
        )}
        {!mgr.actions.review && mgr.actions.error && (
          <p role="alert" className="text-xs text-error">
            {mgr.actions.error}
          </p>
        )}
      </div>
      {mgr.actions.review && (
        <ActionForm key={mgr.actions.review.id} mgr={mgr} />
      )}{" "}
      {result && (
        <Modal
          isOpen
          ariaLabel={result.action.label}
          onClose={mgr.actions.clearResult}
          panelClassName="max-w-5xl max-h-[calc(100dvh-2rem)] overflow-hidden"
          contentClassName="flex min-h-0 flex-col p-0"
        >
          <DialogHeader
            title={result.action.label}
            icon={Settings2}
            variant="compact"
            onClose={mgr.actions.clearResult}
          />
          <ModalBody className="overflow-y-auto p-5">
            {result.action.image ? (
              <CameraImage value={result.value} />
            ) : (
              <AdminTable
                title={result.action.label}
                rows={
                  Array.isArray(result.value)
                    ? result.value
                    : result.value && typeof result.value === "object"
                      ? [result.value]
                      : []
                }
                columns={result.action.columns ?? []}
              />
            )}
          </ModalBody>
        </Modal>
      )}
    </>
  );
}
