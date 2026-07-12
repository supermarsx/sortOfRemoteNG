// Mail-category integration descriptors (t42 Wave M — unified Mail Server).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { mailDescriptor } from "../../components/integrations/mail/descriptor";

export const mailIntegrations: IntegrationDescriptor[] = [mailDescriptor];
