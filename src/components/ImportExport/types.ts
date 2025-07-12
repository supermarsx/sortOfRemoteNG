import { Connection } from '../../types/connection';

export interface ImportResult {
  success: boolean;
  imported: number;
  errors: string[];
  connections: Connection[];
}
