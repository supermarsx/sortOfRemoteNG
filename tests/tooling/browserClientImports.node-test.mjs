import assert from "node:assert/strict";
import test from "node:test";
import { validateBrowserClientImports } from "../../scripts/lib/browser-client-imports.mjs";

const x64 = "x86_64-pc-windows-msvc";
const arm64 = "aarch64-pc-windows-msvc";
const symbols = ["WSAStartup", "WSACleanup", "socket", "bind"];
const optional = 0x98;
const section = optional + 240;
const directory = (index) => optional + 112 + index * 8;
const offset = (rva) => rva - 0x1000 + 0x400;
const thunk = 0x180001100n;

function fixture({
  target = x64,
  delayed = [{ dll: "ws2_32.dll", names: symbols }],
  eager = [],
} = {}) {
  const buffer = Buffer.alloc(0x2400);
  buffer.write("MZ");
  buffer.writeUInt32LE(0x80, 60);
  buffer.writeUInt32LE(0x4550, 0x80);
  buffer.writeUInt16LE(target === x64 ? 0x8664 : 0xaa64, 0x84);
  buffer.writeUInt16LE(1, 0x86);
  buffer.writeUInt16LE(240, 0x94);
  buffer.writeUInt16LE(0x2000, 0x96);
  buffer.writeUInt16LE(0x20b, optional);
  buffer.writeBigUInt64LE(0x180000000n, optional + 24);
  buffer.writeUInt32LE(0x3000, optional + 56);
  buffer.writeUInt32LE(0x400, optional + 60);
  buffer.writeUInt32LE(16, optional + 108);
  buffer.write(".rdata", section);
  for (const [field, value] of [
    [8, 0x2000],
    [12, 0x1000],
    [16, 0x2000],
    [20, 0x400],
  ])
    buffer.writeUInt32LE(value, section + field);
  let cursor = 0x1300;
  const allocate = (size) => {
    const rva = cursor;
    cursor += Math.ceil(size / 8) * 8;
    assert.ok(cursor < 0x2e00, "fixture allocation fits");
    return rva;
  };
  const tables = (descriptors, isDelayed) => {
    if (!descriptors.length) return [];
    const rva = isDelayed ? 0x1180 : 0x1000;
    const stride = isDelayed ? 32 : 20;
    const dir = directory(isDelayed ? 13 : 1);
    buffer.writeUInt32LE(rva, dir);
    buffer.writeUInt32LE((descriptors.length + 1) * stride, dir + 4);
    return descriptors.map(({ dll, names }, i) => {
      const at = offset(rva) + i * stride;
      const dllRva = allocate(dll.length + 1);
      buffer.write(dll, offset(dllRva));
      const intRva = allocate((names.length + 1) * 8);
      const iatRva = allocate((names.length + 1) * 8);
      const nameRvas = names.map((name, j) => {
        const nameRva =
          typeof name === "bigint" ? name : allocate(name.length + 3);
        if (typeof name !== "bigint") buffer.write(name, offset(nameRva) + 2);
        buffer.writeBigUInt64LE(BigInt(nameRva), offset(intRva) + j * 8);
        buffer.writeBigUInt64LE(
          isDelayed ? thunk : BigInt(nameRva),
          offset(iatRva) + j * 8,
        );
        return nameRva;
      });
      const moduleRva = allocate(8);
      const boundRva = allocate((names.length + 1) * 8);
      const fields = isDelayed
        ? [1, dllRva, moduleRva, iatRva, intRva, boundRva, 0, 0]
        : [intRva, 0, 0, dllRva, iatRva];
      fields.forEach((value, j) => buffer.writeUInt32LE(value, at + j * 4));
      return { at, dllRva, intRva, iatRva, nameRvas, moduleRva, boundRva };
    });
  };
  return {
    buffer,
    eager: tables(eager, false),
    delayed: tables(delayed, true),
  };
}

function rejects(buffer, pattern, target = x64) {
  assert.throws(
    () => validateBrowserClientImports(buffer, target),
    (error) => {
      assert.equal(
        error.constructor,
        Error,
        "no unchecked Buffer RangeError/TypeError",
      );
      assert.match(error.message, /Browser client import guard/);
      assert.match(error.message, pattern);
      assert.match(
        error.message,
        /Rebuild app_lib\.dll.*canonical Windows SDK.*\/DELAYLOAD.*do not stage this DLL/,
      );
      return true;
    },
  );
}

