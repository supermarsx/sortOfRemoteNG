# Login fixture corpus

One directory per application of the website application catalog. Each directory states where
the application's login selectors came from (`evidence.json`) and pins the layout they were
written for (`fixture.html`). The corpus runners load every profile against its fixture; the
check described here makes sure nothing in the corpus presents a guess as verified.

```
tests/fixtures/logins/
  README.md                  this file
  evidence.schema.json       structure of evidence.json
  <id>/                      <id> is the catalog profile id, for example zoom
    evidence.json            required
    fixture.html             required for a form login: the first document of the flow
    fixture.<name>.html      optional: a later step, another origin, or a frame's content
    capture.json             capture tool output, when a source cites one
    capture.<name>.json      optional further captures
```

Nothing else may be in an application directory: no scripts, images, styles or subdirectories.
The application's steps live elsewhere, in `src/data/loginSteps/<family>/<id>.json`
(format: `src/types/connection/httpLoginSteps.ts`).

## Rules that have no exceptions

- Every selector cites a source in `evidence.json`. A selector from memory is not acceptable, and
  there is no source kind for it.
- Never enter a credential anywhere, create an account, or answer a CAPTCHA.
- Never contact a private address or a device on the user's network. Never download or decrypt
  DSM firmware and never run Virtual DSM.
- Network reads are for public sources only: a project's public repository, vendor documentation,
  and one anonymous render of a catalog `hostedLoginUrl` with the capture tool, and that only after
  the host's robots rules and terms were checked (see "Before a hosted capture").
- Fixtures are synthetic: the controls a selector needs and their ancestors. No vendor script,
  style, image, icon or page copy.
- No credential, account name, session value or private address in any file here. Synthetic
  credentials belong to the test runners, not to the corpus.

## Evidence classes

| Class | Meaning                                                                                                                                    | Result                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **A** | Every selector was **observed** in an **authoritative** source.                                                                            | Reviewed login.                                        |
| **B** | At least one selector is inferred, or comes from an anonymous capture or secondary material. An informed guess until the user confirms it. | Selectable, shown with an "unverified layout" note.    |
| **C** | Nothing to build from: no saved-password form as far as the evidence shows, or the page cannot be reached anonymously.                     | Evidence only: no selectors, no fixture, no steps file |

Class is decided by the evidence, not chosen. The check refuses class A when any selector is
`inferred`, cites a source that is not authoritative, or when a fixture is derived from one.
Labelling something B that could be A is allowed; the check prints a note.

### What counts as a source

| `kind`                 | Authoritative | What it is                                                                                   | Required fields                   |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------- | --------------------------------- |
| `repository`           | yes           | A fixture, adapter or test already in this repository.                                       | `path` (must exist)               |
| `public-source`        | yes           | The application's own published source code.                                                 | `url`, and `commit` or `version`  |
| `cdp-auth`             | yes           | The user's `cdp-auth` tool (`github.com/supermarsx/cdp-auth`).                               | `url`, `commit`, `path`           |
| `user-capture`         | yes           | A page the user saved from their own account or device, read with `--from-file`.             | `capture`, `captureSha256`        |
| `user-confirmation`    | yes           | The user signed in with this layout.                                                         | `note` (what was confirmed)       |
| `anonymous-capture`    | no            | The public `hostedLoginUrl`, rendered once without an account. It shows the first step only. | `url`, `capture`, `captureSha256` |
| `vendor-documentation` | no            | Manuals and help pages. They show screenshots, not markup.                                   | `url`                             |
| `secondary`            | no            | Anything else that is public: third-party integrations, write-ups.                           | `url`                             |

Every source also has `id`, `title` and `retrieved` (the date it was read). A `public-source` or
`cdp-auth` URL must be pinned: a commit or a release tag, never `main` or `master`. Source URLs
must be `https` on a public host. A `repository` source is never a file of this corpus or of
`src/data/loginSteps`: those are what the evidence explains, not its proof.

