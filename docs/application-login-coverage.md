---
title: Application login coverage
eyebrow: Use the app
description: Every website application in the catalog, how it signs in today, and what was found for the ones that do not sign in automatically.
permalink: /application-login-coverage/
---

# Application login coverage

This page lists every website application in the catalog: how it signs in today and, for each one
that has no reviewed login, what was found when its login was examined. The numbers and the tables
are generated from the catalog, from each application's evidence record and from the login steps
files. They report what exists in this project today, not what is planned.

Automatic login types the saved username and password into the application's own form and submits
it once. CAPTCHA, device approval, passkeys, SMS and email codes and security keys stay with you:
the login stops there and leaves the page usable. A saved authenticator secret is entered only
where a reviewed challenge exists for that application; see
[Website application login](http-application-logins.md). Every application starts in **Manual**
mode, and you turn automatic login on per connection.

## Where the work stands

<!-- coverage:summary:begin -->

| Where each application stands today                                          | Applications |
| ---------------------------------------------------------------------------- | ------------ |
| Signs in automatically with a reviewed login                                 | 60           |
| HTTP authentication, no page form                                            | 7            |
| Configured by you                                                            | 2            |
| No web login                                                                 | 8            |
| Login steps written, class A: every selector seen in an authoritative source | 13           |
| Login steps written, class B: unverified layout                              | 18           |
| Evidence, but no steps file                                                  | 3            |
| Nothing to build from (class C)                                              | 41           |
| Total                                                                        | 152          |

Of the 60 that sign in automatically, 33 use reviewed form selectors and 27 keep a hand-written
adapter (`adobe` 1, `bitwarden` 2, `chatgpt` 1, `claude` 1, `cloudflare` 1, `google` 19,
`synology` 1, `yealink` 1).

No steps-based login is switched on yet. The 31 applications with login steps behave as they did
before the steps were written: 19 are manual and 12 use field detection.

No evidence record cites a sign-in confirmed by a user, and none cites a page a user saved.

| Why nothing can be built | Applications | Meaning                                                                                                                                                        |
| ------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Robots rules or terms    | 25           | The site's robots rules or its terms forbid a program reading the page, so it was not loaded.                                                                  |
| Refused or unreadable    | 10           | The site answered with a refusal or a challenge, or its robots rules or terms could not be read, so the page was not loaded; or the one permitted load failed. |
| No public markup         | 2            | The application has a password form, but no public source shows its markup.                                                                                    |
| No password form         | 4            | The evidence shows no user name and password form for a saved password to fill.                                                                                |

<!-- coverage:summary:end -->

How to read that:

- **Login steps are data.** A steps file describes a login; it signs nobody in until the engine
  that runs steps is switched on, and whether it is, is stated above.
- **Class B steps are unverified.** At least one selector in them is inferred, or comes from one
  anonymous view of a public page or from secondary material.
- **Class A is not a tested sign-in.** It says where the selectors were seen, not that a sign-in
  was tried. Whether any sign-in was confirmed by a user is stated above.
- **Nothing to build from means the application stays as it is**, manual or on field detection,
  until there is a source for its form. No robots rule, term of use or refusal was worked around
  to get one.
- **This is less than was forecast.** The first version of this page expected that a login could be
  built for 69 applications. When they were examined, on 12 October 2026, 31 got login steps, 3
  got evidence but no steps file, and 35 ended with nothing to build from.

## What you can supply

Where a program may not read a sign-in page, you still can: it is your account and your browser. A
page you saved yourself is an authoritative source, so a login built from it can be class A.

1. Sign out, or open a private window, and go to the application's sign-in page.
2. Save it as **Webpage, Complete**, and keep the `_files` folder that is written beside the
   `.html` file. Do not use "Webpage, HTML only": it downloads the address again and misses a form
   that a script drew.
3. If the password is asked on a second page, enter the account name, continue, and save that
   page too, **before** typing the password.
4. Note the address of each page: host and path only, nothing after a question mark.
5. Keep the files outside this repository. They can hold your account name.

The import reads the file offline and keeps only the structure of the form controls: no text, no
values, no cookies.

```sh
node scripts/capture-login-page.mjs --id <id> --from-file "<folder>/<name>.html"
```

