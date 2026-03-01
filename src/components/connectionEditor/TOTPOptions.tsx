import React from "react";
import { Shield, ChevronDown, ChevronUp } from "lucide-react";
import { TotpImportDialog } from "../security/TotpImportDialog";
import { useTOTPOptions } from "../../hooks/security/useTOTPOptions";
import Toolbar from "./totpOptions/Toolbar";
import CopyFromPanel from "./totpOptions/CopyFromPanel";
import ReplicateToPanel from "./totpOptions/ReplicateToPanel";
import ImportPanel from "./totpOptions/ImportPanel";
import QRDisplay from "./totpOptions/QRDisplay";
import ConfigEditRow from "./totpOptions/ConfigEditRow";
import ConfigRow from "./totpOptions/ConfigRow";
import ConfigList from "./totpOptions/ConfigList";
import AddForm from "./totpOptions/AddForm";

export const TOTPOptions: React.FC<TOTPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useTOTPOptions(formData, setFormData);

  if (formData.isGroup) return null;

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => mgr.setExpanded(!mgr.expanded)}
        className="sor-settings-row"
      >
        <div className="flex items-center space-x-2">
          <Shield size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            2FA / TOTP
          </span>
          {mgr.configs.length > 0 && (
            <span className="sor-micro-badge">
              {mgr.configs.length}
            </span>
          )}
        </div>
        {mgr.expanded ? (
          <ChevronUp
            size={14}
            className="text-[var(--color-textSecondary)]"
          />
        ) : (
          <ChevronDown
            size={14}
            className="text-[var(--color-textSecondary)]"
          />
        )}
      </button>

      {mgr.expanded && (
        <div className="px-4 py-3 space-y-3 border-t border-[var(--color-border)]">
          <Toolbar mgr={mgr} />
          <CopyFromPanel mgr={mgr} />
          <ReplicateToPanel mgr={mgr} />
          <ImportPanel mgr={mgr} />
          <QRDisplay mgr={mgr} />
          <ConfigList mgr={mgr} />
          <AddForm mgr={mgr} />
        </div>
      )}

      {mgr.showFileImport && (
        <TotpImportDialog
          onImport={mgr.handleFileImport}
          onClose={() => mgr.setShowFileImport(false)}
          existingSecrets={mgr.configs.map((c) => c.secret)}
        />
      )}
    </div>
  );
};

export default TOTPOptions;
