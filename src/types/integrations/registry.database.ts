// Database-category integration descriptors (t42 Wave 2).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { mssqlDescriptor } from "../../components/integrations/MssqlPanel";

export const databaseIntegrations: IntegrationDescriptor[] = [mssqlDescriptor];