Each application's `evidence.json` under `tests/fixtures/logins/<id>/` says in `neededFromUser`
exactly which pages or facts are needed, and in `lookedFor` what was tried. A saved page does not
help where the Note below says **No password form**: a saved password has nothing to fill there.
It is not enough either where the Note says the steps format cannot address or express the form;
the format has to change first.

## How to read the tables

| Column                 | Meaning                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Catalog capability** | The application's entry in the catalog today. See the capability table below.                                                                                                  |
| **Class**              | The evidence class in the application's `evidence.json`. `-` means no evidence record exists: an application with a reviewed login was not examined again.                     |
| **Mechanism**          | What the evidence says the login is: `form` (a page form filled through selectors), `adapter` (a hand-written adapter for a staged sign-in), `http-auth`, or `none` (class C). |
| **Steps file**         | The application's login steps file under `src/data/loginSteps/`; `none` when it was examined and has no steps file; `-` when it was not examined.                              |
| **Note**               | Generated, except under "Evidence, but no steps file" and "Nothing to build from", where a person wrote the reason from the evidence record.                                   |

| Class | Meaning                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Every selector was observed in an authoritative source: the application's public source code, a fixture or adapter in this project, the `cdp-auth` reference tool, or a page you saved.                               |
| **B** | At least one selector is inferred, or comes from one anonymous render of the public sign-in page or from secondary material. An informed guess until someone signs in with it. This is the "unverified layout" label. |
| **C** | Nothing to build from: no saved-password form as far as the evidence shows, or the page could not be read. No selectors, no fixture, no steps file.                                                                   |

| Capability     | Today                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `known-form`   | Reviewed login: signs in automatically in the built-in browser and in the legacy proxied viewer.          |
| `generic-form` | No reviewed selectors. The fields are detected heuristically, which may work but is not pinned by a test. |
| `custom-form`  | Your own selectors.                                                                                       |
| `http-auth`    | The saved credential answers the server's HTTP authentication request in the legacy proxied viewer.       |
| `manual`       | No credential is released. You sign in by hand.                                                           |
| `none`         | No web login.                                                                                             |

## Evidence standard

A login selector must come from a source that can be cited. Recollection is not a source.

- **Authoritative** sources can support class A: a fixture, adapter or test in this project; the
  application's own published source code at a commit or release; the `cdp-auth` reference tool; a
  page you saved from your own account or device; your confirmation that a sign-in worked.
- **Not authoritative**, class B only: the public sign-in page rendered once without an account
  (it shows the first step only); vendor documentation; other public material.
- Class is decided by the evidence. A login is class A only when every selector was observed in an
  authoritative source.
- A public sign-in page is rendered only after the site's robots rules and its terms were both read
  and neither forbids it. A rule that could not be read, or a clause that is unclear, counts as a
  prohibition. The page is loaded once and never a second time.
- Nothing is learned by signing in, creating an account, answering a CAPTCHA, or contacting a
  device on anyone's network. Synology DSM firmware and Virtual DSM are never used.
- Test fixtures are synthetic: the controls a selector needs and nothing copied from a vendor.

Each application's evidence is recorded next to its test fixture. The full standard, the file
format and the capture tool are described in the
[login fixture corpus guide]({{ site.repository_url }}/blob/main/tests/fixtures/logins/README.md).

## Coverage matrix

Every application is listed once, in the section that says where it stands today.

<!-- coverage:matrix:begin -->

### Signs in automatically today (60)

A reviewed login in the catalog: reviewed form selectors, or a hand-written adapter for a sign-in
that takes several pages.

