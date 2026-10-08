// Full-app PE32+ structural gate; intentionally not part of fixture packaging.
// Follows advertised descriptors/INTs/IATs, never a whole-file string search.
// Recognized MSVC x64 delay thunks additionally get descriptor/slot ownership
// checks. Unknown code formats and ARM64 report skipped/partial coverage.
// This is not runtime proof or exhaustive orphan/call-site detection; it cannot
// verify delay-helper execution, sandboxing or network admission.
// Layout: https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
export function validateBrowserClientImports(buffer, target) {
  const fail = (detail, dll) => {
    throw new Error(
      `Browser client import guard (${target}): ${detail}. Rebuild app_lib.dll ` +
        "with canonical Windows SDK import libraries and " +
        (dll ? `/DELAYLOAD:${dll}` : "matching /DELAYLOAD options") +
        "; do not stage this DLL",
    );
  };
  if (!Buffer.isBuffer(buffer)) fail("expected a PE file Buffer");
  const range = (offset, size, label, limit = buffer.length) => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      size < 0 ||
      !Number.isSafeInteger(size) ||
      offset + size > limit
    )
      fail(`${label} is out of bounds`);
    return offset;
  };
  const u16 = (offset) => buffer.readUInt16LE(range(offset, 2, "PE field"));
  const u32 = (offset) => buffer.readUInt32LE(range(offset, 4, "PE field"));
  const u64 = (offset) =>
    buffer.readBigUInt64LE(range(offset, 8, "PE pointer"));
  range(0, 64, "DOS header");
  if (u16(0) !== 0x5a4d) fail("missing MZ signature");
  const pe = u32(60);
  range(pe, 24, "PE/COFF header");
  if (pe < 64 || u32(pe) !== 0x4550) fail("invalid PE signature");
  const machine = new Map([
    ["x86_64-pc-windows-msvc", 0x8664],
    ["aarch64-pc-windows-msvc", 0xaa64],
  ]).get(target);
  if (!machine || u16(pe + 4) !== machine)
    fail("expected matching x64/ARM64 machine");
  if (!(u16(pe + 22) & 0x2000)) fail("expected a client DLL");
  const optional = pe + 24;
  const optionalSize = u16(pe + 20);
  range(optional, optionalSize, "optional header");
  if (optionalSize < 112 || u16(optional) !== 0x20b)
    fail("expected PE32+ optional header");
  const imageBase = u64(optional + 24);
  const imageSize = u32(optional + 56);
  const headers = u32(optional + 60);
  range(0, headers, "SizeOfHeaders");
  const directoryCount = u32(optional + 108);
  range(112, directoryCount * 8, "data directories", optionalSize);
  const sectionCount = u16(pe + 6);
  const sectionTable = optional + optionalSize;
  if (!sectionCount || sectionCount > 96 || headers > imageSize)
    fail("invalid section count or image/header size");
  range(sectionTable, sectionCount * 40, "section table", headers);
  const sections = [{ rva: 0, size: headers, raw: 0, span: headers }];
  for (let i = 0; i < sectionCount; i++) {
    const at = sectionTable + i * 40;
    const rva = u32(at + 12),
      size = u32(at + 16),
      raw = u32(at + 20);
    const span = Math.max(u32(at + 8), size);
    if (rva < headers || rva + span > imageSize)
      fail(`section ${i} RVA is out of bounds`);
    if (size) range(raw, size, `section ${i} raw data`);
    sections.push({
      rva,
      size,
      raw,
      span,
      executable: !!(u32(at + 36) & 0x20000000),
    });
  }
  for (const [start, length] of [
    ["rva", "span"],
    ["raw", "size"],
  ]) {
    const sorted = sections
      .filter((s) => s[length])
      .sort((a, b) => a[start] - b[start]);
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i][start] < sorted[i - 1][start] + sorted[i - 1][length])
        fail(`overlapping section ${start} ranges`);
  }
  const mapped = (rva, size, label, virtual = false) => {
    if (!Number.isSafeInteger(rva) || rva <= 0 || rva + size > imageSize)
      fail(`${label}: invalid RVA 0x${rva.toString(16)}`);
    const section = sections.find(
      (s) => rva >= s.rva && rva + size <= s.rva + s.span,
    );
    if (!section || (!virtual && rva + size > section.rva + section.size))
      fail(`${label}: RVA 0x${rva.toString(16)} is outside file-backed bounds`);
    return {
      offset: section.raw + rva - section.rva,
      available: section.size - (rva - section.rva),
    };
  };
  const nameAt = (rva, label) => {
    const { offset, available } = mapped(rva, 1, label);
    const bytes = buffer.subarray(offset, offset + Math.min(available, 4096));
    const end = bytes.indexOf(0);
    if (
      end <= 0 ||
      bytes.subarray(0, end).some((byte) => byte < 32 || byte > 126)
    )
      fail(`${label}: empty, invalid or unterminated ASCII name`);
    return bytes.toString("ascii", 0, end);
  };
  const tableAt = (rva, label) => {
    if (rva % 8) fail(`${label}: unaligned pointer array`);
    return mapped(rva, 8, label);
  };
  const thunkTarget = (value, label) => {
    const rva = value - imageBase;
    if (rva <= 0n || rva > 0xffffffffn) fail(`${label}: invalid thunk VA`);
    mapped(Number(rva), 1, label);
  };
  const imports = (intRva, iatRva, label, delayed) => {
    const names = tableAt(intRva, `${label} INT`);
    const addresses = tableAt(iatRva, `${label} IAT`);
    const limit = Math.min(names.available, addresses.available) / 8;
    const symbols = [];
    for (let i = 0; i < Math.floor(limit) && i < 65536; i++) {
      const entry = u64(names.offset + i * 8);
      const pointer = u64(addresses.offset + i * 8);
      if (!entry) {
        if (pointer) fail(`${label}: INT/IAT terminators disagree`);
        return symbols;
      }
      if (!pointer) fail(`${label}: IAT terminates before INT`);
      if (delayed) thunkTarget(pointer, `${label} IAT[${i}]`);
      if (entry & (1n << 63n)) {
        if (entry & 0x7fffffffffff0000n)
          fail(`${label}: invalid ordinal thunk`);
        symbols.push(`#${entry & 0xffffn}`);
      } else {
        if (entry > 0x7fffffffn) fail(`${label}: invalid import name RVA`);
        mapped(Number(entry), 3, `${label} hint/name`);
        symbols.push(nameAt(Number(entry) + 2, `${label} import name`));
      }
    }
    fail(
      `${label}: unterminated INT/IAT or pointer array exceeds bounds/guard limit`,
    );
  };
  const descriptors = (index, delayed) => {
    if (index >= directoryCount) return [];
    const dir = optional + 112 + index * 8;
    const rva = u32(dir),
      size = u32(dir + 4);
    if (!rva && !size) return [];
    const stride = delayed ? 32 : 20;
    if (!rva || size < stride || size % stride)
      fail("invalid import directory size/RVA");
    const { offset } = mapped(rva, size, "import directory");
    const result = [];
    for (let i = 0; i < size / stride && i < 4096; i++) {
      const at = offset + i * stride;
      const fields = Array.from({ length: stride / 4 }, (_, j) =>
        u32(at + j * 4),
      );
      if (fields.every((value) => !value)) return result;
      if (delayed && fields[0] !== 1)
        fail("delay descriptor must use RVA-based attributes (1)");
      const dll = nameAt(fields[delayed ? 1 : 3], "import DLL name");
      const label = `${delayed ? "delayed" : "eager"} ${dll}`;
      const iatRva = fields[delayed ? 3 : 4];
      const symbols = imports(
        delayed ? fields[4] : fields[0] || iatRva,
        iatRva,
        label,
        delayed,
      );
      if (delayed) {
        // The module-handle storage may legitimately occupy a zero-filled tail.
        if (fields[2] % 8) fail(`${label}: unaligned module handle`);
        mapped(fields[2], 8, `${label} module handle`, true);
        for (const field of [5, 6]) {
          if (!fields[field]) continue;
          const table = tableAt(
            fields[field],
            `${label} optional pointer array`,
          );
          const bytes = (symbols.length + 1) * 8;
          if (bytes > table.available)
            fail(`${label}: optional pointer array out of bounds`);
          for (let j = 0; j <= symbols.length; j++) {
            const value = u64(table.offset + j * 8);
            // MSVC reserves an all-zero BIAT before binding. UIAT, when present,
            // must preserve the original IAT (including its null terminator).
            if (j === symbols.length && value)
              fail(`${label}: optional pointer array terminator mismatch`);
            if (
              field === 6 &&
              value !==
                u64(mapped(iatRva, bytes, `${label} IAT`).offset + j * 8)
            )
              fail(`${label}: unload IAT differs from IAT`);
          }
        }
      }
      // Windows SDK ws2_32.lib imports these by their established ordinals.
      // Scope aliases to Winsock; ordinal 115 in another DLL means nothing here.
      const dllName = dll.toLowerCase();
      const aliases = new Map([
        ["#115", "WSAStartup"],
        ["#116", "WSACleanup"],
      ]);
      result.push({
        rva: rva + i * stride,
        iatRva,
        dll: dllName,
        symbols:
          dllName === "ws2_32.dll"
            ? symbols.map((s) => aliases.get(s) ?? s)
            : symbols,
        delayed,
      });
    }
    fail("unterminated import descriptors or directory exceeds guard limit");
  };
  const eager = descriptors(1, false);
  const delayed = descriptors(13, true);
  const winsock = delayed.filter(({ dll }) => dll === "ws2_32.dll");
  if (winsock.length !== 1)
    fail(
      `expected one unique delayed ws2_32.dll descriptor (case-insensitive); found ${winsock.length}`,
    );
  if (eager.some(({ dll }) => dll === "ws2_32.dll"))
    fail("ws2_32.dll must not be eager");
  const required = ["WSAStartup", "WSACleanup"];
  const checked = [...required, "socket", "bind"];
  for (const descriptor of [...eager, ...delayed])
    for (const symbol of descriptor.symbols)
      if (checked.includes(symbol) && descriptor !== winsock[0])
        fail(
          `${symbol} must belong to the delayed ws2_32.dll descriptor, not ${descriptor.delayed ? "delayed" : "eager"} ${descriptor.dll}`,
        );
  const missing = required.filter(
    (symbol) => !winsock[0].symbols.includes(symbol),
  );
  if (missing.length)
    fail(
      `delayed ws2_32.dll INT/IAT is missing ${missing.join(", ")} (possible orphan thunks)`,
    );
  return {
    target,
    machine: machine === 0x8664 ? "x64" : "arm64",
    dll: "ws2_32.dll",
    delayedImports: winsock[0].symbols.length,
    checkedImports: checked.filter((symbol) =>
      winsock[0].symbols.includes(symbol),
    ),
    thunkOwnership: checkX64DelayThunks(
      buffer,
      sections,
      delayed,
      imageBase,
      machine,
      fail,
    ),
  };
}