`user-capture` and `user-confirmation` come from the user and from nobody else. Do not write
either on the user's behalf: a page you fetched yourself is not a user capture, and a login nobody
signed in with is not confirmed.

An authoritative source supports class A only for what it actually contains. `cdp-auth` shows that
a login is "click `#tab2`, fill two ids, press Enter"; when the ids themselves are passed in by the
user and are not in the script, selectors for them are `inferred`.

## evidence.json

Structure is in `evidence.schema.json`; put `"$schema": "../evidence.schema.json"` first to get
editor validation. The fields:

| Field              | Required          | Meaning                                                                                                          |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `version`          | yes               | `1`                                                                                                              |
| `id`               | yes               | The directory name and catalog profile id.                                                                       |
| `proposedProfile`  | new profiles only | `true` for an application that is not in the catalog yet.                                                        |
| `class`            | yes               | `A`, `B` or `C`.                                                                                                 |
| `mechanism`        | yes               | `form`, `adapter` (a dedicated staged adapter, catalog `loginFlow`), `http-auth`, or `none` (class C).           |
| `source`           | A and B           | The primary citation: the `url`, `path` or capture path of one entry of `sources`.                               |
| `reviewed`         | yes               | Date of the review, `YYYY-MM-DD`.                                                                                |
| `summary`          | yes               | One or two sentences: what the login is.                                                                         |
| `sources`          | yes               | The sources, see above. At least one for A and B.                                                                |
| `selectors`        | yes               | One entry per selector: `selector`, `role`, `source` (a source id), `basis`, `locator`, optional `fixture`.      |
| `fixtures`         | yes               | One entry per fixture file: `file`, optional `origin`, `path`, optional `frame`, `derivedFrom` (source ids).     |
| `staysInteractive` | yes               | What the user still does by hand (`captcha`, `device-approval`, `sms-code`, ...). `[]` if nothing is known.      |
| `unverified`       | B                 | Each thing that was not observed.                                                                                |
| `neededFromUser`   | B and C           | What would make this class A. A page asked for is asked for as "Webpage, Complete"; see "A page the user saved". |
| `lookedFor`        | C                 | What was examined and what it showed.                                                                            |
| `schemaGaps`       | optional          | Anything about the login that the steps format could not express.                                                |
| `notes`            | optional          | Anything else worth keeping.                                                                                     |

`selectors[].basis` is `observed` when the attributes the selector relies on are present in the
cited source, and then `locator` says where (a line range, or the element's id in a capture). It
is `inferred` when they were worked out from the source without being seen there. Where the
source is at hand the check verifies `observed`: a selector citing a capture must match an element
of that capture, and the ids and field names of a selector citing a repository file must occur in
that file. An attribute the capture withheld (written as `null`) was not observed.

`fixtures[].origin` is omitted for the connection's own origin (for a hosted application, the
origin of its `hostedLoginUrl`), exactly as in the steps format. Any other origin is an exact
`https://host` and needs its own fixture file. It must be an origin the steps format accepts as a
listed credential origin: a public DNS name, so no IP address, no single-label host and no name
under a private-use suffix such as `.local`, `.lan` or `.corp`. `fixtures[].path` is the pathname
the document is served on; a step's path gate must accept it.

### Class A example

The ids, URLs and selectors in these three examples are invented.