for (const target of [x64, arm64]) {
  test(`valid ${target} with matching delayed INT/IAT and an unbound zero BIAT`, () => {
    const { buffer } = fixture({
      target,
      eager: [{ dll: "kernel32.dll", names: ["Sleep"] }],
    });
    const before = Buffer.from(buffer);
    assert.deepEqual(validateBrowserClientImports(buffer, target), {
      target,
      machine: target === x64 ? "x64" : "arm64",
      dll: "ws2_32.dll",
      delayedImports: 4,
      checkedImports: symbols,
      thunkOwnership: {
        format: target === x64 ? "msvc-x64" : "unsupported-architecture",
        status: "skipped",
        recognizedThunks: 0,
        unrecognizedCandidates: 0,
        unrecognizedSlots: 4,
      },
    });
    assert.deepEqual(buffer, before, "validation is read-only");
  });
}

test("one mixed-case Winsock descriptor is allowed; socket/bind are optional", () => {
  const { buffer } = fixture({
    delayed: [{ dll: "Ws2_32.DLL", names: symbols.slice(0, 2) }],
  });
  assert.deepEqual(
    validateBrowserClientImports(buffer, x64).checkedImports,
    symbols.slice(0, 2),
  );
});

for (const target of [x64, arm64]) {
  test(`accepts SDK Winsock ordinals 115/116 on ${target}`, () => {
    const { buffer } = fixture({
      target,
      delayed: [
        {
          dll: "WS2_32.dll",
          names: [0x8000000000000073n, 0x8000000000000074n, "socket", "bind"],
        },
      ],
    });
    assert.deepEqual(
      validateBrowserClientImports(buffer, target).checkedImports,
      symbols,
    );
  });
}

test("accepts mixed name/ordinal imports but no unrelated ordinal aliases", () => {
  const { buffer } = fixture({
    delayed: [
      { dll: "ws2_32.dll", names: ["WSAStartup", 0x8000000000000074n] },
    ],
  });
  assert.equal(validateBrowserClientImports(buffer, x64).delayedImports, 2);
  rejects(
    fixture({
      delayed: [
        {
          dll: "ws2_32.dll",
          names: [0x8000000000000072n, 0x8000000000000074n],
        },
      ],
    }).buffer,
    /missing WSAStartup/,
  );
  rejects(
    fixture({
      delayed: [
        { dll: "ws2_32.dll", names: ["socket", "bind"] },
        { dll: "other.dll", names: [0x8000000000000073n, 0x8000000000000074n] },
      ],
    }).buffer,
    /missing WSAStartup, WSACleanup/,
  );
});

for (const missing of symbols.slice(0, 2)) {
  test(`rejects missing ${missing} despite a hint/name and orphan thunk elsewhere`, () => {
    const { buffer } = fixture({
      delayed: [
        { dll: "ws2_32.dll", names: symbols.filter((s) => s !== missing) },
      ],
    });
    // A valid, unreferenced hint/name plus INT/IAT pair cannot repair a descriptor.
    buffer.write(missing, offset(0x2e00) + 2);
    buffer.writeBigUInt64LE(0x2e00n, offset(0x2e80));
    buffer.writeBigUInt64LE(thunk, offset(0x2ec0));
    rejects(buffer, new RegExp(`missing ${missing}`));
  });
}

test("rejects minimal networking-free DLL (gate is full-app only)", () => {
  rejects(fixture({ delayed: [] }).buffer, /one unique delayed ws2_32/);
});

test("rejects dual-cased delay descriptors even when their combined names are complete", () => {
  rejects(
    fixture({
      delayed: [
        { dll: "ws2_32.dll", names: symbols.slice(0, 2) },
        { dll: "WS2_32.dll", names: symbols.slice(2) },
      ],
    }).buffer,
    /unique.*case-insensitive.*found 2/,
  );
});

