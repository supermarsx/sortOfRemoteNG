# Connection icon brand sources

The picker stores stable catalog keys, not SVG payloads. All icons render locally
on the same 24×24 grid and inherit the connection color. No image CDN, web font,
runtime Simple Icons import, or new dependency is used. A server/database/NAS/AP/
switch/cloud variant combines its mark with the app's corresponding role frame;
these composites are app UI symbols, not official alternate brand logos.

## Installed Simple Icons

`src/utils/icons/brand/brandIconSlugs.ts` is the source of truth for the 150 paths
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
verified publisher geometry. MEO, UZO, Hurricane Electric, and unresolved VIVA use
the disclosed identifiers listed later. The saved Vodafone catalog key is preserved; telecom device/service variants use
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

`publisherBrandIcons.ts` adds twenty-four marks from public publisher assets,
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

## Explicitly nonofficial identifiers

Forty-six entries use explicit nonofficial identifiers. Most did not yield a
suitable compact vector source in the installed or checked historical collection
and bounded publisher lookup; VIVA is intentionally neutral because the intended
provider is unconfirmed. These entries are still distinct and usable:
`identifierIcons.ts` draws geometric identifiers with SVG paths, not fonts or
copies of unrelated logos. Catalog descriptions disclose that they are app-authored.

| Entries                       | App-authored symbol          | Publisher checked                                                                                                                                                                                     |
| ----------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dlink`                       | DL monogram                  | [D-Link](https://www.dlink.com/); no verified reusable compact vector obtained.                                                                                                                       |
| `levelone`, `levelone-switch` | L1 monogram                  | [LevelOne](https://www.level1.com/level1_en/); the public header is a wide raster wordmark.                                                                                                           |
| `arista`, `arista-switch`     | A with network cross         | [Arista brand information](https://www.arista.com/en/company/company-overview); not a traced Arista wordmark.                                                                                         |
| `freepbx`, `freepbx-server`   | FP monogram                  | [FreePBX](https://www.freepbx.org/); not the FreePBX mascot/logo.                                                                                                                                     |
| `brother`, device variants    | B identifier                 | [Brother's public header asset](https://global.brother/-/media/global/common/img/header/logo-brother.ashx) is raster PNG; this is not a tracing of its wordmark.                                      |
| `yealink`, phone variant      | Y with call waves            | [Yealink](https://www.yealink.com/) publishes raster header logos; this is not its official wordmark.                                                                                                 |
| `clevo`, laptop variant       | CV monogram                  | [CLEVO](https://www.clevo.com.tw/); app-authored, not the publisher logo.                                                                                                                             |
| `grandstream`, phone variant  | GS monogram                  | [Grandstream](https://www.grandstream.com/) uses a public raster header; the identifier is not that logo.                                                                                             |
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
| `draytek, device variants`    | DT monogram                  | [Publisher/project](https://www.draytek.co.uk/); The checked UK public assets were raster; the global site rejected retrieval. No claim to reproduce DrayTek's logo.                                  |
| `dameware`                    | DW monogram                  | [Publisher/project](https://www.solarwinds.com/dameware); Dameware redirects to its publisher's page with raster SolarWinds branding; this is a distinct product identifier, not that publisher logo. |
| `meo`                         | Full MEO identifier          | [MEO](https://www.meo.pt/) and the checked corporate/store domains returned HTTP 410; no verified compact SVG was obtained in the bounded lookup. This is not an official MEO logo.                   |
| `uzo`                         | Full UZO identifier          | [UZO](https://www.uzo.pt/) and its checked mobile page returned HTTP 410; no verified compact SVG was obtained. This is not an official UZO mark.                                                     |
| `hurricaneelectric`           | HE monogram                  | [Hurricane Electric](https://he.net/) publishes a raster GIF header in the checked page. The local HE paths are app-authored, not a conversion of that image.                                         |
| `viva`                        | Neutral full VIVA identifier | Provider identity remains unconfirmed. No country, network, regional operator or Vivo association is asserted; this is deliberately not advertised as a sourced official VIVA logo.                   |

These are a disclosed logo-coverage limitation, not fabricated official marks.
They stay outside the `BRAND_ICONS` registry. Their device/server variants use
the same identifier inside a different role silhouette, so variants are not
merely duplicate bare glyphs with different labels.

The `APP_AUTHORED_IDENTIFIER_ICONS` registry enumerates all 46 exceptions, and
tests assert their path geometry is pairwise distinct and none enters the
`BRAND_ICONS` sourced-mark registry. New custom Lucide nodes carry stable React
keys; a regression renders every brand without filtering unrelated console
errors and asserts no missing-key warnings.

## Protocol and camera source additions

The final source registry has 150 installed marks, 12 pinned historical marks,
24 publisher-file marks and seven preserved/local marks (including the three
publisher geometries described above). The 46 explicitly nonofficial identifiers
are a separate registry and are not counted as sourced marks.

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
| `ddwrt`, router variant      | DD lettering. The checked [publisher theme](https://dd-wrt.com/wp-content/themes/dd-wrt/style.css) references `assets/images/logo.png`; the local identifier is not that image.                                                                                                                                         |
| `hikvision`, device variants | HK identifier. The [publisher homepage](https://www.hikvision.com/en/) references a vector font sprite, but retrieval of that source returned access denied; no unverified paths are claimed as official.                                                                                                               |
| `dahua`, device variants     | DA identifier. The [publisher footer SVG](https://materialfile.dahuasecurity.com/assets/img/footer_logo.svg) embeds a PNG instead of usable vector geometry; that raster wrapper is not vendored.                                                                                                                       |
| `hanwha`, device variants    | HV identifier for **Hanwha Vision**, not a Hanwha Group or other subsidiary mark. The checked [company-profile page](https://profile.hanwhavision.com/en/corporate-identity.html) could not be retrieved and the old CI URL returned 404.                                                                               |
| `amcrest`, device variants   | AC identifier. The checked [publisher](https://amcrest.com/) returned access denied; this is not a traced Amcrest logo.                                                                                                                                                                                                 |

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
