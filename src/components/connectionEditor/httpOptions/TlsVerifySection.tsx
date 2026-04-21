import { Mgr } from "./types";
import React from "react";
import { AlertTriangle } from "lucide-react";
import { Checkbox } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";

const TlsVerifySection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.isHttps) return null;
  return (
    <div className="md:col-span-2">
      <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]">
        <Checkbox checked={mgr.formData.httpVerifySsl ?? true} onChange={(v: boolean) => mgr.setFormData({
              ...mgr.formData,
              httpVerifySsl: v,
            })} variant="form" />
        <span>Verify TLS certificates <InfoTooltip text="When enabled, the server's TLS certificate is validated against trusted Certificate Authorities. Disable only for self-signed certificates." /></span>
      </label>
      {(mgr.formData.httpVerifySsl ?? true) ? (
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Disable only for self-signed or untrusted certificates.
        </p>
      ) : (
        <div className="flex items-start gap-2 mt-2 p-3 bg-error/30 border border-error/50 rounded-lg">
          <AlertTriangle
            size={16}
            className="text-error flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-error">
              SSL verification disabled
            </p>
            <p className="text-xs text-error/70 mt-0.5">
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

export default TlsVerifySection;
