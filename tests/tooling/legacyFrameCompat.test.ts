// t95 W0: the pure parts of the legacy-page Edge probe. Nothing here starts a
// browser, a server or the app; the probe's own browser half is exercised by
// `node scripts/test-legacy-web-compat-browser.mjs`.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as probe from "../../scripts/test-legacy-web-compat-browser.mjs";

const repoRoot = process.cwd();

const PRODUCTION_SANDBOX = fs.readFileSync(
  path.join(repoRoot, probe.SANDBOX_SOURCE_PATH),
  "utf8",
);

describe("production sandbox mirror", () => {
  it("reads the tokens the product actually ships", () => {
    const tokens = probe.parseSandboxTokens(PRODUCTION_SANDBOX);
    expect(tokens.empty).toBe("");
    expect(tokens.tokens).toEqual([...probe.EXPECTED_PROXY_TOKENS]);
    expect(tokens.proxy).toBe("allow-same-origin allow-scripts allow-forms");
  });

  it("accepts the constant written across two lines", () => {
    const source = [
      'export const EMPTY_WEB_FRAME_SANDBOX = "";',
      "export const PROXY_WEB_FRAME_SANDBOX =",
      '  "allow-same-origin allow-scripts allow-forms";',
    ].join("\n");
    expect(probe.parseSandboxTokens(source).tokens).toHaveLength(3);
  });

  it("refuses a blank frame that gained any token", () => {
    const source = PRODUCTION_SANDBOX.replace(
      'EMPTY_WEB_FRAME_SANDBOX = ""',
      'EMPTY_WEB_FRAME_SANDBOX = "allow-scripts"',
    );
    expect(() => probe.parseSandboxTokens(source)).toThrow(
      /no longer the empty string/u,
    );
  });

  it.each(probe.FORBIDDEN_SANDBOX_TOKENS)(
    "refuses a proxy frame that gained %s",
    (token) => {
      const source = PRODUCTION_SANDBOX.replace(
        "allow-same-origin allow-scripts allow-forms",
        `allow-same-origin allow-scripts allow-forms ${token}`,
      );
      expect(() => probe.parseSandboxTokens(source)).toThrow(
        new RegExp(`unexpected: ${token}`, "u"),
      );
    },
  );

  it("refuses a proxy frame that lost a token", () => {
    const source = PRODUCTION_SANDBOX.replace(" allow-forms", "");
    expect(() => probe.parseSandboxTokens(source)).toThrow(
      /missing: allow-forms/u,
    );
  });

  it("refuses a source that no longer declares the constants", () => {
    expect(() => probe.parseSandboxTokens("export const OTHER = 1;")).toThrow(
      /Could not read the sandbox constants/u,
    );
  });

  it("never lists a forbidden token among the expected ones", () => {
    for (const token of probe.EXPECTED_PROXY_TOKENS)
      expect(probe.FORBIDDEN_SANDBOX_TOKENS).not.toContain(token);
  });
});

describe("sandbox modes", () => {
  const tokens = "allow-same-origin allow-scripts allow-forms";

  it("reproduces the product tokens for the measured modes", () => {
    expect(probe.sandboxForMode("current", tokens)).toBe(tokens);
    expect(probe.sandboxForMode("shim", tokens)).toBe(tokens);
  });

  it("only adds allow-modals in the measure-only mode", () => {
    expect(probe.sandboxForMode("modals", tokens)).toBe(
      `${tokens} allow-modals`,
    );
  });

  it("drops the attribute entirely for the unsandboxed control", () => {
    expect(probe.sandboxForMode("nosandbox", tokens)).toBeNull();
  });

  it("refuses an unknown mode rather than silently sandboxing", () => {
    expect(() => probe.sandboxForMode("relaxed", tokens)).toThrow(
      /Unknown sandbox mode/u,
    );
  });
});

