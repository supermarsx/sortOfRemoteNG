import React, { useState } from "react";
import { PasswordInput } from "../ui/forms/PasswordInput";
import {
  X,
  AlertTriangle,
  Lock,
  Trash2,
  Pencil,
  Plus,
  GripVertical,
  Star,
  ArrowUp,
  ArrowDown,
  FolderOpen,
} from "lucide-react";
import { Modal, ModalHeader } from "../ui/overlays/Modal";
import { Connection, HttpBookmarkItem } from "../../types/connection";
import {
  getAllTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
} from "../../utils/trustStore";
import { useHTTPOptions } from "../../hooks/connection/useHTTPOptions";
import { Checkbox, Select } from '../ui/forms';

type Mgr = ReturnType<typeof useHTTPOptions>;

interface HTTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const AuthTypeSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="md:col-span-2">
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
      Authentication Type
    </label>
    <Select value={mgr.formData.authType ?? "basic"} onChange={(v: string) => mgr.setFormData({ ...mgr.formData, authType: v as any })} options={[{ value: "basic", label: "Basic Authentication" }, { value: "header", label: "Custom Headers" }]} variant="form" />
  </div>
);

const BasicAuthFields: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.formData.authType !== "basic") return null;
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Basic Auth Username
        </label>
        <input
          type="text"
          value={mgr.formData.basicAuthUsername || ""}
          onChange={(e) =>
            mgr.setFormData({
              ...mgr.formData,
              basicAuthUsername: e.target.value,
            })
          }
          className="sor-form-input"
          placeholder="Username"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Basic Auth Password
        </label>
        <PasswordInput
          value={mgr.formData.basicAuthPassword || ""}
          onChange={(e) =>
            mgr.setFormData({
              ...mgr.formData,
              basicAuthPassword: e.target.value,
            })
          }
          className="sor-form-input"
          placeholder="Password"
        />
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          Realm (Optional)
        </label>
        <input
          type="text"
          value={mgr.formData.basicAuthRealm || ""}
          onChange={(e) =>
            mgr.setFormData({
              ...mgr.formData,
              basicAuthRealm: e.target.value,
            })
          }
          className="sor-form-input"
          placeholder="Authentication realm"
        />
      </div>
    </>
  );
};

