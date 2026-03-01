import { Mgr } from "./types";

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
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
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

export default TlsVerifySection;
