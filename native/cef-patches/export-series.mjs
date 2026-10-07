// Mechanical export from isolated git-index baselines. No commits needed.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const lane = fileURLToPath(new URL('.', import.meta.url));
const scratch = resolve(process.argv[2] ?? '');
const artifacts = resolve(lane, '../../.artifacts');
if (!scratch.startsWith(artifacts + sep)) throw new Error('Expected isolated .artifacts scratch');
const series = resolve(lane, '154.0.8037.58-682c378');
mkdirSync(series, { recursive: true });
const entries = [];
const bases = [];
for (const [local, engine] of [
  ['cef_sorng_tls_bridge.h', 'cef/include/cef_sorng_tls_bridge.h'],
  ['sorng_tls_policy.h', 'chromium/net/socket/sorng_tls_policy.h'],
]) {
  const canonical = readFileSync(resolve(lane, local), 'utf8').replaceAll('\r\n', '\n');
  const patched = readFileSync(resolve(scratch, engine), 'utf8').replaceAll('\r\n', '\n');
  if (canonical !== patched) throw new Error(`Canonical and engine header differ: ${local}`);
}
for (const [project, filename] of [
  ['chromium', '0001-chromium-socket-admission.patch'],
  ['cef', '0002-cef-native-bridge.patch'],
]) {
  const cwd = resolve(scratch, project);
  const patch = execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-ext-diff', '--no-color', '--full-index', '--binary'], { cwd });
  if (!patch.length) throw new Error(`No ${project} delta`);
  writeFileSync(resolve(series, filename), patch);
  entries.push(`${project} ${filename}`);
  // Only modified pre-existing files have a baseline blob; added CEF files
  // are already fully represented by the patch. Pin SHA-256 of upstream bytes.
  const paths = execFileSync('git', ['diff', '--name-only', '--diff-filter=M'], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const path of paths) {
    const bytes = execFileSync('git', ['show', `:${path}`], { cwd });
    bases.push({ project, path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
writeFileSync(resolve(series, 'series'), entries.join('\n') + '\n');
writeFileSync(resolve(series, 'upstream-sha256.json'), JSON.stringify(bases, null, 2) + '\n');
console.log(relative(process.cwd(), series));