const TlsVerifySection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.isHttps) return null;
  return (
    <div className="md:col-span-2">
      <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]">
        <Checkbox checked={mgr.formData.httpVerifySsl ?? true} onChange={(v: boolean) => mgr.setFormData({
              ...mgr.formData,
              httpVerifySsl: v,
            })} variant="form" />
        <span>Verify TLS certificates</span>
      </label>
      {(mgr.formData.httpVerifySsl ?? true) ? (
        <p className="text-xs text-gray-500 mt-1">
          Disable only for self-signed or untrusted certificates.
        </p>
      ) : (
        <div className="flex items-start gap-2 mt-2 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
          <AlertTriangle
            size={16}
            className="text-red-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-red-400">
              SSL verification disabled
            </p>
            <p className="text-xs text-red-300/70 mt-0.5">
              This connection will accept any certificate, including potentially
              malicious ones. Only use this for trusted internal servers with
              self-signed certificates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const TrustPolicySection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.isHttps) return null;
  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Certificate Trust Policy
      </label>
      <Select value={mgr.formData.tlsTrustPolicy ?? ""} onChange={(v: string) => mgr.setFormData({
            ...mgr.formData,
            tlsTrustPolicy:
              v === ""
                ? undefined
                : (v as
                    | "tofu"
                    | "always-ask"
                    | "always-trust"
                    | "strict"),
          })} options={[{ value: "", label: "Use global default" }, { value: "tofu", label: "Trust On First Use (TOFU)" }, { value: "always-ask", label: "Always Ask" }, { value: "always-trust", label: "Always Trust (skip verification)" }, { value: "strict", label: "Strict (reject unless pre-approved)" }]} variant="form" />
      <p className="text-xs text-gray-500 mt-1">
        Controls whether certificate fingerprints are memorized and verified
        across connections.
      </p>
      {/* Per-connection stored TLS certificates */}
      {mgr.formData.id &&
        (() => {
          const records = getAllTrustRecords(mgr.formData.id).filter(
            (r) => r.type === "tls",
          );
          if (records.length === 0) return null;
          return (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-1.5">
                  <Lock size={14} className="text-green-400" />
                  Stored Certificates ({records.length})
                </label>
                <button
                  type="button"
                  onClick={() => {
                    clearAllTrustRecords(mgr.formData.id);
                    mgr.setFormData({ ...mgr.formData }); // force re-render
                  }}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {records.map((record, i) => {
                  const [host, portStr] = record.host.split(":");
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 bg-[var(--color-border)]/50 border border-[var(--color-border)]/50 rounded px-3 py-1.5 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[var(--color-textSecondary)] truncate">
                            {record.nickname || record.host}
                          </p>
                          {record.nickname && (
                            <p className="text-gray-500 truncate">
                              ({record.host})
                            </p>
                          )}
                        </div>
                        <p className="font-mono text-gray-500 truncate">
                          {formatFingerprint(record.identity.fingerprint)}
                        </p>
                      </div>
                      <NicknameEditButton
                        record={record}
                        connectionId={mgr.formData.id}
                        onSaved={() => mgr.setFormData({ ...mgr.formData })}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          removeIdentity(
                            host,
                            parseInt(portStr, 10),
                            record.type,
                            mgr.formData.id,
                          );
                          mgr.setFormData({ ...mgr.formData }); // force re-render
                        }}
                        className="text-gray-500 hover:text-red-400 p-0.5 transition-colors flex-shrink-0"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
    </div>
  );
};

const CustomHeadersSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (mgr.formData.authType !== "header") return null;
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        Custom HTTP Headers
      </label>
      <div className="space-y-2">
        {Object.entries(mgr.formData.httpHeaders || {}).map(([key, value]) => (
          <div key={key} className="flex items-center space-x-2">
            <input
              type="text"
              value={key}
              readOnly
              className="flex-1 px-3 py-2 bg-gray-600 border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
            />
            <input
              type="text"
              value={value}
              onChange={(e) =>
                mgr.setFormData({
                  ...mgr.formData,
                  httpHeaders: {
                    ...(mgr.formData.httpHeaders || {}),
                    [key]: e.target.value,
                  },
                })
              }
              className="sor-form-input flex-1"
            />
            <button
              type="button"
              onClick={() => mgr.removeHttpHeader(key)}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-[var(--color-text)] rounded-md transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => mgr.setShowAddHeader(true)}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
        >
          Add Header
        </button>
      </div>
    </div>
  );
};

const BookmarksSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="md:col-span-2">
    <div className="flex items-center justify-between mb-2">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-1.5">
        <Star size={14} className="text-yellow-400" />
        Bookmarks ({(mgr.formData.httpBookmarks || []).length})
      </label>
      <button
        type="button"
        onClick={mgr.openAddBookmark}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
      >
        <Plus size={12} /> Add bookmark
      </button>
    </div>
    {(mgr.formData.httpBookmarks || []).length === 0 ? (
      <p className="text-xs text-gray-500 italic">
        No bookmarks yet. Add quick-access paths for this connection.
      </p>
    ) : (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {(mgr.formData.httpBookmarks || []).map((bm, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 bg-[var(--color-border)]/50 border border-[var(--color-border)]/50 rounded px-3 py-1.5 text-xs group"
          >
            {bm.isFolder ? (
              <FolderOpen
                size={12}
                className="text-blue-400/70 flex-shrink-0"
              />
            ) : (
              <Star
                size={12}
                className="text-yellow-400/70 flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-gray-200 truncate">{bm.name}</p>
              {bm.isFolder ? (
                <p className="text-gray-500 font-mono truncate">
                  {bm.children.length} items
                </p>
              ) : (
                <p className="text-gray-500 font-mono truncate">{bm.path}</p>
              )}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {idx > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const bookmarks = [
                      ...(mgr.formData.httpBookmarks || []),
                    ];
                    [bookmarks[idx - 1], bookmarks[idx]] = [
                      bookmarks[idx],
                      bookmarks[idx - 1],
                    ];
                    mgr.setFormData({
                      ...mgr.formData,
                      httpBookmarks: bookmarks,
                    });
                  }}
                  className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5 transition-colors"
                  title="Move up"
                >
                  <ArrowUp size={12} />
                </button>
              )}
              {idx < (mgr.formData.httpBookmarks || []).length - 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const bookmarks = [
                      ...(mgr.formData.httpBookmarks || []),
                    ];
                    [bookmarks[idx], bookmarks[idx + 1]] = [
                      bookmarks[idx + 1],
                      bookmarks[idx],
                    ];
                    mgr.setFormData({
                      ...mgr.formData,
                      httpBookmarks: bookmarks,
                    });
                  }}
                  className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5 transition-colors"
                  title="Move down"
                >
                  <ArrowDown size={12} />
                </button>
              )}
              {!bm.isFolder && (
                <button
                  type="button"
                  onClick={() => mgr.openEditBookmark(idx, bm.name, bm.path)}
                  className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5 transition-colors"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const bookmarks = (mgr.formData.httpBookmarks || []).filter(
                    (_, i) => i !== idx,
                  );
                  mgr.setFormData({
                    ...mgr.formData,
                    httpBookmarks: bookmarks,
                  });
                }}
                className="text-gray-500 hover:text-red-400 p-0.5 transition-colors"
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const BookmarkModal: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.showAddBookmark) return null;
  return (
    <Modal
      isOpen={mgr.showAddBookmark}
      onClose={() => mgr.setShowAddBookmark(false)}
      panelClassName="max-w-md mx-4"
      dataTestId="http-options-bookmark-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={() => mgr.setShowAddBookmark(false)}
          className="relative h-12 border-b border-[var(--color-border)]"
          titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
          title={
            mgr.editingBookmarkIdx !== null ? "Edit Bookmark" : "Add Bookmark"
          }
        />
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Name
            </label>
            <input
              ref={mgr.bookmarkNameRef}
              type="text"
              value={mgr.bookmarkName}
              onChange={(e) => mgr.setBookmarkName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleSaveBookmark();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. Status Page"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Path
            </label>
            <input
              type="text"
              value={mgr.bookmarkPath}
              onChange={(e) => mgr.setBookmarkPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleSaveBookmark();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. /status-log.asp"
            />
            <p className="text-xs text-gray-500 mt-1">
              Relative path starting with /. Will be appended to the connection
              URL.
            </p>
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => mgr.setShowAddBookmark(false)}
              className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={mgr.handleSaveBookmark}
              className="px-4 py-2 text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              {mgr.editingBookmarkIdx !== null ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const HeaderModal: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.showAddHeader) return null;
  return (
    <Modal
      isOpen={mgr.showAddHeader}
      onClose={() => mgr.setShowAddHeader(false)}
      panelClassName="max-w-md mx-4"
      dataTestId="http-options-header-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={() => mgr.setShowAddHeader(false)}
          className="relative h-12 border-b border-[var(--color-border)]"
          titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
          title="Add HTTP Header"
        />
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Header Name
            </label>
            <input
              ref={mgr.headerNameRef}
              type="text"
              value={mgr.headerName}
              onChange={(e) => mgr.setHeaderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleAddHeader();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. Authorization"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
              Header Value
            </label>
            <input
              type="text"
              value={mgr.headerValue}
              onChange={(e) => mgr.setHeaderValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  mgr.handleAddHeader();
                }
              }}
              className="sor-form-input"
              placeholder="e.g. Bearer token123"
            />
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => mgr.setShowAddHeader(false)}
              className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={mgr.handleAddHeader}
              className="px-4 py-2 text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ------------------------------------------------------------------ */
/*  Root component                                                     */
/* ------------------------------------------------------------------ */

export const HTTPOptions: React.FC<HTTPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useHTTPOptions(formData, setFormData);

  if (formData.isGroup || !mgr.isHttpProtocol) return null;

  return (
    <>
      <AuthTypeSection mgr={mgr} />
      <BasicAuthFields mgr={mgr} />
      <TlsVerifySection mgr={mgr} />
      <TrustPolicySection mgr={mgr} />
      <CustomHeadersSection mgr={mgr} />
      <BookmarksSection mgr={mgr} />
      <BookmarkModal mgr={mgr} />
      <HeaderModal mgr={mgr} />
    </>
  );
};

/** Inline nickname edit button for trust record rows */
function NicknameEditButton({
  record,
  connectionId,
  onSaved,
}: {
  record: TrustRecord;
  connectionId?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.nickname ?? "");
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const [h, p] = record.host.split(":");
            updateTrustRecordNickname(
              h,
              parseInt(p, 10),
              record.type,
              draft.trim(),
              connectionId,
            );
            setEditing(false);
            onSaved();
          } else if (e.key === "Escape") {
            setDraft(record.nickname ?? "");
            setEditing(false);
          }
        }}
        onBlur={() => {
          const [h, p] = record.host.split(":");
          updateTrustRecordNickname(
            h,
            parseInt(p, 10),
            record.type,
            draft.trim(),
            connectionId,
          );
          setEditing(false);
          onSaved();
        }}
        placeholder="Nickname…"
        className="w-24 px-1.5 py-0.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-gray-200 placeholder-gray-500 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(record.nickname ?? "");
        setEditing(true);
      }}
      className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5 transition-colors flex-shrink-0"
      title={record.nickname ? `Nickname: ${record.nickname}` : "Add nickname"}
    >
      <Pencil size={10} />
    </button>
  );
}

export default HTTPOptions;