```json
{
  "$schema": "../evidence.schema.json",
  "version": 1,
  "id": "example-dashboard",
  "class": "A",
  "mechanism": "form",
  "source": "https://github.com/example/dashboard/blob/3f2a9c1d5e7b8a6f4c0d1e2f3a4b5c6d7e8f9a0b/web/templates/login.html",
  "reviewed": "2026-10-12",
  "summary": "One POST form at /login on the connection's own origin. The project publishes the template.",
  "sources": [
    {
      "id": "template",
      "kind": "public-source",
      "title": "Login template of release 4.2.0",
      "url": "https://github.com/example/dashboard/blob/3f2a9c1d5e7b8a6f4c0d1e2f3a4b5c6d7e8f9a0b/web/templates/login.html",
      "commit": "3f2a9c1d5e7b8a6f4c0d1e2f3a4b5c6d7e8f9a0b",
      "version": "4.2.0",
      "retrieved": "2026-10-12"
    }
  ],
  "selectors": [
    {
      "selector": "form#login-form input#id_username[name=\"username\"]",
      "role": "username",
      "source": "template",
      "basis": "observed",
      "locator": "lines 18-19"
    },
    {
      "selector": "form#login-form input#id_password[type=\"password\"]",
      "role": "password",
      "source": "template",
      "basis": "observed",
      "locator": "lines 22-23"
    },
    {
      "selector": "form#login-form button[type=\"submit\"]",
      "role": "control",
      "source": "template",
      "basis": "observed",
      "locator": "line 27"
    }
  ],
  "fixtures": [
    { "file": "fixture.html", "path": "/login", "derivedFrom": ["template"] }
  ],
  "staysInteractive": [
    {
      "kind": "single-sign-on",
      "note": "An administrator can replace the form with an identity provider."
    }
  ]
}
```

### Class B example

```json
{
  "$schema": "../evidence.schema.json",
  "version": 1,
  "id": "example-portal",
  "class": "B",
  "mechanism": "form",
  "source": "https://portal.example.com/signin",
  "reviewed": "2026-10-12",
  "summary": "Identifier first on the portal, then a password page on the provider's identity origin.",
  "sources": [
    {
      "id": "page",
      "kind": "anonymous-capture",
      "title": "The public sign-in page, rendered once without an account",
      "url": "https://portal.example.com/signin",
      "capture": "capture.json",
      "captureSha256": "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
      "retrieved": "2026-10-12"
    },
    {
      "id": "help",
      "kind": "vendor-documentation",
      "title": "Sign-in help article, which shows the password page",
      "url": "https://help.example.com/articles/signing-in",
      "retrieved": "2026-10-12"
    }
  ],
  "selectors": [
    {
      "selector": "form#identifier input[name=\"email\"][autocomplete=\"username\"]",
      "role": "username",
      "source": "page",
      "basis": "observed",
      "locator": "frames[0], form#identifier"
    },
    {
      "selector": "form#identifier button[type=\"submit\"]",
      "role": "control",
      "source": "page",
      "basis": "observed",
      "locator": "frames[0], form#identifier"
    },
    {
      "selector": "form input[name=\"password\"][type=\"password\"]",
      "role": "password",
      "source": "help",
      "basis": "inferred",
      "fixture": "fixture.password.html"
    }
  ],
  "fixtures": [
    { "file": "fixture.html", "path": "/signin", "derivedFrom": ["page"] },
    {
      "file": "fixture.password.html",
      "origin": "https://id.example.com",
      "path": "/password",
      "derivedFrom": ["help"]
    }
  ],
  "staysInteractive": [
    { "kind": "captcha", "note": "A challenge widget is present on the page." },
    { "kind": "device-approval" }
  ],
  "unverified": [
    "The password page: it is shown only after an existing account name is accepted.",
    "Whether the identity origin is the same for every region."
  ],
  "neededFromUser": "One sign-in with this layout, or the password page saved signed out as Webpage, Complete, before the password is typed."
}
```

### Class C example

```json
{
  "$schema": "../evidence.schema.json",
  "version": 1,
  "id": "example-appliance",
  "class": "C",
  "mechanism": "none",
  "reviewed": "2026-10-12",
  "summary": "Closed firmware with several sign-in variants; no public markup was found.",
  "sources": [],
  "selectors": [],
  "fixtures": [],
  "staysInteractive": [{ "kind": "other", "note": "The whole sign-in." }],
  "lookedFor": [
    "The vendor's manual: screenshots only, no markup.",
    "Public repositories and integrations: none reproduce the login page."
  ],
  "neededFromUser": "The device's login page, saved signed out as Webpage, Complete."
}
```

