import React from "react";
import { Plus, Eye, EyeOff } from "lucide-react";
import { Select } from "../../ui/forms";

const AddForm: React.FC<{ mgr: TOTPOptionsMgr }> = ({ mgr }) => {
  if (!mgr.showAddForm) {
    return (
      <button
        type="button"
        onClick={() => mgr.setShowAddForm(true)}
        className="flex items-center space-x-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
      >
        <Plus size={12} />
        <span>Add TOTP configuration</span>
      </button>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] rounded-lg p-3 space-y-2">
      <input
        type="text"
        value={mgr.newAccount}
        onChange={(e) => mgr.setNewAccount(e.target.value)}
        placeholder="Account name (e.g. admin@server)"
        className="sor-form-input-sm w-full"
      />
      <input
        type="text"
        value={mgr.newIssuer}
        onChange={(e) => mgr.setNewIssuer(e.target.value)}
        placeholder="Issuer"
        className="sor-form-input-sm w-full"
      />
      <div className="relative">
        <input
          type={mgr.showNewSecret ? "text" : "password"}
          value={mgr.newSecret}
          onChange={(e) => mgr.setNewSecret(e.target.value)}
          placeholder="Secret key (auto-generated if empty)"
          className="sor-form-input-sm w-full pr-8 font-mono"
        />
        <button
          type="button"
          onClick={() => mgr.setShowNewSecret(!mgr.showNewSecret)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
        >
          {mgr.showNewSecret ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="flex space-x-2">
        <Select value={mgr.newDigits} onChange={(v: string) => mgr.setNewDigits(parseInt(v))} options={[{ value: "6", label: "6 digits" }, { value: "8", label: "8 digits" }]} variant="form-sm" className="" />
        <Select value={mgr.newPeriod} onChange={(v: string) => mgr.setNewPeriod(parseInt(v))} options={[{ value: "15", label: "15s period" }, { value: "30", label: "30s period" }, { value: "60", label: "60s period" }]} variant="form-sm" className="" />
        <Select value={mgr.newAlgorithm} onChange={(v: string) => mgr.setNewAlgorithm(v)} options={[{ value: "sha1", label: "SHA-1" }, { value: "sha256", label: "SHA-256" }, { value: "sha512", label: "SHA-512" }]} variant="form-sm" className="" />
      </div>
      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={() => mgr.setShowAddForm(false)}
          className="px-3 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={mgr.handleAdd}
          className="px-3 py-1 text-xs bg-[var(--color-surfaceHover)] hover:bg-[var(--color-secondary)] text-[var(--color-text)] rounded transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
};

export default AddForm;
