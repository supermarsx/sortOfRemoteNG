import { PasswordInput } from "../../ui/forms/PasswordInput";
import { Mgr } from "./types";
import React from "react";

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

export default BasicAuthFields;
