// Infrastructure-category integration descriptors (t42 Wave 1/2).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { lxdDescriptor } from "../../components/integrations/lxd/LxdPanel";

export const infraIntegrations: IntegrationDescriptor[] = [lxdDescriptor];
