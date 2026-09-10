---
title: Connection icon brand sources
eyebrow: For developers
description: Source provenance and rendering conventions for the connection icon catalog.
permalink: /connection-icon-brands/
---

The picker stores stable catalog keys, not SVG payloads. All icons render locally
on the same 24×24 grid and inherit the connection color. No image CDN, web font,
runtime Simple Icons import, or new dependency is used. A server/database/NAS/AP/
switch/cloud variant combines its mark with the app's corresponding role frame;
these composites are app UI symbols, not official alternate brand logos.

## Installed Simple Icons

`src/utils/icons/brand/brandIconSlugs.ts` is the source of truth for the installed paths
vendored from the installed `simple-icons` 16.28.0 package. Regenerate with
`npm run icons:brand:generate`; validate with `npm run icons:brand:check`.
Never hand-edit `generatedBrandIcons.ts`. The generator reads only requested
single-path SVGs and fails if a requested source is missing or incompatible.

The expansion adds Alibaba Cloud, DigitalOcean, Envoy Proxy, Git, GitHub, Google,
Hetzner, NetApp, OVH, and Red Hat; other requested brands reuse already-vendored
paths. Exact publisher source/guideline links are retained in the installed
`simple-icons/data/simple-icons.json`. Simple Icons distributes its collection
under [CC0-1.0](https://github.com/simple-icons/simple-icons/blob/16.28.0/LICENSE.md),
but that does not waive third-party trademark rights or individual asset terms.
See its [disclaimer](https://github.com/simple-icons/simple-icons/blob/16.28.0/DISCLAIMER.md).

QEMU uses the unchanged single-path mark from Simple Icons 16.28.0, whose source
metadata points to the [QEMU project logo page](https://wiki.qemu.org/Logo).
The [project website](https://www.qemu.org/) identifies QEMU as a machine emulator
and virtualizer. The logo page was access-protected during this addition; this
is a pinned collection asset, not a newly downloaded publisher SVG. Its geometry
is preserved and only its fill follows the selected icon color. The separate
`virtual-machine` and `cryptography` symbols are app-authored generic vectors;
they do not imply a particular hypervisor, cryptocurrency, or encryption mode.

In particular, the [Git logo](https://git-scm.com/community/logos) is by Jason Long
and licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Here its
geometry is preserved, its fill inherits the UI color, and its server variant
adds an app-authored role frame.

### OS, build-server, and IoT additions

The additional installed marks cover Fedora, Debian, Rocky Linux, AlmaLinux,
openSUSE, Epson, Fujitsu, Huawei, Lenovo, LG, Razer, Samsung, Ubiquiti, Acer, MSI,
Toshiba, Juniper Networks, Fortinet, QNAP, Snort, WireGuard, Joomla, WordPress,
Arduino, Raspberry Pi, Espressif, Schneider Electric, Shelly, Jenkins, GitHub
Actions, TeamCity, CircleCI, Travis CI, Buildkite, Home Assistant, ESPHome, and
Tasmota. Already-vendored Apple, Android, ASUS, HP, Kyocera, Cisco, GitLab,
OpenVPN, OPNsense, pfSense, FreeBSD, Apache, phpMyAdmin, and Dovecot are reused.

The build-server set is curated, not a claim to include every CI vendor. It
includes Jenkins, GitHub Actions, GitLab CI, TeamCity, CircleCI, Travis CI,
Buildkite, Azure DevOps, and the existing Drone CI, with separate server/runner
variants. Generic reverse-proxy, DNS, time, RMM, mail, directory, LLM, and agent
service icons use distinct local geometry rather than brand claims.

Individual license/attribution records take precedence over the collection's
CC0 label. Relevant newly added explicit license records are:

| Mark        | Artwork attribution and terms                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jenkins     | Artwork attributed to the [Jenkins project](https://jenkins.io/). The [official artwork page](https://www.jenkins.io/artwork/) credits the original logo to Frontside, with Charles Lowell championing its design. Licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The vendored silhouette uses monochrome fill; the server image adds a local role frame. These artwork adaptations remain under CC BY-SA 3.0. |
| Debian      | Debian Open Use Logo, © 1999 Software in the Public Interest, Inc.; created by Raul Silva. The [publisher](https://www.debian.org/logos/) offers LGPLv3-or-later or CC BY-SA 3.0; the vendored asset follows the [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) option recorded upstream. Monochrome silhouette adaptation retains these artwork terms.                                                                  |
| Rocky Linux | Artwork from [Rocky Linux's official branding repository](https://github.com/rocky-linux/branding), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The package pins [this source icon](https://github.com/rocky-linux/branding/blob/94e97dd30b87d909cc4f6a6838a2926f77f9ac47/logo/src/icon-black.svg); monochrome rendering retains the artwork license.                                                       |
| Fedora      | Installed metadata specifies a **custom** license linked to the [Fedora brand guide](https://docs.fedoraproject.org/en-US/project/brand/), not CC0-only. [Fedora trademark guidance](https://fedoraproject.org/wiki/Legal:Trademark_guidelines) also applies.                                                                                                                                                                             |

Other newly added CI/IoT marks have no separate `license` field in the installed
metadata; that is not a finding that their trademarks or publisher artwork are
unrestricted. Publisher references include [Jenkins art](https://get.jenkins.io/art/),
[GitHub Actions](https://github.com/features/actions), [GitLab press kit](https://about.gitlab.com/press/press-kit/),
[JetBrains logos](https://www.jetbrains.com/company/brand/logos), [CircleCI press](https://circleci.com/press),
[Travis CI](https://travis-ci.com/logo), [Buildkite assets](https://buildkite.com/brand-assets),
[Arduino trademark rules](https://www.arduino.cc/en/trademark), [Raspberry Pi trademark rules](https://www.raspberrypi.org/trademark-rules),
[Espressif](https://www.espressif.com), [Shelly](https://shelly.com),
[Home Assistant design guidance](https://design.home-assistant.io/#brand/logo),
[ESPHome source SVG](https://github.com/esphome/developers.esphome.io/blob/7c0304aa36536c63c93b1f19ba18969f96df0e08/docs/images/logo.svg),
[Tasmota source SVG](https://github.com/tasmota/docs/blob/f9ad71612681d85f3b21406c7defa86b3eaa6bb9/docs/images/symbol.svg),
and [Schneider Electric's source SVG](https://www.se.com/us/en/assets/739/media/202250/SE_logo-LIO-white_header.svg).

### Business, remote, platform, and registrar additions

The next bounded set adds 43 installed paths. It is a curated collection, not
a claim to cover every ERP, analytics, chat, CMS, CI, registrar, or server vendor.
Already-vendored Redis, Nextcloud, Elasticsearch, Splunk, Bitwarden, Cloudflare,
Microsoft, Apple, Cisco, Citrix, FileZilla, and MikroTik are reused where relevant.

The exact sources below come from the installed 16.28.0 metadata; an absent
individual license field is **not** a claim of unrestricted publisher rights.

| Mark                | Publisher source recorded upstream                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ansible             | [Source](https://www.ansible.com/logos)                                                                                                                             |
| Apache Superset     | [Source](https://apache.org/logos); [guidelines](https://www.apache.org/foundation/marks/)                                                                          |
| Apache Tomcat       | [Source](https://apache.org/logos); [guidelines](https://www.apache.org/foundation/marks)                                                                           |
| Budibase            | [Source](https://github.com/Budibase/budibase/blob/6137ffd9a278ecb3e4dbb42af804c9652741699e/packages/builder/assets/bb-emblem.svg)                                  |
| Caddy               | [Source](https://caddyserver.com)                                                                                                                                   |
| Directus            | [Source](https://directus.io)                                                                                                                                       |
| Docker              | [Source](https://www.docker.com/company/newsroom/media-resources)                                                                                                   |
| Dolibarr            | [Source](https://github.com/Dolibarr/dolibarr-foundation/blob/39f562651f88c4c4a4cd5754c18a7a2cd3dd5e59/logo-cliparts/dolibarr_256x256_color.svg)                    |
| Drupal              | [Source](https://www.drupal.org/about/media-kit/logos)                                                                                                              |
| Element             | [Source](https://element.io)                                                                                                                                        |
| ERPNext             | [Source](https://github.com/frappe/erpnext/blob/924911e74317f95a59f29e9410d4f141020a0411/erpnext/public/images/erpnext-logo.svg)                                    |
| Gandi               | [Source](https://news.gandi.net/en/presskit/)                                                                                                                       |
| Ghost               | [Source](https://github.com/TryGhost/Admin/blob/e3e1fa3353767c3729b1658ad42cc35f883470c5/public/assets/icons/icon.svg); [guidelines](https://ghost.org/docs/logos/) |
| Gitea               | [Source](https://github.com/go-gitea/gitea/blob/e0c753e770a64cda5e3900aa1da3d7e1f3263c9a/assets/logo.svg)                                                           |
| GoDaddy             | [Source](https://aboutus.godaddy.net/newsroom/media-resources/)                                                                                                     |
| Google Drive        | [Source](https://developers.google.com/drive/web/branding)                                                                                                          |
| Intel               | [Source](https://www.intel.com/content/www/us/en/newsroom/resources/press-kits-intel-overview.html)                                                                 |
| Ionos               | [Source](https://www.ionos.de)                                                                                                                                      |
| Jira                | [Source](https://atlassian.design/resources/logo-library); [guidelines](https://atlassian.design/foundations/logos/)                                                |
| Matomo              | [Source](https://matomo.org/media/)                                                                                                                                 |
| Matrix              | [Source](https://matrix.org)                                                                                                                                        |
| Mattermost          | [Source](https://www.mattermost.org/brand-guidelines/)                                                                                                              |
| Metabase            | [Source](https://www.metabase.com)                                                                                                                                  |
| MinIO               | [Source](https://min.io); [guidelines](https://min.io/logo)                                                                                                         |
| n8n                 | [Source](https://n8n.io/press)                                                                                                                                      |
| Namecheap           | [Source](https://www.namecheap.com)                                                                                                                                 |
| Nginx Proxy Manager | [Source](https://github.com/NginxProxyManager/nginx-proxy-manager/blob/2a06384a4aa597777931d38cef49cf89540392e6/docs/.vuepress/public/logo.svg)                     |
| Node-RED            | [Source](https://nodered.org/about/resources/)                                                                                                                      |
| Node.js             | [Source](https://nodejs.org/en/about/branding)                                                                                                                      |
| Odoo                | [Source](https://www.odoo.com/page/brand-assets)                                                                                                                    |
| Payload CMS         | [Source](https://payloadcms.com)                                                                                                                                    |
| PHP                 | [Source](https://php.net/download-logos.php)                                                                                                                        |
| Plausible Analytics | [Source](https://github.com/plausible/docs/blob/be5c935484e075f1e0caf3c9b3351ddd62348139/static/img/logo.svg)                                                       |
| Porkbun             | [Source](https://porkbun.design); [guidelines](https://porkbun.design/guidelines.html)                                                                              |
| Prometheus          | [Source](https://prometheus.io)                                                                                                                                     |
| Puppet              | [Source](https://puppet.com/company/press-room/)                                                                                                                    |
| Redash              | [Source](https://github.com/getredash/website/blob/c454b523fdaa60218845313904c5498cda7e7b7a/static/assets/images/elements/redash-logo.svg)                          |
| Rocket.Chat         | [Source](https://docs.rocket.chat/docs/media-kit); [guidelines](https://docs.rocket.chat/docs/brand-and-visual-guidelines)                                          |
| Rundeck             | [Source](https://github.com/rundeck/docs/blob/a1c98b682eb6e82b60de0daa876133f390630821/docs/.vuepress/public/images/rundeck-logo.svg)                               |
| SAP                 | [Source](https://www.sap.com)                                                                                                                                       |
| Strapi              | [Source](https://handbook.strapi.io/strapi-brand-book-2022/strapi-logo); [guidelines](https://handbook.strapi.io/strapi-brand-book-2022)                            |
| TrueNAS             | [Source](https://www.truenas.com)                                                                                                                                   |
| Zulip               | [Source](https://github.com/zulip/zulip/blob/df9e40491dc77b658d943cff36a816d46e32ce1b/static/images/logo/zulip-org-logo.svg)                                        |

Additional attribution and adaptation notices:

- **PHP:** original logo by Colin Viebrock, released by the [PHP project](https://www.php.net/download-logos.php)
  under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  The extracted monochrome mark and PHP-FPM server-frame image are adaptations;
  these artwork adaptations retain CC BY-SA 4.0.
- **Dolibarr:** artwork from the [Dolibarr Foundation repository](https://github.com/Dolibarr/dolibarr-foundation/blob/39f562651f88c4c4a4cd5754c18a7a2cd3dd5e59/logo-cliparts/dolibarr_256x256_color.svg),
  recorded as [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) in
  the installed metadata. The monochrome silhouette retains that artwork license.
- **Apache Superset and Apache Tomcat:** artwork attributed to the Apache Software
  Foundation and its project communities; upstream records
  [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0). The local render uses
  monochrome fill and, for Tomcat server, a separate app role frame.
  [ASF trademark policy](https://www.apache.org/foundation/marks/) still applies;
  Apache names/logos identify those projects, not this app or an endorsement.
- **Node.js and Node-RED:** consult the [Node.js branding page](https://nodejs.org/en/about/branding)
  and [Node-RED resources](https://nodered.org/about/resources/), including the
  [OpenJS trademark policy](https://trademark-policy.openjsf.org/).
  These are project-identification icons, not certification marks.

### Telecom providers

This bounded batch covers the 18 requested telecom names without claiming every
provider or region. Vodafone reuses its existing installed path; five new
installed paths add Deutsche Telekom, Orange, O2, AT&T, and Movistar. None of these
six metadata entries records an individual artwork license, so the absence of a
field must not be read as unrestricted publisher permission. Exact installed
source references are:

| Mark             | Publisher source recorded upstream                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AT&T             | [Source](https://www.att.com)                                                                                                     |
| Deutsche Telekom | [Source](https://tmap.t-mobile.com/portals/pro74u7a/EXTBrandPortal)                                                               |
| Movistar         | [Source](https://www.movistar.com.co); [guidelines](https://brandfactory.telefonica.com/document/4201#/movistar/mision-y-valores) |
| O2               | [Source](https://www.telefonica.de/presse/fotos/logos.html)                                                                       |
| Orange           | [Source](https://brand.orange.com); [guidelines](https://system.design.orange.com/0c1af118d/p/494474-guidelines)                  |
| Vodafone         | [Source](https://web.vodafone.com.eg)                                                                                             |

T-Mobile uses the historical path below; it is byte-identical to the installed
Deutsche Telekom mark because both sources use the shared T symbol. Seven additional providers use
verified publisher geometry. MEO, UZO, and Hurricane Electric now use the
[named publisher retraces](#named-publisher-retraces); unresolved VIVA remains a neutral identifier. The saved Vodafone catalog key is preserved; telecom device/service variants use
the app's role frames, not fabricated provider product logos.

## Pinned historical paths

`historicalBrandIcons.ts` preserves these upstream path strings verbatim, without
installing an older package. Original SVG SHA-256 hashes are recorded beside each
export; offline tests also verify the rendered path hashes. These are identified
as historical where the product's current branding differs.

| Mark                   | Exact upstream SVG                                                                                                     | Publisher provenance / caveat                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oracle                 | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/oracle.svg)             | [Oracle logo guidelines](https://www.oracle.com/legal/logos/); used for an Oracle Cloud connection, not an affiliation claim.                                                                                                                                                                                                                |
| IBM                    | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/ibm.svg)                | [IBM 8-bar source and guidance](https://www.ibm.com/design/language/ibm-logos/8-bar/).                                                                                                                                                                                                                                                       |
| Linode                 | [Simple Icons 7.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/7.0.0/icons/linode.svg)               | Upstream cites `https://www.linode.com/company/press/`; this is the historical Linode cube, not the current [Akamai identity](https://www.akamai.com/newsroom/media-resources).                                                                                                                                                              |
| Microsoft Office       | [Simple Icons 9.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/9.0.0/icons/microsoftoffice.svg)      | Upstream cites `https://developer.microsoft.com/en-us/microsoft-365`. The `microsoft365` entry explicitly describes this as the historical Office mark, not the current Microsoft 365 logo.                                                                                                                                                  |
| Azure DevOps           | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/azuredevops.svg)        | Exact standalone Azure DevOps path, reused in its separate build-server variant; not an Azure recoloring. Original SVG SHA-256 is stored beside the export, and the rendered path is hash-tested.                                                                                                                                            |
| Java                   | [Simple Icons 5.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/5.0.0/icons/java.svg)                 | Oracle Java cup path preserved verbatim; [publisher logo guidance](https://www.oracle.com/legal/logos/) applies. Not a new Java artwork license.                                                                                                                                                                                             |
| Microsoft SQL Server   | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/microsoftsqlserver.svg) | Exact historical collection path. The collection metadata originally links a Wikimedia-hosted asset; we pin the primary Simple Icons release instead of claiming it was fetched from Microsoft's current brand kit.                                                                                                                          |
| Microsoft Exchange     | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/microsoftexchange.svg)  | Upstream records a custom [Fluent UI assets license](https://aka.ms/fluentui-assets-license) and [Microsoft trademark guidance](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks); not CC0-only. Local server frame is app-authored.                                                                                    |
| Microsoft Dynamics 365 | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/dynamics365.svg)        | Exported as `microsoftdynamics365`, but the upstream filename is **dynamics365.svg**. [Publisher icon terms](https://learn.microsoft.com/en-us/dynamics365/get-started/icons) limit their stated permission to diagrams, training, and documentation; historical collection availability is not a blanket permission for app redistribution. |
| Slack                  | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/slack.svg)              | Historical collection path; [Slack brand guidelines](https://slack.com/brand-guidelines) remain applicable.                                                                                                                                                                                                                                  |
| T-Mobile               | [Simple Icons 11.0.0](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/tmobile.svg)            | Exact historical T-Mobile path, byte-identical to the installed Deutsche Telekom shared T symbol; [publisher brand portal](https://tmap.t-mobile.com/portals/pro74u7a/EXTBrandPortal) is recorded upstream. Source SVG SHA-256 and path digest are verified independently.                                                                   |

The pinned releases' collection licenses are [11.0.0 CC0](https://github.com/simple-icons/simple-icons/blob/11.0.0/LICENSE.md),
[9.0.0 CC0](https://github.com/simple-icons/simple-icons/blob/9.0.0/LICENSE.md), and
[7.0.0 CC0](https://github.com/simple-icons/simple-icons/blob/7.0.0/LICENSE.md), and
[5.0.0 CC0](https://github.com/simple-icons/simple-icons/blob/5.0.0/LICENSE.md).
Their availability is not a grant of trademark permission. Publisher brand-use
guidance still applies, especially for redistribution outside connection-picker
identification; this app does not claim sponsorship or endorsement.

## Publisher-sourced compact marks

The following additions in `handAuthoredBrandIcons.ts` use verified publisher
geometry, with uniform scaling/centering and `currentColor`. These assets are
**not** claimed to be CC0 or newly authored logos.

| Mark          | Exact source                                                                                                                                                                                                                                                                      | Transformation                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft     | [Official symbol SVG](https://learn.microsoft.com/en-us/entra/identity-platform/media/howto-add-branding-in-apps/ms-symbollockup_mssymbol_19.svg), linked from [Microsoft's branding guide](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps) | Four original 9×9 squares at (1,1), (1,11), (11,1), (11,11), converted to one path; 21×21 canvas scaled uniformly to 24×24; monochrome.                   |
| HPE           | [HPE Design's black Element SVG](https://raw.githubusercontent.com/hpe-design/logos/master/HPE%20Element%20-%20SVG/hpe-element-black.svg), [source repository](https://github.com/hpe-design/logos)                                                                               | Exact path; 56×17 source scaled by 24/56 and vertically centered. This is the Element, not the HP logo or full HPE wordmark.                              |
| Tencent Cloud | [Official header SVG](https://staticintl.cloudcachetci.com/yehe/backend-news/VYt5270_qc-topnav-logo.svg), referenced by [Tencent Cloud](https://www.tencentcloud.com/)                                                                                                            | Original final cloud-symbol subpath (starts `M13.267 1.4`) retained; wide lettering omitted; 27×22 symbol canvas scaled by 24/27 and vertically centered. |

The original hand-authored Windows, AWS, Azure, and PowerShell silhouettes are
preserved unchanged; this expansion does not retroactively label them exact
publisher-sourced assets.

### Additional publisher SVGs

`publisherBrandIcons.ts` adds twenty-eight marks from public publisher assets,
without assigning them the Simple Icons collection license. Original SVG
SHA-256 hashes are recorded in source, and offline tests verify the selected
path geometry and normalization. Whitespace may be normalized; fills inherit
the UI color. Local role frames remain app symbols, not approved brand lockups.

| Mark     | Exact source and extraction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Xerox    | [Official site icon](https://www.xerox.com/icon.svg): preserve its white wordmark path, omit the red square backdrop, uniformly fit the wordmark region at (7,74), 180×40, into 24×24.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Avaya    | [Official site SVG sprite](https://www.avaya.com/etc.clientlibs/aem-avaya-portal/clientlibs/clientlib-site/resources/images/svg/symbol-defs.svg): concatenate the five closed paths in `symbol#avaya-logo`, normalize its 112×32 extent uniformly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Canon    | [Official global header SVG](https://global.canon/01cmn/img/common/logo.svg): keep the five red `cls-3` Canon paths, omit gray “Global” lettering. Each path's initial relative `m` becomes absolute `M` when joining paths so letter positions do not change; normalize a 125×26 region.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Wazuh    | [Publisher's logo SVG](https://wazuh.com/brand-assets/Wazuh-Logo.svg): use the original first polygon, the W portion of the wordmark, as a compact identifier. Convert polygon vertices to equivalent closed path commands; fit its 414×298 region uniformly. This is not the full wordmark or a newly invented W.                                                                                                                                                                                                                                                                                                                                                                                                 |
| UGREEN   | [Official storefront logo SVG](https://www.ugreen.com/cdn/shop/files/ugreen_logo-_1.svg?height=22&v=1761026719): preserve all six wordmark paths; uniformly scale the 66.6×11.1 source and center vertically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ASUSTOR  | [Official header logo SVG](https://www.asustor.com/images/ASUSTOR_Logo_SVG_white.svg): retain all seven letter paths **and their original per-path translate transforms** (including -19.032, -40.025, etc.). Remove only source padding/transparent background/clip definitions; uniformly fit the existing 152.855×28 text group. No relative letter positions are redesigned.                                                                                                                                                                                                                                                                                                                                   |
| Vertiv   | [Official timeline logo SVG](https://www.vertiv.com/Content/images/phase3/about/timeline/Vertiv-Logo.svg): retain symbol paths 2, 3, and 4 (zero-based), omit the wordmark; fit symbol bounds x=0…49.8664, y=0.280029…47.2801 uniformly. This source location is documented without claiming a new logo license or that a timeline asset defines current branding.                                                                                                                                                                                                                                                                                                                                                 |
| Riello   | [Official footer logo SVG](https://www.riello-ups.com/assets/footer/logo_footer-c89fff08d3d2458fc46bff65817629b8.svg): retain the ribbon `path1707` from the Riello Elettronica mark, omit lettering. Preserve the path, replacing the containing layer offset with a uniform fit of its measured cubic-curve bounds.                                                                                                                                                                                                                                                                                                                                                                                              |
| PHC      | [Publisher SVG](https://phcsoftware.com/pt/wp-content/uploads/sites/3/2023/11/logo.svg): Retain the final three paths, the PHC lettering from the official Cegid-PHC lockup; omit the Cegid wordmark. Preserve path geometry, use monochrome fill, uniformly fit the PHC region. This is a wordmark portion, not an invented PHC logo.                                                                                                                                                                                                                                                                                                                                                                             |
| Cegid    | [Publisher SVG](https://www.cegid.com/ib/wp-content/uploads/sites/3/2026/08/cegid-logo-blue-rgb.svg): Exact single full-wordmark path; uniformly normalize 1000×408 to 24×24 and center vertically. Cegid Primavera is separately represented by a disclosed PR identifier, not Oracle Primavera.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| NetBox   | [Publisher SVG](https://raw.githubusercontent.com/netbox-community/netbox/7ae8e4461fb77d7a4a91427d5c4d9306abadd079/netbox/project-static/img/netbox_icon.svg): Pinned project source: eight circles and six rectangles are converted to equivalent paths, applying the two original rotated-rectangle transforms. Scale the original 320×320 canvas by 0.075. Fills become monochrome; source's thin outline is omitted. Repository [license](https://github.com/netbox-community/netbox/blob/7ae8e4461fb77d7a4a91427d5c4d9306abadd079/LICENSE.txt) is Apache-2.0; trademark rights are separate.                                                                                                                  |
| TightVNC | [Publisher SVG](https://www.tightvnc.com/logo/tightvnc-logo-new.svg): Preserve all three paths and the first path's evenodd fill rule; scale the 90×90 source uniformly by 24/90. Monochrome adaptation of the publisher mark, without embedding raster content. Publisher [software licensing](https://www.tightvnc.com/licensing.php) is not asserted to grant a separate unrestricted logo license.                                                                                                                                                                                                                                                                                                             |
| UltraVNC | [Publisher SVG](https://raw.githubusercontent.com/ultravnc/UltraVNC/901682ac13cbd5a0c0c50b1144d3f75ad799d53a/vncviewer/res/logo.svg): Pinned publisher **eye-symbol adaptation**, not the full logo: retain original eye curve and iris/pupil circles (radii 130/70), render eye/iris as outlines and pupil filled. Omit gradient, background, decorative ring, highlight and font-dependent lettering. Uniform 22/720 scale with 1px inset accommodates the added 45-source-unit outline without clipping; center stays (12,12). The repository's [GPLv3 license](https://github.com/ultravnc/UltraVNC/blob/901682ac13cbd5a0c0c50b1144d3f75ad799d53a/LICENSE) is recorded without relabeling this artwork as CC0. |
| NOS      | [Publisher source](https://www.nos.pt/content/dam/nos/assets/logos/logo-nos.svg): Keep the full NOS lettering/radial symbol geometry and original **evenodd** fill rule; uniformly fit the 96×52 canvas. Source SVG SHA-256 is recorded beside the export.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| NOWO     | [Publisher source](https://www.nowo.pt/icons/logo-nowo.svg): Select the three orange NOWO letter paths and orange W polygon from the current **DIGI / NOWO** lockup. Convert the polygon to an equivalent closed path, omit the DIGI portion and separator; uniformly fit the NOWO lettering region. This is an extracted wordmark portion, not the full combined logo.                                                                                                                                                                                                                                                                                                                                            |
| DIGI     | [Publisher source](https://www.digi.pt/): Decode the actual navbar image whose alt text identifies the DIGI logo; preserve its single SVG path. The homepage also embeds a menu/hamburger SVG, which is **not** the brand asset. Record the decoded logo SVG hash, not the changing HTML page hash; monochrome fit of the 100×35 mark region.                                                                                                                                                                                                                                                                                                                                                                      |
| Tele2    | [Publisher source](https://www.tele2.com/): Extract the exact inline `symbol#svg-Logotype` path from the official homepage. The recorded source hash is for that symbol, not the changing HTML page. Uniformly fit its 402×151 source canvas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| SFR      | [Publisher source](https://static.s-sfr.fr/assets/logos/SFR.svg): Retain the original white SFR lettering path and omit the red square background; uniformly fit the lettering region. This is the publisher's wordmark geometry, not an app-authored SFR monogram.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Altice   | [Publisher source](https://altice.net/sites/default/files/favicons/safari-pinned-tab.svg): Preserve the complete negative-space pinned-tab favicon and its flipped coordinate system, fitting the original 260×260 canvas. The publisher site explicitly identifies itself as the **archived Altice Europe** website; no claim that this asset defines the current Altice France/International identity or grants a new artwork license.                                                                                                                                                                                                                                                                           |
| Three    | [Publisher source](https://www.three.co.uk/content/dam/threedigital/static-files/components/header/three-logo.svg): Preserve the exact Three UK header symbol path, including the original containing `translate(8,6)`; uniformly scale the 44×44 source canvas. This is the Three mark, not the newer combined VodafoneThree corporate wordmark.                                                                                                                                                                                                                                                                                                                                                                  |

## Identifier compatibility group

The initial group used explicit nonofficial identifiers. Most did not yield a
suitable compact vector source in the installed or checked historical collection
and bounded publisher lookup; VIVA is intentionally neutral because the intended
provider is unconfirmed. These entries are still distinct and usable:
`identifierIcons.ts` draws geometric identifiers with SVG paths, not fonts or
copies of unrelated logos. Later publisher-derived replacements are called out
below; catalog descriptions distinguish those traces from the remaining neutral identifiers.

| Entries                       | App-authored symbol          | Publisher checked                                                                                                                                                                                     |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dlink`                       | DL monogram                  | [D-Link](https://www.dlink.com/); no verified reusable compact vector obtained.                                                                                                                       |
| `levelone`, `levelone-switch` | L1 monogram                  | [LevelOne](https://www.level1.com/level1_en/); the public header is a wide raster wordmark.                                                                                                           |
| `arista`, `arista-switch`     | A with network cross         | [Arista brand information](https://www.arista.com/en/company/company-overview); not a traced Arista wordmark.                                                                                         |
| `freepbx`, `freepbx-server`   | Upstream frog trace          | Replaces the initial FP fallback; see [named publisher retraces](#named-publisher-retraces).                                                                                                          |
| `yealink`, phone variant      | Y with call waves            | [Yealink](https://www.yealink.com/) publishes raster header logos; this is not its official wordmark.                                                                                                 |
| `clevo`, laptop variant       | CV monogram                  | [CLEVO](https://www.clevo.com.tw/); app-authored, not the publisher logo.                                                                                                                             |
| `grandstream`, phone variant  | Publisher G-emblem trace     | Replaces the initial GS fallback; see [named publisher retraces](#named-publisher-retraces).                                                                                                          |
| `freshtomato`                 | Tomato with stem/leaves      | [FreshTomato](https://freshtomato.org/) has raster public branding; this app drawing is not an official project mark.                                                                                 |
| `meshcentral`                 | M with connected nodes       | [MeshCentral](https://meshcentral.com/); project raster artwork was not converted or relabeled as original SVG.                                                                                       |
| `suricata`                    | S/sensor identifier          | [Suricata branding page](https://suricata.io/branding-images/) provides raster marks; this is not the meerkat logo.                                                                                   |
| `zeek`                        | Z with traffic arrows        | [Zeek](https://zeek.org/); app-authored and not a copy of the project's official Z logo.                                                                                                              |
| `postfix`                     | PF with mail-flow arrow      | [Postfix](https://www.postfix.org/); app-authored, not an official mail-server logo.                                                                                                                  |
| `apc`, UPS variant            | AP monogram                  | [APC publisher page](https://www.se.com/ww/en/brands/apc/); distinct from the actual Schneider Electric mark used by its own entries.                                                                 |
| `eaton`, UPS variant          | E with power bolt            | [Eaton](https://www.eaton.com/) supplied raster header branding in the checked page; not an official Eaton logo.                                                                                      |
| `cyberpower`, UPS variant     | CP monogram                  | [CyberPower](https://www.cyberpower.com/); no suitable compact publisher vector obtained in the bounded lookup.                                                                                       |
| `tripplite`, UPS variant      | TL monogram                  | [Tripp Lite by Eaton](https://tripplite.eaton.com/) uses Eaton raster header branding; not presented as a current Tripp Lite logo.                                                                    |
| `sonoff`                      | S/switch identifier          | [SONOFF](https://sonoff.tech/); distinct app-authored identifier, not an official wordmark.                                                                                                           |
| `tuya`                        | T/cloud identifier           | [Tuya](https://www.tuya.com/); distinct app-authored identifier, not an official wordmark.                                                                                                            |
| `primavera`                   | PR/ERP monogram              | [Publisher/project](https://pt.primaverabss.com/pt/); Cegid Primavera ERP is intended; published compact assets found were Cegid-only or raster combined marks. This is not Oracle Primavera.         |
| `bind-server`                 | B/DNS identifier             | [Publisher/project](https://www.isc.org/bind/); App-authored identifier for ISC BIND DNS; no claim to be the ISC or BIND logo.                                                                        |
| `sqlpad`                      | Query-pad identifier         | [Publisher/project](https://github.com/sqlpad/sqlpad); No suitable project vector in the bounded check; not an official SQLPad mark.                                                                  |
| `openssh`                     | Terminal/lock identifier     | [Publisher/project](https://www.openssh.org/); Not the OpenSSH pufferfish artwork; the app draws a terminal and lock.                                                                                 |
| `lxd`                         | LX/container identifier      | [Publisher/project](https://canonical.com/lxd); Not a Canonical or historical Linux Containers project logo.                                                                                          |
| `incus`                       | Container/anvil identifier   | [Publisher/project](https://linuxcontainers.org/incus/); Not an official Incus or Linux Containers logo.                                                                                              |
| `samba`                       | Shared-directory topology    | [Publisher/project](https://www.samba.org/); Not a tracing of the Samba wordmark.                                                                                                                     |
| `openldap`                    | Linked-directory identifier  | [Publisher/project](https://www.openldap.org/); Not the OpenLDAP project logo.                                                                                                                        |
| `keepass`                     | K/key identifier             | [Publisher/project](https://keepass.info/); Not the KeePass application artwork.                                                                                                                      |
| `keepassx`                    | KX identifier                | [Publisher/project](https://www.keepassx.org/); KeePassX is not substituted with the different KeePassXC project's mark.                                                                              |
| `mailcow, mailcow-server`     | Cow/mail identifier          | [Publisher/project](https://mailcow.email/); Not an official Mailcow logo; unrelated SOGo SVGs in the project were deliberately not relabeled.                                                        |
| `osticket`                    | Ticket identifier            | [Publisher/project](https://osticket.com/); Not a tracing of the osTicket mascot.                                                                                                                     |
| `mremoteng`                   | M/remote identifier          | [Publisher/project](https://mremoteng.org/); The official website SVG favicon embeds a PNG, and the checked project tree supplied no SVG paths; that raster wrapper is not vendored.                  |
| `draytek, device variants`    | Publisher wordmark trace     | Full standalone wordmark; compact two-line appliance adaptation. See [named publisher retraces](#named-publisher-retraces).                                                                           |
| `dameware`                    | DW monogram                  | [Publisher/project](https://www.solarwinds.com/dameware); Dameware redirects to its publisher's page with raster SolarWinds branding; this is a distinct product identifier, not that publisher logo. |
| `meo`                         | Publisher three-bar roundel  | Normalized official SVG replaces the initial typed-letter fallback; see [named publisher retraces](#named-publisher-retraces).                                                                        |
| `uzo`                         | Publisher wordmark           | Normalized official SVG replaces the initial typed-letter fallback; see [named publisher retraces](#named-publisher-retraces).                                                                        |
| `hurricane-electric`          | Publisher circled HE trace   | Replaces the initial plain HE fallback; see [named publisher retraces](#named-publisher-retraces).                                                                                                    |
| `viva`                        | Neutral full VIVA identifier | Provider identity remains unconfirmed. No country, network, regional operator or Vivo association is asserted; this is deliberately not advertised as a sourced official VIVA logo.                   |

The remaining neutral identifiers are a disclosed logo-coverage limitation, not
fabricated official marks. This historical group stays outside the `BRAND_ICONS`
registry, including its later publisher-derived replacements. Device/server variants use
the same geometry inside a different role silhouette, so variants are not
merely duplicate bare glyphs with different labels.

The `APP_AUTHORED_IDENTIFIER_ICONS` name is retained for compatibility; it is no
longer a provenance classification. In particular, MEO/UZO are publisher vectors
and the explicitly identified local traces are not arbitrary initials. New custom Lucide nodes carry stable React
keys; a regression renders every brand without filtering unrelated console
errors and asserts no missing-key warnings.

## Protocol and camera source additions

The final source registry has 161 installed marks, 13 pinned historical marks,
28 publisher-file marks and seven preserved/local marks (including the three
publisher geometries described above). These are historical source-inventory
counts, not a current logo-coverage claim; the compatibility group and subsequent
publisher additions/retraces are documented separately below.

Scaleway comes from the installed collection's `scaleway` path, whose publisher
source is [Ultraviolet](https://ultraviolet.scaleway.com). Heroku uses the unchanged
[Simple Icons 11.0.0 path](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/heroku.svg).
The Heroku SVG SHA-256 is
`622d358ec7c6b09d8f8d2273ee226b5613e94c75d026651ee3889e44282627c1`;
its rendered path is checked separately. The historical collection license
does not replace publisher trademark rights or grant new brand-use permission.

| Mark                | Verified publisher source and adaptation                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reolink             | [Current header SVG](https://home-cdn.reolink.us/wp-content/assets/header-svg-white.svg). Preserve the fourth path, the R symbol from the wordmark; omit remaining letters. Uniform fit of the 97.73×108.9 symbol region. SVG SHA-256: `afc0b7b9b14e024cd7e913766eabb3c4f4608b8900837f58e46989e80bbe7350`.                                                                |
| Uniview             | [Publisher UNV SVG](https://www.uniview.com/tres/images/2022/img/logo.svg). Preserve all four paths, uniformly fit the 56.69×34.02 source canvas. SVG SHA-256: `38c090011e4df1d3484d1ea0d97764e6c0684e44e5228f546a369f2d67412d30`.                                                                                                                                        |
| Axis Communications | [Publisher sprite](https://www.axis.com/themes/custom/axiscom/icon-sprite.svg). Preserve all six paths in `symbol#axis-logo`, including lettering and triangle; uniformly fit 200×72. Monochrome rendering removes the source triangle's color contrast. Selected-symbol SHA-256 (not entire sprite): `9139a771d3fede11a9dde3d826155d1cea93af59968a02e8f69ee7b82be150ca`. |

These three publisher marks are not newly licensed as CC0. SVG/path hashes prove
source fidelity, not unrestricted permission to use a vendor trademark.
TP-Link VIGI and Ubiquiti Protect entries use their existing parent-company marks
inside local camera frames; they are not claimed to be distinct product logos.

The following additional exceptions are SVG identifiers drawn by the app,
without tracing raster artwork:

| Entries                      | Identifier and source limitation                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nomachine`                  | NX lettering, not the official NoMachine logo. The checked [publisher](https://www.nomachine.com/) supplied raster header artwork. No external image is embedded; the existing NX protocol receives this disclosed identifier.                                                                                          |
| `x2go`                       | X2/forward identifier. The verified [publisher logo](https://artwork.x2go.org/logos_and_mascot/x2go-logo.svg) credits Heinz-M. Graesing / obviously-nice and explicitly declares **CC BY-ND 3.0**. Its monochrome adaptation is therefore not vendored; the local drawing is independent, not copied from that artwork. |
| `haproxy`                    | HA/routing identifier. The checked [project](https://www.haproxy.org/) supplied a raster header and no installed Simple Icons path was available.                                                                                                                                                                       |
| `hikvision`, device variants | HK identifier. The [publisher homepage](https://www.hikvision.com/en/) references a vector font sprite, but retrieval of that source returned access denied; no unverified paths are claimed as official.                                                                                                               |

Standard SSH, HTTPS, raw TCP, rlogin, FTP, SFTP, SMB, SPICE and XDMCP choices use
meaningful terminal/lock, web/lock, connector, transfer, shared-file or display
geometry, not invented official protocol logos. Existing manual `terminal`,
`monitor`, `folder`, `eye` and all other saved choices remain valid.

## Pure modern Exchange product mark

`microsoftexchangemodern` vendors the exact single path from Microsoft's
[ExchangeLogoIcon.tsx](https://raw.githubusercontent.com/microsoft/fluentui/eefc5128d958e74262de72965b60608953945515/packages/react-icons-mdl2-branded/src/components/ExchangeLogoIcon.tsx), pinned to commit `eefc5128d958e74262de72965b60608953945515`.
It depicts the modern flat E tile and Exchange tiles rather than the older
perspective E used by the historical Simple Icons export. The full publisher
2048×2048 coordinate system is uniformly scaled by 24/2048. No server, computer,
envelope frame, or other app-authored geometry is added to the pure product mark.
The manual server variant can still place it in the app's separate server frame.

The earlier `microsoftexchange` historical export and its source hash remain
unchanged. This lets existing artwork references distinguish the old and modern
designs instead of silently relabeling the old path as current.

Source TSX SHA-256:
`5d913439528e5e4cb51606ceeeed6aeaf8bff5bc1b08bd969238e89fb0c425d4`.
Exact rendered path SHA-256:
`e41f35b84ad0952c541f730ede4970ae894f226ec401e949906590863e04f4fb`.
Offline tests verify this path, uniform scale, absence of a device wrapper, and
distinctness from the historical artwork.

Copyright Microsoft Corporation. The publisher package
[license](https://github.com/microsoft/fluentui/blob/eefc5128d958e74262de72965b60608953945515/packages/react-icons-mdl2-branded/LICENSE)
specifically requires the [Microsoft Fabric Assets License](https://aka.ms/fluentui-assets-license).
These branded assets are **not** covered by a blanket MIT or CC0 assertion.

## CRM, GraphQL, VPN, and database additions

The installed collection supplies GraphQL, HubSpot, Zoho, ZeroTier, Tailscale,
Cockroach Labs, ClickHouse, Apache Cassandra, Apache CouchDB, Neo4j, and InfluxDB.
SQLite reuses its existing vendored path. CockroachDB entries use the publisher's
Cockroach Labs mark, not an invented separate product logo. These are local icon
choices; they do not add database drivers or VPN implementations.

| Mark                         | Publisher source recorded in the installed collection                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL                      | [Brand assets](https://graphql.org/brand)                                                                                                         |
| HubSpot                      | [Style guide](https://www.hubspot.com/style-guide)                                                                                                |
| Zoho                         | [Branding](https://www.zoho.com/branding)                                                                                                         |
| ZeroTier                     | [Publisher](https://www.zerotier.com)                                                                                                             |
| Tailscale                    | [Press resources](https://tailscale.com/press)                                                                                                    |
| SQLite                       | [Pinned publisher artwork](https://github.com/sqlite/sqlite/blob/43e862723ec680542ca6f608f9963c0993dd7324/art/sqlite370.eps)                      |
| Cockroach Labs               | [Publisher](https://www.cockroachlabs.com)                                                                                                        |
| ClickHouse                   | [Pinned publisher SVG](https://github.com/ClickHouse/ClickHouse/blob/12bd453a43819176d25ecf247033f6cb1af54beb/website/images/logo-clickhouse.svg) |
| Apache Cassandra and CouchDB | [Apache logos](https://www.apache.org/logos)                                                                                                      |
| Neo4j                        | [Brand guide](https://neo4j.com/brand/#logo)                                                                                                      |
| InfluxDB                     | [Publisher downloads](https://influxdata.github.io/branding/logo/downloads/)                                                                      |

The installed metadata records Apache-2.0 for the Cassandra and CouchDB artwork;
the [ASF trademark policy](https://www.apache.org/foundation/marks/) still applies.
The other listed metadata entries do not declare an individual artwork license.
That absence, and the collection's CC0 license, do not grant unrestricted
publisher trademark permission.

Salesforce preserves the exact historical
[Simple Icons 11.0.0 SVG path](https://raw.githubusercontent.com/simple-icons/simple-icons/11.0.0/icons/salesforce.svg).
The source is its cloud silhouette without lettering, not newly authored
Salesforce artwork. Source SVG SHA-256:
`9f8adb4f73acb235b2fe1c721f17d915d3559c905d1de9c7b678d76d0687eb08`.
Rendered path SHA-256:
`1d3af188552e86b2e368f97efcbe990d32ae8a2d870d169f9284cd680b18c5c5`.

Four additional assets use verified publisher SVG geometry:

- **Pipedrive:** [Publisher source](https://www.pipedrive.com/). Leading P path from the publisher header wordmark; remaining lettering omitted. Source 18×21 symbol viewport begins at (0,5). Source SVG SHA-256: `b96d5e70979e59117b3fe26f85bcc76e986a048bfed711074e57269a5cefa105`. Rendered path SHA-256: `52cb4efbdae85617054eda2a6d49fe8a65dd6b30de1177db21bf0bc85cb37ca2`.
- **NetBird:** [Publisher source](https://netbird.io/_next/static/media/netbird-icon.167cd80b.svg). All three exact bird paths from the publisher press-kit icon. Uniform 41×30 fit; monochrome removes the original darker wing overlap. Source SVG SHA-256: `0876ddda40f4ddc49f8ed6a0cd6369482af29077f06a648e907043e022151468`. Rendered path SHA-256: `6cb44c0cee99b8d1d6868c5a8c799cd45323ac8f8f4bb18c49acf1faeb69a14e`.
- **Twingate:** [Publisher source](https://www.twingate.com/). Two left-hand symbol subpaths from header SVG#svg712272324_2169. Lettering beginning at M26.8 omitted; original evenodd fill retained. Source SVG SHA-256: `a7169ca049e502cc639bc2b102ee08f1e698a753cfd8976c9e9feda4a50ecd6f`. Rendered path SHA-256: `01c141edfcd80afa53960ec86a97e3b0b0fc44c01d06c881bb42db5ed8c5de08`.
- **Nebula VPN:** [Publisher source](https://nebula.defined.net/img/mark.svg). Final wave/network symbol path from the actual Nebula VPN documentation logo, not the unrelated Nebula streaming brand. Lettering omitted; uniform fit of its 480×256 symbol region. Source SVG SHA-256: `b2f0303ef1d78a7319a431aa8218c1ee2928a090d782fa2221ad9d4e62f31b93`. Rendered path SHA-256: `c3a409d5858acdb3bc364592c06afb5523bf1ea4e6f392cc1d6e73aa727a3404`.

For Pipedrive and Twingate, the source hash identifies the selected inline header
SVG, not the whole HTML page; path bytes and transforms are checked separately.
All four are monochrome adaptations, not newly licensed CC0 artwork.
[NetBird's press guidelines](https://netbird.io/press) specify its original
palette and prohibit color changes; the connection-color adaptation here is
disclosed, not asserted to satisfy those marketing guidelines or grant a broader
license. The verified [Nebula documentation](https://nebula.defined.net/docs/)
identifies the open-source networking project; the unrelated installed
`nebula` streaming-service mark is intentionally not vendored.

**SoftEther** uses a distinct app-authored SE/ethernet SVG identifier. The checked
[project website](https://www.softether.org/) supplies raster logo artwork; no
verified compact vector was obtained in the bounded lookup. The identifier is
not a tracing or official project logo, and remains outside `BRAND_ICONS`.
Its VPN variant adds only the app's existing role frame.

## Product-role semantics

The Microsoft/Apple/Cisco VPN, Hyper-V, RD Gateway and remote-desktop entries
reuse existing vendor marks; role variants combine them with an app-authored frame.
They do not claim to reproduce those products' application icons. Generic KMS,
SQL server, MTA, Active Directory server, wired router and SNMP entries use
service/device geometry rather than vendor branding. The older Active Directory
entry remains intact; its new server variant uses a distinct directory-tree inset.
Saved explicit icon keys remain valid, and manual appliance choices remain
selectable. The Exchange base mark and its server-variant inset now use the pinned
modern product glyph described above. Automatic defaults use pure brand marks or
unframed protocol symbols, without app-authored server/appliance frames, with the same resolver feeding
the editor dropdown, connection tree, Quick Connect, Bulk Connection Editor and
Session Manager. All 37 built-in defaults and 27 registered integration descriptors
are checked; integration icons and persistence-safe default keys agree. Tool,
status, log and aggregate-category icons remain semantic UI controls, not protocol
brands. Service folders and alternative containers add local Lucide geometry
without adding brand sources.

## Hosting, domain, and access-provider additions

Hosting providers and Domains & registrars are separate picker categories.
Existing Porkbun, Namecheap, GoDaddy, Gandi, Cloudflare, and No-IP keys now browse
beside the new DNS/registrar entries; IONOS has hosting as its primary category.
Mixed-service companies carry search aliases for their other services, without
duplicate saved keys. Hetzner, OVHcloud (`ovh`), and Scaleway retain their existing
pure marks and Cloud category. Category placement is not a service endorsement.
The ambiguous request “Level4 communications” is intentionally not mapped to a
different company. No service availability is implied by an icon, including Freenom.

### Pinned package marks

The following ten additions use the installed Simple Icons 16.28.0 paths. Sources
are recorded upstream and were checked for the intended identity; in particular,
Spaceship means the domain registrar, not a similarly named software project.

| Key         | Publisher artwork reference                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostinger` | [Hostinger newsroom](https://www.hostinger.com/newsroom)                                                                                    |
| `netcup`    | [netcup SVG](https://www.netcup.de/static/assets/images/favicons/favicon.svg), [guidelines](https://www.netcup.eu/ueber-netcup/werbemittel) |
| `upcloud`   | [UpCloud brand assets](https://upcloud.com/brand-assets/)                                                                                   |
| `wpengine`  | [WP Engine brand assets](https://wpengine.com/brand-assets)                                                                                 |
| `namesilo`  | [NameSilo publisher source](https://www.namesilo.com/support/v2)                                                                            |
| `wix`       | [Wix design assets](https://www.wix.com/about/design-assets)                                                                                |
| `spaceship` | [Spaceship registrar](https://www.spaceship.com)                                                                                            |
| `contabo`   | [Contabo](https://contabo.com)                                                                                                              |
| `vultr`     | [Vultr brand assets](https://www.vultr.com/company/brand-assets)                                                                            |
| `exoscale`  | [Exoscale press](https://www.exoscale.com/press/)                                                                                           |

### Publisher and historical geometry

The local `hostingPublisherBrandIcons.ts`, `hostingHistoricalBrandIcons.ts`,
`telecomPublisherBrandIcons.ts`, and `providerResourceIcons.ts` record SHA-256
checksums of their source SVGs. Only local passive vector geometry ships; no
source URL is fetched at runtime. Uniform scaling and monochrome fills are UI
adaptations, not newly endorsed logos. Publisher trademark/artwork rights remain
applicable even when a collection is freely licensed.

| Key            | Exact source and adaptation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dominios-pt`  | [Publisher SVG](https://www.dominios.pt/wp-content/uploads/2026/03/logo-dominios-white-byteamblue.svg). Only the leading lowercase d path beginning `M23.11,2.65` is extracted; the separate period and remaining wordmark are excluded.                                                                                                                                                                                                                                                                              |
| `rackspace`    | [Publisher SVG](https://www.rackspace.com/themes/custom/hansel/images/rs-logo-2021B.svg). Only the leading r subpath is extracted for small-size legibility. Its relative initial move is resolved to `M10.0488 13.2054`; the following line remains relative and all curves are unchanged.                                                                                                                                                                                                                           |
| `amen-pt`      | Monochrome path trace of the compact parentheses emblem in the [publisher header raster](https://cdn-teamblue.services/amen.pt/img/header/logo.png). Not an original publisher SVG; the wordmark/team.blue endorsement line is excluded.                                                                                                                                                                                                                                                                              |
| `noip`         | Smooth Bezier/line contour trace of the 54×54 [publisher compact raster](https://d2qr50rz2oof04.cloudfront.net/assets/img/logo/logo-grey-bug.png), linked by the [No-IP homepage](https://www.noip.com/). Green foreground becomes currentColor; the pale strike and letter counters remain transparent. Curved roundel and letter bowls replace raster stair steps, preserving four disconnected foreground contours and uniform scale. Not an original publisher SVG.                                               |
| `claranet`     | [Publisher favicon](https://www.claranet.com/favicon.svg). All three paths retain their independent relative-coordinate origins; joining them would corrupt the cloud/power emblem.                                                                                                                                                                                                                                                                                                                                   |
| `sapo`         | First five paths of `svg#sapoLogo` on the [SAPO homepage](https://www.sapo.pt/): frog, two eye cutouts and two pupils. Even-odd monochrome fill preserves the eyes without a fixed background. [Publisher rebrand announcement](https://sobre.sapo.pt/novidades/noticias/artigos/um-novo-sapo-com-uma-nova-marca-para-uma-nova-era-digital).                                                                                                                                                                          |
| `freenom`      | [Pinned historical collection SVG](https://raw.githubusercontent.com/homarr-labs/dashboard-icons/4f6ec5df68bdffd41395b395bb6f304553ba0677/svg/freenom.svg). Ring and centre-dot geometry retained; the source's `fill:none` first path is excluded. This is community-preserved historical artwork, not a verified current publisher release.                                                                                                                                                                         |
| `bluehost`     | [2019 SVG](https://upload.wikimedia.org/wikipedia/commons/9/9a/Bluehost_logo_2019.svg), [source/author attribution](https://commons.wikimedia.org/wiki/File:Bluehost_logo_2019.svg). The nine grid polygons are extracted without the wordmark. Historical identification, not a current-brand claim.                                                                                                                                                                                                                 |
| `ec2-instance` | [Official AWS architecture package](https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip), member `Resource-Icons_07312026/Res_Compute/Res_Amazon-EC2_Instance_48.svg`. Actual singular Instance resource, not a generic AWS logo or framed server. Original even-odd fill is preserved; orange becomes currentColor. See [AWS architecture icon terms](https://aws.amazon.com/architecture/icons/). |

### Explicit app-authored alternatives

These small geometric identifiers are **not official logos**, and their catalog
descriptions say so. They are not included in `BRAND_ICONS`. They do not trace
unknown raster artwork or claim vendor approval. Publisher references establish
which company/service a label identifies, not the source of the authored shapes.

| Key                 | Identifier and publisher reference                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dns-pt`            | .PT path lettering; [DNS.PT](https://www.dns.pt/) redirects to [the .PT registry](https://www.pt.pt/pt/). Its available Safari SVG was an unsuitable large raster trace. |
| `ptisp`             | PI initials; [PTisp contact/identity page](https://ptisp.pt/company/contacts). A usable publisher vector was not verified.                                               |
| `ptservidor`        | PS and server line; [PTServidor](https://www.ptservidor.pt/) exposes a raster header logo.                                                                               |
| `webtuga`           | WT initials; [WebTuga](https://www.webtuga.pt/) exposes a raster header logo.                                                                                            |
| `time4vps`          | Clock/four symbol; [Time4VPS](https://www.time4vps.com/). Usable publisher vector unavailable during bounded lookup.                                                     |
| `network-solutions` | NS initials; [Network Solutions](https://www.networksolutions.com/). A current compact publisher vector was not verified.                                                |
| `cogent`            | CC initials; [Cogent media kit](https://www.cogentco.com/en/media-kit) provides raster artwork.                                                                          |
| `hostgator`         | HG initials; [HostGator](https://www.hostgator.com/). The linked Safari asset did not return verified SVG content.                                                       |

The generic `isp` globe/distribution symbol, `dynamic-dns` domain/update service,
and `display-multi-screen` three-screen array are app-authored, unbranded geometry, not provider marks.

### PuTTY author-generated geometry

The PuTTY icon comes from the author's [0.85 source archive](https://the.earth.li/~sgtatham/putty/0.85/putty-src.zip),
SHA-256 `232c5c286a5b35f445dbbf49e159469acde372a3907aef738d88e28b4b0f6da2`.
The reviewed, standalone `icons/mksvg.py` generator was run with the constant
`putty_icon`, size 48 and `bw` mode, writing only to an in-memory stream.
Generated SVG SHA-256: `ad9c058c5f30caed3d2fa07c4047532611c5b7c947d6f3a69f76ab33381dfc2a`.
See the author's [icon design explanation](https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/putty-icons/).

`puttyBrandIcon.ts` preserves its computers-and-lightning polygon/rectangle
coordinates and scales uniformly. Black becomes currentColor; white is transparent
so the cases and bolt use linework, not fixed white backgrounds. Inline styles are
flattened into passive attributes; no mask, font, script or live generator ships.

PuTTY is copyright 1997–2026 Simon Tatham. Portions copyright Robert de Bath,
Joris van Rantwijk, Delian Delchev, Andreas Schultz, Jeroen Massar, Wez Furlong,
Nicolas Barry, Justin Bradford, Ben Harris, Malcolm Smith, Ahmad Khalifa, Markus
Kuhn, Colin Watson, Christopher Staite, Lorenz Diener, Christian Brabandt, Jeff
Smith, Pavel Kryukov, Maxim Kuznetsov, Svyatoslav Kuzmich, Nico Williams, Viktor
Dukhovni, Josh Dersch, Lars Brinkhoff, and CORE SDI S.A.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Named publisher retraces

These eight existing choices were refined on 2026-09-09 without changing saved
keys. Publisher SVGs are normalized locally; raster references were visually
inspected and hand-traced into compact paths, not embedded or relabelled as
original publisher vectors. Traces simplify details for small sizes and are not
claims of publisher approval or a new trademark license. Rendering is local,
font-free, theme-color aware and free of image, mask, script or network dependencies.

| Choice                            | Reference and adaptation                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meo`                             | [Publisher SVG](https://conteudos.meo.pt/Style%20Library/consumo/images/logo-meo.svg), linked by the official site's organization metadata. The 96×96 roundel and three bars are uniformly scaled; blue becomes currentColor and white bars become transparent even-odd cutouts. The redundant rectangular mask is omitted.                                 |
| `uzo`                             | [Publisher SVG](https://conteudos.uzo.pt/Style%20Library/uzo/resources/images/logo/uzo-logo.svg), linked in the official header. Original 519×239 wordmark path retained, uniformly scaled and centered; no replacement font or guessed lettering.                                                                                                          |
| `ddwrt`, router variant           | [Publisher header raster](https://www.dd-wrt.com/wp-content/themes/dd-wrt/assets/images/logo.png). Rounded lowercase **dd-wrt** letterforms are manually retraced as outline geometry. The `.com` suffix and decorative header tick strip are omitted. Both standalone and router choices reuse the trace.                                                  |
| `draytek`, router/switch variants | [Publisher wordmark raster](https://www.draytek.de/tl_files/cto_layout/img/logo.png). Italic **DrayTek** letterforms are manually retraced. The pure key keeps the full horizontal wordmark; appliance badges stack the same **Dray** and **Tek** paths to stay legible. This compact two-line layout is an app adaptation, not another official logo.      |
| `freepbx`, server variant         | [Pinned upstream frog artwork](https://raw.githubusercontent.com/FreePBX/framework/6cb2e29d83a5646a9f300851d53b9806f25ffa2b/amp_conf/htdocs/admin/images/freepbx.png), from `release/17.0`. The frog face is manually retraced; eye/mouth details become transparent cutouts, with color and fine shading omitted.                                          |
| `grandstream`, phone variant      | [Publisher header raster](https://www.grandstream.com/hs-fs/hubfs/raw_assets/public/Grandstream_Feb_2021/images/logo-grandstream-low-web.png). The compact G/swoosh emblem is manually retraced, omitting the wordmark/tagline. Gradients become currentColor with a subdued secondary arrow; transparent interior geometry remains visible in both themes. |
| `hurricane-electric`              | [Publisher header GIF](https://he.net/images/helogo.gif). The circled, overlapping serif **HE** emblem is manually retraced, not replaced by plain initials. The long company name/tagline is omitted and the emblem inherits the selected icon color.                                                                                                      |
| `viva`                            | Deliberately **app-authored neutral VIVA lettering**. The intended regional operator remains unconfirmed, so no unrelated country's mark is substituted. The revised filled letterforms improve small-size contrast without asserting a sourced official logo.                                                                                              |

Reference-byte SHA-256 values (not hashes of the adapted SVG):

| Reference          | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| MEO                | `113e3a9b2054e50f8213ab5e2cc40248312ac4b71fa61277357933ba765ff1e5` |
| UZO                | `ac326c956b045e3f4409b2b79f6e646d7bc3c4382eeba5ad7d3ab21ab32b790c` |
| DD-WRT             | `18552be8e7fc907eb65861d43731bd725df8c8814d994a3d1f663c8c64af14c3` |
| DrayTek            | `226102ffe6d1773478f8cd51937d56c6c5a9eb1b314e6a5ce4a6f20f64aae1e8` |
| FreePBX            | `79c1614dcb979d96bacf1ec6896439650fb8fda7a25b56d8c4865afdd559cf83` |
| Grandstream        | `9b324cfb2fcfbaf65f4c89467ad7f59f718c1676862a85e2ee068dd2c5b39583` |
| Hurricane Electric | `13834f9f1468f97a38c50e47886b5aea03c929bc3b55b4e48ed7d5c516f6ec63` |

`tests/icons/providerRetraces.test.tsx` checks saved keys, vector-only/theme-safe
rendering and shared glyph paths. The DrayTek exception permits only placement
changes for its identical letterforms; the exhaustive appliance test still
requires an exact plain counterpart for other badges.
`node scripts/catalog-icon-contact-sheet.mjs retraced` renders the actual catalog's
pure and appliance variants at 16/20/24 pixels on dark and light backgrounds.

### Amcrest, Hanwha Vision, Dahua and Brother

These four refinements preserve the original public names, saved catalog keys and
historical identifier-registry membership. Their printer, camera and recorder
variants use the exact same glyphs inside the existing appliance frames. Pure
brands have no frame. They are theme-color adaptations, not claims of publisher
endorsement or newly licensed trademarks.

| Choice                  | Publisher reference and local adaptation                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `amcrest`, camera       | [Amcrest Cloud header raster](https://www.amcrestcloud.com/templates/tpl_amcrest/images/amcrest-logo.png), linked by the [publisher cloud site](https://www.amcrestcloud.com/). Locally traced hexagonal roof/lower chevron and circular lens. The wordmark is omitted; straight edges and circular contours replace raster stair steps. Not an original publisher SVG. |
| `hanwha`, camera        | First three ring paths of the inline header SVG on [Hanwha Vision's global site](https://www.hanwhavision.com/global). Exact curves and independent relative-path origins are retained. The wordmark and redundant clip wrapper are omitted; uniform scale and currentColor replace source dimensions and orange shades.                                                |
| `dahua`, camera and DVR | [Publisher footer artwork](https://materialfile.dahuasecurity.com/assets/img/footer_logo.svg). This SVG embeds a raster; the embedded image is not shipped. The compact leading loop/stem and inner letterform are locally traced, excluding the remaining wordmark and tagline. Not an original publisher vector.                                                      |
| `brother`, printer      | [Publisher header raster](https://global.brother/-/media/global/common/img/header/logo-brother.ashx). Locally traced leading lowercase b with its original rounded counter and upright stem; the remaining wordmark and tagline are omitted for compact display. Not a replacement font or original publisher SVG.                                                      |

Reference-byte SHA-256 values (Hanwha hashes the complete inline header SVG):

| Reference     | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| Amcrest       | `3796dd3d01c91c23a6cc22eec6de622db3ddd991eda279ddd1c00a2f2f92e99e` |
| Hanwha Vision | `ece22946d78decef4ed137104503e04f7e6c25bb961315ced8d3d8cd1ab0720a` |
| Dahua         | `4fdc121da538fe213a70afd17b3a2d5f0b971ca39c3a1be62c35ac85cfea679d` |
| Brother       | `33dcccd7c3a184516345ba01fa250441ad544fc196b0bd1fd0007a02f4def439` |

`tests/icons/applianceBrandRefinements.test.tsx` checks the stable aliases,
source-geometry fingerprints, theme-safe passive rendering, library export, and
identical badge reuse. `node scripts/catalog-icon-contact-sheet.mjs appliance-refined`
renders these choices and the refined No-IP mark at 16/24/32/96 pixels in both
themes, including the large Icon Explorer preview size. No publisher URLs,
raster images, fonts or external dependencies are loaded when icons render.

## Developer-tool marks

The `mcp` and `mcp-server` choices use `modelcontextprotocol` from pinned
Simple Icons 16.28.0. The collection's metadata points to the protocol project's
[version-pinned publisher SVG](https://github.com/modelcontextprotocol/docs/blob/573dc60c2e7aab2605b29d0bf27194aa7b02e4fb/logo/light.svg).
Its complete reference SVG hashes to
`3163a85f9db4b98c3b5af846ea284b3296295dbd51a138b2e77ebd438342e902`.
Only the collection's normalized protocol emblem ships; the long wordmark is not
included. The server choice reuses that exact pure glyph in a bottom-right badge.

`vscode` identifies Microsoft Visual Studio Code, using the exact even-odd
silhouette from the mask path in `visual-studio-code-icons/vscode-alt.svg` in the
[publisher's icon package](https://code.visualstudio.com/assets/branding/visual-studio-code-icons.zip),
linked from [Microsoft's usage guidelines](https://code.visualstudio.com/brand).
Archive SHA-256: `04c5292a117bbc619f1ce574cc59b6c5e2e26374d6e64b92619e848612f2d9cb`;
source SVG SHA-256: `4ef4077d35718ae78184902b3b763281c97b0ff46f2b5a36c10c5c5189ed027f`.
Uniform scale and a margin preserve the outline and triangular counter. Source
shadows, gradients, overlays, masks and clipping are not shipped; the silhouette
inherits the selected icon color. This is a local monochrome identification
adaptation, not a claim of endorsement or permission beyond the publisher's terms.

The existing `code-server` key keeps its generic server/code glyph and its
`code-editor` pure counterpart. It is not relabelled as Microsoft's product mark
or as the [Coder code-server project's](https://github.com/coder/code-server) logo.
The existing `test-tube` and `panel` artwork likewise stays intact; added search
aliases expose these existing choices. Inspector, magnifier, linter, test-checklist
and control-panel sliders use local Lucide glyphs; the bug collection is an
app-authored two-insect tray symbol. None of these choices implies an installed
service or functional integration.

## Messaging platforms

The Communication category adds 30 pure, unframed choices. Existing Slack,
Mattermost, Rocket.Chat, Matrix, Zulip and Element keys and artwork are unchanged.
These icons identify a saved connection; they do not install clients, enable
protocol support, or claim that a messaging integration exists.

Twenty-four marks use exact paths from the pinned Simple Icons 16.28.0 release:
Discord, Telegram, WhatsApp, Signal, Messenger, Google Chat, Google Messages,
LINE, Viber, WeChat, QQ, KakaoTalk, Snapchat, iMessage, XMPP, SimpleX, Session,
Threema, Mumble, TeamSpeak, Zoom, Webex, Wire and Gitter. Their upstream source and
usage links remain in `simple-icons/data/simple-icons.json`; the generated
module records the pinned collection version. Publisher identity references
include [Discord](https://discord.com/branding),
[Signal](https://signal.org/brand), [LINE](https://line.me/en/logo),
[Viber](https://www.viber.com/brand-center), [Threema](https://threema.ch/en/press)
and [Wire](https://brand.wire.com). The Zoom choice deliberately retains the
verified wordmark: its correct wide proportions make the letters small at 16px.
It is not replaced with an unrelated camera glyph.

Three collection entries record Wikimedia rather than a publisher SVG as their
artwork source. That provenance is retained, not relabelled as direct publisher
artwork: [iMessage](https://commons.wikimedia.org/wiki/File:IMessage_logo.svg),
[QQ](https://en.wikipedia.org/wiki/File:Tencent_QQ.svg), and
[KakaoTalk](https://commons.wikimedia.org/wiki/File:KakaoTalk_logo.svg).
Apple's [Messages listing](https://apps.apple.com/us/app/messages/id1146560473),
Tencent's [QQ identity portal](https://qq.design/brand/BrandDesign/Logo), and
[Kakao's product page](https://www.kakaocorp.com/page/service/service/KakaoTalk?lang=en)
are separate identity references. Collection availability is not a new license
for the underlying trademarks.

Five choices use locally normalized publisher SVG geometry, verified on
2026-09-09. These are monochrome identification adaptations, not original
publisher monochrome releases or endorsements. Only passive paths/rectangles,
uniform transforms and theme color/opacity ship; no source CSS, gradients,
filters, raster images, masks, fonts or remote requests are retained.

| Choice            | Publisher source and adaptation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `microsoft-teams` | [Current FY26 SVG](https://www.microsoft.com/content/dam/microsoft/bade/images/icons/en-us/m365-app-icons-fy26/Teams-Icon-FY26.svg), linked by [Microsoft 365](https://www.microsoft.com/microsoft-365). Original people, rounded tile and T geometry; redundant gradient overlays omitted. Theme opacity separates the bodies; the tile is outlined so the T remains legible without a fixed background. [Microsoft trademark guidance](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks) still applies. |
| `delta-chat`      | [Publisher SVG](https://delta.chat/assets/logos/delta-chat.svg), linked by the [project homepage](https://delta.chat/en/). Original bubble boundary and delta letter, including the letter's source transform. The bubble uses theme linework; the gradient backdrop is omitted.                                                                                                                                                                                                                                               |
| `briar`           | [Publisher black icon](https://briarproject.org/styleguide/images/briar_icon_black.svg) from the [brand guide](https://briarproject.org/styleguide/brand/). Both exact interlocking strand paths, uniformly scaled; editor metadata omitted.                                                                                                                                                                                                                                                                                   |
| `jami`            | [Publisher SVG](https://jami.net/content/images/2018/12/logo-jami.svg), referenced by the [current project homepage](https://jami.net/). Compact ribbon emblem only; the wordmark, tagline, gradient definitions and duplicate shading overlays are omitted. Original ribbon paths retain their order; theme opacity separates the interwoven layers.                                                                                                                                                                          |
| `nextcloud-talk`  | [Publisher product SVG](https://nextcloud.com/c/uploads/2022/10/nc-talk-icon-blue.svg), linked by [Nextcloud Talk](https://nextcloud.com/talk/). Exact speech-bubble/ring path with its transparent counter. This is the Talk product mark, not a relabelled generic Nextcloud logo.                                                                                                                                                                                                                                           |

Reference SVG SHA-256 values:

| Source               | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Microsoft Teams FY26 | `6a33d49f19d1be2bcdf86921935a2171e5c18c3b11abe297ca03d5f4f302ba3a` |
| Delta Chat           | `58dfdd96cea4b5c62e6cac4bd5210e8dd4b039995a2d0ae4cb3a30c882e702fa` |
| Briar                | `7d130e3472ec4eb9a342152468daea2993cc91930151847a99d2b45bd4cc76a7` |
| Jami                 | `47dacb6b58fb39bf0e9fc0d5d4e48381c63e5a550811f35c5ab759a5be54c40f` |
| Nextcloud Talk       | `a1a7cd4a5bdf69f97ca7b8f76dd62f8a8582a3cee22d1796f5c49460042a21cd` |

`irc` is explicitly a **generic app-authored protocol symbol**: a channel hash
inside a speech bubble, not a claimed official IRC, network or client logo.

### Hosted dashboard additions (2026-09-10)

YouTube, iCloud, Claude, OpenRouter, Facebook, Instagram, Gmail, Google Analytics,
Google Ads and Google Search Console use the installed, pinned Simple Icons
paths via `brandIconSlugs.ts` and `npm run icons:brand:generate` (CC0 collection;
underlying trademarks remain their owners'). Zoom reuses the existing mark.

`adobe` uses the leading A contour from the [publisher SVG wordmark](https://www.adobe.com/federal/assets/svgs/adobe-logo.svg),
with a uniform transform and theme color. Source SHA-256:
`54213e56d564e8174ec2de6aa5f91907aebadc38215f4c3597d1e9b83cce127a`.
`registro-br` uses the entire [publisher pinned-tab SVG](https://registro.br/assets/img/favicon/safari-pinned-tab.svg),
uniformly scaling its 325×325 view box to 24×24. Source SHA-256:
`07da9afa01fcbf117ad288213ea8ebec2fff7eabcb569504d7ea2263536b9fde`.
These are monochrome identification adaptations, not endorsements or new licenses.

`marcaria` and `freedns` are distinct **app-authored vector identifiers**, not
official-logo reproductions or raster tracings. No verified publisher vector was
available in this review. Their catalogue descriptions say so explicitly.
All added marks are passive local SVG geometry without frames, external resources,
fonts, scripts or raster payloads. `tests/icons/hostedDashboardIcons.test.tsx`
checks search, uniqueness, light/dark theme color, exact collection paths and
safe icon-library export/import at 16/24/32/96px.

`tests/icons/messagingPlatformIcons.test.tsx` covers all 30 new and six retained
choices: unique categories/keys, common-name searches, saved selection resolution,
pure passive rendering, exact collection/publisher geometry and strict icon
library export/import. The `messaging` contact-sheet family renders the actual
catalog components at 16/24/32/96px in both themes, including the large Explorer
preview size.