describe("per-session proxy authority", () => {
  const hex = "0123456789abcdef0123456789abcdef";

  it("builds the shape assertWebBrowserFrameNavigation demands", () => {
    expect(probe.proxyHost(hex)).toBe(`p${hex}.localhost`);
    expect(probe.isProxyHost(probe.proxyHost(hex))).toBe(true);
  });

  it.each([
    ["p0123456789ABCDEF0123456789abcdef.localhost", "uppercase"],
    ["p0123.localhost", "too short"],
    ["q0123456789abcdef0123456789abcdef.localhost", "wrong prefix"],
    ["p0123456789abcdef0123456789abcdef.example", "wrong suffix"],
    ["p0123456789abcdef0123456789abcdef.a.localhost", "extra label"],
    ["localhost", "the app host"],
    ["app.localhost", "the packaged app host"],
  ])("rejects %s (%s)", (host) => {
    expect(probe.isProxyHost(host)).toBe(false);
  });

  it("refuses to build a short or non-hex label", () => {
    expect(() => probe.proxyHost("abc")).toThrow(/32 lowercase hex digits/u);
    expect(() => probe.proxyHost(hex.toUpperCase())).toThrow(
      /32 lowercase hex digits/u,
    );
  });

  it("keeps both app host variants distinct from the proxy authority", () => {
    for (const host of Object.values(probe.APP_HOSTS))
      expect(host).not.toBe(probe.proxyHost(hex));
  });
});

describe("compatibility shim prototype", () => {
  const source = probe.buildCompatShimSource({
    dialogEndpoint: probe.DIALOG_ENDPOINT_PATH,
  });

  it("installs in the order the injected client must keep", () => {
    expect(probe.shimOrderingProblems(source)).toEqual([]);
  });

  it("captures the real parent before anything else runs", () => {
    expect(
      source.startsWith("(function(){\nvar realParent = window.parent;"),
    ).toBe(true);
  });

  it("overrides parent as the last statement", () => {
    const override = source.indexOf('Object.defineProperty(window, "parent"');
    expect(override).toBeGreaterThan(0);
    expect(source.slice(override)).not.toContain("postMessage");
  });

  it("keeps the app window on a non-configurable own property", () => {
    expect(source).toContain(
      'Object.defineProperty(window, "__sorngAppParent"',
    );
    expect(source).toMatch(/writable: false, configurable: false/u);
  });

  it("posts to the app reference, never to the overridden parent alone", () => {
    expect(source).toContain(
      "(window.__sorngAppParent || window.parent).postMessage",
    );
  });

  it("sends the dialog to the same-origin endpoint synchronously", () => {
    expect(source).toContain(
      `xhr.open("POST", "${probe.DIALOG_ENDPOINT_PATH}"`,
    );
    expect(source).toMatch(/, false\);/u);
  });

  it("carries the message text in the request body, not only the message", () => {
    const send = source.slice(source.indexOf("xhr.send("));
    expect(send).toContain("message:");
    expect(send).toContain("defaultValue:");
  });

  it("falls back to today's behaviour per dialog kind", () => {
    expect(source).toContain(
      'return kind === "confirm" ? false : kind === "prompt" ? null : undefined;',
    );
  });

  it("refuses a cross-origin dialog endpoint", () => {
    expect(() =>
      probe.buildCompatShimSource({
        dialogEndpoint: "https://example.test/dialog",
      }),
    ).toThrow(/same-origin path/u);
    expect(() => probe.buildCompatShimSource({})).toThrow(/same-origin path/u);
  });

  it("catches a lost capture, a reordered install and a late override", () => {
    const withoutCapture = source.replace(
      "var realParent = window.parent;",
      "var realParent = window;",
    );
    expect(probe.shimOrderingProblems(withoutCapture)).toContain(
      "the real parent is never captured",
    );
    const overrideFirst = `(function(){\nObject.defineProperty(window, "parent", {});\nvar realParent = window.parent;\nwindow.__sorngAppParent;\n})();`;
    expect(probe.shimOrderingProblems(overrideFirst).length).toBeGreaterThan(0);
    const postBeforeCapture = `(function(){\nwindow.parent.postMessage(1, "*");\nvar realParent = window.parent;\n"__sorngAppParent";\nObject.defineProperty(window, "parent", {});\n})();`;
    expect(probe.shimOrderingProblems(postBeforeCapture)).toContain(
      "a postMessage bridge installs before the capture",
    );
  });
});

