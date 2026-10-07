import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBrowserSandboxAccess } from "../../scripts/lib/browser-sandbox-access.mjs";

const exec = promisify(execFile);
const windows = {
  skip: process.platform !== "win32" ? "Windows ACL fixture" : false,
  timeout: 120_000,
};
const appName = "Fixture Browser";
const packageSids = ["S-1-15-2-1", "S-1-15-2-2"];
const readExecute = 0x200a9;
const synchronize = 0x100000;
const repairScript = fileURLToPath(
  new URL(
    "../../scripts/native/repair-browser-sandbox-access.ps1",
    import.meta.url,
  ),
);
const powershell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);

// The test utility accepts JSON, not interpolated command/path text. ACL writes
// additionally require an existing, regular, test-owned path. Never reset or
// grant permissions on os.tmpdir(), its ancestors, or the live browser bundle.
const aclUtility = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$inputData = $env:SORNG_SANDBOX_ACL_TEST_INPUT | ConvertFrom-Json
if ($inputData.operation -eq 'parse') {
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($inputData.script, [ref]$tokens, [ref]$errors)
    @{
        errors = @($errors | ForEach-Object { $_.Message })
        parameters = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
        strings = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.StringConstantExpressionAst] }, $true) | ForEach-Object { $_.Value })
    } | ConvertTo-Json -Depth 8 -Compress
    exit
}
$testRoot = Get-Item -LiteralPath $inputData.root -Force
if (-not $testRoot.PSIsContainer -or $testRoot.Name -notlike 'sorng-sandbox-access-*' -or ($testRoot.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'ACL test root is not a private fixture directory'
}
function Get-OwnedEntry([string]$candidate, [bool]$writing) {
    $full = [IO.Path]::GetFullPath($candidate)
    if ($full -ne $testRoot.FullName -and -not $full.StartsWith($testRoot.FullName + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'ACL test path escapes its private fixture directory'
    }
    $entry = Get-Item -LiteralPath $full -Force
    if ($writing) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $entry.LinkType -eq 'HardLink') {
            throw 'ACL test setup cannot write through a link'
        }
        $ancestor = if ($entry.PSIsContainer) { $entry } else { $entry.Directory }
        for (; $null -ne $ancestor; $ancestor = $ancestor.Parent) {
            if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ACL test setup has a redirected ancestor' }
            if ($ancestor.FullName -eq $testRoot.FullName) { break }
        }
    }
    return $entry
}
function Get-OwnedDacl($entry) {
    $section = [Security.AccessControl.AccessControlSections]::Access
    if ($entry.PSIsContainer) { return [IO.Directory]::GetAccessControl($entry.FullName, $section) }
    return [IO.File]::GetAccessControl($entry.FullName, $section)
}
function Set-OwnedDacl($entry, $acl) {
    if ($entry.PSIsContainer) { [IO.Directory]::SetAccessControl($entry.FullName, $acl) }
    else { [IO.File]::SetAccessControl($entry.FullName, $acl) }
}
if ($inputData.operation -eq 'prepare') {
    foreach ($candidate in $inputData.paths) {
        $entry = Get-OwnedEntry $candidate $true
        $acl = Get-OwnedDacl $entry
        # Convert inherited rules on this fixture entry only; preserve unrelated
        # identities, then remove just the package SIDs to make missing RX real.
        $acl.SetAccessRuleProtection($true, $true)
        foreach ($sidText in @('S-1-15-2-1', 'S-1-15-2-2')) {
            $acl.PurgeAccessRules([Security.Principal.SecurityIdentifier]::new($sidText))
        }
        Set-OwnedDacl $entry $acl
    }
} elseif ($inputData.operation -eq 'deny') {
    $entry = Get-OwnedEntry $inputData.path $true
    $acl = Get-OwnedDacl $entry
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($inputData.sid),
        [Security.AccessControl.FileSystemRights]::ReadData,
        [Security.AccessControl.InheritanceFlags]::None,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Deny))
    Set-OwnedDacl $entry $acl
} elseif ($inputData.operation -ne 'snapshot') {
    throw 'Unknown ACL test operation'
}
$snapshots = @()
foreach ($candidate in $inputData.paths) {
    $entry = Get-OwnedEntry $candidate $false
    $acl = Get-Acl -LiteralPath $entry.FullName
    $snapshots += @{
        path = $entry.FullName
        sddl = $acl.Sddl
        owner = $acl.Owner
        protected = $acl.AreAccessRulesProtected
        rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
            @{
                sid = $_.IdentityReference.Value
                rights = [int]$_.FileSystemRights
                type = [int]$_.AccessControlType
                inherited = $_.IsInherited
                inheritance = [int]$_.InheritanceFlags
                propagation = [int]$_.PropagationFlags
            }
        })
    }
}
ConvertTo-Json -InputObject $snapshots -Depth 8 -Compress
`;

async function acl(input) {
  const program = `$ProgressPreference = 'SilentlyContinue'\ntry {\n${aclUtility}\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const { stdout } = await exec(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(program, "utf16le").toString("base64"),
    ],
    {
      env: {
        ...process.env,
        SORNG_SANDBOX_ACL_TEST_INPUT: JSON.stringify(input),
      },
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  ).catch((error) => {
    // Never dump the encoded utility or the fixture's security descriptors.
    throw new Error(
      `ACL fixture ${input.operation} failed: ${error.stderr?.trim() || error.code}`,
    );
  });
  return JSON.parse(stdout.trim());
}

