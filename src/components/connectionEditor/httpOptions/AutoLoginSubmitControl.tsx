import React, { useContext } from "react";
import SettingsContext from "../../../contexts/SettingsContext";
import { Checkbox } from "../../ui/forms";
import type { Mgr } from "./types";

/** Submission is an explicit saved choice, separate from permission to fill. */
export default function AutoLoginSubmitControl({ mgr }: { mgr: Mgr }) {
  const context = useContext(SettingsContext);
  const manual =
    mgr.formData.browserSession?.manualFormSubmit ??
    context?.settings.webBrowser?.manualFormSubmit ??
    true;
  return (
    <label className="mt-3 flex items-start gap-2 text-sm">
      <Checkbox
        checked={!manual}
        disabled={context?.settingsReady === false}
        onChange={(enabled: boolean) =>
          mgr.setFormData((previous) => ({
            ...previous,
            browserSession: {
              ...previous.browserSession,
              version: 1,
              manualFormSubmit: !enabled,
            },
          }))
        }
        variant="form"
      />
      <span>
        Automatically submit sign-in
        <span className="block text-xs text-[var(--color-textMuted)]">
          Sign in when this connection opens or reconnects, including restored
          tabs. Otherwise, credentials are filled and you submit the form.
          Verification challenges still require your input unless automatic 2FA
          is configured.
        </span>
      </span>
    </label>
  );
}
