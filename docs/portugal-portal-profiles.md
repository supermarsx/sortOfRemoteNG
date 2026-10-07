# Portuguese portal profiles

Reviewed on 2026-10-06. Implementation:
`src/utils/connection/portugalPortalProfiles.ts`, exporting
`PORTUGAL_PORTAL_PROFILES: readonly HttpApplicationProfile[]`. The module contains
12 manual-only profiles. Tests import this array directly; registration, shared
authentication logic, editor changes and icon mapping belong to the main lane.

## Capability and routing limits

Every profile has `capability: "manual"`, `loginModes: ["manual"]` and
`requiresHttps: true`. There are no form selectors, credential adapters, email-only
assistance, automatic TOTP challenges, auxiliary credential origins or wildcard
grants. No account was registered, no credentials were entered and no authenticated
session was tested. Public documentation, links, anonymous HTML and HTTP redirects
establish the portal entries only. Public inputs or a login title do not establish
a reviewed form contract or successful login.

The module imports the core profile type with `import type`. It makes no requests
and changes no proxy or consent behavior. Once integrated, embedded requests,
secondary resources and identity-provider redirects must continue through the
existing application proxy and its origin/consent controls. A referenced identity
provider is evidence, not permission to release credentials or grant access to
that origin. No direct-network fallback or automatic external-browser handoff is
introduced. Runtime proxy traversal and embedded login compatibility have not been
validated by this data-only lane.

All persisted entries are HTTPS URLs without query strings, fragments, credentials
or captured SAML/OIDC transaction data. Portals generate their own authentication
transactions when the user navigates. Some entries are service gateways with a
Login action rather than standalone password forms; those cases are explicit
below. Product-specific tenant/ERP installations must use their administrator's
actual URL in a separately configured connection, not one of these public customer
presets. No unknown tenant hostname has been synthesized.

## Primary evidence and chosen entries

### Cegid Primavera customer portal

- Profile: `cegid-primavera`, **Cegid Primavera — Portal de Cliente**.
- Selected entry: <https://mycegid.ila.cegid.com/pt/>.
- Primary source: Cegid Primavera's [customer registration and subscription guide](https://www.primaverabss.com/pt/Userfiles/Downloads/Processo_de_Registo_Adesao_Faturacao_Direta_Cliente.pdf).
  Page 10 identifies the customer portal; its PDF link annotation targets
  `https://myprimavera.primaverabss.com/`. Page 14 distinguishes the identity account
  from the customer subscription portal: the respective annotations point to
  `https://id.cegid.cloud/` and `https://myprimavera.primaverabss.com/pt/`.
- An anonymous GET to the latter customer URL returned HTTP 301 to
  `https://mycegid.ila.cegid.com/pt/`. An anonymous GET there returned HTTP 302 to
  `https://id.cegid.cloud/connect/authorize` with transaction parameters. Only the
  stable customer entry is saved. The web research reader returned 403 for the
  customer sites; the redirect evidence came from separate anonymous HTTP reads.
- This is the source-backed Primavera customer/subscription entry, not Partner
  Space, a generic Cegid identity account, or an arbitrary ERP tenant. Identity
  routing and all challenges remain interactive; no tenant account or live login
  was tested.

### Autoridade Tributária

