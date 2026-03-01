import { Connection } from "../../../types/connection";

export interface ConnectionDiagnosticsProps {
  connection: Connection;
  onClose: () => void;
}
