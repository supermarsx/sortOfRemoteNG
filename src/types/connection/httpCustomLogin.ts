/**
 * Where and how the Custom application's own selectors are applied. Saved in
 * `httpApplication.customLogin`; holds no secret and no value to type.
 *
 * Together with the three selectors of `httpAutoLoginSelectors` these options
 * become login steps in the catalog's format (`buildHttpCustomLoginSteps`),
 * which run on the connection's own origin only. Defaults are not stored: an
 * absent field means the top document, a username and a password, no
 * pre-step, and a click on the submit control.
 *
 * These options decide where a saved credential is typed. They are authority,
 * not presentation: an edit must end an open native tab, so neither this
 * field nor `httpApplication` may ever be listed in
 * `src-tauri/src/origin_browser_digest_exclusions.json`.
 */
export interface HttpCustomLoginOptions {
  /** `id` or `name` of a direct child `<iframe>` of the page, on the same
   * origin, that holds the login form. */
  frame?: string;
  /** A device with no username field: only the password is typed. */
  passwordOnly?: true;
  /** CSS selector of one control to click before the fields are filled, in
   * the same document as the form. */
  preStepSelector?: string;
  /** `enter` presses Enter in the password field and needs no submit
   * selector; `spa` clicks the button of a form without a POST action. */
  submission?: "enter" | "spa";
}
