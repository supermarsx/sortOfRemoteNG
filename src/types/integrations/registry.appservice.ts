// App-service-category integration descriptors (t42 Wave 3).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { exchangeDescriptor } from "../../components/integrations/exchange/descriptor";
import { prometheusDescriptor } from "../../components/integrations/PrometheusPanel";
import { gdriveDescriptor } from "../../components/integrations/GdrivePanel";

export const appServiceIntegrations: IntegrationDescriptor[] = [
  exchangeDescriptor,
  prometheusDescriptor,
  gdriveDescriptor,
];
