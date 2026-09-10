import { useId, useState } from "react";
import { Info, Link, Share2 } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../../ui/overlays/Modal";
import { DialogHeader } from "../../ui/overlays/DialogHeader";
import AdminTable from "./AdminTable";
import type { SubProps } from "./types";
const fileSize = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "—";
  const power = value
    ? Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))
    : 0;
  return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][power]}`;
};
const fileTime = (value: unknown) =>
  typeof value === "number" && Number.isFinite(new Date(value * 1000).getTime())
    ? new Date(value * 1000).toLocaleString()
    : "—";
const fileMode = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? `0o${value.toString(8)}`
    : "—";

function ShareReview({ mgr }: SubProps) {
  const id = useId(),
    [password, setPassword] = useState(""),
    [expiry, setExpiry] = useState("");
  const s = mgr.sharing,
    review = s.review!;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void s.confirm(password, expiry).then((ok) => {
          if (ok) setPassword("");
        });
      }}
    >
      <p className="break-all text-sm">
        {review.kind === "create" ? review.path : review.link.path}
      </p>
      <p className="text-sm text-warning">
        {review.kind === "create"
          ? "Anyone with this link may access the selected item according to NAS sharing settings. Set a password and expiry when appropriate."
          : "Revoke this sharing link? Existing recipients will no longer be able to use it. This does not delete the file."}
      </p>
      {review.kind === "create" && (
        <>
          <label htmlFor={`${id}-password`} className="block text-sm">
            Sharing password (optional, maximum 16 characters)
            <input
              id={`${id}-password`}
              type="password"
              className="sor-form-input"
              maxLength={16}
              autoComplete="new-password"
              disabled={s.busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-expiry`} className="block text-sm">
            Expiry date (optional)
            <input
              id={`${id}-expiry`}
              type="date"
              className="sor-form-input"
              disabled={s.busy}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </label>
        </>
      )}
      <div className="flex justify-end gap-2">
        <button
          className="sor-btn sor-btn-secondary"
          type="button"
          disabled={s.busy}
          onClick={s.cancelReview}
        >
          Cancel review
        </button>
        <button className="sor-btn sor-btn-danger" disabled={s.busy}>
          {s.busy
            ? "Working…"
            : review.kind === "create"
              ? "Create sharing link"
              : "Revoke sharing link"}
        </button>
      </div>
    </form>
  );
}
export default function FileDetailsSharing({ mgr }: SubProps) {
  const [details, setDetails] = useState(false),
    fs = mgr.fileStation,
    s = mgr.sharing;
  const items = (fs.fileList?.files ?? []).filter((item) =>
    fs.selected.includes(item.path),
  );
  return (
    <>
      <button
        className="sor-btn-secondary-sm"
        disabled={fs.busy || !items.length}
        onClick={() => setDetails(true)}
      >
        <Info className="h-4 w-4" />
        Details & permissions
      </button>
      <button
        className="sor-btn-secondary-sm"
        disabled={fs.busy || items.length !== 1}
        onClick={() => s.requestCreate(items[0].path)}
      >
        <Share2 className="h-4 w-4" />
        Share selected item
      </button>
      <button
        className="sor-btn-secondary-sm"
        disabled={fs.busy}
        onClick={s.show}
      >
        <Link className="h-4 w-4" />
        Sharing links
      </button>
      {details && (
        <Modal
          isOpen
          ariaLabel="File details and permissions"
          onClose={() => setDetails(false)}
          panelClassName="max-w-5xl max-h-[calc(100dvh-2rem)] overflow-hidden"
          contentClassName="flex min-h-0 flex-col p-0"
        >
          <DialogHeader
            title="File details and permissions"
            icon={Info}
            onClose={() => setDetails(false)}
          />
          <ModalBody className="overflow-y-auto p-5">
            <p className="mb-3 text-xs text-text-muted">
              Metadata from the current listing. Missing values are unknown.
              ACLs are read-only here; use DSM to edit permissions.
            </p>
            <AdminTable
              title="Selected files"
              rows={items}
              columns={[
                ["name", "Name"],
                ["path", "Path"],
                ["isdir", "Folder"],
                ["additional.size", "Size", fileSize],
                ["additional.owner.user", "Owner"],
                ["additional.owner.group", "Group"],
                ["additional.perm.posix", "POSIX mode", fileMode],
                ["additional.perm.is_acl_mode", "ACL mode"],
                ["additional.time.mtime", "Modified", fileTime],
                ["additional.time.crtime", "Created", fileTime],
                ["additional.realPath", "Real path"],
              ]}
            />
          </ModalBody>
        </Modal>
      )}
      {s.open && (
        <Modal
          isOpen
          ariaLabel="File sharing links"
          onClose={s.close}
          closeOnEscape={!s.busy}
          closeOnBackdrop={!s.busy}
          panelClassName="max-w-5xl max-h-[calc(100dvh-2rem)] overflow-hidden"
          contentClassName="flex min-h-0 flex-col p-0"
        >
          <DialogHeader
            title="File sharing links"
            icon={Share2}
            onClose={s.busy ? undefined : s.close}
          />
          <ModalBody className="space-y-4 overflow-y-auto p-5">
            {s.error && (
              <p role="alert" className="text-error text-sm">
                {s.error}
              </p>
            )}
            {s.review ? (
              <ShareReview
                key={
                  s.review.kind +
                  (s.review.kind === "create"
                    ? s.review.path
                    : s.review.link.id)
                }
                mgr={mgr}
              />
            ) : (
              <>
                {s.created && (
                  <label className="block text-sm">
                    Created sharing URL
                    <input
                      className="sor-form-input"
                      readOnly
                      value={s.created.url}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
                <p className="text-xs text-text-muted">
                  Links grant access independently of this app session. URLs are
                  never opened automatically. Revoking a link does not delete
                  its file.
                </p>
                <AdminTable
                  title="Sharing links"
                  rows={s.data?.links ?? []}
                  columns={[
                    ["path", "Path"],
                    ["url", "URL"],
                    ["dateExpired", "Expires"],
                    ["hasPassword", "Password protected"],
                  ]}
                  actions={(row) => (
                    <button
                      className="sor-btn-danger-sm"
                      disabled={s.busy}
                      onClick={() => {
                        const link = s.data?.links.find(
                          (item) => item.id === row.id,
                        );
                        if (link) s.requestRevoke(link);
                      }}
                    >
                      Revoke
                    </button>
                  )}
                />
                <div className="flex justify-end gap-2 text-xs">
                  <button
                    className="sor-btn-secondary-sm"
                    disabled={s.busy || s.page === 0}
                    onClick={() => void s.changePage(s.page - 1)}
                  >
                    Previous link page
                  </button>
                  <span>
                    NAS page {s.page + 1} · {s.data?.total ?? 0} links
                  </span>
                  <button
                    className="sor-btn-secondary-sm"
                    disabled={
                      s.busy || !s.data || (s.page + 1) * 50 >= s.data.total
                    }
                    onClick={() => void s.changePage(s.page + 1)}
                  >
                    Next link page
                  </button>
                </div>
              </>
            )}
          </ModalBody>
          {!s.review && (
            <ModalFooter>
              <button
                className="sor-btn sor-btn-secondary"
                disabled={s.busy}
                onClick={() => void s.refresh()}
              >
                Refresh links
              </button>
            </ModalFooter>
          )}
        </Modal>
      )}
    </>
  );
}
