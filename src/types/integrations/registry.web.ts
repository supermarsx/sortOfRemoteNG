// Web-server-manager-category integration descriptors (t42 Wave 4).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { nginxDescriptor } from "../../components/integrations/NginxPanel";
import { haproxyDescriptor } from "../../components/integrations/HaproxyPanel";
import { caddyDescriptor } from "../../components/integrations/CaddyPanel";
import { traefikDescriptor } from "../../components/integrations/TraefikPanel";
import { phpDescriptor } from "../../components/integrations/php/descriptor";

export const webIntegrations: IntegrationDescriptor[] = [
  nginxDescriptor,
  haproxyDescriptor,
  caddyDescriptor,
  traefikDescriptor,
  phpDescriptor,
];
