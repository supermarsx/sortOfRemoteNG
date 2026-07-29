---
title: Cloud & Lights-Out Connections
eyebrow: Use the app
description: Configure the twelve cloud and BMC management panels, understand their credential boundaries, and recover safely from failed sessions.
permalink: /cloud-and-lights-out/
---

## Picker and session model

The connection picker exposes four **Lights-Out & BMC** protocols and eight
**Cloud Platforms** protocols. Opening one resolves a dedicated runtime
descriptor and mounts its management panel through `SessionViewer`.

These are management sessions. They do not provide a shell, framebuffer, or
generic remote desktop merely because the panel opens.

| Picker protocol | Required saved fields | Optional non-secret context | What connect proves |
| --- | --- | --- | --- |
| Dell iDRAC | Host, username, password | Insecure TLS choice, timeout, forced Redfish/WS-Man/IPMI protocol | The native device connect path must succeed; capabilities still depend on live hardware and firmware. |
| HPE iLO | Host, username, password | Auth mode, iLO generation, timeout, Redfish/RIBCL/IPMI choice and IPMI port | The native device connect path must succeed; capabilities still depend on live hardware and firmware. |
| Lenovo XClarity | Host, username, password | XCC/IMM generation, timeout, Redfish/legacy REST/IPMI choice and IPMI port | The native device connect path must succeed; capabilities still depend on live hardware and firmware. |
| Supermicro BMC | Host, username, password | Platform, TLS verification, auth mode and timeout | The native device connect path must succeed; capabilities still depend on live hardware and firmware. |
| Google Cloud | Project ID and service-account JSON credential | Region, zone, OAuth scopes and endpoint override | Local service-account parsing and client/session initialization. It does not prove a provider API request. |
| Microsoft Azure | Tenant ID, client ID, subscription ID and client secret | Default resource group and region | An Azure token request is attempted. Inventory and resource permissions require later live calls. |
| DigitalOcean | API token | Region | Local backend session creation only. |
| IBM Cloud | API key | Region and resource group | Local backend session creation only. |
| Heroku | API key | App name and region | Local backend session creation only. |
| Scaleway | API key | Organization ID, project name and region | Local backend session creation only. |
| Linode | API key | Region | Local backend session creation only. |
| OVHcloud | Application/API key, application secret and consumer key | Service ID, project name and region | Local backend session creation after validating the three-part credential bundle. |

<div class="callout">
  <strong>Connected is not universal proof of provider authentication.</strong>
  <p>For Google Cloud, DigitalOcean, IBM Cloud, Heroku, Scaleway, Linode, and OVHcloud, local session creation does not prove live authentication, authorization, account access, or inventory. Confirm those with a real provider operation.</p>
</div>

## Saved settings and protected secrets

The saved `Connection.password` field is the protected credential boundary for
these protocols. At-rest protection follows the active connection database and
vault configuration.

- GCP stores service-account JSON in the protected credential.
- Azure stores the client secret there.
- DigitalOcean, IBM Cloud, Heroku, Scaleway, and Linode store their API token or
  key there.
- OVHcloud stores a JSON credential bundle containing `apiKey`, `appSecret`,
  and `consumerKey` there.
- Provider-specific settings contain non-secret project, region, organization,
  resource-group, service, scope, or endpoint context only.
- Frontend runtime handles contain only backend session identifiers.
- Public cloud status DTOs and Lights-Out safe-config DTOs omit credentials.

Connection exports remain sensitive whenever the export workflow includes
credentials. Do not paste connection JSON, provider config, screenshots, or
diagnostics containing credential material into an issue.

## Legacy cloud records

Older saved records may contain a `cloudProvider` object. The editor and runtime
normalizer read that deprecated shape and map it into the canonical
provider-specific settings plus the protected credential:

| Legacy field | Canonical destination |
| --- | --- |
| GCP `projectId`, `region`, `zone` | `gcpSettings` |
| GCP `serviceAccountKey` | protected credential |
| Azure tenant, client, subscription, resource-group and region fields | `azureSettings` |
| Azure `clientSecret` | protected credential |
| Provider `apiKey` or `accessToken` | protected credential |
| Provider region, app, organization, project, resource-group or service context | the matching provider settings object |
| OVHcloud `apiKey`, `appSecret`, `consumerKey` | protected credential bundle |

Canonical values win when both forms exist. Invalid non-string legacy values
are dropped rather than coerced. The next explicit save or autosave removes the
deprecated object. Reopening that record uses only the canonical fields.

An OVHcloud raw value that is not valid JSON stays masked. Enter all three
credentials to replace it. A partial bundle remains invalid and is rejected
before native invocation.

## Concurrency and teardown

- Each Lights-Out provider has one runtime lease. A second tab for the same
  provider is rejected until teardown finishes; different hardware providers
  can coexist.
- Azure is process-wide and permits one active lease.
- The other seven cloud providers use per-session leases and can run in
  parallel.
- Closing or unmounting a panel joins an in-flight connect before disconnect
  and coalesces duplicate teardown requests.
- A connect or disconnect rejection still releases the frontend lease in a
  `finally` path so the connection can be reopened.
- Native iDRAC, iLO, and Lenovo teardown removes their client/config state.
  Supermicro logs out its protocol clients and replaces its credential-bearing
  client with an empty default client.

## Failure, rollback, and recovery

1. Correct validation errors in the editor before retrying. Missing required
   identifiers or credentials never reach native invocation.
2. If connect fails, close the panel and reopen it after correcting network,
   TLS, endpoint, or credential settings.
3. If disconnect reports an error, the local lease is still released. Restart
   the app before retrying if backend state is uncertain.
4. A full application restart clears in-memory session state. Reopening creates
   a new session; it does not reattach an old provider or BMC session.
5. Revoke or rotate a provider token if a failed remote logout could have left
   a provider-side session active.
6. Keep a rollback copy of the connection database before bulk migration, but
   treat that backup as sensitive because it may contain protected credentials.

The app does not currently reconcile arbitrary pre-existing backend sessions
after a process restart. It also cannot prove inventory permissions without a
live provider operation or prove device capability without real supported BMC
hardware.

## Developer contract

The primary implementation and regression seams are:

- `src/types/connection/connection.ts`
- `src/utils/connection/cloudConnectionContract.ts`
- `src/utils/session/builtInCloudRuntimeRegistry.ts`
- `src/utils/session/builtInManagementRuntimeRegistry.ts`
- `src/utils/session/cloudRuntimeAdapters.ts`
- `src/utils/session/bmcRuntimeAdapters.ts`
- `src/components/connectionEditor/CloudProviderOptions.tsx`
- `tests/cloud/cloudEditorRuntimeContract.test.tsx`
- `tests/cloud/cloudRuntimeRecovery.test.ts`
- `tests/cloud/builtInCloudRuntimeRegistry.test.ts`
- `tests/hardware/BmcSessionPanel.test.tsx`
- the `t57_secret_hardening_tests` modules in the four native service crates

Source-level registration and focused tests are not substitutes for live
provider/device validation. Release evidence must state which real providers,
accounts, BMC generations, transports, and firmware versions were exercised.
