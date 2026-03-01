import React from "react";
import { TOTPConfig } from "../../../types/settings";
import { Select } from "../../ui/forms";

const ConfigEditRow: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => (
  <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
    <input
      type="text"
      value={mgr.editData.account ?? ""}
      onChange={(e) =>
        mgr.setEditData((d) => ({ ...d, account: e.target.value }))
      }
      placeholder="Account"
      className="sor-form-input-sm w-full"
    />
    <input
      type="text"
      value={mgr.editData.issuer ?? ""}
      onChange={(e) =>
        mgr.setEditData((d) => ({ ...d, issuer: e.target.value }))
      }
      placeholder="Issuer"
      className="sor-form-input-sm w-full"
    />
    <div className="flex space-x-2">
      <Select value={mgr.editData.digits ?? 6} onChange={(v: string) => mgr.setEditData((d) => ({
            ...d,
            digits: parseInt(v),
          }))} options={[{ value: "6", label: "6 digits" }, { value: "8", label: "8 digits" }]} variant="form-sm" className="" />
      <Select value={mgr.editData.period ?? 30} onChange={(v: string) => mgr.setEditData((d) => ({
            ...d,
            period: parseInt(v),
          }))} options={[{ value: "15", label: "15s period" }, { value: "30", label: "30s period" }, { value: "60", label: "60s period" }]} variant="form-sm" className="" />
      <Select value={mgr.editData.algorithm ?? "sha1"} onChange={(v: string) => mgr.setEditData((d) => ({
            ...d,
            algorithm: v as TOTPConfig["algorithm"],
          }))} options={[{ value: "sha1", label: "SHA-1" }, { value: "sha256", label: "SHA-256" }, { value: "sha512", label: "SHA-512" }]} variant="form-sm" className="" />
    </div>
    <div className="flex justify-end space-x-2">
      <button
        type="button"
        onClick={mgr.cancelEdit}
        className="px-3 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={mgr.saveEdit}
        className="px-3 py-1 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] text-[var(--color-text)] rounded"
      >
        Save
      </button>
    </div>
  </div>
);

export default ConfigEditRow;
