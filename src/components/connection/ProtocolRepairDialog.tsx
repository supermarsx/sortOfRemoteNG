import React, { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wrench, EyeOff, ArrowRight } from "lucide-react";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import { ToastContext } from "../../contexts/ToastContext";
import {
  useProtocolRepair,
  PROTOCOL_REPAIR_NOTIFIED_PREFIX,
} from "../../hooks/connection/useProtocolRepair";

export interface ProtocolRepairDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Lists connections that look mis-typed (e.g. RDP on port 443) and lets the
 * user fix the selected rows in one click. Never auto-applies.
 */
export const ProtocolRepairDialog: React.FC<ProtocolRepairDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const toastCtx = useContext(ToastContext);
  const { suggestions, ignoredCount, applyFixes, ignore, resetIgnored } =
    useProtocolRepair();

  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());

  // Reset the selection whenever the dialog is (re)opened.
  useEffect(() => {
    if (isOpen) setUnchecked(new Set());
  }, [isOpen]);

  const selectedIds = useMemo(
    () => suggestions.filter((s) => !unchecked.has(s.id)).map((s) => s.id),
    [suggestions, unchecked],
  );

  const toggle = (id: string) => {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const applied = applyFixes(selectedIds);
    if (applied > 0) {
      toastCtx?.toast.success(
        t("protocolRepair.applied", "Fixed {{count}} connection(s)", {
          count: applied,
        }),
      );
    }
    if (applied === suggestions.length) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      dataTestId="protocol-repair-dialog"
      panelClassName="max-w-3xl"
    >
      <ModalHeader
        title={
          <span className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" />
            {t("protocolRepair.title", "Repair mis-typed connections")}
          </span>
        }
        onClose={onClose}
      />
      <ModalBody className="p-6">
        <p className="text-sm text-[var(--color-textSecondary)] mb-3">
          {t(
            "protocolRepair.description",
            "These connections are typed RDP (or have an unknown protocol) but their port, hostname or name suggests a web server. Nothing changes until you click Fix selected.",
          )}
        </p>

        {suggestions.length === 0 ? (
          <div
            className="text-sm text-[var(--color-textSecondary)] py-6 text-center"
            data-testid="protocol-repair-empty"
          >
            {t(
              "protocolRepair.nothingFound",
              "No suspicious connections found.",
            )}
            {ignoredCount > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={resetIgnored}
                  data-testid="protocol-repair-reset-ignored"
                >
                  {t(
                    "protocolRepair.showIgnored",
                    "Show {{count}} ignored connection(s)",
                    { count: ignoredCount },
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--color-textSecondary)]">
                <tr>
                  <th className="w-6" />
                  <th className="text-left py-1 pr-2">
                    {t("protocolRepair.columns.name", "Name")}
                  </th>
                  <th className="text-left py-1 pr-2">
                    {t("protocolRepair.columns.host", "Host")}
                  </th>
                  <th className="text-left py-1 pr-2">
                    {t("protocolRepair.columns.change", "Change")}
                  </th>
                  <th className="text-left py-1 pr-2">
                    {t("protocolRepair.columns.reason", "Reason")}
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const checked = !unchecked.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      data-testid={`protocol-repair-row-${s.id}`}
                      className="border-t border-[var(--color-border)] align-top"
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          className="sor-settings-checkbox"
                          checked={checked}
                          onChange={() => toggle(s.id)}
                          aria-label={t(
                            "protocolRepair.selectRow",
                            "Fix {{name}}",
                            { name: s.name },
                          )}
                          data-testid={`protocol-repair-check-${s.id}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2 font-medium">{s.name}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs break-all">
                        {s.hostname}
                        {s.port ? `:${s.port}` : ""}
                        {s.patch.hostname !== s.hostname && (
                          <div className="text-[var(--color-textSecondary)]">
                            → {s.patch.hostname}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <span className="font-mono text-xs">
                          {s.currentProtocol}
                          {s.port ? `:${s.port}` : ""}
                        </span>
                        <ArrowRight className="inline w-3 h-3 mx-1 opacity-70" />
                        <span className="font-mono text-xs text-primary">
                          {s.suggestedProtocol}:{s.patch.port}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-[var(--color-textSecondary)]">
                        {s.reason}
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          title={t("protocolRepair.ignore", "Ignore")}
                          aria-label={t(
                            "protocolRepair.ignoreRow",
                            "Ignore {{name}}",
                            { name: s.name },
                          )}
                          className="p-1 rounded hover:bg-[var(--color-border)]"
                          onClick={() => ignore(s.id)}
                          data-testid={`protocol-repair-ignore-${s.id}`}
                        >
                          <EyeOff className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ModalBody>
      <ModalFooter className="flex justify-end gap-2 px-6 py-4">
        <button
          type="button"
          className="px-3 py-1.5 rounded text-sm bg-[var(--color-border)] hover:bg-[var(--color-borderHover)]"
          onClick={onClose}
          data-testid="protocol-repair-close"
        >
          {t("common.close", "Close")}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded text-sm bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          disabled={selectedIds.length === 0}
          onClick={handleApply}
          data-testid="protocol-repair-apply"
        >
          {t("protocolRepair.apply", "Fix selected ({{count}})", {
            count: selectedIds.length,
          })}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export interface ProtocolRepairNoticeProps {
  /** Current database/collection id; the toast is shown once per id. */
  databaseId?: string | null;
}

/**
 * Renders nothing. Shows a one-time (per database) info toast when suspicious
 * connections exist, pointing the user at Settings → Advanced.
 */
export const ProtocolRepairNotice: React.FC<ProtocolRepairNoticeProps> = ({
  databaseId,
}) => {
  const { t } = useTranslation();
  const toastCtx = useContext(ToastContext);
  const { suggestions } = useProtocolRepair();
  const count = suggestions.length;

  useEffect(() => {
    if (!databaseId || count === 0 || !toastCtx) return;
    const key = `${PROTOCOL_REPAIR_NOTIFIED_PREFIX}${databaseId}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, new Date().toISOString());
    } catch {
      return;
    }
    toastCtx.toast.info(
      t(
        "protocolRepair.notice",
        "{{count}} connection(s) look like web servers but are typed RDP — review in Settings → Advanced → Connection maintenance",
        { count },
      ),
      8000,
    );
  }, [databaseId, count, toastCtx, t]);

  return null;
};

export default ProtocolRepairDialog;
