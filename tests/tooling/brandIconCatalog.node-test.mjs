import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const {
    BRAND_ICONS,
    BRAND_ICON_SLUGS,
    HAND_AUTHORED_BRAND_ICON_NAMES,
    HISTORICAL_BRAND_ICON_NAMES,
    PUBLISHER_BRAND_ICON_NAMES,
  } = await importBrandModule();

  const names = Object.keys(BRAND_ICONS);
  assert.equal(
    names.length,
    BRAND_ICON_SLUGS.length +
      HAND_AUTHORED_BRAND_ICON_NAMES.length +
      HISTORICAL_BRAND_ICON_NAMES.length +
      PUBLISHER_BRAND_ICON_NAMES.length,
  );

  // Custom IconNode attributes must carry React keys just like Lucide's stock
  // nodes. Capture only this regression; unrelated console errors stay visible.
  const consoleError = console.error;
  const keyWarnings = [];
  console.error = (...args) => {
    if (
      args.some(
        (value) =>
          typeof value === "string" && /unique.*key|key.*prop/iu.test(value),
      )
    ) {
      keyWarnings.push(args);
    } else {
      consoleError(...args);
    }
  };
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
  assert.equal(
    keyWarnings.length,
    0,
    "Every custom brand IconNode needs a stable React key",
  );
});

test("the hand-authored marks cover the brands simple-icons dropped", async () => {
  const { HAND_AUTHORED_BRAND_ICONS, BRAND_ICON_SLUGS } =
    await importBrandModule();

  assert.deepEqual(Object.keys(HAND_AUTHORED_BRAND_ICONS).sort(), [
    "aws",
    "azure",
    "hpe",
    "microsoft",
    "powershell",
    "tencentcloud",
    "windows",
  ]);
  for (const name of Object.keys(HAND_AUTHORED_BRAND_ICONS)) {
    assert.ok(
      !BRAND_ICON_SLUGS.includes(name),
      `${name} is hand-authored precisely because simple-icons has no such slug`,
    );
  }
});

test("historical marks preserve the version-pinned upstream path bytes", async () => {
  const { HISTORICAL_BRAND_ICONS, HISTORICAL_BRAND_ICON_NAMES } =
    await importBrandModule();
  const hashes = {
    heroku: "489f3f58c4fa1064a098080a015747329b477bb81cc8bdf755a12fd592ac7090",
    tmobile: "fafddc1ad71a451ab5eca8bfc2085a381448bce9671cf6658c4c8846811c3d49",
    java: "27c0563ecd4b6d139b484904f262a5d8aa27bb8786ff1b1335a5790c672ff0fd",
    microsoftsqlserver:
      "ac0ff3139ff3fda1b381d7f5ec7206a3827ecc2f2f992c9b7a0ab34919dd3564",
    microsoftexchange:
      "c465e4905722d5754dc3d8bc551060a2a848e2c9bb5ae5bca7ade601e7090993",
    slack: "69c3650cc9632f4edcf00bb5fd02792d5cb46d8af58f8db5001ba64cdd40da4b",
    microsoftdynamics365:
      "e94805642fc2492a49226adec04458ebcdcb5b4342cc92554791a0c00d05ed2e",
    azuredevops:
      "e5ece2d09238680055222940ce3a22dd1f736a3669272ecfb6e39d8977e56cd3",
    oracle: "64970312892eec68521f882c47fe9633a395097045d5c84f8d9ab3b02f966f2b",
    ibm: "1a831c288974e116f245e99ed3b6682e930c7401aaa9182607c27fb6178c92ab",
    linode: "7c0a82f4e746975fea5c77d96e3631fd73ceeb8f9d7f17188c509567671a7388",
    microsoftoffice:
      "06c1849fc67d842ab3ee501b24252737980095211358ae42e6efcff4e4172077",
  };
  assert.deepEqual(
    [...HISTORICAL_BRAND_ICON_NAMES].sort(),
    Object.keys(hashes).sort(),
  );
  for (const [name, digest] of Object.entries(hashes)) {
    const markup = renderToStaticMarkup(
      createElement(HISTORICAL_BRAND_ICONS[name]),
    );
    const paths = [...markup.matchAll(/<path d="([^"]+)"/gu)];
    assert.equal(paths.length, 1, `${name} must keep the source path intact`);
    assert.equal(
      createHash("sha256").update(paths[0][1]).digest("hex"),
      digest,
      `${name} drifted from the documented upstream source`,
    );
  }
});

