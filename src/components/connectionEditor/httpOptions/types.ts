import type { useHTTPOptions } from "../../../hooks/connection/useHTTPOptions";
import type { Connection } from "../../../types/connection/connection";

export type Mgr = ReturnType<typeof useHTTPOptions>;

export type HTTPOptionsSection = "authentication" | "security" | "advanced";

export interface HTTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  sections?: readonly HTTPOptionsSection[];
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