test("rejects two identically cased Winsock descriptors", () => {
  rejects(
    fixture({
      delayed: [
        { dll: "ws2_32.dll", names: symbols },
        { dll: "ws2_32.dll", names: symbols },
      ],
    }).buffer,
    /unique.*found 2/,
  );
});

test("rejects eager Winsock even alongside a valid delayed descriptor", () => {
  rejects(
    fixture({ eager: [{ dll: "WS2_32.DLL", names: ["WSAStartup"] }] }).buffer,
    /must not be eager/,
  );
  rejects(
    fixture({ eager: [{ dll: "ws2_32.dll", names: [0x8000000000000073n] }] })
      .buffer,
    /must not be eager/,
  );
});

for (const name of symbols) {
  test(`rejects ${name} in another DLL's eager or delayed descriptor`, () => {
    for (const kind of ["eager", "delayed"]) {
      const descriptors = [{ dll: "other.dll", names: [name] }];
      if (kind === "delayed")
        descriptors.unshift({ dll: "ws2_32.dll", names: symbols });
      rejects(
        fixture({ [kind]: descriptors }).buffer,
        new RegExp(`${name} must belong to the delayed ws2_32`),
      );
    }
  });
}

test("supports eager OriginalFirstThunk fallback and well-formed ordinal entries", () => {
  const f = fixture({
    eager: [{ dll: "kernel32.dll", names: ["Sleep", 0x8000000000000001n] }],
    delayed: [{ dll: "ws2_32.dll", names: [...symbols, 0x8000000000000002n] }],
  });
  f.buffer.writeUInt32LE(0, f.eager[0].at);
  assert.equal(validateBrowserClientImports(f.buffer, x64).delayedImports, 5);
});

test("allows zero-filled virtual module-handle storage and a matching unload IAT", () => {
  const {
    buffer,
    delayed: [d],
  } = fixture();
  buffer.writeUInt32LE(0x4000, optional + 56);
  buffer.writeUInt32LE(0x3000, section + 8);
  buffer.writeUInt32LE(0x3100, d.at + 8);
  buffer.writeUInt32LE(0x2e00, d.at + 24);
  buffer.copy(buffer, offset(0x2e00), offset(d.iatRva), offset(d.iatRva) + 40);
  assert.equal(validateBrowserClientImports(buffer, x64).delayedImports, 4);
});

test("IAT may be in a separate section, but its final slot and terminator must fit", () => {
  const {
    buffer,
    delayed: [d],
  } = fixture();
  buffer.writeUInt16LE(2, 0x86);
  buffer.writeUInt32LE(0x1000, section + 8);
  buffer.writeUInt32LE(0x1000, section + 16);
  for (const [field, value] of [
    [8, 0x1000],
    [12, 0x2000],
    [16, 0x1000],
    [20, 0x1400],
  ])
    buffer.writeUInt32LE(value, section + 40 + field);
  buffer.copy(buffer, offset(0x2fd8), offset(d.iatRva), offset(d.iatRva) + 40);
  buffer.writeUInt32LE(0x2fd8, d.at + 12);
  assert.equal(validateBrowserClientImports(buffer, x64).delayedImports, 4);
  // Every function slot fits, but there is no room for the terminating pointer.
  buffer.copy(buffer, offset(0x2fe0), offset(d.iatRva), offset(d.iatRva) + 32);
  buffer.writeUInt32LE(0x2fe0, d.at + 12);
  rejects(buffer, /unterminated INT\/IAT/);
});

test("name terminators and pointer slots cannot use zero-filled section tails", () => {
  const {
    buffer,
    delayed: [d],
  } = fixture();
  buffer.writeUInt32LE(0x1f00, section + 16);
  buffer.writeUInt32LE(0x2ef8, d.at + 4);
  buffer.fill(65, offset(0x2ef8), offset(0x2f00));
  rejects(buffer, /unterminated ASCII name/);
  buffer.writeUInt32LE(d.dllRva, d.at + 4);
  buffer.writeUInt32LE(0x2f00, d.at + 12);
  rejects(buffer, /outside file-backed bounds/);
});

