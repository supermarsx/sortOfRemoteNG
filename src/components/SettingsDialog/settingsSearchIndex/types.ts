/**
 * Schema for a single entry in the Settings search index.
 *
 * The index is hand-written (see `.orchestration/plans/t75.md` §5 for why codegen
 * was rejected) but it is **not** free-form: `tests/settings/settingsSearchDrift.test.ts`
 * parses every section component and asserts the index and the rendered controls
 * agree in both directions.
 */
export interface SettingSearchEntry {
  /**
   * The join key. MUST equal a `settingKey` (or raw `data-setting-key`) rendered
   * by a control in this entry's `section`, because `useSettingHighlight` resolves
   * a result to a DOM node with `[data-setting-key="<key>"]`. An entry whose key is
   * not rendered is a dead result: it is findable but navigates nowhere.
   */
  key: string;

  /** English label as shown on the control. */
  label: string;

  /** English one-line description / tooltip text. */
  description: string;

  /** English keywords and synonyms. Lower-cased at match time. */
  tags: string[];

  /** Tab id — must be one of `SETTINGS_TABS[].id`. */
  section: string;

  /** Human-readable tab name. Searched, so `API Server` finds the API tab. */
  sectionLabel: string;

  /**
   * Every selectable value for this control — **both halves** of each
   * `{ value, label }` option pair, so `AES-256-GCM`, `aes256gcm`,
   * `Let's Encrypt (Auto-Renew)` and `letsencrypt` all match.
   *
   * Required by the drift guard for any control with a literal `options` array.
   */
  values?: readonly string[];

  /**
   * Alternate spellings and abbreviations the user may type instead of the label:
   * `wol` ⇄ `wake on lan`, `2fa` ⇄ `totp`.
   */
  synonyms?: readonly string[];

  /** i18n key of the rendered label, when the section renders it via `t()`. */
  labelKey?: string;

  /** i18n key of the rendered description/tooltip, when rendered via `t()`. */
  descriptionKey?: string;
}
