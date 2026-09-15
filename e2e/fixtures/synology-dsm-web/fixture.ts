/**
 * Scenario state for the synthetic DSM 7.2 website fixture (t85).
 *
 * Shared by `server.mjs` (Node type stripping, inside the `test-dsm-web`
 * container) and the vitest checks next to it. Keep this module import-free
 * and erasable-only TypeScript so plain Node can load it.
 *
 * The page runtime and boot timelines come from
 * `tests/fixtures/synology/dsmLoginTimeline.ts`; callers pass them in. Nothing
 * here is a real DSM, and the recorded hits never keep a credential value.
 */

export interface DsmWebTimeline {
  readonly name: string;
  readonly path?: string;
  readonly jsdomOnly?: boolean;
  readonly initial: readonly unknown[];
  readonly steps: readonly { readonly at: number; readonly step: unknown }[];
  readonly expected: {
    readonly phase: string;
    readonly reason: string;
    readonly handoff?: string | null;
  };
}

export interface DsmWebAccount {
  readonly username: string;
  readonly password: string;
}

/** Scenario per variant. Timelines are e1's names; `slow` also holds the
 * document in `readyState === "loading"` with chained parser-blocking chunks. */
export const DSM_WEB_VARIANTS = {
  standard: {
    timeline: "vue-router-slash-normalisation",
    expectedTimeline: "vue-router-slash-normalisation",
    bootChunkDelayMs: 0,
    otp: false,
  },
  slow: {
    timeline: "quickconnect-slow-boot-splash",
    expectedTimeline: "quickconnect-slow-boot-splash",
    // Chained chunks keep DOMContentLoaded past the app's old 30 s budget
    // while each request stays under the proxy's 30 s upstream timeout.
    bootChunkDelayMs: 16_000,
    otp: false,
  },
  otp: {
    timeline: "vue-router-slash-normalisation",
    expectedTimeline: "post-submit-otp-hand-off",
    bootChunkDelayMs: 0,
    otp: true,
  },
} as const;
export type DsmWebVariant = keyof typeof DSM_WEB_VARIANTS;
export const DSM_WEB_BOOT_CHUNKS = 2;

/** DSM-side response delays, matching the simulator's click defaults. */
export const DSM_WEB_RESPONSE_DELAY_MS = {
  authType: 300,
  login: 1200,
} as const;
const RECORD_LIMIT = 200;

export interface DsmWebHits {
  variant: DsmWebVariant;
  /** Document requests; `dest` is the `Sec-Fetch-Dest` header, so a native
   * probe can be told apart from the web view's own document load. */
  documents: { t: number; method: string; path: string; dest: string | null }[];
  bootChunks: { t: number; chunk: string }[];
  /** `SYNO.API.Auth.Type` lookups: one per username submission. */
  authType: { t: number; method: string; accountMatches: boolean }[];
  /** `SYNO.API.Auth` logins: one per password submission. */
  login: {
    t: number;
    method: string;
    accountMatches: boolean;
    passwordMatches: boolean;
    otpCode: boolean;
    outcome: "signed-in" | "otp-required" | "otp-rejected" | "rejected";
  }[];
  other: { t: number; api: string; method: string }[];
  /** Page milestones posted by `app.js`; closed labels, no values. */
  page: { t: number; received: number; event: string; detail: string | null }[];
}

export interface DsmWebPageConfig {
  variant: DsmWebVariant;
  timeline: {
    name: string;
    hash: string;
    initial: readonly unknown[];
    steps: readonly { at: number; step: unknown }[];
  };
}

export interface DsmWebEntryResult {
  status: number;
  delayMs: number;
  body: unknown;
}

export function isDsmWebVariant(value: unknown): value is DsmWebVariant {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DSM_WEB_VARIANTS, value)
  );
}

function findTimeline(timelines: readonly DsmWebTimeline[], name: string) {
  const timeline = timelines.find((candidate) => candidate.name === name);
  if (!timeline) throw new Error(`Unknown DSM timeline ${name}`);
  return timeline;
}

function startHash(timeline: DsmWebTimeline) {
  const path = timeline.path ?? "/";
  const index = path.indexOf("#");
  const pathname = index === -1 ? path : path.slice(0, index);
  // The fixture only serves the reviewed start path; other paths are separate
  // helper refusals that the jsdom timelines already cover.
  if (pathname !== "/")
    throw new Error(`DSM timeline ${timeline.name} does not start at /`);
  return index === -1 ? "" : path.slice(index);
}

