import { Mgr } from "./types";
import NicknameEditButton from "./NicknameEditButton";

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
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
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
                  className="text-xs text-[var(--color-textMuted)] hover:text-red-400 transition-colors"
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
                            <p className="text-[var(--color-textMuted)] truncate">
                              ({record.host})
                            </p>
                          )}
                        </div>
                        <p className="font-mono text-[var(--color-textMuted)] truncate">
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
                        className="text-[var(--color-textMuted)] hover:text-red-400 p-0.5 transition-colors flex-shrink-0"
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

export default TrustPolicySection;