function codeFixture(options) {
  const f = fixture(options),
    b = f.buffer;
  b.writeUInt16LE(2, 0x86);
  b.writeUInt32LE(0x1000, section + 8);
  b.writeUInt32LE(0x1000, section + 16);
  b.write(".code", section + 40); // Recognition uses execute permission, not .text.
  for (const [field, value] of [
    [8, 0x1000],
    [12, 0x2000],
    [16, 0x1000],
    [20, 0x1400],
    [36, 0x60000020],
  ])
    b.writeUInt32LE(value, section + 40 + field);
  const writeTail = (tail, descriptor, helper = 0x2f00) => {
    const rva = tail + 32,
      at = offset(rva);
    b.set([0x48, 0x8b, 0xd0, 0x48, 0x8d, 0x0d], at);
    b.writeInt32LE(descriptor - (rva + 10), at + 6);
    b[at + 10] = 0xe8;
    b.writeInt32LE(helper - (rva + 15), at + 11);
  };
  const writeThunk = (rva, slot, tail = 0x2200) => {
    const at = offset(rva);
    b.set([0x48, 0x8d, 0x05], at);
    b.writeInt32LE(slot - (rva + 7), at + 3);
    b[at + 7] = 0xe9;
    b.writeInt32LE(tail - (rva + 12), at + 8);
    b.writeBigUInt64LE(0x180000000n + BigInt(rva), offset(slot));
  };
  b[offset(0x2f00)] = 0xc3;
  let next = 0x2020;
  for (const [i, d] of f.delayed.entries()) {
    const tail = 0x2200 + i * 0x100;
    writeTail(tail, d.at + 0xc00);
    for (let j = 0; j < d.nameRvas.length; j++, next += 16)
      writeThunk(next, d.iatRva + j * 8, tail);
  }
  return { ...f, writeTail, writeThunk };
}

test("recognizes self-referencing x64 thunks in executable sections", () => {
  const { buffer } = codeFixture();
  const before = Buffer.from(buffer);
  assert.deepEqual(validateBrowserClientImports(buffer, x64).thunkOwnership, {
    format: "msvc-x64",
    status: "recognized-patterns-checked",
    recognizedThunks: 4,
    unrecognizedCandidates: 0,
    unrecognizedSlots: 0,
  });
  assert.deepEqual(buffer, before);
});

test("signed backward jumps and tail patterns at the section boundary are recognized", () => {
  const f = codeFixture();
  f.writeTail(0x2d00, f.delayed[0].at + 0xc00);
  f.writeThunk(0x2e00, f.delayed[0].iatRva, 0x2d00);
  // Only 47 bytes of the scanner's 128-byte tail window are file-backed here.
  f.writeTail(0x2fd1, f.delayed[0].at + 0xc00);
  f.writeThunk(0x2030, f.delayed[0].iatRva + 8, 0x2fd1);
  const summary = validateBrowserClientImports(f.buffer, x64).thunkOwnership;
  assert.equal(summary.status, "recognized-patterns-checked");
  assert.equal(summary.recognizedThunks, 4);
});

test("rejects another orphan thunk despite repaired SDK startup/cleanup ordinals", () => {
  const f = codeFixture({
    delayed: [
      { dll: "ws2_32.dll", names: [0x8000000000000073n, 0x8000000000000074n] },
    ],
  });
  f.writeThunk(0x2080, 0x1e00); // Other function's orphan slot, outside advertised IAT.
  rejects(
    f.buffer,
    /orphan MSVC x64 delay thunk 0x2080.*slot 0x1e00.*ws2_32.dll.*advertised IAT/,
  );
});

test("thunks must belong to their tail's descriptor, not another DLL's IAT", () => {
  const f = codeFixture({
    delayed: [
      { dll: "ws2_32.dll", names: symbols },
      { dll: "other.dll", names: ["OtherFunction"] },
    ],
  });
  // IAT slot is advertised, but only by other.dll. The tail points at Winsock.
  f.writeThunk(0x2080, f.delayed[1].iatRva);
  rejects(f.buffer, /orphan MSVC x64.*outside ws2_32.dll descriptor/);
});

