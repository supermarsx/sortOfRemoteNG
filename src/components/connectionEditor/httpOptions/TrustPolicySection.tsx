import { Mgr } from "./types";
import NicknameEditButton from "./NicknameEditButton";
import React from "react";
import { Lock, Trash2 } from "lucide-react";
import { Select } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";
import { getAllTrustRecords, formatFingerprint, removeIdentity } from "../../../utils/auth/trustStore";
import type { TrustPolicy } from "../../../utils/auth/trustStore";

const TrustPolicySection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.isHttps) return null;
  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
        HTTPS Certificate Trust Policy <InfoTooltip text="Controls how HTTPS certificate fingerprints are remembered and verified across connections to this host." />
      </label>
      <Select value={mgr.formData.httpsTrustPolicy ?? mgr.formData.tlsTrustPolicy ?? ""} onChange={(v: string) => mgr.setFormData({
        ...mgr.formData,
        httpsTrustPolicy: v === "" ? undefined : (v as TrustPolicy),
        ...(v === "" ? { tlsTrustPolicy: undefined } : {}),
          })} options={[{ value: "", label: "Use global default" }, { value: "tofu", label: "Trust On First Use (TOFU)" }, { value: "always-ask", label: "Always Ask" }, { value: "always-trust", label: "Always Trust (skip verification)" }, { value: "strict", label: "Strict (reject unless pre-approved)" }]} variant="form" />
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Controls whether certificate fingerprints are memorized and verified
        across connections.
      </p>
      {/* Per-connection stored HTTPS certificates */}
      {mgr.formData.id &&
        (() => {
          const records = getAllTrustRecords(mgr.formData.id).filter(
            (record) => record.type === "https",
          );
          if (records.length === 0) return null;
          return (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <label className="sor-form-label-icon">
                  <Lock size={14} className="text-success" />
                  Stored HTTPS Certificates ({records.length})
                </label>
                <button
                  type="button"
                  onClick={() => {
                    records.forEach((record) => {
                      const [host, portStr] = record.host.split(":");
                      removeIdentity(
                        host,
                        parseInt(portStr, 10),
                        record.type,
                        mgr.formData.id,
                      );
                    });
                    mgr.setFormData({ ...mgr.formData }); // force re-render
                  }}
                  className="text-xs text-[var(--color-textMuted)] hover:text-error transition-colors"
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
                        className="text-[var(--color-textMuted)] hover:text-error p-0.5 transition-colors flex-shrink-0"
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
