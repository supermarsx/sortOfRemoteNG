// Web-server-manager-category integration descriptors (t42 Wave 4).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { phpDescriptor } from "../../components/integrations/php/descriptor";
import {
  caddyDescriptor,
  haproxyDescriptor,
  nginxDescriptor,
  traefikDescriptor,
} from "../../components/integrations/descriptors";

export const webIntegrations: IntegrationDescriptor[] = [
  nginxDescriptor,
  haproxyDescriptor,
  caddyDescriptor,
  traefikDescriptor,
  phpDescriptor,
];
