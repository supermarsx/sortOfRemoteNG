import { Mgr } from "./types";
import React from "react";
import { Checkbox } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";
import type { HttpAutoLoginSelectors } from "../../../types/connection/connection";

/**
 * t20: per-connection opt-in for proxy-side web auto-login. When
 * enabled, opening this connection auto-submits the credentials the
 * admin already saved on it (Basic Auth or username/password) into the
 * device's login form, via the internal proxy. Default OFF.
 *
 * No new credential field here — auto-login reuses the existing saved
 * secret. The optional advanced fields hold only CSS selectors that
 * override the backend's form-detection heuristic for device UIs it
 * misses; they never carry secrets.
 */
const AutoLoginSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  if (!mgr.isHttpProtocol) return null;

  const enabled = mgr.formData.httpAutoLogin ?? false;

  const updateSelector = (
    key: keyof HttpAutoLoginSelectors,
    value: string,
  ) => {
    const next: HttpAutoLoginSelectors = {
      ...(mgr.formData.httpAutoLoginSelectors || {}),
      [key]: value.trim() === "" ? undefined : value,
    };
    // Drop the whole object when every override is empty so we don't
    // persist an empty selector struct on the connection record.
    const hasAny =
      next.usernameSelector || next.passwordSelector || next.submitSelector;
    mgr.setFormData({
      ...mgr.formData,
      httpAutoLoginSelectors: hasAny ? next : undefined,
    });
  };

  return (
    <div className="md:col-span-2">
      <label className="flex items-center space-x-2 text-sm text-[var(--color-textSecondary)]">
        <Checkbox
          checked={enabled}
          onChange={(v: boolean) =>
            mgr.setFormData({ ...mgr.formData, httpAutoLogin: v })
          }
          variant="form"
        />
        <span>
          Auto-login to this site{" "}
          <InfoTooltip text="When enabled, opening this connection automatically fills and submits this connection's saved credentials into the site's login form, via the internal proxy. The credentials used are the ones saved on this connection (Basic Auth, or the username/password). Off by default." />
        </span>
      </label>
      <p className="text-xs text-[var(--color-textMuted)] mt-1">
        Submits this connection's saved credentials into the device's login
        form on connect. Multi-factor / CAPTCHA prompts are left to you.
      </p>

      {enabled && (
        <div className="mt-3 space-y-3 pl-1">
          <p className="text-xs font-medium text-[var(--color-textSecondary)]">
            Advanced: form field selectors (optional){" "}
            <InfoTooltip text="CSS selectors that override the automatic login-form detection. Leave blank to auto-detect. Set these only if auto-login targets the wrong fields on this device." />
          </p>
          <div>
            <label className="block text-xs text-[var(--color-textMuted)] mb-1">
              Username field selector
            </label>
            <input
              type="text"
              value={mgr.formData.httpAutoLoginSelectors?.usernameSelector || ""}
              onChange={(e) =>
                updateSelector("usernameSelector", e.target.value)
              }
              className="sor-form-input"
              placeholder='e.g. input[name="user"]'
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-textMuted)] mb-1">
              Password field selector
            </label>
            <input
              type="text"
              value={mgr.formData.httpAutoLoginSelectors?.passwordSelector || ""}
              onChange={(e) =>
                updateSelector("passwordSelector", e.target.value)
              }
              className="sor-form-input"
              placeholder='e.g. input[type="password"]'
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-textMuted)] mb-1">
              Submit button selector
            </label>
            <input
              type="text"
              value={mgr.formData.httpAutoLoginSelectors?.submitSelector || ""}
              onChange={(e) => updateSelector("submitSelector", e.target.value)}
              className="sor-form-input"
              placeholder='e.g. button[type="submit"]'
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoLoginSection;