async function fixture(t) {
  const temp = await realpath(os.tmpdir());
  const root = await realpath(
    await mkdtemp(path.join(temp, "sorng-sandbox-access-")),
  );
  t.after(async () => {
    const relative = path.relative(temp, root);
    assert.ok(!path.isAbsolute(relative) && !relative.startsWith(".."));
    assert.match(path.basename(root), /^sorng-sandbox-access-/);
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  });
  // Freeze inherited temp-folder ACEs only on this owned root. Otherwise
  // unrelated host ACL propagation can reorder snapshots during the test.
  await acl({ operation: "prepare", root, paths: [root] });
  const bundle = path.join(root, "install", "bundle");
  const locales = path.join(bundle, "locales");
  const profile = path.join(bundle, "profile");
  const nested = path.join(locales, "private");
  const sibling = path.join(root, "unrelated-profile");
  for (const directory of [locales, profile, nested, sibling])
    await mkdir(directory, { recursive: true });
  const approvedFiles = [
    `${appName}.exe`,
    `${appName}.dll`,
    "libcef.dll",
    "icudtl.dat",
    "resources.pak",
    "locales/en-US.pak",
    "locales/zh_CN.pak",
  ].map((name) => path.join(bundle, name));
  const unrelatedFiles = [
    path.join(bundle, "unrelated.dll"),
    path.join(profile, "Cookies"),
    path.join(locales, "unlisted.json"),
    path.join(nested, "en-US.pak"),
    path.join(sibling, "private.db"),
  ];
  // ACL fixtures only: deliberately not PE files and NEVER loaded or executed.
  for (const file of [...approvedFiles, ...unrelatedFiles])
    await writeFile(
      file,
      `Not executable. Private ACL fixture: ${path.basename(file)}\n`,
    );
  const approved = [bundle, ...approvedFiles, locales];
  const untouched = [
    root,
    path.dirname(bundle),
    profile,
    nested,
    sibling,
    ...unrelatedFiles,
  ];
  await acl({ operation: "prepare", root, paths: approved });
  return {
    root,
    bundle,
    locales,
    approved,
    untouched,
    required: approvedFiles.slice(0, 3),
    snapshot: (paths = [...approved, ...untouched]) =>
      acl({ operation: "snapshot", root, paths }),
    repair: (options = {}) =>
      ensureBrowserSandboxAccess({ bundle, appName, ...options }),
  };
}

const packageRules = (snapshot) =>
  snapshot.rules.filter((rule) => packageSids.includes(rule.sid));
const otherRules = (snapshot) =>
  snapshot.rules.filter((rule) => !packageSids.includes(rule.sid));