| Application                               | Id                        | Catalog capability | Class | Mechanism | Steps file | Note                                |
| ----------------------------------------- | ------------------------- | ------------------ | ----- | --------- | ---------- | ----------------------------------- |
| Adobe Admin Console                       | `adobe-admin-console`     | `known-form`       | -     | -         | -          | Hand-written adapter (`adobe`)      |
| Apache Guacamole                          | `guacamole`               | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Bitwarden (self-hosted)                   | `bitwarden-self-hosted`   | `known-form`       | -     | -         | -          | Hand-written adapter (`bitwarden`)  |
| Brevo                                     | `brevo`                   | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| ChatGPT                                   | `chatgpt`                 | `known-form`       | -     | -         | -          | Hand-written adapter (`chatgpt`)    |
| Claude                                    | `claude`                  | `known-form`       | -     | -         | -          | Hand-written adapter (`claude`)     |
| Cloudflare Dashboard                      | `cloudflare`              | `known-form`       | -     | -         | -          | Hand-written adapter (`cloudflare`) |
| cPanel / WHM                              | `cpanel`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Drupal                                    | `drupal`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Exchange Admin Center / ECP               | `exchange-ecp`            | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Exchange Outlook on the web (on-premises) | `exchange-owa`            | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| FreePBX Administration                    | `freepbx`                 | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Gitea                                     | `gitea`                   | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| GitHub                                    | `github`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| GitLab (self-hosted)                      | `gitlab-self-hosted`      | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Gmail                                     | `gmail`                   | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Account                            | `google-account`          | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Ad Manager                         | `google-ad-manager`       | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Ads                                | `google-ads`              | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google AdSense                            | `google-adsense`          | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Analytics                          | `google-analytics`        | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Business Profile                   | `google-business-profile` | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Cloud Console                      | `google-cloud-console`    | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Drive                              | `gdrive`                  | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google for Developers                     | `google-developers`       | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Forms                              | `google-forms`            | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Gemini                             | `google-gemini`           | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Play Console                       | `google-play-console`     | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Play Store                         | `google-play-store`       | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Search Console                     | `google-search-console`   | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Tag Manager                        | `google-tag-manager`      | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Google Workspace Admin console            | `google-workspace-admin`  | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| Instagram                                 | `instagram`               | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Joomla Administrator                      | `joomla`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| LinkedIn                                  | `linkedin`                | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Matomo                                    | `matomo`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| MeshCentral                               | `meshcentral`             | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Nextcloud                                 | `nextcloud`               | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Nginx Proxy Manager                       | `nginxProxyMgr`           | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Odoo                                      | `odoo`                    | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| OPNsense                                  | `opnsense`                | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Payload CMS                               | `payload-cms`             | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| pfSense                                   | `pfsense`                 | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| phpMyAdmin                                | `phpmyadmin`              | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Plausible Analytics                       | `plausible`               | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Porkbun                                   | `porkbun`                 | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Portainer                                 | `portainer`               | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Proxmox VE                                | `proxmox`                 | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| PTisp customer area                       | `ptisp`                   | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| SQLPad                                    | `sqlpad`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Synology DSM                              | `synology-dsm`            | `known-form`       | -     | -         | -          | Hand-written adapter (`synology`)   |
| Tactical RMM                              | `tacticalrmm`             | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Vaultwarden                               | `vaultwarden`             | `known-form`       | -     | -         | -          | Hand-written adapter (`bitwarden`)  |
| Vodafone Smart Router 3                   | `vodafone-smart-router-3` | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| VoIP phone (Yealink)                      | `voip-phone`              | `known-form`       | -     | -         | -          | Hand-written adapter (`yealink`)    |
| Webmin                                    | `webmin`                  | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| Windows RemoteApp / RD Web Access         | `rdweb`                   | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| WordPress                                 | `wordpress`               | `known-form`       | -     | -         | -          | Reviewed form selectors             |
| YouTube                                   | `youtube`                 | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |
| YouTube Studio                            | `youtube-studio`          | `known-form`       | -     | -         | -          | Hand-written adapter (`google`)     |

### HTTP authentication (7)

The saved credential answers the server's HTTP Basic or Digest request. There is no page form.

| Application                | Id            | Catalog capability | Class | Mechanism | Steps file | Note                               |
| -------------------------- | ------------- | ------------------ | ----- | --------- | ---------- | ---------------------------------- |
| DD-WRT                     | `ddwrt`       | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |
| FreshTomato                | `freshtomato` | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |
| HAProxy stats              | `haproxy`     | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |
| HTTP Basic authentication  | `http-basic`  | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |
| HTTP Digest authentication | `http-digest` | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |
| Prometheus                 | `prometheus`  | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |
| Traefik dashboard          | `traefik`     | `http-auth`        | -     | -         | -          | HTTP Basic or Digest; no page form |

