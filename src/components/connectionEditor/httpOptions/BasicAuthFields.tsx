import { PasswordInput } from "../../ui/forms";
import { Mgr } from "./types";
import React from "react";

const BasicAuthFields: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (
    mgr.formData.authType !== undefined &&
    mgr.formData.authType !== "basic" &&
    mgr.formData.authType !== "digest"
  )
    return null;
  const mode = mgr.formData.authType === "digest" ? "Digest" : "Basic";
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">
          {mode} Auth Username
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
          {mode} Auth Password
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

      {mode === "Basic" && (
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
      )}
      {mode === "Digest" && (
        <p className="md:col-span-2 text-xs text-[var(--color-textMuted)]">
          Digest uses the server's advertised realm and challenge. It never
          falls back to Basic or supplies these credentials to a login form. Use
          HTTPS and keep the saved authority unchanged.
        </p>
      )}
    </>
  );
};

export default BasicAuthFields;
