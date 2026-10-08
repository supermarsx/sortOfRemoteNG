import { normalizeImportedProtocol } from "./normalizeImportedProtocol";
import type { ConnectionProtocol } from "../../types/connection/connection";

/** Resolve template protocol aliases before creating a connection; never fall
 * back to RDP without evidence. Kept outside the component's refresh boundary. */
export const resolveTemplateProtocol = (
  protocol: string,
  port?: number,
): ConnectionProtocol =>
  normalizeImportedProtocol({ raw: protocol, port }).protocol;