### Configured by you (2)

Automatic through your own configuration: field detection on a page you choose, or selectors you
enter.

| Application        | Id             | Catalog capability | Class | Mechanism | Steps file | Note                                 |
| ------------------ | -------------- | ------------------ | ----- | --------- | ---------- | ------------------------------------ |
| Custom application | `custom`       | `custom-form`      | -     | -         | -          | Selectors you enter yourself         |
| Generic login form | `generic-form` | `generic-form`     | -     | -         | -          | Field detection on a page you choose |

### No web login (8)

Native integration entries with no web login page.

| Application                 | Id              | Catalog capability | Class | Mechanism | Steps file | Note              |
| --------------------------- | --------------- | ------------------ | ----- | --------- | ---------- | ----------------- |
| Ansible                     | `ansible`       | `none`             | -     | -         | -          | No web login page |
| Caddy admin API             | `caddy`         | `none`             | -     | -         | -          | No web login page |
| KeePass                     | `keepass`       | `none`             | -     | -         | -          | No web login page |
| Mail Server                 | `mail`          | `none`             | -     | -         | -          | No web login page |
| Microsoft SQL Server        | `mssql`         | `none`             | -     | -         | -          | No web login page |
| Nginx configuration         | `nginx`         | `none`             | -     | -         | -          | No web login page |
| PHP runtime                 | `php`           | `none`             | -     | -         | -          | No web login page |
| VMware Workstation / Fusion | `vmwareDesktop` | `none`             | -     | -         | -          | No web login page |

### Login steps written, not switched on (31)

A steps file exists under `src/data/loginSteps/`. Class A: every selector was seen in an
authoritative source. Class B: the layout is unverified until someone signs in with it.