## fixture.html

A fixture is the smallest document on which the selectors mean what they meant in the source:
the controls, their attributes, and the ancestors a selector names. Write it from the source, or
start from the draft the capture tool writes.

The check refuses a fixture that:

- has a `script`, `style`, `link`, `img`, `svg`, `canvas`, media, `object`, `embed`, `base` or
  `meta http-equiv` element, an inline `on...` handler, `srcdoc`, `srcset`, or a `style` attribute
  that loads something;
- frames anything but another listed fixture file of the same directory
  (`<iframe id="appFrame" src="fixture.frame.html">`), or names an absolute URL whose origin is not
  the `origin` of a listed fixture;
- has a password field with a value, or anything resembling a credential, an account name, a
  session token or a private address;
- holds more than 1000 characters of text and comments, is larger than 64 KiB, or has no form
  control at all.

`action="javascript:"` (the bare marker, no code) is allowed, because "a script handles this form"
is a layout fact some selectors depend on.

Each selector in `evidence.json` must match an element of its fixture, and each selector of the
steps file must match a fixture served where that step runs: same origin, a `path` its path gate
accepts, and the same `frame`. A step on another origin, a later page, or a frame's content
therefore needs its own `fixture.<name>.html` entry.

## Before a hosted capture: robots rules and terms

The capture tool does not decide whether a page may be captured. That is checked by whoever runs
it, before each run, and the check is recorded.

A hosted login page may be captured only when **both** hold, for the catalog host **and** for the
host the page ends on after redirects:

1. The host's `robots.txt` was readable and does not disallow the login path, for unnamed agents
   or for this agent by name; or the host plainly has no robots file (a 404).
2. The provider's published terms were readable and contain no clause against automated access,
   or against automated collection or extraction.

A refused request (a 403, a security check, a challenge page), or terms that cannot be found or
read, mean the check did not come back clean: **no capture**. The application is then documented
from other public material that actually contains the markup, or it stays class C until the user
saves the page themselves and it is imported with `--from-file`.

`evidence.json` records what was read: the URL, the date, and the rule or clause quoted. Put it in
the `note` of the capture's source entry, or in a `vendor-documentation` source of its own.

A redirect to another public host is followed, and the page that is captured is then that host's
(see below). The final host is only known after the run: when the tool reports that the page
ended on another host, the standard applies to that host as well, and a capture made before that
was checked is not used until it has been.

What the tool enforces, and what it leaves to the operator:

| Rule                                                                                       | Enforced by                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Only the catalog `hostedLoginUrl`, on the default https port                               | the tool                                 |
| No loopback, private, link-local or special-use address, for any connection the page makes | the tool (its connection guard)          |
| No keyboard or pointer input; nothing activated                                            | the tool                                 |
| One load per page                                                                          | the tool, and the exit status (below)    |
| No content of frames from another origin                                                   | the tool                                 |
| robots rules and terms, for the catalog host and the final host                            | **the operator**: the tool reads neither |

Before a hosted run the tool prints a one-line reminder of the last row. It does not fetch
`robots.txt` itself.

## Capture tool

`scripts/capture-login-page.mjs` writes the form skeleton of one page: tags and attributes of
forms, fields, buttons, labels and frames, with their ancestors.

```sh
# A public hosted login page: one anonymous render of the catalog hostedLoginUrl.
node scripts/capture-login-page.mjs --id <id> --fixture tests/fixtures/logins/<id>/fixture.html

# A page the user saved: parsed offline, nothing is loaded.
node scripts/capture-login-page.mjs --id <id> --from-file <saved.html> --fixture tests/fixtures/logins/<id>/fixture.html

# Which applications have a hostedLoginUrl.
node scripts/capture-login-page.mjs --list
```