export function createDsmWebState(options: {
  timelines: readonly DsmWebTimeline[];
  account: DsmWebAccount;
  now?: () => number;
  variant?: DsmWebVariant;
}) {
  const now = options.now ?? Date.now;
  const account = options.account;
  // Validate every variant up front so a renamed timeline fails at start.
  for (const scenario of Object.values(DSM_WEB_VARIANTS)) {
    for (const name of [scenario.timeline, scenario.expectedTimeline]) {
      const timeline = findTimeline(options.timelines, name);
      if (timeline.jsdomOnly)
        throw new Error(`DSM timeline ${name} needs jsdom-only steps`);
      startHash(timeline);
    }
  }
  let variant: DsmWebVariant = options.variant ?? "standard";
  let startedAt = now();
  let hits: DsmWebHits;
  const elapsed = () => Math.max(0, now() - startedAt);
  const push = <T>(list: T[], value: T) => {
    if (list.length < RECORD_LIMIT) list.push(value);
  };

  function reset(next: DsmWebVariant = variant) {
    variant = next;
    startedAt = now();
    hits = {
      variant,
      documents: [],
      bootChunks: [],
      authType: [],
      login: [],
      other: [],
      page: [],
    };
    return scenario();
  }

  function scenario() {
    const settings = DSM_WEB_VARIANTS[variant];
    const expected = findTimeline(
      options.timelines,
      settings.expectedTimeline,
    ).expected;
    return {
      variant,
      timeline: settings.timeline,
      bootChunkDelayMs: settings.bootChunkDelayMs,
      bootChunks: DSM_WEB_BOOT_CHUNKS,
      otp: settings.otp,
      expected: {
        phase: expected.phase,
        reason: expected.reason,
        handoff: expected.handoff ?? null,
      },
      // Synthetic placeholders from the shared fixture, never a real account.
      account: { username: account.username, password: account.password },
    };
  }

  function pageConfig(): DsmWebPageConfig {
    const timeline = findTimeline(
      options.timelines,
      DSM_WEB_VARIANTS[variant].timeline,
    );
    return {
      variant,
      timeline: {
        name: timeline.name,
        hash: startHash(timeline),
        initial: timeline.initial,
        steps: timeline.steps,
      },
    };
  }

  /** `/webapi/entry.cgi`, answered with DSM 7 response shapes. `params` is the
   * merged query string and urlencoded body. */
  function handleEntryCgi(
    params: URLSearchParams,
    method: string,
  ): DsmWebEntryResult {
    const api = params.get("api") ?? "";
    const call = params.get("method") ?? "";
    const accountMatches = params.get("account") === account.username;
    if (api === "SYNO.API.Auth.Type" && call === "get") {
      push(hits.authType, { t: elapsed(), method, accountMatches });
      return {
        status: 200,
        delayMs: DSM_WEB_RESPONSE_DELAY_MS.authType,
        body: {
          success: true,
          data: [
            { type: "passwd" },
            ...(DSM_WEB_VARIANTS[variant].otp ? [{ type: "otp" }] : []),
          ],
        },
      };
    }
    if (api === "SYNO.API.Auth" && call === "login") {
      const passwordMatches = params.get("passwd") === account.password;
      const otpCode = (params.get("otp_code") ?? "") !== "";
      const outcome =
        !accountMatches || !passwordMatches
          ? "rejected"
          : otpCode
            ? "otp-rejected"
            : DSM_WEB_VARIANTS[variant].otp
              ? "otp-required"
              : "signed-in";
      push(hits.login, {
        t: elapsed(),
        method,
        accountMatches,
        passwordMatches,
        otpCode,
        outcome,
      });
      const body =
        outcome === "signed-in"
          ? {
              success: true,
              data: { sid: "synthetic-dsm-session", is_portal_port: false },
            }
          : outcome === "otp-required"
            ? {
                success: false,
                error: { code: 403, errors: { types: [{ type: "otp" }] } },
              }
            : { success: false, error: { code: otpCode ? 404 : 400 } };
      return { status: 200, delayMs: DSM_WEB_RESPONSE_DELAY_MS.login, body };
    }
    push(hits.other, { t: elapsed(), api: api.slice(0, 64), method });
    return {
      status: 200,
      delayMs: 0,
      body: { success: false, error: { code: 102 } },
    };
  }

  function recordDocument(path: string, method: string, dest?: string) {
    push(hits.documents, {
      t: elapsed(),
      method,
      path,
      dest: dest && /^[a-z-]{1,16}$/.test(dest) ? dest : null,
    });
  }

  /** Each chunk document.writes the next one, so Chromium's preload scanner
   * cannot fetch them in parallel and the delays add up. */
  function bootChunk(chunk: string) {
    const index = Number.parseInt(chunk, 10);
    const valid = Number.isInteger(index) && index >= 1;
    push(hits.bootChunks, { t: elapsed(), chunk: chunk.slice(0, 8) });
    return {
      delayMs: valid ? DSM_WEB_VARIANTS[variant].bootChunkDelayMs : 0,
      next: valid && index < DSM_WEB_BOOT_CHUNKS ? index + 1 : null,
    };
  }

  function recordPageEvent(value: unknown) {
    const event = value as { event?: unknown; detail?: unknown; t?: unknown };
    if (
      !event ||
      typeof event.event !== "string" ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(event.event)
    )
      return false;
    const detail =
      typeof event.detail === "string" &&
      /^[A-Za-z0-9#/ :._-]{0,80}$/.test(event.detail)
        ? event.detail
        : null;
    const t =
      typeof event.t === "number" && Number.isFinite(event.t)
        ? Math.max(0, Math.round(event.t))
        : -1;
    push(hits.page, { t, received: elapsed(), event: event.event, detail });
    return true;
  }

  function snapshot(): DsmWebHits {
    return JSON.parse(JSON.stringify(hits)) as DsmWebHits;
  }

  reset(variant);
  return {
    reset,
    scenario,
    pageConfig,
    handleEntryCgi,
    recordDocument,
    bootChunk,
    recordPageEvent,
    snapshot,
    get variant() {
      return variant;
    },
  };
}
export type DsmWebState = ReturnType<typeof createDsmWebState>;