test("publisher marks normalize their source coordinates without distorting geometry", async () => {
  const { microsoft, hpe, tencentcloud } = await importBrandModule();
  for (const [Icon, transform] of [
    [microsoft, "scale(1.142857143)"],
    [hpe, "translate(0 8.357142857) scale(0.428571429)"],
    [tencentcloud, "translate(0 2.222222222) scale(0.888888889)"],
  ]) {
    const markup = renderToStaticMarkup(createElement(Icon));
    assert.ok(markup.includes(`transform="${transform}"`));
    assert.equal((markup.match(/<path /gu) ?? []).length, 1);
  }
});

test("app-authored identifiers are distinct SVG geometry and not advertised as official brand marks", async () => {
  const { BRAND_ICONS, APP_AUTHORED_IDENTIFIER_ICONS } =
    await importBrandModule();
  const identifiers = Object.entries(APP_AUTHORED_IDENTIFIER_ICONS);
  assert.equal(identifiers.length, 46);
  const paths = identifiers.map(([name, Icon]) => {
    assert.ok(
      !(name in BRAND_ICONS),
      `${name} must not masquerade as a sourced brand logo`,
    );
    const markup = renderToStaticMarkup(
      createElement(Icon, { color: "tomato", size: 16 }),
    );
    assert.match(markup, /width="16"/u);
    assert.match(markup, /stroke="tomato"/u);
    assert.doesNotMatch(markup, /<(?:text|image|foreignObject)\b/u);
    return [...markup.matchAll(/<path d="([^"]+)"/gu)]
      .map((match) => match[1])
      .join(" ");
  });
  assert.equal(new Set(paths).size, identifiers.length);
});

