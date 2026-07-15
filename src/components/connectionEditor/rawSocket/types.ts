import type { RawSocketSettingsV1 } from "../../../types/protocols/rawSocket";
import type { RawSocketEditorSectionId } from "./searchMetadata";

export interface RawSocketSectionProps {
  settings: RawSocketSettingsV1;
  disabled: boolean;
  update: (settings: RawSocketSettingsV1) => void;
}

export interface RawSocketOptionsProps {
  value?: unknown;
  onChange: (settings: RawSocketSettingsV1) => void;
  sections?: readonly RawSocketEditorSectionId[];
  networkRoutes?: readonly import("../../../types/protocols/rawSocket").RawSocketNetworkRouteKind[];
  targetHost?: string;
  targetPort?: number;
  disabled?: boolean;
}
