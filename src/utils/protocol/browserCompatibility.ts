import type { WebBrowserSettingsConfig } from "../../types/settings/webBrowser";
import type { HttpFormAutomation } from "../../types/connection/httpFormAutomation";
import {
  DEFAULT_HTTP_FORM_AUTOMATION,
  MAX_BROWSER_FORM_COMBINED_DELAY_MS,
} from "../connection/httpFormAutomation";

/** Work on already validated headers. Never mutate the saved connection. */
export function browserIdentityHeaders(
  headers: Record<string, string>,
  preferNativeUserAgent: boolean,
  preferNativeLanguage = false,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        !(preferNativeUserAgent && name.toLowerCase() === "user-agent") &&
        !(preferNativeLanguage && name.toLowerCase() === "accept-language"),
    ),
  );
}

/** A global preference can restrict submission, not override saved consent. */
export function browserFormAutomation(
  form: HttpFormAutomation | undefined,
  manualFormSubmit: boolean,
  minimumFillDelayMs = 0,
  minimumSubmitDelayMs = 0,
): HttpFormAutomation | undefined {
  if (!manualFormSubmit && !minimumFillDelayMs && !minimumSubmitDelayMs)
    return form;
  const base = form ?? DEFAULT_HTTP_FORM_AUTOMATION;
  const fillDelayMs = Math.max(base.fillDelayMs, minimumFillDelayMs);
  const submitDelayMs = Math.max(base.submitDelayMs, minimumSubmitDelayMs);
  const timingChanged =
    fillDelayMs > base.fillDelayMs || submitDelayMs > base.submitDelayMs;
  const totalDelayMs = fillDelayMs + submitDelayMs;
  if (timingChanged && totalDelayMs > MAX_BROWSER_FORM_COMBINED_DELAY_MS)
    throw new Error(
      "Combined browser and connection form delays exceed 52,000 ms. Reduce autofill or submit delays to leave time for form detection.",
    );
  return {
    ...base,
    fillDelayMs,
    submitDelayMs,
    detectionTimeoutMs: timingChanged
      ? Math.max(
          base.detectionTimeoutMs,
          totalDelayMs + DEFAULT_HTTP_FORM_AUTOMATION.detectionTimeoutMs,
        )
      : base.detectionTimeoutMs,
    fields: form?.fields.map((field) => ({ ...field })) ?? [],
    submit: manualFormSubmit ? false : base.submit,
  };
}

export function browserCompatibilityOptions(
  settings: WebBrowserSettingsConfig,
  headers: Record<string, string>,
  form: HttpFormAutomation | undefined,
  hasStagedLogin = false,
) {
  return {
    headers: browserIdentityHeaders(
      headers,
      settings.preferNativeUserAgent,
      settings.preferNativeLanguage,
    ),
    form: browserFormAutomation(
      form,
      settings.manualFormSubmit,
      // Reviewed staged adapters own their timing; native validation rejects
      // generic overrides. Never change their contract through global defaults.
      hasStagedLogin ? 0 : settings.minimumFormFillDelayMs,
      hasStagedLogin ? 0 : settings.minimumFormSubmitDelayMs,
    ),
  };
}