// Only called after section ranges and advertised INT/IAT arrays are validated.
// This recognizes the MSVC template, not arbitrary machine code/disassembly.
function checkX64DelayThunks(
  buffer,
  sections,
  descriptors,
  imageBase,
  machine,
  fail,
) {
  const summary = {
    format: machine === 0x8664 ? "msvc-x64" : "unsupported-architecture",
    status: "skipped",
    recognizedThunks: 0,
    unrecognizedCandidates: 0,
    unrecognizedSlots: descriptors.reduce((n, d) => n + d.symbols.length, 0),
  };
  if (machine !== 0x8664) return summary;
  // Speculative instruction matches may point anywhere: check before reading,
  // and do not mistake an unrelated LEA for a malformed import-table pointer.
  const containing = (rva, size, executable = false) =>
    sections.find(
      (s) =>
        rva > 0 &&
        rva >= s.rva &&
        rva + size <= s.rva + s.size &&
        (!executable || s.executable),
    );
  const byRva = new Map(descriptors.map((d) => [d.rva, d]));
  const tails = new Map(),
    slots = new Set();
  const signature = Buffer.from([0x48, 0x8d, 0x05]); // lea rax,[rip+slot]; jmp tail
  const tailSignature = Buffer.from([0x48, 0x8b, 0xd0, 0x48, 0x8d, 0x0d]);
  const hex = (rva) => `0x${rva.toString(16)}`;
  const tailDescriptor = (rva) => {
    if (tails.has(rva)) return tails.get(rva);
    const section = containing(rva, 1, true);
    const hits = [];
    if (section) {
      const at = section.raw + rva - section.rva;
      const code = buffer.subarray(
        at,
        at + Math.min(128, section.rva + section.size - rva),
      );
      let p = -1;
      while (
        (p = code.indexOf(tailSignature, p + 1)) >= 0 &&
        p + 15 <= code.length
      ) {
        if (code[p + 10] !== 0xe8) continue; // mov rdx,rax; lea rcx,[descriptor]; call helper
        const helper = rva + p + 15 + code.readInt32LE(p + 11);
        if (containing(helper, 1, true))
          hits.push(rva + p + 10 + code.readInt32LE(p + 6));
      }
    }
    // An ambiguous or unknown tail is coverage we cannot claim.
    const descriptorRva = hits.length === 1 ? hits[0] : undefined;
    tails.set(rva, descriptorRva);
    return descriptorRva;
  };
  for (const section of sections.filter((s) => s.executable && s.size)) {
    const code = buffer.subarray(section.raw, section.raw + section.size);
    let p = -1;
    while ((p = code.indexOf(signature, p + 1)) >= 0 && p + 12 <= code.length) {
      if (code[p + 7] !== 0xe9) continue;
      const thunkRva = section.rva + p;
      const slot = thunkRva + 7 + code.readInt32LE(p + 3);
      const storage = containing(slot, 8);
      if (
        !storage ||
        buffer.readBigUInt64LE(storage.raw + slot - storage.rva) !==
          imageBase + BigInt(thunkRva)
      )
        continue;
      const tail = thunkRva + 12 + code.readInt32LE(p + 8);
      const descriptorRva = tailDescriptor(tail);
      if (descriptorRva === undefined) {
        summary.unrecognizedCandidates++;
        continue;
      }
      const descriptor = byRva.get(descriptorRva);
      if (!descriptor)
        fail(
          `MSVC x64 delay thunk ${hex(thunkRva)} targets unadvertised descriptor ${hex(descriptorRva)}`,
        );
      const index = (slot - descriptor.iatRva) / 8;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= descriptor.symbols.length
      )
        fail(
          `orphan MSVC x64 delay thunk ${hex(thunkRva)}: slot ${hex(slot)} is outside ${descriptor.dll} descriptor ${hex(descriptorRva)} advertised IAT [${hex(descriptor.iatRva)}, ${hex(descriptor.iatRva + descriptor.symbols.length * 8)})`,
          descriptor.dll,
        );
      summary.recognizedThunks++;
      slots.add(`${descriptorRva}:${slot}`);
    }
  }
  summary.unrecognizedSlots -= slots.size;
  if (summary.recognizedThunks)
    summary.status =
      summary.unrecognizedSlots || summary.unrecognizedCandidates
        ? "partial"
        : "recognized-patterns-checked";
  return summary;
}
