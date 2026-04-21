import type { RDPConnectionSettings } from "../../../types/connection/connection";

export interface SectionBaseProps {
  rdp: RDPConnectionSettings;
  updateRdp: <K extends keyof RDPConnectionSettings>(
    section: K,
    patch: Partial<NonNullable<RDPConnectionSettings[K]>>,
  ) => void;
}
