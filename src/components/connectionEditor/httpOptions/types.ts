import type { useHTTPOptions } from "../../../hooks/connection/useHTTPOptions";
import type { Connection } from "../../../types/connection/connection";
import type { BrowserSessionRetentionCapabilities } from "../../../types/settings/browserSession";

export type Mgr = ReturnType<typeof useHTTPOptions>;

export type HTTPOptionsSection =
  "application" | "authentication" | "security" | "advanced";

export interface HTTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  sections?: readonly HTTPOptionsSection[];
  retentionCapabilities?: BrowserSessionRetentionCapabilities;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
