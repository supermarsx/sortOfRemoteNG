import { Connection } from "../../../types/connection/connection";

export interface ConnectionDiagnosticsProps {
  connection: Connection;
  onClose: () => void;
}