describe("scenario catalogue", () => {
  it("covers every failure class the plan names", () => {
    const names = probe.SCENARIOS.map((scenario) => scenario.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "legacy-onload",
        "parent-top-access",
        "top-shadowing",
        "frame-bust",
        "dialogs",
        "renderer-placement",
        "frameset",
        "postmessage-shim",
        "dialog-bridge",
        "dialog-hold",
        "dialog-unload",
      ]),
    );
  });

  it("measures the bridge against both app host variants", () => {
    for (const name of ["renderer-placement", "dialog-bridge"]) {
      const scenario = probe.SCENARIOS.find((item) => item.name === name);
      expect(scenario?.hosts).toEqual(["dev", "prod"]);
    }
  });

  it("only relaxes the sandbox in explicitly measure-only runs", () => {
    for (const scenario of probe.SCENARIOS)
      for (const mode of scenario.modes)
        expect(["current", "shim", "modals", "nosandbox"]).toContain(mode);
    const relaxed = probe.SCENARIOS.filter((scenario) =>
      scenario.modes.includes("modals"),
    ).map((scenario) => scenario.name);
    expect(relaxed).toEqual(["dialogs"]);
  });

  it("expands to one run per scenario, mode and host", () => {
    const runs = probe.expandRuns();
    const expected = probe.SCENARIOS.reduce(
      (total, scenario) =>
        total + scenario.modes.length * scenario.hosts.length,
      0,
    );
    expect(runs).toHaveLength(expected);
    expect(new Set(runs.map((run) => run.id)).size).toBe(expected);
    expect(runs[0].id).toBe("legacy-onload/current/dev");
  });

  it("selects by scenario name or by full run id", () => {
    expect(probe.selectRuns("top-shadowing").map((run) => run.id)).toEqual([
      "top-shadowing/current/dev",
      "top-shadowing/shim/dev",
    ]);
    expect(probe.selectRuns("dialog-bridge/shim/prod")).toHaveLength(1);
    expect(probe.selectRuns("frameset, dialogs")).toHaveLength(4);
  });

  it("refuses an unknown selection instead of running nothing", () => {
    expect(() => probe.selectRuns("parent-access")).toThrow(
      /Unknown scenario\(s\): parent-access/u,
    );
  });

  it("returns every run when nothing is selected", () => {
    expect(probe.selectRuns(undefined)).toHaveLength(probe.expandRuns().length);
  });
});

describe("recorded expectations", () => {
  it("names only scenario/mode pairs the catalogue can produce", () => {
    const pairs = new Set(
      probe.expandRuns().map((run) => `${run.scenario.name}/${run.mode}`),
    );
    for (const key of Object.keys(probe.EXPECTATIONS))
      expect(pairs).toContain(key);
  });

  it("pins the findings the design depends on", () => {
    expect(
      probe.EXPECTATIONS["parent-top-access/current"]["parent.document"],
    ).toEqual(["throw", "SecurityError"]);
    expect(
      probe.EXPECTATIONS["parent-top-access/shim"]["parent.document"],
    ).toEqual(["ok", "true"]);
    expect(
      probe.EXPECTATIONS["parent-top-access/shim"]["top.document"],
    ).toEqual(["throw", "SecurityError"]);
    expect(probe.EXPECTATIONS["top-shadowing/current"]["global let top"]).toBe(
      "throw",
    );
    expect(
      probe.EXPECTATIONS["renderer-placement/current"][
        "app tick gap during sync XHR"
      ],
    ).toBe("isolated");
    expect(
      probe.EXPECTATIONS["dialog-hold/shim"][
        "postMessage from the blocked frame arrived"
      ],
    ).toBe("deferred");
  });

  it("never expects the app window to survive an unsandboxed frame-buster", () => {
    expect(
      probe.EXPECTATIONS["frame-bust/nosandbox"]["app window never navigated"],
    ).toBe("failed");
    expect(
      probe.EXPECTATIONS["frame-bust/current"]["app window never navigated"],
    ).toBe("ok");
    expect(
      probe.EXPECTATIONS["frame-bust/shim"]["app window never navigated"],
    ).toBe("ok");
  });
});

