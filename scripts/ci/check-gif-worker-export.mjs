#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

/** Evaluate the emitted worker URL factory, not an incidental source-asset URL. */
export function workerUrlFromClient(chunks) {
  const client = [...chunks].find(([, source]) =>
    source.includes("GIF recording requires Web Worker support"),
  );
  assert.ok(client, "No exported GIF worker client was found.");
  const registrations = [];
  const context = createContext({
    TURBOPACK: registrations,
    URL,
    location: new URL("https://gif-worker.test/"),
  });
  // Only evaluate registration array literals: importing a second emitted
  // chunk must not execute its runtime/bootstrap or any application factory.
  // TypeScript is already a direct build dependency and parses actual JS here.
  for (const [path, source] of chunks) {
    if (!source.includes("TURBOPACK")) continue;
    const file = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.JS,
    );
    assert.equal(
      file.parseDiagnostics.length,
      0,
      `Invalid emitted JavaScript in ${path}.`,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(file).replace(/\s/gu, "") ===
          "(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push"
      ) {
        assert.equal(
          node.arguments.length,
          1,
          "Unknown Turbopack client chunk format.",
        );
        const registration = node.arguments[0];
        assert.ok(
          ts.isArrayLiteralExpression(registration),
          "Unknown Turbopack client chunk format.",
        );
        // New builds can place a registration group in a nested array.
        const elements = registration.elements
          .slice(1)
          .flatMap((element) =>
            ts.isArrayLiteralExpression(element)
              ? [...element.elements]
              : [element],
          );
        if (
          elements.length === 1 &&
          ts.isObjectLiteralExpression(elements[0])
        ) {
          const properties = elements[0].properties;
          assert.ok(
            properties.length === 2 &&
              properties.every(
                (property) =>
                  ts.isPropertyAssignment(property) &&
                  ["otherChunks", "runtimeModuleIds"].includes(
                    property.name.getText(file),
                  ) &&
                  ts.isArrayLiteralExpression(property.initializer),
              ),
            "Unknown Turbopack runtime registration format.",
          );
          return; // Entry/runtime metadata is executed by the real worker probe.
        }
        // Check IDs/factories without evaluating arbitrary element expressions.
        for (let offset = 0; offset < elements.length;) {
          let ids = 0;
          while (
            offset < elements.length &&
            ts.isNumericLiteral(elements[offset])
          ) {
            offset++;
            ids++;
          }
          assert.ok(
            ids &&
              offset < elements.length &&
              (ts.isArrowFunction(elements[offset]) ||
                ts.isFunctionExpression(elements[offset])),
            "Unknown Turbopack client chunk format.",
          );
          offset++;
        }
        // The metadata slot normally reads document.currentScript. Its value
        // is irrelevant to module lookup, so never evaluate that expression.
        registrations.push({
          path,
          values: runInContext(
            `[null,${elements.map((element) => element.getText(file)).join(",")}]`,
            context,
            { filename: path, timeout: 5000 },
          ),
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const factories = new Map();
  for (const { path, values: registration } of registrations) {
    for (let offset = 1; offset < registration.length;) {
      let end = offset;
      while (
        end < registration.length &&
        typeof registration[end] !== "function"
      )
        end++;
      assert.ok(
        end < registration.length,
        "Unknown Turbopack client chunk format.",
      );
      for (; offset < end; offset++) {
        const id = registration[offset];
        assert.ok(
          Number.isSafeInteger(id) && id >= 0,
          "Unknown Turbopack module ID.",
        );
        const entries = factories.get(id) ?? [];
        // Split entry chunks can repeat a byte-identical module definition.
        // Conflicting definitions remain ambiguous and fail when reachable.
        if (
          !entries.some(
            (entry) =>
              entry.path === path &&
              entry.factory.toString() === registration[end].toString(),
          )
        )
          entries.push({ path, factory: registration[end] });
        factories.set(id, entries);
      }
      offset++;
    }
  }
  const candidate = [...factories].find(([, entries]) => {
    const factory = entries.find((entry) => entry.path === client[0])?.factory;
    if (!factory) return false;
    const source = factory.toString();
    return (
      source.includes("turbopack-worker-") &&
      [...chunks].some(
        ([path, content]) =>
          source.includes(path) &&
          content.includes("GIF encoder is not initialized"),
      )
    );
  });
  assert.ok(
    candidate,
    "No compiled GIF worker factory and codec dependency were found.",
  );
  const [factoryId] = candidate;
  assert.match(
    client[1],
    new RegExp(`\\.r\\(${factoryId}\\)\\(Worker,`),
    "GIF client does not invoke the compiled worker factory.",
  );
  const modules = new Map();
  const load = (id) => {
    if (modules.has(id)) return modules.get(id);
    const registered = factories.get(id);
    assert.ok(registered, `Missing emitted worker-factory dependency ${id}.`);
    // Split entry compilations can reuse IDs with different minified bindings.
    // Prefer the selected client's own definition. A cross-chunk dependency
    // must be unambiguous; never choose one by filesystem ordering.
    const local = registered.filter((entry) => entry.path === client[0]);
    const entries = local.length
      ? local
      : registered.filter(
          (entry, index) =>
            registered.findIndex(
              (other) => other.factory.toString() === entry.factory.toString(),
            ) === index,
        );
    assert.equal(
      entries.length,
      1,
      `Duplicate emitted worker-factory module ${id}.`,
    );
    const [{ factory }] = entries;
    const exports = {};
    modules.set(id, exports);
    factory({
      b: "/_next/",
      X: "",
      h: (path, base) => `${base}${path}`,
      r: load,
      s: (values) => {
        for (let i = 0; i < values.length; i += 3) {
          assert.equal(
            values[i + 1],
            0,
            "Unknown worker-factory export format.",
          );
          exports[values[i]] = values[i + 2];
        }
      },
      v: (value) => modules.set(id, value),
    });
    return modules.get(id);
  };
  class WorkerProbe {
    constructor(url, options) {
      this.url = url;
      this.options = options;
    }
  }
  const worker = load(factoryId)(WorkerProbe, { type: "module" });
  assert.ok(worker.url instanceof URL);
  assert.ok(
    worker.url.pathname.endsWith(".js"),
    "GIF worker URL points to non-JavaScript output.",
  );
  return { url: worker.url, client: client[0] };
}

/** Independently parse and decode this probe's 1×1 GIF frames (no gifenc import). */
function verifyGif(bytes) {
  const uint16 = (offset) => bytes[offset] | (bytes[offset + 1] << 8);
  assert.equal(bytes.subarray(0, 6).toString(), "GIF89a");
  assert.equal(uint16(6), 1);
  assert.equal(uint16(8), 1);
  let offset = 13;
  let palette;
  if (bytes[10] & 0x80) {
    const size = 3 * (2 << (bytes[10] & 7));
    palette = bytes.subarray(offset, offset + size);
    offset += size;
  }
  let delay = 0;
  const frames = [];
  const blocks = () => {
    const data = [];
    while (bytes[offset]) {
      const size = bytes[offset++];
      data.push(...bytes.subarray(offset, offset + size));
      offset += size;
      assert.ok(offset < bytes.length, "Truncated GIF data.");
    }
    offset++;
    return data;
  };
  while (offset < bytes.length) {
    const type = bytes[offset++];
    if (type === 0x3b) {
      assert.equal(offset, bytes.length, "Trailing GIF garbage.");
      assert.deepEqual(frames, [
        { color: [255, 0, 0], delay: 230 },
        { color: [0, 255, 0], delay: 370 },
      ]);
      return frames;
    }
    if (type === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) delay = uint16(offset + 2) * 10;
      blocks();
      continue;
    }
    assert.equal(type, 0x2c, "Invalid GIF block.");
    assert.equal(uint16(offset + 4), 1);
    assert.equal(uint16(offset + 6), 1);
    const packed = bytes[offset + 8];
    offset += 9;
    let framePalette = palette;
    if (packed & 0x80) {
      const size = 3 * (2 << (packed & 7));
      framePalette = bytes.subarray(offset, offset + size);
      offset += size;
    }
    const minimum = bytes[offset++];
    const data = blocks();
    let bit = 0;
    const readCode = () => {
      let code = 0;
      for (let i = 0; i <= minimum; i++, bit++)
        code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      return code;
    };
    assert.equal(readCode(), 1 << minimum, "Missing GIF LZW clear code.");
    const index = readCode();
    assert.equal(readCode(), (1 << minimum) + 1, "Missing GIF LZW end code.");
    frames.push({
      color: [...framePalette.subarray(index * 3, index * 3 + 3)],
      delay,
    });
  }
  assert.fail("Missing GIF trailer.");
}

/** Load the exported bootstrap using worker globals and resolve every dependency. */
export async function loadExportedWorker(outDirectory, url) {
  const root = resolve(outDirectory);
  const loaded = [];
  const responses = [];
  class WorkerGlobalScope {
    // vm contextifies its global object, so prototype identity is not retained.
    static [Symbol.hasInstance](value) {
      return value?.WorkerGlobalScope === this;
    }
  }
  const scope = new WorkerGlobalScope();
  Object.assign(scope, {
    self: scope,
    WorkerGlobalScope,
    location: url,
    URL,
    Blob,
    Uint8Array,
    Uint8ClampedArray,
    ArrayBuffer,
    DOMException,
    console,
    setTimeout,
    clearTimeout,
    postMessage: (message) => responses.push(message),
  });
  const context = createContext(scope);
  const execute = (reference) => {
    const resource = new URL(reference, url);
    assert.equal(
      resource.origin,
      url.origin,
      "Worker attempted a foreign dependency.",
    );
    assert.ok(
      resource.pathname.endsWith(".js"),
      "Worker attempted to execute a non-JavaScript asset.",
    );
    const path = resolve(root, `.${decodeURIComponent(resource.pathname)}`);
    assert.ok(
      path.startsWith(`${root}${sep}`),
      "Worker dependency escaped the export directory.",
    );
    loaded.push(resource.pathname);
    runInContext(readFileSync(path, "utf8"), context, {
      filename: path,
      timeout: 5000,
    });
  };
  scope.importScripts = (...references) => references.forEach(execute);
  execute(url.href);
  // Turbopack starts the worker's entry module after its dependencies settle.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    typeof scope.onmessage,
    "function",
    "GIF worker never installed its message handler.",
  );
  return { scope, responses, loaded };
}

/** Execute the actual emitted client factory, worker bootstrap and GIF protocol. */
export async function checkGifWorkerExport(outDirectory = resolve("out")) {
  const root = resolve(outDirectory);
  const chunkDirectory = join(root, "_next", "static", "chunks");
  const chunks = new Map(
    readdirSync(chunkDirectory)
      .filter((name) => name.endsWith(".js"))
      .map((name) => [
        `static/chunks/${name}`,
        readFileSync(join(chunkDirectory, name), "utf8"),
      ]),
  );
  const { url, client } = workerUrlFromClient(chunks);
  const { scope, responses, loaded } = await loadExportedWorker(root, url);
  const request = (data) => {
    scope.onmessage({ data });
    assert.equal(
      responses.length,
      1,
      "Worker did not return exactly one response.",
    );
    const response = responses.shift();
    assert.notEqual(response.type, "error", response.message);
    return response;
  };
  assert.equal(
    request({ type: "init", options: { width: 1, height: 1 } }).type,
    "ready",
  );
  assert.equal(
    request({
      type: "frame",
      rgba: new Uint8ClampedArray([255, 0, 0, 255]).buffer,
      timestampMs: 0,
    }).type,
    "frame",
  );
  assert.equal(
    request({
      type: "frame",
      rgba: new Uint8ClampedArray([0, 255, 0, 255]).buffer,
      timestampMs: 230,
    }).type,
    "frame",
  );
  const response = request({ type: "finish", timestampMs: 600 });
  assert.equal(response.type, "done");
  assert.equal(response.result.durationMs, 600);
  assert.equal(response.result.blob.type, "image/gif");
  const bytes = Buffer.from(await response.result.blob.arrayBuffer());
  const frames = verifyGif(bytes);
  return {
    client,
    worker: url.pathname,
    loaded,
    encodedBytes: bytes.length,
    frames,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(
      JSON.stringify(await checkGifWorkerExport(process.argv[2]), null, 2),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