function normalizeAllowOrder(snapshot) {
  const descriptor = snapshot.sddl.match(/^(.*?D:[^(]*)(.*)$/s);
  const aces = descriptor?.[2].match(/\([^()]*\)/g);
  // Rewriting a parent's DACL can canonicalize inherited allow ACE order on
  // descendants without changing access. Only normalize this proven-equivalent
  // case: keep deny/mixed/object/callback/SACL descriptors strictly ordered.
  if (
    !aces?.length ||
    aces.join("") !== descriptor[2] ||
    !aces.every((ace) => ace.startsWith("(A;")) ||
    !snapshot.rules.every((rule) => rule.type === 0)
  )
    return snapshot;
  const key = (rule) =>
    JSON.stringify([
      rule.sid,
      rule.rights,
      rule.type,
      rule.inherited,
      rule.inheritance,
      rule.propagation,
    ]);
  return {
    ...snapshot,
    sddl: descriptor[1] + [...aces].sort().join(""),
    rules: [...snapshot.rules].sort((a, b) =>
      key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
    ),
  };
}

function assertSnapshotsUnchanged(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index++)
    assert.ok(
      isDeepStrictEqual(
        normalizeAllowOrder(actual[index]),
        normalizeAllowOrder(expected[index]),
      ),
      `ACL snapshot changed for ${expected[index].path}`,
    );
}

test("ACL comparison ignores only allow ACE order, never rights, flags, identities or deny order", () => {
  const prefix = "O:SYG:SYD:PAI";
  const aces = ["(A;;0x200a9;;;SY)", "(A;;0x200a9;;;BA)"];
  const expected = {
    path: "owned fixture",
    owner: "SYSTEM",
    protected: true,
    sddl: prefix + aces.join(""),
    rules: ["S-1-5-18", "S-1-5-32-544"].map((sid) => ({
      sid,
      rights: readExecute,
      type: 0,
      inherited: false,
      inheritance: 0,
      propagation: 0,
    })),
  };
  const reordered = structuredClone(expected);
  reordered.rules.reverse();
  reordered.sddl = prefix + [...aces].reverse().join("");
  assertSnapshotsUnchanged([reordered], [expected]);
  for (const mutate of [
    (value) => (value.rules[0].rights |= 2),
    (value) => (value.rules[0].sid = "S-1-1-0"),
    (value) => (value.rules[0].type = 1),
    (value) => (value.rules[0].inherited = true),
    (value) => (value.rules[0].inheritance = 3),
    (value) => (value.rules[0].propagation = 2),
    (value) => (value.owner = "different owner"),
    (value) => (value.protected = false),
    (value) => (value.sddl = value.sddl.replace("G:SY", "G:BA")),
    (value) => (value.sddl = value.sddl.replace("D:PAI", "D:AI")),
    (value) => (value.sddl = value.sddl.replace("0x200a9", "FA")),
    (value) => value.rules.pop(),
    (value) => value.rules.push({ ...value.rules[0] }),
  ]) {
    const changed = structuredClone(expected);
    mutate(changed);
    assert.throws(
      () => assertSnapshotsUnchanged([changed], [expected]),
      /ACL snapshot changed/,
    );
  }
  const mixed = structuredClone(expected);
  mixed.rules[0].type = 1;
  mixed.sddl = prefix + aces[0].replace("(A;", "(D;") + aces[1];
  const reorderedDeny = structuredClone(mixed);
  reorderedDeny.rules.reverse();
  reorderedDeny.sddl = prefix + aces[1] + aces[0].replace("(A;", "(D;");
  assert.throws(
    () => assertSnapshotsUnchanged([reorderedDeny], [mixed]),
    /ACL snapshot changed/,
  );
});

test("non-Windows platforms do not inspect paths or claim repaired ACLs", async () => {
  for (const platform of ["linux", "darwin"])
    assert.deepEqual(
      await ensureBrowserSandboxAccess({
        platform,
        bundle: "not-a-bundle",
        appName: "../invalid",
      }),
      { applicable: false, repaired: 0 },
    );
});