The capture goes to `tests/fixtures/logins/<id>/capture.json` (or `--out <file>`). `--fixture`
also writes a fixture draft built from the skeleton. The tool prints a `captureSha256` line: copy
it into the source entry that cites the capture. It is a hash of the capture's canonical JSON, so
running `prettier --write` on the file does not change it; editing the capture does.

What the tool does and refuses:

- Hosted mode loads the application's catalog `hostedLoginUrl` and no other URL. It refuses an
  application without one, a catalog URL that names a port, loopback, private and link-local
  addresses in any spelling (including IPv6 forms that wrap an IPv4 address), and every name under
  a special-use suffix (`.local`, `.internal`, `.onion` and the rest of the list the steps format
  refuses as a listed origin).
- It loads the page once. It refuses to run when the output file exists, or when the corpus
  already holds a capture of the same URL: cite that one (`"capture": "../<other id>/capture.json"`).
  After the load it waits six seconds for script-rendered pages (`--settle-ms`, at most 20000).
  A capture that came back blocked or without a form is still the one load: keep it and work from
  other material.
- **Redirects.** A redirect to another public host is followed, and the page it ends on is the
  one captured; `source.finalUrl` records where that was. A redirect or a script navigation to a
  host that is not public is refused at the guard before any connection is made. Every capture
  states this as `limits.redirects: "public-hosts-only"`.
- It uses an installed Microsoft Edge, headless, with a new temporary profile that it deletes. It
  never touches the user's own Edge profile and downloads nothing. It opens no debugging port: the
  browser is driven over a pipe, and exits when the tool does.
- Every connection the browser makes passes a guard inside the tool that allows public addresses
  on ports 80 and 443 and nothing else. No option and no catalog entry opens another port.
- It sends no keyboard or pointer input and activates nothing. It does not disguise the headless
  browser. A page that answers with a block or a challenge is recorded as that (`httpStatus`,
  `observations`), and the application stays class B from other material, or class C.
- It reads only documents of the top document's origin. A frame from another origin is another
  party's page: the capture says that it exists and where it is from, and nothing of what is in
  it.
- It writes no page text, field value, URL query or fragment, inline handler, script or style
  body, and no browser state. A withheld attribute is written as `null`: present, value not kept.
  An `id`, a `name` or a reference to one is kept only when it is an identifier (no spaces, at
  most 128 characters); every `aria-` attribute that holds words for a person is withheld. Hosts
  of a saved page are written as `origin-N.invalid`.

### When a run writes no capture

The exit status says whether the run was the one load of the page:

| Exit | Meaning                                                                                                                                                 | Run it again?                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `0`  | The capture was written.                                                                                                                                | No. The page is captured.                                             |
| `2`  | Nothing was sent to the site: a refusal at the pre-flight, or the run failed before the guard had a connection to the site (the browser did not start). | Yes, once, after removing the cause.                                  |
| `1`  | The site was reached and the run then failed: a protocol error, a timeout, a page that could not be read, an interrupted run.                           | No. That was the one load: record the failure and use other material. |

The message says the same in words. A pre-flight refusal such as
`Refused: <host> did not resolve, so nothing was loaded` happens before any browser is started and
before anything is sent: check that the name resolves and run the command once more. If it is
refused a second time, stop and report it. A usage refusal, or a refusal because the page is
already captured, is not about the load at all.

Ending a run early: Ctrl+C, Ctrl+Break, a closing console window and a termination signal all
close the browser and delete the profile before the tool exits. A kill the tool cannot see
(`taskkill /F`, a parent process ending its job, a power cut) leaves no time for that: the browser
still exits, because its debugging pipe is gone, but the temporary profile directory stays. The
next run of the tool removes any such directory older than ten minutes. It holds the state of an
anonymous page load and nothing of the user's.

### Reading a capture