test("rejects the real split Shell32 IAT even when all Winsock thunks are valid", () => {
  const f = codeFixture({
    delayed: [
      { dll: "WS2_32.dll", names: [0x8000000000000073n, 0x8000000000000074n] },
      {
        dll: "SHELL32.dll",
        names: [
          "SHOpenFolderAndSelectItems",
          0x80000000000000ben,
          "Shell_NotifyIconW",
          0x800000000000009bn,
        ],
      },
    ],
  });
  // The failed full DLL advertised four SDK slots, but seven lower-case
  // Shell32 slots elsewhere called the SAME descriptor's delay-helper tail.
  for (let i = 0; i < 7; i++)
    f.writeThunk(0x2080 + i * 16, 0x1e00 + i * 8, 0x2300);
  const before = Buffer.from(f.buffer);
  rejects(f.buffer, /orphan MSVC x64.*outside shell32\.dll descriptor/);
  assert.throws(
    () => validateBrowserClientImports(f.buffer, x64),
    (error) => {
      assert.match(error.message, /\/DELAYLOAD:shell32\.dll/);
      assert.doesNotMatch(error.message, /Winsock|\/DELAYLOAD:ws2_32\.dll/);
      return true;
    },
  );
  assert.deepEqual(f.buffer, before, "never repair or widen the malformed IAT");
});

test("accepts a single canonical Shell32 closure alongside canonical Winsock", () => {
  const f = codeFixture({
    delayed: [
      { dll: "WS2_32.dll", names: [0x8000000000000073n, 0x8000000000000074n] },
      {
        dll: "SHELL32.dll",
        names: [
          "SHOpenFolderAndSelectItems",
          0x80000000000000ben,
          "Shell_NotifyIconW",
          0x800000000000009bn,
          "SHGetKnownFolderPath",
          "SHCreateItemFromParsingName",
          "ShellExecuteW",
          "Shell_NotifyIconGetRect",
          "DragFinish",
          "SHAppBarMessage",
          "DragQueryFileW",
        ],
      },
    ],
  });
  assert.deepEqual(validateBrowserClientImports(f.buffer, x64).thunkOwnership, {
    format: "msvc-x64",
    status: "recognized-patterns-checked",
    recognizedThunks: 13,
    unrecognizedCandidates: 0,
    unrecognizedSlots: 0,
  });
});

test("recognized tail cannot target an unadvertised descriptor", () => {
  const f = codeFixture();
  f.writeTail(0x2200, 0x1800);
  rejects(f.buffer, /targets unadvertised descriptor 0x1800/);
});

test("unrecognized thunk code reports partial coverage", () => {
  const { buffer } = codeFixture();
  buffer[offset(0x2020)] = 0x49;
  const summary = validateBrowserClientImports(buffer, x64).thunkOwnership;
  assert.equal(summary.status, "partial");
  assert.equal(summary.recognizedThunks, 3);
  assert.equal(summary.unrecognizedSlots, 1);
});

for (const kind of [
  "unknown",
  "ambiguous",
  "non-executable-helper",
  "out-of-bounds-tail",
]) {
  test(`skips ${kind} tail format with explicit incomplete coverage`, () => {
    const f = codeFixture();
    if (kind === "unknown") f.buffer[offset(0x2220)] = 0x49;
    if (kind === "ambiguous") f.writeTail(0x2220, f.delayed[0].at + 0xc00);
    if (kind === "non-executable-helper")
      f.writeTail(0x2200, f.delayed[0].at + 0xc00, 0x1100);
    if (kind === "out-of-bounds-tail") {
      for (let i = 0; i < 4; i++)
        f.writeThunk(0x2020 + i * 16, f.delayed[0].iatRva + i * 8, 0x4000);
    }
    assert.deepEqual(
      validateBrowserClientImports(f.buffer, x64).thunkOwnership,
      {
        format: "msvc-x64",
        status: "skipped",
        recognizedThunks: 0,
        unrecognizedCandidates: 4,
        unrecognizedSlots: 4,
      },
    );
  });
}

test("ARM64 and non-executable bytes do not get x64 ownership claims", () => {
  for (const target of [x64, arm64]) {
    const f = codeFixture({ target });
    f.writeThunk(0x2080, 0x1e00);
    if (target === x64) f.buffer.writeUInt32LE(0x40000040, section + 40 + 36);
    const summary = validateBrowserClientImports(
      f.buffer,
      target,
    ).thunkOwnership;
    assert.equal(summary.status, "skipped");
    assert.equal(summary.recognizedThunks, 0);
    assert.equal(summary.unrecognizedSlots, 4);
  }
});