| Application                                 | Id                        | Catalog capability | Class | Mechanism | Steps file                                        | Note                 |
| ------------------------------------------- | ------------------------- | ------------------ | ----- | --------- | ------------------------------------------------- | -------------------- |
| Amazon Shopping                             | `amazon-shopping`         | `manual`           | B     | `form`    | `commerce-social-developer/amazon-shopping.json`  | Unverified layout    |
| Autoridade Tributária — Portal das Finanças | `autoridade-tributaria`   | `manual`           | B     | `form`    | `portuguese-portals/autoridade-tributaria.json`   | Unverified layout    |
| Budibase                                    | `budibase`                | `generic-form`     | A     | `form`    | `self-hosted/budibase.json`                       | Authoritative source |
| Contabo customer panel                      | `contabo`                 | `manual`           | B     | `form`    | `registrars-hosting/contabo.json`                 | Unverified layout    |
| Dell iDRAC                                  | `idrac`                   | `generic-form`     | B     | `form`    | `appliances/idrac.json`                           | Unverified layout    |
| DIGI — Portugal (My DIGI)                   | `digi-portugal`           | `manual`           | B     | `form`    | `portuguese-portals/digi-portugal.json`           | Unverified layout    |
| DrayTek                                     | `draytek`                 | `generic-form`     | B     | `form`    | `appliances/draytek.json`                         | Unverified layout    |
| FreeDNS (afraid.org)                        | `freedns`                 | `manual`           | B     | `form`    | `registrars-hosting/freedns.json`                 | Unverified layout    |
| Ghost Admin                                 | `ghost`                   | `manual`           | A     | `form`    | `self-hosted/ghost.json`                          | Authoritative source |
| GitLab.com                                  | `gitlab-com`              | `manual`           | B     | `form`    | `self-hosted/gitlab-com.json`                     | Unverified layout    |
| Grafana                                     | `grafana`                 | `generic-form`     | A     | `form`    | `self-hosted/grafana.json`                        | Authoritative source |
| HP / HPE iLO                                | `ilo`                     | `generic-form`     | A     | `form`    | `appliances/ilo.json`                             | Authoritative source |
| HPE GreenLake dashboard                     | `hpe-greenlake`           | `manual`           | B     | `form`    | `enterprise-identity/hpe-greenlake.json`          | Unverified layout    |
| Jira                                        | `jira`                    | `generic-form`     | B     | `form`    | `appliances/jira.json`                            | Unverified layout    |
| Mailcow                                     | `mailcow`                 | `generic-form`     | A     | `form`    | `self-hosted/mailcow.json`                        | Authoritative source |
| My Vodafone — Portugal                      | `vodafone-portugal`       | `manual`           | B     | `form`    | `portuguese-portals/vodafone-portugal.json`       | Unverified layout    |
| NetBox                                      | `netbox`                  | `generic-form`     | A     | `form`    | `self-hosted/netbox.json`                         | Authoritative source |
| No-IP account                               | `no-ip`                   | `manual`           | B     | `form`    | `registrars-hosting/no-ip.json`                   | Unverified layout    |
| osTicket                                    | `osticket`                | `generic-form`     | A     | `form`    | `self-hosted/osticket.json`                       | Authoritative source |
| Outlook Online (Microsoft 365)              | `outlook-online`          | `manual`           | B     | `form`    | `enterprise-identity/outlook-online.json`         | Unverified layout    |
| PyPI                                        | `pypi`                    | `manual`           | A     | `form`    | `self-hosted/pypi.json`                           | Authoritative source |
| Segurança Social Direta                     | `seguranca-social-direta` | `manual`           | B     | `form`    | `portuguese-portals/seguranca-social-direta.json` | Unverified layout    |
| Strapi Admin                                | `strapi`                  | `manual`           | B     | `form`    | `self-hosted/strapi.json`                         | Unverified layout    |
| Supermicro BMC                              | `supermicro`              | `generic-form`     | B     | `form`    | `appliances/supermicro.json`                      | Unverified layout    |
| TP-Link managed switch                      | `tplink-switch`           | `generic-form`     | A     | `form`    | `appliances/tplink-switch.json`                   | Authoritative source |
| Uptime Kuma (self-hosted)                   | `uptime-kuma`             | `manual`           | A     | `form`    | `self-hosted/uptime-kuma.json`                    | Authoritative source |
| VMware vSphere                              | `vmware`                  | `generic-form`     | B     | `form`    | `appliances/vmware.json`                          | Unverified layout    |
| Wazuh dashboard (self-hosted)               | `wazuh`                   | `manual`           | A     | `form`    | `self-hosted/wazuh.json`                          | Authoritative source |
| Zabbix frontend (self-hosted)               | `zabbix`                  | `manual`           | A     | `form`    | `self-hosted/zabbix.json`                         | Authoritative source |
| Zoom web portal                             | `zoom`                    | `manual`           | B     | `form`    | `enterprise-identity/zoom.json`                   | Unverified layout    |
| Zulip (organization / self-hosted)          | `zulip`                   | `manual`           | A     | `form`    | `self-hosted/zulip.json`                          | Authoritative source |

### Evidence, but no steps file (3)

The login layout is known. The Note says why no steps file was written.

| Application           | Id           | Catalog capability | Class | Mechanism | Steps file | Note                                                                                                                                                                                     |
| --------------------- | ------------ | ------------------ | ----- | --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adobe Account         | `adobe`      | `manual`           | B     | `form`    | none       | The steps format cannot tell the two stages of the sign-in apart: they differ only by URL fragment. The reviewed `adobe` adapter is not connected to this profile, so it is manual today |
| IMT — Serviços online | `imt-online` | `manual`           | B     | `form`    | none       | The page's own form needs a third value, a taxpayer number, which the steps format does not carry; its two buttons lead to another origin                                                |
| Microsoft Exchange    | `exchange`   | `manual`           | A     | `form`    | none       | The steps format cannot express what the Outlook Web Access form needs. The reviewed `exchange-owa` login is not connected to this profile, so it is manual today                        |

### Nothing to build from (41)

Class C. The Note says why. Each application's `evidence.json` says what was looked for and what you
can supply.