`frames[0]` is the top document; further entries are child frames. `tree` is the pruned document.
`rendered: false` marks a control that exists but is not displayed, typically the next step's
field. `observations` may hold `captcha`, `cross-origin-frame` (the page embeds a frame from
another origin), `shadow-dom`, `no-password-field` (an identifier-first page) or `error-status`.
The fixture draft covers the top document; a same-origin child frame's controls are under
`frames[n].tree` and go into their own fixture file.

A frame of another origin has no `tree` and no `controls`: only `url` (its origin, nothing more),
`parent` and `sameOriginAsTop: false`. If a login form really lives in such a frame, the capture
cannot show it and the steps format cannot address it: record that under `schemaGaps` and
`staysInteractive`.

`frames[n].name` is written only for a frame of the top document's origin, and only when it is a
plain identifier an author chose, such as `appFrame` or `login_iframe`. A frame name follows
`window.name`, so a page can put anything into it; a generated, token-shaped, long or free-text
name is withheld and the frame carries `nameWithheld: true`. The `name` attribute of an `iframe`
element is held to the same rule. A frame whose URL is `about:blank` has its parent's origin.

`network.contacted` lists every host and port the page caused the browser to contact, sorted. Two
things are normalised so the list does not describe the machine the capture was made on: the
browser's own services (`edge.microsoft.com`, `*.smartscreen.microsoft.com`, `www.bing.com`) are
left out, and a country domain of Google is written as `google.[country]`. Nothing a page
requested is dropped. `network.refused` counts the connection targets the guard refused; they are
not named, because they may be private hosts.

An anonymous capture shows the first step only. Whatever follows it is `inferred` from other
material and listed under `unverified`. When a capture has the `captcha` observation,
`staysInteractive` must list a `captcha` entry. A control inside a shadow root (`shadow` in the
tree) cannot be reached by a step selector: record that under `schemaGaps`.

### A page the user saved

Importing a saved page is a two-part job.

**The user** saves the page and notes its address. Nothing else is asked of them.

- Sign out first, or use a private window: a page saved while signed in can contain the account
  name. For the same reason save it **outside the repository**.
- Save with **"Webpage, Complete"** and keep the `<name>_files` folder beside the `.html` file.
  "Complete" writes the document as it stands in the browser. **Do not use "Webpage, HTML
  only"**: it downloads the address afresh instead of saving what is on screen (Chromium
  `content/browser/download/save_package.cc`: `SAVE_FILE_FROM_NET` for "HTML only",
  `SAVE_FILE_FROM_DOM` for "Complete"). For a page built by scripts that is the empty shell; for a
  page reached by submitting a form it may be a different page altogether.
- For an identifier-first login, save the first page, enter the account name, and save the
  password page **before** the password is typed.
- Note each page's address: host and path only, no query string.

**An executor** then runs the import, cites the capture and writes the rest:

```sh
node scripts/capture-login-page.mjs --id <id> --from-file "<folder>/<name>.html"
```

- File mode takes the `.html` (or `.htm`) file, parses that one file as it is, and reads the top
  document only. No script runs and nothing is loaded, not even from the `_files` folder.
- It prints one line a non-expert can read, for example
  `found 3 form controls, including a password field`. `found 0 form controls and no password
field` means an empty shell: the page was saved as "HTML only" or before it had finished
  loading. Ask for it again.
- A sign-in form inside a frame is not in that file. "Complete" saves each frame as its own file
  in the `_files` folder, so the frame is imported separately, into a second capture:
  `node scripts/capture-login-page.mjs --id <id> --from-file "<folder>/<name>_files/<frame>.html" --out tests/fixtures/logins/<id>/capture.frame.json`.
  Each capture gets its own `user-capture` source, and the frame's controls go into their own
  fixture file with `frame` set.
- The name of the `_files` folder is the page title, so it is written as `[saved-files]`; hosts
  become `origin-N.invalid`; values, text and queries are withheld as in any capture.
- Cite the capture as a `user-capture` source with the printed `captureSha256`, set the fixture's
  `path` from the address the user noted, then write the fixture and the steps file.