- Profile: `autoridade-tributaria`, **Autoridade Tributária — Portal das Finanças**.
- Selected entry: <https://www.portaldasfinancas.gov.pt/at/html/index.html>.
- Primary source: the [official Portal das Finanças](https://www.portaldasfinancas.gov.pt/)
  redirects to that path. Its public HTML includes the AT identity and the
  **Iniciar Sessão** link to
  `https://sitfiscal.portaldasfinancas.gov.pt/geral/dashboard`.
- Both the web reader and a separate anonymous HTTP GET returned 404 for that
  published sign-in destination during this review. The selected public service
  portal returned 200. The preset therefore opens the working official entry and
  lets the user select a service/sign-in action. It does not claim the downstream
  authentication service was available.
- No guessed `acesso.gov.pt` authorization URL, NIF form selectors or automatic
  government credential sharing is provided.

### Segurança Social Direta

- Profile: `seguranca-social-direta`, **Segurança Social Direta**.
- Selected entry: <https://www.seg-social.pt/ptss/>.
- Primary sources: the [official Segurança Social website](https://www.seg-social.pt/)
  currently redirects to that Segurança Social Direta entry. A separate anonymous
  GET to `/ptss/` returned 302 to `/ptss/pssd/home`, which returned 200 with the
  Segurança Social Direta title.
- The web reader exposed only a JavaScript application shell. The preset retains
  the published portal path, not an old bookmarked CAS transaction or an API
  endpoint. The user chooses the service and authentication method interactively;
  no current login DOM, account access or embedded flow was verified.

### IRN online

- Profile: `irn-online`, **IRN — Registos online**.
- Selected entry: <https://registo.justica.gov.pt/Login>.
- Primary source: the [Plataforma de Registos](https://registo.justica.gov.pt/)
  exposes **Login** with that exact path and provides citizen, business, property
  and movable-property service categories, plus IRN contacts.
- Anonymous HTML inspection confirmed `/Login`; an anonymous GET returned 302 to
  the SAML endpoint at
  `https://autenticacao.irn.justica.gov.pt/realms/justica/protocol/saml`.
  Transaction parameters are not persisted. The web reader could not inspect the
  login destination.
- This is the general Registos portal. It does not assert a universal login for
  every IRN specialized site (such as Civil Online or testaments), nor automate
  citizen-card, digital-key or representative authentication.

### E-REDES Balcão Digital

- Profile: `e-redes`, **E-REDES — Balcão Digital**.
- Selected entry: <https://balcaodigital.e-redes.pt/home>.
- Primary source: E-REDES's [official help page](https://www.e-redes.pt/pt-pt/ajuda/perguntas-frequentes/anomalias-avarias-videos)
  links to this exact Balcão Digital URL and describes network-service functions.
  The [official FAQ](https://www.e-redes.pt/pt-pt/faqs) describes registration and
  account access separately.
- The target is the customer service application, not the institutional/marketing
  homepage. Its JavaScript application was not rendered by the research reader.
  The user selects Login; registration, password recovery and verification stay
  manual. No forms or authenticated network-service requests were exercised.

### MEO individuals and companies

- Profiles: `meo-particulares`, **MEO — Particulares (my MEO)**; `meo-empresas`,
  **MEO — Empresas**.
- Consumer entry: <https://my.meo.pt/>. The [official my MEO page](https://www.meo.pt/cliente)
  links **my MEO na Web** directly there. Its documentation also explains that
  some company services can be associated in my MEO. The reader saw only the
  JavaScript-required shell at the consumer entry.
- Business entry:
  <https://cliente-empresas.meo.pt/Pages/Dashboard/Dashboard.aspx>.
  The [official business customer page](https://www.meo.pt/empresas/cliente)
  publishes that exact **Entrar** link under the Grandes Empresas area.
  Following it redirected toward `id.services.telecom.pt/oic`, including an
  OpenID transaction and a callback to `/Pages/Login/Login.aspx`; the research
  reader could not access the identity destination. The preset saves the
  published dashboard entry and none of the transaction parameters.
- These are deliberately separate profiles. Business service eligibility and
  account association are determined by MEO; neither preset asserts every company
  uses the Grandes Empresas portal. ID MEO, Google/Apple options, verification and
  account association remain interactive. A Google sign-in option on a third-party
  portal does not make it a first-party Google profile.

### My Vodafone Portugal

- Profile: `vodafone-portugal`, **My Vodafone — Portugal**.
- Selected entry: <https://my.vodafone.pt/>.
- Primary source: the [official My Vodafone portal](https://my.vodafone.pt/)
  identifies the customer account service, including billing, products, settings
  and business-service management. The root redirected to `/main.html` during
  review. This is the account application's entry, not Vodafone's general product
  website.
- Login and registration are selected inside the portal. No captured
  `login.vodafone.pt` authorization URLs, request IDs, nonces or callbacks are
  saved. No login form contract, SMS challenge or authenticated access was tested.

### DIGI Portugal

- Profile: `digi-portugal`, **DIGI — Portugal (My DIGI)**.
- Selected entry: <https://mydigi.digi.pt/>.
- Primary source: DIGI Portugal's [official customer support page](https://www.digi.pt/apoio-ao-cliente)
  links **My DIGI** and its customer-area action directly to that root. It
  separately links bill payment and order tracking, which are not this preset.
- The target returned a JavaScript loading shell to the reader. The official link
  establishes the Portuguese customer portal but does not establish a form
  selector contract. No other country's DIGI portal or guessed `/login` path is
  used; sign-in and challenges remain manual.

### IMT Online

- Profile: `imt-online`, **IMT — Serviços online**.
- Selected entry: <https://servicos.imt-ip.pt/login.aspx>.
- Primary source: IMT's [official access FAQ](https://www.imt-ip.pt/faq/como-posso-aceder-aos-servicos-do-imtonline-2/)
  links to IMT Online and describes authentication using the available government
  methods. Following that link reached `/login.aspx?ReturnUrl=/default.aspx`.
  The query-free [login page](https://servicos.imt-ip.pt/login.aspx) was also read
  directly and identified IMT Online.
- Public page text distinguishes individuals, businesses and representatives,
  including taxpayer, citizen-card and digital-key options. These different paths
  are not reduced to a generic username/password form. No AT credentials,
  representative credentials or challenge codes are filled automatically.

### Via Verde

- Profile: `via-verde`, **Via Verde — Área de cliente**.
- Selected entry: <https://www.viaverde.pt/particulares/login>.
- Primary source: the [official login page](https://www.viaverde.pt/particulares/login)
  presents the **A Minha Via Verde** customer login and account-management actions.
  It also includes registration/recovery controls and separate business/visitor
  navigation.
- The preset targets the private-customer portal. It does not substitute a partner
  portal or assert business/visitor compatibility. Public page text contains
  multiple input groups, so no generic form selection or automated submission is
  enabled. There was no authenticated account, toll, vehicle or billing action.

### UZO individuals; separate business portal unverified

- Profile: `uzo-particulares`, **UZO — Particulares (my UZO)**.
- Selected entry: <https://my.uzo.pt/>.
- Primary source: the [official UZO help page](https://www.uzo.pt/ajuda), under
  **Área de cliente my UZO na web**, links **Aceder área cliente** to that exact
  root. The [customer-data help page](https://www.uzo.pt/ajuda/dados-de-cliente)
  also documents the customer area, but its `/l/home` app-oriented link redirected
  to help with campaign parameters in the research reader. The preset uses the
  explicit web entry and drops app/campaign links. The root returned the
  JavaScript-required shell; no form or login was verified.
- Official-domain searches for UZO business/customer portals, plus the homepage
  and help pages, did not establish a separate **UZO Empresas** portal. The
  [technical-support page](https://www.uzo.pt/ajuda/apoio-tecnico) does mention a
  business customer in its warranty information; that is not evidence of a
  distinct business login destination. This review does **not** conclude that UZO
  has no business customers.
- Consequently no `uzo-empresas` preset, invented business hostname or substitute
  MEO Empresas destination is included. A future separate business preset needs
  a primary source naming its actual entry. A user-supplied business/tenant URL
  can instead be explicitly configured with an appropriate manual custom profile.
- Individual accounts use this single my UZO entry. If UZO makes a business
  account available under the same customer access, reuse this entry for its
  associated services. This is conditional account guidance, not verification
  that every business contract is supported by my UZO. The ID remains
  `uzo-particulares`; no second preset or business hostname is introduced.

## Suggested existing icon keys

These are handoff suggestions only; this lane does not edit shared icon files.
The keys were checked in the existing business, telecom, building, generic-shape
and industrial-asset icon catalogs. Generic symbols below are not official portal
logos.

| Profile ID                | Existing icon key                  |
| ------------------------- | ---------------------------------- |
| `cegid-primavera`         | `primavera` (alternative: `cegid`) |
| `autoridade-tributaria`   | `building-government`              |
| `seguranca-social-direta` | `people`                           |
| `irn-online`              | `building-government`              |
| `e-redes`                 | `lightning`                        |
| `meo-particulares`        | `meo`                              |
| `meo-empresas`            | `meo`                              |
| `vodafone-portugal`       | `vodafone`                         |
| `digi-portugal`           | `digi`                             |
| `imt-online`              | `vehicle`                          |
| `via-verde`               | `vehicle`                          |
| `uzo-particulares`        | `uzo`                              |

## Validation scope

`tests/utils/portugalPortalProfiles.test.ts` imports the exported array directly
and checks completeness/uniqueness, manual-only capabilities, absence of credential
and challenge automation, exact reviewed destinations, HTTPS without embedded
identity state, and separation of the two MEO portal origins. These are offline
metadata checks, not live website or proxy-routing tests. The main lane must wire
the registry and validate its shared default-mode/consent behavior separately.