describe("expectation comparison", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    scenario: "parent-top-access",
    mode: "current",
    host: "dev",
    check: "parent.document",
    outcome: "throw",
    detail: "SecurityError: Blocked a frame",
    ...overrides,
  });
  const table = {
    "parent-top-access/current": {
      "parent.document": ["throw", "SecurityError"] as [string, string],
      "top.document": "throw",
    },
  };

  it("passes when every pinned check matches", () => {
    expect(
      probe.expectationMismatches(
        [row(), row({ check: "top.document", detail: "" })],
        table,
      ),
    ).toEqual([]);
  });

  it("reports a changed outcome", () => {
    const problems = probe.expectationMismatches(
      [row({ outcome: "ok", detail: "true" }), row({ check: "top.document" })],
      table,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("expected throw");
    expect(problems[0]).toContain("measured ok");
  });

  it("reports a matching outcome whose evidence changed", () => {
    const problems = probe.expectationMismatches(
      [
        row({ detail: "TypeError: something else" }),
        row({ check: "top.document" }),
      ],
      table,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('containing "SecurityError"');
  });

  it("reports a pinned check the run silently stopped producing", () => {
    expect(probe.expectationMismatches([row()], table)).toEqual([
      "parent-top-access/current top.document: never measured",
    ]);
  });

  it("stays quiet about scenarios this invocation did not run", () => {
    expect(
      probe.expectationMismatches(
        [row({ scenario: "dialogs", check: "alert()", outcome: "ok" })],
        table,
      ),
    ).toEqual([]);
  });

  it("always fails a run that never completed", () => {
    const problems = probe.expectationMismatches(
      [
        row({
          check: "run completed",
          outcome: "failed",
          detail: "no page report within 90000 ms",
        }),
      ],
      {},
    );
    expect(problems).toEqual([
      "parent-top-access/current/dev: no page report within 90000 ms",
    ]);
  });

  it("ignores informational rows the table does not pin", () => {
    expect(
      probe.expectationMismatches(
        [
          row({ check: "top.length (cross-origin allowed)", outcome: "ok" }),
          row(),
          row({ check: "top.document", detail: "" }),
        ],
        table,
      ),
    ).toEqual([]);
  });
});

describe("app tick gaps", () => {
  it("finds the longest stall inside the measured window", () => {
    expect(probe.maxGap([0, 10, 20, 1520, 1530], 0, 1530)).toBe(1500);
  });

  it("reports a small gap when the app window kept ticking", () => {
    const ticks = Array.from({ length: 150 }, (_, index) => index * 10);
    expect(probe.maxGap(ticks, 0, 1490)).toBe(10);
  });

  it("ignores ticks from outside the window", () => {
    expect(probe.maxGap([0, 5000, 10000, 10010], 10000, 10010)).toBe(10);
  });

  it("falls back to the whole window when the app stopped reporting", () => {
    expect(probe.maxGap([], 100, 1600)).toBe(1500);
  });

  it("returns -1 rather than NaN when the frame never reported its window", () => {
    expect(probe.maxGap([1, 2], undefined as unknown as number, 5)).toBe(-1);
    expect(probe.maxGap(undefined as unknown as number[], 1, 5)).toBe(-1);
  });
});

describe("matrix rendering", () => {
  const rows = [
    {
      scenario: "parent-top-access",
      mode: "current",
      host: "dev",
      check: "parent.document",
      outcome: "throw",
      detail: "SecurityError: Blocked a frame",
    },
    {
      scenario: "dialogs",
      mode: "modals",
      host: "dev",
      check: "confirm()",
      outcome: "ok",
      detail: "true",
    },
  ];

  it("aligns every column and underlines the header", () => {
    const lines = probe.renderMatrix(rows).split("\n");
    expect(lines[0]).toMatch(
      /^scenario\s+mode\s+host\s+check\s+outcome\s+detail$/u,
    );
    expect(lines[1]).toMatch(/^-+( +-+)+$/u);
    expect(lines[2].startsWith("parent-top-access  current  dev")).toBe(true);
    expect(lines[3].startsWith("dialogs            modals   dev")).toBe(true);
  });

  it("collapses newlines and clips a long detail", () => {
    const [, , line] = probe
      .renderMatrix([{ ...rows[0], detail: "first line\n  second line " }], {
        width: 14,
      })
      .split("\n");
    expect(line).toContain("first line se");
    expect(line).not.toContain("\n");
  });

  it("survives a row with no detail at all", () => {
    expect(() =>
      probe.renderMatrix([{ ...rows[0], detail: undefined }]),
    ).not.toThrow();
  });
});

