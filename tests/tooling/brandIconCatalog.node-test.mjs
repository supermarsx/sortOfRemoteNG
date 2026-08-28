import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  brandIconIdentifier,
  buildGeneratedModule,
  collectBrandIcons,
  generatedTextMatches,
  parseBrandIconSlugs,
  readBrandIcon,
} from "../../scripts/sync-brand-icons.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BRAND_DIRECTORY = path.join(REPOSITORY_ROOT, "src/utils/icons/brand");
const SLUGS_SOURCE = fs.readFileSync(
  path.join(BRAND_DIRECTORY, "brandIconSlugs.ts"),
  "utf8",
);
const GENERATED_SOURCE = fs.readFileSync(
  path.join(BRAND_DIRECTORY, "generatedBrandIcons.ts"),
  "utf8",
);

function withSvgFixture(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "brand-icons-"));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), contents, "utf8");
  }
  return directory;
}

const singlePathSvg = (title, d) =>
  `<svg role="img" viewBox="0 0 24 24"><title>${title}</title><path d="${d}"/></svg>`;

test("parses the hand-maintained slug list", () => {
  const slugs = parseBrandIconSlugs(SLUGS_SOURCE);
  assert.ok(slugs.length > 0);
  assert.equal(new Set(slugs).size, slugs.length, "slugs must be unique");
  assert.ok(slugs.includes("cisco"));
  assert.ok(slugs.includes("vmware"));
});

test("slug parsing fails closed on a malformed list", () => {
  assert.throws(
    () => parseBrandIconSlugs("export const OTHER = [] as const;"),
    /does not declare `BRAND_ICON_SLUGS`/u,
  );
  assert.throws(
    () => parseBrandIconSlugs("export const BRAND_ICON_SLUGS = [] as const;"),
    /lists no slugs/u,
  );
  assert.throws(
    () =>
      parseBrandIconSlugs(
        'export const BRAND_ICON_SLUGS = ["cisco", "cisco"] as const;',
      ),
    /cisco is listed more than once/u,
  );
  assert.throws(
    () =>
      parseBrandIconSlugs(
        'export const BRAND_ICON_SLUGS = ["Cisco Systems"] as const;',
      ),
    /is malformed/u,
  );
});

test("maps slugs to usable module identifiers", () => {
  assert.equal(brandIconIdentifier("cisco"), "cisco");
  assert.equal(brandIconIdentifier("alpine-linux"), "alpineLinux");
  assert.equal(brandIconIdentifier("dotnet"), "dotnet");
  assert.throws(() => brandIconIdentifier("3cx"), /usable identifier/u);
});

test("a slug missing from the installed simple-icons is a hard failure", () => {
  const iconsDirectory = withSvgFixture({
    "present.svg": singlePathSvg("Present", "M0 0h24v24H0Z"),
  });

  assert.doesNotThrow(() => readBrandIcon("present", { iconsDirectory }));
  assert.throws(
    () => readBrandIcon("removed-upstream", { iconsDirectory }),
    /slug removed-upstream is not present in the installed simple-icons/u,
    "silent omission is the failure mode this generator exists to prevent",
  );
  assert.throws(
    () =>
      collectBrandIcons(["present", "removed-upstream"], { iconsDirectory }),
    /removed-upstream/u,
  );
});

test("a multi-path mark is rejected rather than silently truncated", () => {
  const iconsDirectory = withSvgFixture({
    "twopath.svg":
      '<svg><title>Two</title><path d="M0 0h4v4H0Z"/><path d="M8 8h4v4H8Z"/></svg>',
  });

  assert.throws(
    () => readBrandIcon("twopath", { iconsDirectory }),
    /has 2 paths; createBrandIcon renders exactly one/u,
  );
});

test("marks carry their upstream title and path data", () => {
  const iconsDirectory = withSvgFixture({
    "acme.svg": singlePathSvg("ACME Corp", "M1 2h3v4H1Z"),
  });

  assert.deepEqual(readBrandIcon("acme", { iconsDirectory }), {
    slug: "acme",
    identifier: "acme",
    title: "ACME Corp",
    path: "M1 2h3v4H1Z",
  });
});

