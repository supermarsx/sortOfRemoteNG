// App-service-category integration descriptors (t42 Wave 3).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";

export const appServiceIntegrations: IntegrationDescriptor[] = [];
