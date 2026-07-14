// Vault-category integration descriptors (t42 Wave 1 — e.g. keepass).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { keepassDescriptor } from "../../components/integrations/descriptors";

export const vaultIntegrations: IntegrationDescriptor[] = [keepassDescriptor];
