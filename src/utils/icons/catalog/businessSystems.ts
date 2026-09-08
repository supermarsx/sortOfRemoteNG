import {
  ContactRound,
  createLucideIcon,
  UsersRound,
  Webhook,
} from "lucide-react";

import { graphql, hubspot, pipedrive, salesforce, zoho } from "../brand";
import { createRoleIcon } from "../createRoleIcon";
import { defineIcon } from "./types";

const RestInterface = createLucideIcon("RESTInterface", [
  [
    "path",
    {
      d: "M7 3H4v18h3M17 3h3v18h-3M7 9h9m-3-3 3 3-3 3M17 16H8m3-3-3 3 3 3",
      key: "resource-request-response",
    },
  ],
]);

/** Business and API symbols describe saved items; they add no live providers. */
export const BUSINESS_SYSTEM_ICONS = [
  defineIcon("api", "API", "web-applications", Webhook, [
    "api",
    "application programming interface",
    "endpoint",
    "web service",
  ]),
  defineIcon(
    "api-server",
    "API server",
    "web-applications",
    createRoleIcon("APIServer", "server", Webhook),
    [
      "api server",
      "apiserver",
      "application programming interface",
      "web service server",
    ],
  ),
  defineIcon("rest", "REST", "web-applications", RestInterface, [
    "rest",
    "rest api",
    "restful",
    "http resources",
    "request response",
  ]),
  defineIcon("graphql", "GraphQL", "web-applications", graphql, [
    "graphql",
    "graph ql",
    "query language",
    "api",
  ]),
  defineIcon("hr-system", "HR system", "web-applications", UsersRound, [
    "hr system",
    "hrsystem",
    "human resources",
    "personnel",
    "employees",
    "hris",
  ]),
  defineIcon("crm", "CRM", "web-applications", ContactRound, [
    "crm",
    "crm systems",
    "customer relationship management",
    "customers",
    "sales contacts",
  ]),
  defineIcon("salesforce", "Salesforce", "web-applications", salesforce, [
    "salesforce",
    "crm",
    "sales cloud",
    "customer relationship management",
  ]),
  defineIcon("hubspot", "HubSpot", "web-applications", hubspot, [
    "hubspot",
    "hub spot",
    "crm",
    "marketing",
    "customer relationship management",
  ]),
  defineIcon("zoho", "Zoho", "web-applications", zoho, [
    "zoho",
    "zoho crm",
    "customer relationship management",
    "business software",
  ]),
  defineIcon("pipedrive", "Pipedrive", "web-applications", pipedrive, [
    "pipedrive",
    "pipe drive",
    "crm",
    "sales pipeline",
    "customer relationship management",
  ]),
] as const;