test(
  "PowerShell AST parses and ACL fixtures match the named entry contract",
  windows,
  async () => {
    const parsed = await acl({ operation: "parse", script: repairScript });
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.parameters, ["Bundle", "AppName"]);
    for (const literal of [
      ...packageSids,
      "libcef.dll",
      "icudtl.dat",
      "resources.pak",
    ])
      assert.ok(
        parsed.strings.includes(literal),
        `Missing runtime contract literal ${literal}`,
      );
  },
);

test(
  "missing package SIDs gain only explicit RX; repeat is idempotent and profiles do not inherit",
  windows,
  async (t) => {
    const f = await fixture(t);
    const before = await f.snapshot();
    for (const entry of before.slice(0, f.approved.length))
      assert.deepEqual(packageRules(entry), []);
    const contents = await Promise.all(
      f.required.map((file) => readFile(file)),
    );
    const repaired = await f.repair();
    assert.equal(repaired.ok, true);
    assert.equal(repaired.applicable, true);
    assert.equal(repaired.checked, f.approved.length);
    assert.equal(repaired.repaired, f.approved.length);
    const after = await f.snapshot();
    for (let index = 0; index < f.approved.length; index++) {
      const entry = after[index];
      assert.equal(entry.owner, before[index].owner);
      assert.equal(entry.protected, before[index].protected);
      assert.deepEqual(otherRules(entry), otherRules(before[index]));
      assert.equal(packageRules(entry).length, 2);
      for (const rule of packageRules(entry)) {
        assert.equal(rule.type, 0); // Allow
        assert.equal(rule.rights & readExecute, readExecute);
        assert.equal(rule.rights & ~(readExecute | synchronize), 0);
        assert.equal(rule.inherited, false);
        assert.equal(rule.inheritance, 0);
        assert.equal(rule.propagation, 0);
      }
    }
    assertSnapshotsUnchanged(
      after.slice(f.approved.length),
      before.slice(f.approved.length),
    );
    assert.equal((await f.repair()).repaired, 0);
    assertSnapshotsUnchanged(await f.snapshot(), after);
    assert.deepEqual(
      await Promise.all(f.required.map((file) => readFile(file))),
      contents,
    );
    const newPrivate = path.join(f.bundle, "new-private-profile");
    await mkdir(newPrivate);
    const newSecret = path.join(newPrivate, "Cookies");
    await writeFile(newSecret, "private; never granted by the browser repair");
    for (const entry of await f.snapshot([newPrivate, newSecret]))
      assert.deepEqual(packageRules(entry), []);
  },
);

for (const sid of [...packageSids, "S-1-1-0"])
  test(
    `explicit read deny for ${sid} rejects the whole repair before any ACL write`,
    windows,
    async (t) => {
      const f = await fixture(t);
      // Last locale entry ensures earlier pending root/file grants cannot leak.
      await acl({
        operation: "deny",
        root: f.root,
        path: path.join(f.locales, "zh_CN.pak"),
        sid,
        paths: [],
      });
      const before = await f.snapshot();
      await assert.rejects(f.repair(), /deny prevents browser sandbox access/);
      assertSnapshotsUnchanged(await f.snapshot(), before);
    },
  );

test(
  "invalid application names and bundle paths are rejected without ACL changes",
  windows,
  async (t) => {
    const f = await fixture(t);
    const before = await f.snapshot();
    for (const invalid of [
      "",
      "../escape",
      "bad/name",
      "bad\\name",
      "bad:name",
      "trailing.",
      "trailing ",
      "a".repeat(81),
    ])
      await assert.rejects(
        f.repair({ appName: invalid }),
        /portable application name/,
      );
    await assert.rejects(
      f.repair({ bundle: "relative-bundle" }),
      /absolute browser bundle/,
    );
    await assert.rejects(
      f.repair({ bundle: path.parse(f.bundle).root }),
      /filesystem root/,
    );
    await assert.rejects(
      f.repair({ bundle: f.required[0] }),
      /filesystem root/,
    );
    await assert.rejects(
      f.repair({ bundle: path.join(f.root, "missing") }),
      /could not be prepared/,
    );
    assertSnapshotsUnchanged(await f.snapshot(), before);
  },
);