describe("verdicts", () => {
  const measured = [
    {
      scenario: "parent-top-access",
      mode: "current",
      host: "dev",
      check: "parent.document",
      outcome: "throw",
      detail: "",
    },
    {
      scenario: "parent-top-access",
      mode: "shim",
      host: "dev",
      check: "parent.document",
      outcome: "ok",
      detail: "true",
    },
    {
      scenario: "parent-top-access",
      mode: "shim",
      host: "dev",
      check: "top.document",
      outcome: "throw",
      detail: "",
    },
    {
      scenario: "top-shadowing",
      mode: "current",
      host: "dev",
      check: "defineProperty(window,top)",
      outcome: "throw",
      detail: "",
    },
    {
      scenario: "top-shadowing",
      mode: "current",
      host: "dev",
      check: "global let top",
      outcome: "throw",
      detail: "",
    },
    {
      scenario: "renderer-placement",
      mode: "current",
      host: "dev",
      check: "app tick gap during sync XHR",
      outcome: "isolated",
      value: 12,
      detail: "",
    },
    {
      scenario: "dialog-bridge",
      mode: "shim",
      host: "dev",
      check: "confirm returns host answer",
      outcome: "ok",
      detail: "",
    },
    {
      scenario: "dialog-bridge",
      mode: "shim",
      host: "dev",
      check: "app learned of the dialog while the frame was blocked",
      outcome: "ok",
      detail: "",
    },
    {
      scenario: "dialog-hold",
      mode: "shim",
      host: "dev",
      check: "postMessage from the blocked frame arrived",
      outcome: "deferred",
      detail: "",
    },
    {
      scenario: "dialog-hold",
      mode: "shim",
      host: "dev",
      check: "app page stayed live during the hold",
      outcome: "ok",
      detail: "kept ticking",
    },
  ];

  it("states the measured go/no-go for each layer", () => {
    const verdicts = probe.deriveVerdicts(measured);
    expect(verdicts.parentShim).toBe("works");
    expect(verdicts.topRuntime).toMatch(/no runtime shim is possible/u);
    expect(verdicts.topAfterShim).toBe("throw");
    expect(verdicts.syncXhrBridge).toMatch(/^viable: /u);
    expect(verdicts.dialogNotification).toMatch(/must be told by the proxy/u);
    expect(verdicts.hostVariants).toEqual({ dev: "12 ms app tick gap" });
  });

  it("refuses to call the bridge viable when the app page stalled too", () => {
    const stalled = measured.map((row) =>
      row.check === "app tick gap during sync XHR"
        ? { ...row, outcome: "shared", value: 1500 }
        : row,
    );
    expect(probe.deriveVerdicts(stalled).syncXhrBridge).toMatch(
      /only where the frame is out of process/u,
    );
  });

  it("refuses to call the bridge viable when no answer came back", () => {
    const unanswered = measured.map((row) =>
      row.check === "confirm returns host answer"
        ? { ...row, outcome: "failed" }
        : row,
    );
    expect(probe.deriveVerdicts(unanswered).syncXhrBridge).toBe(
      "not viable as measured",
    );
  });

  it("warns instead of concluding when top turns out to be shadowable", () => {
    const shadowable = measured.map((row) =>
      row.check === "defineProperty(window,top)"
        ? { ...row, outcome: "ok" }
        : row,
    );
    expect(probe.deriveVerdicts(shadowable).topRuntime).toMatch(/unexpected/u);
  });

  it("says so when the shim did not fix the parent read", () => {
    const broken = measured.map((row) =>
      row.mode === "shim" && row.check === "parent.document"
        ? { ...row, outcome: "throw" }
        : row,
    );
    expect(probe.deriveVerdicts(broken).parentShim).toBe(
      "does not fix the parent read",
    );
  });

  it("says 'not measured' rather than guessing on a partial run", () => {
    const partial = measured.filter(
      (row) =>
        row.scenario !== "top-shadowing" && row.scenario !== "dialog-bridge",
    );
    const verdicts = probe.deriveVerdicts(partial);
    expect(verdicts.topRuntime).toBe("not measured");
    expect(verdicts.syncXhrBridge).toBe("not measured");
    expect(verdicts.parentShim).toBe("works");
  });

  it("does not claim a notification channel it never measured", () => {
    const verdicts = probe.deriveVerdicts(
      measured.filter(
        (row) =>
          row.check !== "app learned of the dialog while the frame was blocked",
      ),
    );
    expect(verdicts.dialogNotification).toBe("not measured");
    expect(verdicts.holdSafety).toBe("kept ticking");
  });
});