| Application                            | Id                     | Catalog capability | Class | Mechanism | Steps file | Note                                                                                                                                                              |
| -------------------------------------- | ---------------------- | ------------------ | ----- | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple Account (Apple ID)               | `apple-account`        | `manual`           | C     | `none`    | none       | Robots rules or terms: Apple's website terms bar automatic programs from its sites                                                                                |
| Apple Developer account                | `apple-developer`      | `manual`           | C     | `none`    | none       | Robots rules or terms: Apple's website terms bar automatic programs from its sites                                                                                |
| Arlo Secure web portal                 | `arlo`                 | `manual`           | C     | `none`    | none       | Refused or unreadable: the host answers automated requests with a challenge page                                                                                  |
| Autodesk Account                       | `autodesk`             | `manual`           | C     | `none`    | none       | Robots rules or terms: Autodesk's terms appear to bar collecting information by automated means                                                                   |
| AWS Management Console                 | `aws-console`          | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the console host for every agent                                                                                      |
| AWS Management Console — China         | `aws-console-china`    | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the console host for every agent                                                                                      |
| AWS Management Console — GovCloud (US) | `aws-console-govcloud` | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the console host for every agent                                                                                      |
| Canva                                  | `canva`                | `generic-form`     | C     | `none`    | none       | Robots rules or terms: robots.txt shuts the login page to the agent that made the review; what was found describes an email-and-code sign-in, not a password form |
| Cegid Primavera — Portal de Cliente    | `cegid-primavera`      | `manual`           | C     | `none`    | none       | Robots rules or terms: sign-in is on the vendor's identity service, whose robots rules disallow every path                                                        |
| Drone CI                               | `drone-ci`             | `manual`           | C     | `none`    | none       | No password form: sign-in is an OAuth hand-off to the Git provider                                                                                                |
| E-REDES — Balcão Digital               | `e-redes`              | `manual`           | C     | `none`    | none       | Robots rules or terms: the operator's terms of use forbid automatic mechanisms that copy the website                                                              |
| Eaton UPS web administration           | `eaton-ups`            | `manual`           | C     | `none`    | none       | No public markup: the network card has a login page, but no public source shows it                                                                                |
| eBay account                           | `ebay`                 | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the sign-in host for every agent                                                                                      |
| Facebook                               | `facebook`             | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the site for every agent it does not name                                                                             |
| HPE Support Center                     | `hpe-support`          | `manual`           | C     | `none`    | none       | Refused or unreadable: HPE's terms could not be read at the source, so no capture was made                                                                        |
| iCloud                                 | `icloud`               | `manual`           | C     | `none`    | none       | Robots rules or terms: Apple's website terms bar automatic programs from its sites                                                                                |
| IRN — Registos online                  | `irn-online`           | `manual`           | C     | `none`    | none       | No password form: sign-in is handed to a government identity realm; no user name and password form is recorded                                                    |
| Kimi                                   | `kimi`                 | `manual`           | C     | `none`    | none       | Robots rules or terms: the provider's terms forbid automated tools; whether there is a password form at all is not established                                    |
| Lenovo XClarity                        | `lenovo`               | `generic-form`     | C     | `none`    | none       | No public markup: the XClarity Controller has a login window, but no public source shows it                                                                       |
| Lovable                                | `lovable`              | `manual`           | C     | `none`    | none       | Robots rules or terms: the provider's terms forbid access by automated tools                                                                                      |
| LXD / Incus                            | `lxd`                  | `manual`           | C     | `none`    | none       | No password form: a client certificate (mutual TLS) or OpenID Connect                                                                                             |
| Marcaria                               | `marcaria`             | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the directory that holds the sign-in page                                                                             |
| MEO — Empresas                         | `meo-empresas`         | `manual`           | C     | `none`    | none       | Robots rules or terms: the customer area's conditions of use forbid tools that collect data from it                                                               |
| MEO — Particulares (my MEO)            | `meo-particulares`     | `manual`           | C     | `none`    | none       | Robots rules or terms: the customer area's conditions of use forbid tools that collect data from it                                                               |
| Microsoft Developer portal             | `microsoft-developer`  | `manual`           | C     | `none`    | none       | No password form: the catalog address is a content page; where you sign in depends on the program chosen there                                                    |
| Microsoft personal account             | `microsoft-account`    | `manual`           | C     | `none`    | none       | Refused or unreadable: the one permitted load failed before anything was read                                                                                     |
| Namecheap                              | `namecheap`            | `manual`           | C     | `none`    | none       | Refused or unreadable: the provider's legal pages refuse automated reads, so its terms could not be read                                                          |
| Network Solutions                      | `network-solutions`    | `manual`           | C     | `none`    | none       | Refused or unreadable: robots.txt and the sign-in page both answer HTTP 403 with a security check                                                                 |
| Notion                                 | `notion`               | `manual`           | C     | `none`    | none       | Robots rules or terms: Notion's terms appear to bar automated processes that extract data                                                                         |
| npm package registry                   | `npm`                  | `manual`           | C     | `none`    | none       | Refused or unreadable: the host answers automated requests with a challenge page; its terms also restrict automated access                                        |
| OpenRouter                             | `openrouter`           | `manual`           | C     | `none`    | none       | Robots rules or terms: the provider's terms forbid copying information from the site by automated means                                                           |
| OVHcloud Control Panel (EU)            | `ovhcloud`             | `manual`           | C     | `none`    | none       | Robots rules or terms: the sign-in form is on another host, whose robots.txt disallows its address                                                                |
| Reddit                                 | `reddit`               | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the site for every agent; the fields also sit in shadow roots, which the steps format cannot address                  |
| register.com (Network Solutions)       | `register-com`         | `manual`           | C     | `none`    | none       | Refused or unreadable: shares the Network Solutions sign-in, which answers HTTP 403 with a security check                                                         |
| Registro.br                            | `registro-br`          | `manual`           | C     | `none`    | none       | Refused or unreadable: no terms document could be found or read                                                                                                   |
| Steam account                          | `steam`                | `manual`           | C     | `none`    | none       | Robots rules or terms: the subscriber agreement bars scripts and other systems not controlled by a person                                                         |
| Tesla Account                          | `tesla`                | `manual`           | C     | `none`    | none       | Refused or unreadable: robots.txt and the terms page both answered HTTP 403                                                                                       |
| Time4VPS dashboard                     | `time4vps`             | `manual`           | C     | `none`    | none       | Refused or unreadable: the billing host and the provider's website refuse automated reads                                                                         |
| UZO — Particulares (my UZO)            | `uzo-particulares`     | `manual`           | C     | `none`    | none       | Robots rules or terms: the customer area's conditions of use forbid tools that collect data from it                                                               |
| Via Verde — Área de cliente            | `via-verde`            | `manual`           | C     | `none`    | none       | Robots rules or terms: one clause of the site's conditions can be read as forbidding it, and an unclear clause is treated as a prohibition                        |
| X (Twitter)                            | `x`                    | `manual`           | C     | `none`    | none       | Robots rules or terms: robots.txt disallows the site for every agent it does not name                                                                             |