test(
  "missing or directory-valued required runtime entries fail before repair",
  windows,
  async (t) => {
    const f = await fixture(t);
    const required = f.required[1];
    await unlink(required);
    const remaining = [...f.approved, ...f.untouched].filter(
      (entry) => entry !== required,
    );
    const before = await f.snapshot(remaining);
    await assert.rejects(f.repair(), /could not be prepared/);
    assertSnapshotsUnchanged(await f.snapshot(remaining), before);
    await mkdir(required);
    const directoryBefore = await f.snapshot();
    await assert.rejects(f.repair(), /regular file/);
    assertSnapshotsUnchanged(await f.snapshot(), directoryBefore);
  },
);

test(
  "bundle and ancestor junctions cannot redirect ACL repair",
  windows,
  async (t) => {
    const f = await fixture(t);
    const before = await f.snapshot();
    const bundleAlias = path.join(f.root, "bundle-alias");
    const ancestorAlias = path.join(f.root, "ancestor-alias");
    await symlink(f.bundle, bundleAlias, "junction");
    await symlink(path.dirname(f.bundle), ancestorAlias, "junction");
    for (const redirected of [bundleAlias, path.join(ancestorAlias, "bundle")])
      await assert.rejects(f.repair({ bundle: redirected }), /reparse points/);
    assertSnapshotsUnchanged(await f.snapshot(), before);
  },
);

test(
  "locale junctions cannot grant access to unrelated profiles",
  windows,
  async (t) => {
    const f = await fixture(t);
    // Move no directories: the junction uses an otherwise absent allowlist slot.
    const redirectedBundle = path.join(f.root, "redirected-bundle");
    await mkdir(redirectedBundle);
    for (const original of f.required)
      await writeFile(
        path.join(redirectedBundle, path.basename(original)),
        await readFile(original),
      );
    await symlink(
      path.join(f.root, "unrelated-profile"),
      path.join(redirectedBundle, "locales"),
      "junction",
    );
    const checked = [
      redirectedBundle,
      ...f.required.map((file) =>
        path.join(redirectedBundle, path.basename(file)),
      ),
      ...f.untouched,
    ];
    const before = await f.snapshot(checked);
    await assert.rejects(
      f.repair({ bundle: redirectedBundle }),
      /locale directory must not be redirected/,
    );
    assertSnapshotsUnchanged(await f.snapshot(checked), before);
  },
);

test(
  "runtime hard links are rejected without changing their other directory entry",
  windows,
  async (t) => {
    const f = await fixture(t);
    const outside = path.join(
      f.root,
      "unrelated-profile",
      "shared-library.dll",
    );
    await writeFile(outside, "private hard-link target, not a runtime");
    const runtime = f.required[2];
    await unlink(runtime);
    await link(outside, runtime);
    const checked = [...f.approved, ...f.untouched, outside];
    const before = await f.snapshot(checked);
    await assert.rejects(f.repair(), /hard links/);
    assertSnapshotsUnchanged(await f.snapshot(checked), before);
    assert.equal(
      await readFile(outside, "utf8"),
      "private hard-link target, not a runtime",
    );
  },
);

test(
  "runtime file symlinks are rejected without granting their targets",
  windows,
  async (t) => {
    const f = await fixture(t);
    const outside = path.join(
      f.root,
      "unrelated-profile",
      "private-library.dll",
    );
    await writeFile(outside, "private symlink target");
    const runtime = f.required[2];
    await unlink(runtime);
    try {
      await symlink(outside, runtime, "file");
    } catch (error) {
      if (["EPERM", "EACCES"].includes(error.code))
        return t.skip(
          "Windows file symlink privilege unavailable; junction and hard-link cases remain mandatory",
        );
      throw error;
    }
    const checked = [...f.approved, ...f.untouched, outside];
    const before = await f.snapshot(checked);
    await assert.rejects(f.repair(), /symbolic links/);
    assertSnapshotsUnchanged(await f.snapshot(checked), before);
  },
);
