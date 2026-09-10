import { Mgr } from "./types";
import React from "react";
import { Select } from "../../ui/forms";

const AuthTypeSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="md:col-span-2">
    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
      Authentication Type
    </label>
    <Select
      value={mgr.formData.authType ?? "basic"}
      onChange={(value) => {
        if (value === "basic" || value === "digest" || value === "header")
          mgr.setFormData({
            ...mgr.formData,
            authType: value,
            ...(value === "digest" ? { httpAutoLogin: false } : {}),
          });
      }}
      options={[
        { value: "basic", label: "Basic Authentication" },
        { value: "digest", label: "Digest Authentication" },
        { value: "header", label: "Custom Headers" },
      ]}
      variant="form"
    />
  </div>
);

export default AuthTypeSection;