test("publisher SVG paths retain the verified geometry and normalization", async () => {
  const { PUBLISHER_BRAND_ICONS, PUBLISHER_BRAND_ICON_NAMES } =
    await importBrandModule();
  const sources = {
    uniview: [
      1,
      "2e5fb8e5133aa3ff4e39e6daab6d5ca70f173b49e5681f90ec4e8d3ea744da47",
      "translate(0 4.8) scale(0.42335508908184867)",
    ],
    axis: [
      1,
      "4e9a644cfa8bee84816ffff7a2f2e535e4f0c6d174affad6851e6d994f56eb71",
      "translate(0 7.68) scale(0.12)",
    ],
    reolink: [
      1,
      "8536579af634c0e581117e35a9b59f3aebb63aacef6fa7bf0d23793af9a66e10",
      "translate(1.231955922865014 0) scale(0.22038567493112948)",
    ],
    nos: [
      1,
      "27169f8462cced01e4df8d15ac35b59accd74072f1002781ce5c132dcfbc307a",
      "translate(0 5.5) scale(0.25)",
    ],
    nowo: [
      1,
      "573f30b4dc3ac6990158d51057620f5f7996fd861b05239484f04ee0133772c9",
      "translate(0 9.12) scale(0.24) translate(-90 -5)",
    ],
    digi: [
      1,
      "dbf7dbf05c98dcb248ac593e7688176de1e58b7855dd87ce145fe59d4f006b7a",
      "translate(0 7.8) scale(0.24) translate(-8 -8)",
    ],
    tele2: [
      1,
      "e86d406e9c9d2e4a7cfe55d3be53eca8c6df3b15ad08c40796aff7a8a778dcbb",
      "translate(0 7.492537313432836) scale(0.05970149253731343)",
    ],
    sfr: [
      1,
      "946f6cf543816083035b5f59c92844d3d68d7dbb68bb1c555b3241a0b038d816",
      "translate(0 6.545454545) scale(0.727272727) translate(-10 -14)",
    ],
    altice: [
      1,
      "11c49146c87ef030faa2e718590784c577a2a17019cafd7741e08897de9f35d9",
      "translate(0 24) scale(0.009230769230769232 -0.009230769230769232)",
    ],
    three: [
      1,
      "4d973085c3b0cce01ad163f13a4abe463af8ed5e75e2928cf2a15ea51210f69f",
      "scale(0.5454545454545454) translate(8 6)",
    ],
    tightvnc: [
      3,
      "df1aff944c200140fe79ee7ef8c49dc272af25c2643a2b7304bc2ad9970f9bba",
      "scale(0.26666666666666666)",
    ],
    ultravnc: [
      3,
      "34eeca91cb3dcc3114a81d53b41921afc7cf36a758b6a04df7ca1a2985269c2e",
      "translate(1 1) scale(0.030555555555555555) translate(-180 -180)",
    ],
    netbox: [
      1,
      "3a04622e55fbde9323dfb3825e473aee98364002d0b44fc27e42805addf0d039",
      "scale(0.075)",
    ],
    phc: [
      1,
      "9bf0a63c5d2ad7da783a5bf7d97773d32a9ffe8dc96548fe0299c5f4c1e2bfda",
      "translate(0 7.43327154772938) scale(0.222428174235403) translate(-169.1 -3.4)",
    ],
    cegid: [
      1,
      "be7f2a4541b11bdecd0d033a76e3573aad3cb6fdca6c78c0c8b91d1381d2850d",
      "translate(0 7.104) scale(0.024)",
    ],
    xerox: [
      1,
      "71593c9daf4b036a2a3940316bf96b7ce3ecf0b52da21a245dacff53ecce6d1b",
      "translate(0 9.333333333) scale(0.133333333) translate(-7 -74)",
    ],
    avaya: [
      1,
      "14de6155c984eb270d6907fea50478895f9dbb6194b3a0d53660e6d47a203ac0",
      "translate(0 8.571428571) scale(0.214285714)",
    ],
    canon: [
      1,
      "e2189261c708bef68ce88e506686d7eb0d47f55530824206ace140f5b9efce3a",
      "translate(0 9.504) scale(0.192)",
    ],
    wazuh: [
      1,
      "3520efb298abbaed3aef38841a35792f28107317c06d952e7ef009c99afa61d0",
      "translate(0 3.362318841) scale(0.057971014) translate(-399 -425.7)",
    ],
    ugreen: [
      1,
      "f5adcda19f319d74d772a6f8f3a1b180723b96d996c08427c9f1af6b825e07df",
      "translate(0 10) scale(0.36036036)",
    ],
    asustor: [
      7,
      "118c758c6d6d703e378ada12685b572298100a45022fa7d97fc296f2d1e50c03",
      "translate(0 9.80183834352818) scale(0.15701154689084426)",
    ],
    vertiv: [
      1,
      "ca2e4a999ac4f05c382128c8b0c395c225d0d6f78f5aebee5de08193afdf2047",
      "translate(0 0.5549879678500953) scale(0.4812859961817978)",
    ],
    riello: [
      1,
      "264ce37100b43591194000fbbeee2c13fd8c942743d9b6708ba27f580c52d054",
      "translate(3.538119908491309 0) scale(0.9635975529956209) translate(-129.07296 -151.0556910737898)",
    ],
  };
  assert.deepEqual(
    [...PUBLISHER_BRAND_ICON_NAMES].sort(),
    Object.keys(sources).sort(),
  );
  for (const [name, [count, digest, transform]] of Object.entries(sources)) {
    const markup = renderToStaticMarkup(
      createElement(PUBLISHER_BRAND_ICONS[name]),
    );
    const paths = [...markup.matchAll(/<path d="([^"]+)"/gu)];
    assert.equal(paths.length, count, `${name} lost source paths`);
    assert.equal(
      createHash("sha256")
        .update(paths.map((path) => path[1]).join(" "))
        .digest("hex"),
      digest,
      `${name} geometry drifted`,
    );
    assert.equal(
      [...markup.matchAll(/transform="([^"]+)"/gu)].filter((match) =>
        match[1].startsWith(transform),
      ).length,
      count,
      `${name} normalization drifted`,
    );
  }
});

test("telecom marks retain special fill rules and keep unresolved provider identity neutral", async () => {
  const {
    nos,
    tmobile,
    deutschetelekom,
    viva,
    BRAND_ICONS,
    APP_AUTHORED_IDENTIFIER_ICONS,
  } = await importBrandModule();
  const markup = renderToStaticMarkup(createElement(nos));
  assert.match(markup, /fill-rule="evenodd"/u);
  const geometry = (Icon) =>
    [
      ...renderToStaticMarkup(createElement(Icon)).matchAll(
        /<path d="([^"]+)"/gu,
      ),
    ]
      .map((match) => match[1])
      .join(" ");
  assert.equal(
    geometry(tmobile),
    geometry(deutschetelekom),
    "T-Mobile and Deutsche Telekom preserve the same verified shared T symbol",
  );
  assert.equal(APP_AUTHORED_IDENTIFIER_ICONS.viva, viva);
  assert.ok(
    !("viva" in BRAND_ICONS),
    "An unresolved provider must not be labeled as verified source artwork",
  );
});