test("the committed generated module is in sync with simple-icons", async () => {
  const { source, icons } = await buildGeneratedModule();
  assert.equal(
    generatedTextMatches(GENERATED_SOURCE, source),
    true,
    "generatedBrandIcons.ts is stale; run npm run icons:brand:generate",
  );
  assert.equal(icons.length, parseBrandIconSlugs(SLUGS_SOURCE).length);
});

test("every requested slug reaches the generated module", () => {
  const slugs = parseBrandIconSlugs(SLUGS_SOURCE);
  const exported = new Set(
    [
      ...GENERATED_SOURCE.matchAll(
        /^export const (\w+) = createBrandIcon\(/gmu,
      ),
    ].map((match) => match[1]),
  );
  const recordBlock = /GENERATED_BRAND_ICONS[\s\S]*?= \{([\s\S]*?)\n\};/u.exec(
    GENERATED_SOURCE,
  );
  assert.notEqual(recordBlock, null, "the slug-keyed record must be generated");
  const recordKeys = new Set(
    [...recordBlock[1].matchAll(/^\s*"?([\w.+-]+)"?:/gmu)].map(
      (match) => match[1],
    ),
  );

  for (const slug of slugs) {
    assert.ok(
      exported.has(brandIconIdentifier(slug)),
      `${slug} has no generated export`,
    );
    assert.ok(recordKeys.has(slug), `${slug} is missing from the record`);
  }
  assert.equal(
    exported.size,
    slugs.length,
    "no unrequested marks are vendored",
  );
  assert.equal(recordKeys.size, slugs.length);
});

/**
 * Bundles the brand module so the real TypeScript sources — not a
 * reimplementation — are what gets rendered. Output lands inside node_modules so
 * bare specifiers still resolve against this repository.
 */
async function importBrandModule() {
  const { build } = await import("esbuild");
  const outfile = path.join(
    REPOSITORY_ROOT,
    "node_modules/.cache/brand-icon-node-test/brand.mjs",
  );
  await build({
    entryPoints: [path.join(BRAND_DIRECTORY, "index.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["react", "react-dom", "lucide-react"],
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

test("every brand icon is structurally a Lucide icon and renders solid", async () => {
  const { BRAND_ICONS, BRAND_ICON_SLUGS, HAND_AUTHORED_BRAND_ICON_NAMES } =
    await importBrandModule();

  const names = Object.keys(BRAND_ICONS);
  assert.equal(
    names.length,
    BRAND_ICON_SLUGS.length + HAND_AUTHORED_BRAND_ICON_NAMES.length,
  );

  // lucide's own Icon.mjs maps iconNode without a React key, so every lucide
  // icon logs a key warning. Silencing it keeps real failures readable.
  const consoleError = console.error;
  console.error = () => {};
  try {
    for (const name of names) {
      const Icon = BRAND_ICONS[name];
      assert.equal(
        typeof Icon,
        "object",
        `${name} must be a forwardRef object, not a plain function component — tests/icons/connectionIconCatalog.test.ts asserts typeof icon === "object"`,
      );

      const markup = renderToStaticMarkup(
        createElement(Icon, { size: 22, "aria-hidden": "true" }),
      );
      assert.match(markup, /fill="currentColor"/u, `${name} must fill solid`);
      assert.match(markup, /stroke="none"/u, `${name} must drop the outline`);
      assert.match(
        markup,
        /viewBox="0 0 24 24"/u,
        `${name} must stay on the 24 grid`,
      );
      assert.match(markup, /width="22"/u, `${name} must honour size`);
      assert.match(markup, /height="22"/u, `${name} must honour size`);
      assert.match(markup, /<path d="[^"]+"/u, `${name} must draw a path`);
    }
  } finally {
    console.error = consoleError;
  }
});

test("the hand-authored marks cover the brands simple-icons dropped", async () => {
  const { HAND_AUTHORED_BRAND_ICONS, BRAND_ICON_SLUGS } =
    await importBrandModule();

  assert.deepEqual(Object.keys(HAND_AUTHORED_BRAND_ICONS).sort(), [
    "aws",
    "azure",
    "powershell",
    "windows",
  ]);
  for (const name of Object.keys(HAND_AUTHORED_BRAND_ICONS)) {
    assert.ok(
      !BRAND_ICON_SLUGS.includes(name),
      `${name} is hand-authored precisely because simple-icons has no such slug`,
    );
  }
});