Importing alone leaves the directory failing the corpus check, by design: a capture without
`evidence.json`, a fixture and selectors is not evidence yet.

### Bringing an existing capture under the current rules

A page is never loaded a second time because the sanitizing rules changed. An existing capture is
rewritten offline instead:

```sh
# One capture.
node scripts/capture-login-page.mjs --resanitize tests/fixtures/logins/<id>/capture.json --update-evidence

# Every capture of the corpus, in one pass.
node scripts/capture-login-page.mjs --resanitize tests/fixtures/logins --update-evidence
```

This reads and writes files and does nothing else: no browser, no guard, no name lookup. It
applies the current rules (frame names, frames of another origin, the contacted list, every
attribute), marks the capture with `"sanitizer": 3`, and prints `captureSha256 <old> -> <new>`.
With `--update-evidence` it also replaces the old hash by the new one in every `evidence.json` of
the corpus that pins it (the application's own, and a sibling's that cites the capture); without
it, it names those files. A capture that already meets the rules is reported as `unchanged`.

The corpus check fails a capture whose frame name is outside the rule, and says which command
fixes it. A capture written before the current rules (no `sanitizer` mark, or an older one) that
differs in any other way is printed as a note, and fails under `LOGIN_CORPUS_STRICT=1`; a capture
marked with the current rules must meet them exactly. A selector marked `observed` is compared
with the capture as the current rules keep it, so a selector that matches only inside a frame of
another origin was not observed.

## Checking

```sh
node --test tests/tooling/loginFixtureCorpus.node-test.mjs
node --test --test-name-pattern="logins/<id>" tests/tooling/loginFixtureCorpus.node-test.mjs
npx prettier --check tests/fixtures/logins/<id> src/data/loginSteps/<family>/<id>.json
```

Each application directory is one test named `logins/<id>`. A pass:

```
✔ logins/example-dashboard (41.2ms)
```

A failure lists every problem of that directory, followed by a stack trace:

```
✖ logins/example-dashboard (38.7ms)
  AssertionError [ERR_ASSERTION]: tests/fixtures/logins/example-dashboard: 2 problem(s)
    - selectors[2] matches nothing in any fixture
    - fixture.html has a <script> element (no scripts, styles or assets)
```

Lines starting with `ℹ` are notes, not failures: for example a capture written before the current
sanitizing rules, or a class B directory whose evidence would support class A.

The same run also validates the steps file with the steps validator, and fails when the steps
file and `evidence.json` disagree: `evidence.class`, `evidence.source` and `evidence.reviewed` of
the steps file must equal `class`, `source` and `reviewed` here, every selector of the steps file
must be cited in `selectors`, and a class C directory must have no steps file.

It also reads `neededFromUser` as the instruction a user will follow. A text there that names
"HTML only", or asks for a page saved "as HTML" or "as an HTML file", fails unless it also names
the format to use, "Webpage, Complete". The other conditions belong in the same sentence, and the
check cannot see whether they are there: signed out, no password typed in, the `_files` folder
kept beside the `.html` file, and both kept outside the repository. Other fields may mention the
formats freely.

### Selectors the check can hold to their fixtures

- A selector the check cannot parse (`input#x[`, `]]]`) fails its directory, in `evidence.json`
  and in the steps file alike. It could be neither checked nor run.
- A selector list (`#new-layout input, #old-layout input`) is split on its top-level commas, and
  **every alternative** must match a fixture: in the steps file, a fixture served on that step's
  origin, path gate and frame; in `evidence.json`, a fixture of the directory. One alternative
  matching does not excuse a misspelt other. An alternative for a second layout of the page needs
  that layout as its own fixture file (`fixture.classic.html`), listed with the same origin and a
  path the step's gate accepts.
