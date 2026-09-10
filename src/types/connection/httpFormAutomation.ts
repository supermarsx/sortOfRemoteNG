/** Optional website form automation. Literal field values may contain secrets. */
export interface HttpFormAutomation {
  version: 1;
  formSelector?: string;
  fillDelayMs: number;
  submitDelayMs: number;
  detectionTimeoutMs: number;
  submit: boolean;
  fields: { selector: string; value: string }[];
}
