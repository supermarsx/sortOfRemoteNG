// App-service-category integration descriptors (t42 Wave 3).
// Downstream executors append their `<x>Descriptor` here. Keep it a flat,
// append-only array — do not reorder existing entries.
import type { IntegrationDescriptor } from "./registry";
import { exchangeDescriptor } from "../../components/integrations/exchange/descriptor";
import { jiraDescriptor } from "../../components/integrations/jira/descriptor";
import { osticketDescriptor } from "../../components/integrations/osticket/descriptor";
import { mailcowDescriptor } from "../../components/integrations/mailcow/descriptor";
import {
  budibaseDescriptor,
  gdriveDescriptor,
  grafanaDescriptor,
  prometheusDescriptor,
} from "../../components/integrations/descriptors";

export const appServiceIntegrations: IntegrationDescriptor[] = [
  exchangeDescriptor,
  prometheusDescriptor,
  gdriveDescriptor,
  grafanaDescriptor,
  budibaseDescriptor,
  jiraDescriptor,
  osticketDescriptor,
  mailcowDescriptor,
];