- Citing a list: `evidence.json` may list the selector exactly as the steps file writes it, when
  all its alternatives come from the same source with the same basis. When they do not (the
  current layout was observed, the older one is inferred), give each alternative an entry of its
  own with its own `source`, `basis` and `fixture`; the steps selector is then cited through its
  alternatives. An `observed` list is observed in every alternative.
- With `fixture` named in an entry, the selector as written must match that fixture; each
  alternative must still match some fixture of the directory.

Setting the environment variable `LOGIN_CORPUS_STRICT=1` is for gates: the run then also fails
when a catalog application that needs a directory has none, when
`docs/application-login-coverage.md` is not what the catalog, the corpus and the steps files
give, or when a capture is not in the current sanitized form. Without it those are printed as
notes.

An application needs a directory unless the catalog already settles it: a reviewed login
(`known-form`), HTTP authentication, no web login, or one of the two profiles the user configures
(`custom`, `generic-form`). Every other profile, `manual` or on field detection, is examined and
gets an `evidence.json`, class C included.

### The coverage document

`docs/application-login-coverage.md` is generated: its summary and its tables are written from
the catalog (capability, `loginFlow`), each `evidence.json` (class, mechanism), the steps files
that exist, and the switch for steps-based login in
`src/utils/connection/declarativeLoginSupport.ts`. After adding or changing a directory or a
steps file, regenerate it and check its formatting:

```sh
LOGIN_COVERAGE_WRITE=1 node --test tests/tooling/loginFixtureCorpus.node-test.mjs
npx prettier --check docs/application-login-coverage.md
```

In PowerShell set the variable first: `$env:LOGIN_COVERAGE_WRITE = "1"`. The run rewrites only the
text between the `coverage:summary` markers and between the `coverage:matrix` markers. Two kinds
of cell are written by a person and kept as found:

- the **Application** name of a row. A new application is listed under its id until it is named;
- the **Note** of an application that has evidence but no steps file, which says why, and of a
  class C application, which must open with one of `Robots rules or terms`,
  `Refused or unreadable`, `No public markup` or `No password form`, then a colon and the detail.
  Write it from the directory's `summary` and `lookedFor`. The summary counts class C applications
  by that opening.

The check names each row that still needs its name or its Note.

## What the check cannot see

The check is mechanical. It does not understand a fixture, and these pass it; a reviewer must
read fixtures and captures for them:

- **A plain-word prefilled username.** A field value is withheld from a capture, but a fixture
  written by hand with `value="mariana"` is a short word like any other.
- **A session id in a fixture path.** `action="/session/k3j2/login"` is a path; only long random
  segments are recognised.
- **A default password written as prose.** A comment or a text node saying that the device ships
  with a certain password is not `password=...` and is not caught.
- **A capture edited to mode `file` with its hash recomputed.** The hash proves that the capture
  was not changed after it was cited. It does not prove how the capture was obtained: that a
  `user-capture` really came from the user is a statement by whoever wrote the evidence.
- **A layout that was never seen.** `inferred` selectors match their fixture because the fixture
  was written for them. Only a sign-in by the user, or a page they saved, confirms a layout.

## One application, start to finish

1. Find the best source. In order: this repository; the application's public source at a commit
   or release; `cdp-auth`; a page the user saved. For a hosted application without any of those,
   one anonymous capture and whatever public material describes the later steps.
2. Hosted application: check robots rules and terms for the catalog host, then run the capture
   tool once; if the page ended on another host, check that host too. Self-hosted application or
   device: read the source; never contact a device.
3. Write `fixture.html` (and further fixture files for other origins, later pages, other layouts
   or frames).
4. Write `evidence.json`: sources, one `selectors` entry per selector with its `basis`, the
   fixtures, what stays interactive, and for class B what is unverified.
5. Write the steps file with the same `class`, `source` and `reviewed`, the
   `credentialOrigins`, path gates and any authenticator challenge.
6. Run the check for the application and prettier on its files.
7. Class C: write `evidence.json` only, with `lookedFor` and `neededFromUser`.