<!-- coverage:matrix:end -->

## What this page does not prove

A class B layout was not confirmed against the live site or device. Hosted providers also change
their pages: the evidence records the date it was reviewed, not what a provider serves next month.
Only a sign-in by you, or a page you saved, confirms a layout. A login that runs from steps fails
closed: when the layout does not match, nothing is typed and you sign in by hand.

A class A login is not proof of a sign-in either. It says that every selector was seen in a source
that can be trusted to show the real form; no account was used to try it.

## For contributors

```sh
node --test tests/tooling/loginFixtureCorpus.node-test.mjs
LOGIN_COVERAGE_WRITE=1 node --test tests/tooling/loginFixtureCorpus.node-test.mjs
npx prettier --check docs/application-login-coverage.md
node scripts/capture-login-page.mjs --list
```

The first command checks every application directory under `tests/fixtures/logins`, and prints a
note when this page is not what the catalog, the evidence records and the steps files give. With
`LOGIN_CORPUS_STRICT=1`, which gates use, that note is a failure.

The second command regenerates this page: it rewrites the text between the `coverage:summary`
markers and between the `coverage:matrix` markers, and nothing else. In PowerShell, set the
variable first with `$env:LOGIN_COVERAGE_WRITE = "1"`. Do not edit the generated parts by hand,
with two exceptions that the command keeps as it finds them:

- the **Application** cell of a row. A new application appears under its id until it is named;
- the **Note** of a row under "Evidence, but no steps file" or "Nothing to build from". Under
  "Nothing to build from" it must open with `Robots rules or terms`, `Refused or unreadable`,
  `No public markup` or `No password form`, followed by a colon and the detail.

The last command lists the applications whose public sign-in page the capture tool may render.
