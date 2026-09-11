import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Exercise the exact versioned function prefix in the native compatibility
// rule, not a reimplementation of Synology's default host/port handling.
const native = readFileSync(
  "src-tauri/crates/sorng-protocols/src/http_response.rs",
  "utf8",
);
function nativeConstant(name: string) {
  return native.match(new RegExp(`const ${name}: &str = r#"(.*?)"#;`, "s"))![1];
}
const head = nativeConstant("QUICKCONNECT_REDIRECT_HEAD");
const source = "https://nas.fr3.quickconnect.to";
const local = "http://p0123456789abcdef.localhost:54362";
const bind = (code: string, origin = source) =>
  code
    .split("__SORNG_QUICKCONNECT_SOURCE_ORIGIN__")
    .join(JSON.stringify(origin));
const navigation = readFileSync(
  "src-tauri/crates/sorng-protocols/src/quickconnect_navigation_client.js",
  "utf8",
);
const publishedUrlModule = readFileSync(
  "tests/fixtures/quickconnect-url-module.fixture.js.txt",
  "utf8",
);
const publishedErrorModule = readFileSync(
  "tests/fixtures/quickconnect-error-module.fixture.js.txt",
  "utf8",
);
// Native tests feed these exact modules through the real response adapter,
// including gzip decoding. This VM additionally executes the published module
// methods: no entrypoint, AJAX, timers, cookies, or network APIs are installed.
function errorPageModule(urlModule: string, href: string, retry = false) {
  return runInNewContext(
    `
    const rows = {};
    const element = (selector) => {
      const row = rows[selector] ||= {text: selector === '#message' ? 'Cannot connect to {0}' : '', visible: false};
      const chain = {
        text(value) { if(value === undefined) return row.text; row.text = value; return chain; },
        html(value) { row.html = value; return chain; },
        show() { row.visible = true; return chain; },
        css() { return chain; },
        click(fn) { row.click = fn; return chain; },
        attr() { return chain; },
      };
      return chain;
    };
    const factories = {96: ${urlModule}, 419: ${publishedErrorModule}};
    const cached = {};
    function load(id) {
      if (id === 47) return element;
      if (id === 142) return (template, ...values) => template.replace(/\\{(\\d+)\\}/g, (_, index) => values[index]);
      if (id === 359) return {parse(value) { const url = new URL(value); return {query: Object.fromEntries(url.searchParams)}; }};
      if (id === 397) return {ERR_SERVER_ERROR: 9};
      if (cached[id]) return cached[id].exports;
      const module = cached[id] = {exports:{}};
      factories[id](module,module.exports,load);
      return module.exports;
    }
    const source = load(96).default;
    source.setupTitle(); source.setupLang(); source.setupICP();
    const error = load(419).default;
    error.setupError(); error.setupTitle(); error.setupRetry();
    const beforeRetry = {alias:error.getQuickConnectID(),host:source.getHost(),url:source.getUrl(),errno:error.getErrno(),title:rows['#message'].html,busy:rows['#check-item-server-error'].visible};
    if (retry) rows['#retry'].click();
    ({...beforeRetry,href:window.location.href});
    `,
    {
      URL,
      retry,
      navigator: { language: "en-GB", userAgent: "synthetic" },
      document: {
        title: "QuickConnect",
        body: { setAttribute() {} },
        referrer: "",
      },
      window: { location: new URL(href), history: { length: 1 } },
    },
    { timeout: 100 },
  );
}
function projectedErrorUrlModule(origin: string) {
  const boundNavigation = bind(navigation, origin);
  return publishedUrlModule
    .replace(
      "i=new URL(window.location.href),u=function()",
      bind(nativeConstant("QUICKCONNECT_SOURCE_PROJECTION"), origin),
    )
    .replace(
      "window.location.href=n}}]),t}();e.default=u}",
      `window.location.href=(function(){${boundNavigation};return sorngQuickConnectNavigation(n);})()}}]),t}();e.default=u}`,
    );
}
const mapped = (raw: string) =>
  runInNewContext(
    `${bind(navigation)};sorngQuickConnectNavigation(raw)`,
    {
      URL,
      raw,
      window: { location: new URL(`${local}/?unused=1`) },
    },
    { timeout: 100 },
  );
const evaluate = (
  prefix: string,
  href: string,
  input: Record<string, unknown> = {},
) =>
  runInNewContext(
    `({${prefix};return new URL(n+'//'+o+(f===''?'':':'+f)+'/portal/error.html');}}).value(input).href`,
    { URL, window: { location: new URL(href) }, input },
    { timeout: 100 },
  );