test("speculative LEAs and truncated code never read past section bounds", () => {
  const f = codeFixture();
  // Looks like a thunk, but LEA points outside the image, so self-reference fails.
  f.buffer.copy(f.buffer, offset(0x2080), offset(0x2020), offset(0x2020) + 12);
  f.buffer.writeInt32LE(-0x4000, offset(0x2080) + 3);
  for (const length of [3, 7, 11]) {
    const b = Buffer.from(f.buffer);
    b.copy(b, b.length - length, offset(0x2020), offset(0x2020) + length);
    assert.equal(
      validateBrowserClientImports(b, x64).thunkOwnership.recognizedThunks,
      4,
    );
  }
  // A self-reference is present, but its tail signature is truncated at EOF.
  f.writeThunk(0x2080, 0x1e00, 0x2ffa);
  f.buffer.set([0x48, 0x8b, 0xd0, 0x48, 0x8d, 0x0d], offset(0x2ffa));
  const summary = validateBrowserClientImports(f.buffer, x64).thunkOwnership;
  assert.equal(summary.status, "partial");
  assert.equal(summary.unrecognizedCandidates, 1);
});

const corruptions = [
  ["bad MZ", (b) => b.writeUInt16LE(0, 0), /MZ/],
  [
    "invalid PE offset",
    (b) => b.writeUInt32LE(0xfffffff0, 60),
    /header.*bounds/,
  ],
  ["bad PE signature", (b) => b.writeUInt32LE(0, 0x80), /PE signature/],
  ["wrong machine", (b) => b.writeUInt16LE(0xaa64, 0x84), /machine/],
  ["EXE instead of DLL", (b) => b.writeUInt16LE(0, 0x96), /client DLL/],
  [
    "short optional header",
    (b) => b.writeUInt16LE(100, 0x94),
    /optional header/,
  ],
  ["PE32 instead of PE32+", (b) => b.writeUInt16LE(0x10b, optional), /PE32\+/],
  [
    "directory count overflow",
    (b) => b.writeUInt32LE(17, optional + 108),
    /directories.*bounds/,
  ],
  [
    "section table truncation",
    (b) => b.writeUInt16LE(20, 0x86),
    /section table.*bounds/,
  ],
  [
    "section raw overflow",
    (b) => b.writeUInt32LE(0xfffffff0, section + 20),
    /raw data.*bounds/,
  ],
  [
    "section RVA overflow",
    (b) => b.writeUInt32LE(0xfffffff0, section + 12),
    /section.*RVA/,
  ],
  [
    "section/header overlap",
    (b) => b.writeUInt32LE(0, section + 20),
    /overlapping/,
  ],
  [
    "invalidRVA directory",
    (b) => b.writeUInt32LE(0xfffffff0, directory(13)),
    /invalid RVA/,
  ],
  [
    "directory overrun",
    (b) => b.writeUInt32LE(0x2000, directory(13) + 4),
    /invalid RVA/,
  ],
  [
    "missing descriptor terminator",
    (b) => b.writeUInt32LE(32, directory(13) + 4),
    /unterminated import descriptors/,
  ],
  ["legacy VA attributes", (b, d) => b.writeUInt32LE(0, d.at), /RVA-based/],
  ["reserved attributes", (b, d) => b.writeUInt32LE(3, d.at), /RVA-based/],
  [
    "invalidRVA DLL name",
    (b, d) => b.writeUInt32LE(0xdeadbeef, d.at + 4),
    /invalid RVA/,
  ],
  [
    "invalidRVA INT",
    (b, d) => b.writeUInt32LE(0xdeadbee8, d.at + 16),
    /invalid RVA/,
  ],
  ["null INT", (b, d) => b.writeUInt32LE(0, d.at + 16), /invalid RVA/],
  [
    "invalidRVA IAT",
    (b, d) => b.writeUInt32LE(0xdeadbee8, d.at + 12),
    /invalid RVA/,
  ],
  [
    "invalidRVA handle",
    (b, d) => b.writeUInt32LE(0xdeadbee8, d.at + 8),
    /invalid RVA/,
  ],
  [
    "invalidRVA bound table",
    (b, d) => b.writeUInt32LE(0xdeadbee8, d.at + 20),
    /invalid RVA/,
  ],
  [
    "unaligned array",
    (b, d) => b.writeUInt32LE(d.intRva + 1, d.at + 16),
    /unaligned/,
  ],
  [
    "invalidRVA function name",
    (b, d) => b.writeBigUInt64LE(0x4000n, offset(d.intRva)),
    /invalid RVA/,
  ],
  [
    "64-bit name overflow",
    (b, d) => b.writeBigUInt64LE(0x100000001n, offset(d.intRva)),
    /import name RVA/,
  ],
  [
    "reserved ordinal bits",
    (b, d) => b.writeBigUInt64LE(0x8000000100000001n, offset(d.intRva)),
    /ordinal thunk/,
  ],
  [
    "invalid thunk pointer",
    (b, d) => b.writeBigUInt64LE(1n, offset(d.iatRva)),
    /invalid thunk VA/,
  ],
  [
    "IAT ends early",
    (b, d) => b.writeBigUInt64LE(0n, offset(d.iatRva)),
    /IAT terminates before INT/,
  ],
  [
    "INT ends early",
    (b, d) => b.writeBigUInt64LE(0n, offset(d.intRva)),
    /terminators disagree/,
  ],
  [
    "bad BIAT terminator",
    (b, d) => b.writeBigUInt64LE(1n, offset(d.boundRva) + 32),
    /terminator mismatch/,
  ],
  [
    "short optional array",
    (b, d) => b.writeUInt32LE(0x2ff8, d.at + 20),
    /array out of bounds/,
  ],
  [
    "incorrect unload copy",
    (b, d) => b.writeUInt32LE(d.boundRva, d.at + 24),
    /unload IAT differs/,
  ],
  [
    "non-ASCII DLL name",
    (b, d) => {
      b[offset(d.dllRva)] = 255;
    },
    /ASCII name/,
  ],
  [
    "unterminated DLL name",
    (b, d) => {
      b.writeUInt32LE(0x2ff8, d.at + 4);
      b.fill(65, offset(0x2ff8));
    },
    /unterminated ASCII name/,
  ],
  [
    "unterminated function name",
    (b, d) => {
      b.writeBigUInt64LE(0x2ff0n, offset(d.intRva));
      b.fill(65, offset(0x2ff0) + 2);
    },
    /unterminated ASCII name/,
  ],
  [
    "hint straddles section",
    (b, d) => b.writeBigUInt64LE(0x2fffn, offset(d.intRva)),
    /hint\/name.*invalid RVA/,
  ],
  [
    "unterminated pointer array",
    (b, d) => {
      b.writeUInt32LE(0x2ff8, d.at + 16);
      b.writeBigUInt64LE(BigInt(d.nameRvas[0]), offset(0x2ff8));
    },
    /unterminated INT\/IAT/,
  ],
];
for (const [name, mutate, error] of corruptions) {
  test(`rejects malformed PE: ${name}`, () => {
    const {
      buffer,
      delayed: [d],
    } = fixture();
    mutate(buffer, d);
    rejects(buffer, error);
  });
}

test("bounds checks also cover eager import arrays", () => {
  const {
    buffer,
    eager: [d],
  } = fixture({ eager: [{ dll: "kernel32.dll", names: ["Sleep"] }] });
  buffer.writeUInt32LE(0xdeadbee8, d.at);
  rejects(buffer, /eager kernel32\.dll INT: invalid RVA/);
});

test("truncated buffers and unsupported inputs fail with rebuild errors", () => {
  const { buffer } = fixture();
  for (const size of [
    0,
    2,
    63,
    0x80,
    0x97,
    0x100,
    0x1a0,
    0x500,
    buffer.length - 1,
  ])
    rejects(buffer.subarray(0, size), /bounds/);
  rejects(new Uint8Array(buffer), /Buffer/);
  rejects(buffer, /machine/, "x86_64-unknown-linux-gnu");
});
