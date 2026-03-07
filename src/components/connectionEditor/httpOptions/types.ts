import type { useHTTPOptions } from "../../../hooks/connection/useHTTPOptions";
import type { Connection } from "../../../types/connection/connection";

export type Mgr = ReturnType<typeof useHTTPOptions>;

export interface HTTPOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
