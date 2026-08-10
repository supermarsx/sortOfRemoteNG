import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  collectDirectDependencies,
  generatedTextMatches,
  renderJsDependencyCatalog,
} from "../../scripts/sync-js-deps.mjs";

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
  );
}

function parseGeneratedEntries(source) {
  return [
    ...source.matchAll(
      /^\s+\("([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)"\),$/gm,
    ),
  ].map((match) => ({
    name: match[1],
    version: match[2],
    license: match[3],
    category: match[4],
  }));
}

test("generated About catalog exactly covers every direct package", async () => {
  const [packageJson, packageLock, generatedSource] = await Promise.all([
    readJson("package.json"),
    readJson("package-lock.json"),
    readFile(
      new URL(
        "../../src-tauri/crates/sorng-about/src/js_deps.rs",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const catalog = collectDirectDependencies(packageJson, packageLock);
  const expectedEntries = [...catalog.production, ...catalog.development];
  const generatedEntries = parseGeneratedEntries(generatedSource);

  assert.equal(
    generatedTextMatches(generatedSource, renderJsDependencyCatalog(catalog)),
    true,
    "generated catalog must be idempotent",
  );
  assert.deepEqual(generatedEntries, expectedEntries);
  assert.equal(
    generatedEntries.length,
    Object.keys(packageJson.dependencies).length +
      Object.keys(packageJson.devDependencies).length,
  );
  assert.equal(new Set(generatedEntries.map(({ name }) => name)).size, 73);
});

test("catalog generation fails closed on lock drift or missing metadata", async () => {
  const [packageJson, packageLock] = await Promise.all([
    readJson("package.json"),
    readJson("package-lock.json"),
  ]);

  const missingPackage = structuredClone(packageLock);
  delete missingPackage.packages["node_modules/react"];
  assert.throws(
    () => collectDirectDependencies(packageJson, missingPackage),
    /react has no root lock package/,
  );

  const staleSpec = structuredClone(packageLock);
  staleSpec.packages[""].dependencies.react = "^0.0.0";
  assert.throws(
    () => collectDirectDependencies(packageJson, staleSpec),
    /react root lock spec/,
  );

  const obsoleteDirect = structuredClone(packageLock);
  obsoleteDirect.packages[""].dependencies["obsolete-package"] = "^1.0.0";
  assert.throws(
    () => collectDirectDependencies(packageJson, obsoleteDirect),
    /obsolete: obsolete-package/,
  );

  const missingLicense = structuredClone(packageLock);
  delete missingLicense.packages["node_modules/react"].license;
  assert.throws(
    () => collectDirectDependencies(packageJson, missingLicense),
    /react has no locked license metadata/,
  );
});