describe("QuickConnect versioned redirect URL compatibility", () => {
  const fixed = bind(nativeConstant("QUICKCONNECT_REDIRECT_DEFAULTS"));
  it("reproduces the reported Invalid URL on a nondefault local proxy port", () => {
    expect(() =>
      evaluate(head, "http://p0123456789abcdef.localhost:54362/"),
    ).toThrow("Invalid URL");
  });
  it.each([
    "http://p0123456789abcdef.localhost:54362/",
    "http://p0123456789abcdef.localhost:81/",
    "https://nas.quickconnect.to/",
    "https://nas.quickconnect.to:5001/",
  ])("uses upstream defaults, never the ephemeral proxy port: %s", (href) => {
    expect(evaluate(fixed, href)).toBe(`${source}/portal/error.html`);
    expect(mapped(evaluate(fixed, href))).toBe(`${local}/portal/error.html`);
  });
  it("preserves an explicitly supplied destination and port", () => {
    expect(
      evaluate(fixed, "http://p0123456789abcdef.localhost:54362/", {
        protocol: "https:",
        ip: "nas.example",
        port: "5001",
      }),
    ).toBe("https://nas.example:5001/portal/error.html");
  });
  it("uses the upstream port when the actual NAS origin has a custom port", () => {
    const withPort = bind(
      nativeConstant("QUICKCONNECT_REDIRECT_DEFAULTS"),
      `${source}:5001`,
    );
    expect(evaluate(withPort, local)).toBe(`${source}:5001/portal/error.html`);
  });
  it("projects source detection without changing the browser Location", () => {
    const location = new URL(
      `${local}/nas?product=dsm&a=%20&b=+&__sorng_navigation_v1=internal#login`,
    );
    const projected = runInNewContext(
      `var ${bind(nativeConstant("QUICKCONNECT_SOURCE_PROJECTION"))}{};i.href`,
      {
        URL,
        window: { location },
      },
      { timeout: 100 },
    );
    expect(projected).toBe(`${source}/nas?product=dsm&a=%20&b=+#login`);
    expect(location.origin).toBe(local);
  });
  it("keeps same-origin paths, query and fragments on the protected proxy", () => {
    expect(mapped(`${source}/webman?step=2#login`)).toBe(
      `${local}/webman?step=2#login`,
    );
  });
  it.each([
    "https://nas.quickconnect.to/",
    "https://nas.fr4.quickconnect.to/webman?step=2#login",
    "http://nas.fr4.quickconnect.to/",
    "https://user:secret@nas.fr3.quickconnect.to/",
    "javascript:alert(1)",
  ])("never directly navigates to an unreviewed destination: %s", (raw) => {
    const result = new URL(mapped(raw));
    expect(result.origin).toBe(local);
    expect(result.pathname).toBe("/__sortofremoteng_quickconnect_redirect_v1");
    expect([...result.searchParams.keys()]).toEqual(["destination"]);
    expect(result.searchParams.get("destination")).toBe(new URL(raw).href);
  });
});

describe("QuickConnect published error-page source and retry", () => {
  it("reproduces the separate error bundle reporting the random local alias", () => {
    const output = errorPageModule(
      publishedUrlModule,
      `${local}/portal/error.html?error=9`,
      true,
    );
    expect(output.alias).toBe("p0123456789abcdef");
    expect(output.title).toContain("p0123456789abcdef");
    expect(output.href).toBe("http://p0123456789abcdef.localhost/");
    expect(output.busy).toBe(true);
  });
  it.each([
    "https://nas.quickconnect.to",
    "https://nas.fr3.quickconnect.to",
    "http://nas.quickconnect.cn",
  ])(
    "uses the actual source for bootstrap, error title and retry: %s",
    (origin) => {
      const output = errorPageModule(
        projectedErrorUrlModule(origin),
        `${local}/portal/error.html?error=9&__sorng_navigation_v1=internal`,
        true,
      );
      expect(output.alias).toBe("nas");
      expect(output.host).toBe(new URL(origin).hostname);
      expect(output.title).toContain(">nas</p>");
      expect(output.title).not.toContain("p0123456789abcdef");
      expect(output.url).toBe(`${origin}/portal/error.html?error=9`);
      expect(output.href).toBe(`${local}/`);
      // A corrected identity must not suppress Synology's real failure reason.
      expect(output.errno).toBe(9);
      expect(output.busy).toBe(true);
    },
  );
  it("still reviews retry when the vendor drops a custom upstream port", () => {
    const output = errorPageModule(
      projectedErrorUrlModule("https://nas.quickconnect.to:5001"),
      `${local}/portal/error.html?error=9`,
      true,
    );
    const target = new URL(output.href);
    expect(target.origin).toBe(local);
    expect(target.pathname).toBe("/__sortofremoteng_quickconnect_redirect_v1");
    expect(target.searchParams.get("destination")).toBe(
      "https://nas.quickconnect.to/",
    );
  });
});
