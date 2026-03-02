/**
 * adopt-form-components.mjs
 *
 * Phase 1: Add PasswordInput to the forms barrel
 * Phase 2: Consolidate all direct `from './PasswordInput'` imports to use barrel
 * Phase 3: For raw <textarea> elements, replace with <Textarea> component
 *          (only where className matches sor-form-textarea or sor-form-textarea-*)
 * Phase 4: Consolidate import paths for overlay barrel (Modal, DialogHeader, etc.)
 * Phase 5: Consolidate sub-directory imports to use barrel index.ts
 */
import fs from 'fs';
import path from 'path';

let totalChanges = 0;
const touchedFiles = new Set();

function readFile(p) { return fs.readFileSync(p, 'utf8'); }
function writeFile(p, c) { fs.writeFileSync(p, c); }

/* ─── Phase 1: Add PasswordInput to forms barrel ─────────────── */
console.log('\n=== Phase 1: PasswordInput barrel export ===');
const barrelPath = 'src/components/ui/forms/index.ts';
let barrel = readFile(barrelPath);
if (!barrel.includes('PasswordInput')) {
  barrel += `\nexport { PasswordInput } from './PasswordInput';\nexport type { PasswordInputProps } from './PasswordInput';\n`;
  writeFile(barrelPath, barrel);
  console.log('Added PasswordInput to forms barrel');
  totalChanges++;
} else {
  console.log('PasswordInput already in barrel');
}

/* ─── Phase 2: Consolidate PasswordInput deep imports ────────── */
console.log('\n=== Phase 2: Consolidate PasswordInput imports ===');
function walk(dir, ext, cb) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, ext, cb);
    else if (f.name.endsWith(ext)) cb(p, f.name);
  }
}

// Consolidate: import PasswordInput from '../../ui/forms/PasswordInput'
// →           import { PasswordInput } from '../../ui/forms';
// Handle any depth (../ui, ../../ui, etc.)
let pwImportCount = 0;
walk('src/components', '.tsx', (filePath) => {
  let raw = readFile(filePath);
  // Match both default and named imports from deep PasswordInput path
  const re = /import\s+(?:{ )?PasswordInput(?: })?\s+from\s+['"]([^'"]*\/ui\/forms\/PasswordInput)['"]\s*;/g;
  if (re.test(raw)) {
    raw = raw.replace(
      /import\s+(?:{ )?PasswordInput(?: })?\s+from\s+['"]([^'"]*)(\/ui\/forms)\/PasswordInput['"]\s*;/g,
      (match, prefix, uiPath) => `import { PasswordInput } from '${prefix}${uiPath}';`
    );
    writeFile(filePath, raw);
    pwImportCount++;
    touchedFiles.add(path.basename(filePath));
  }
});
console.log(`Consolidated ${pwImportCount} PasswordInput imports to barrel path`);
totalChanges += pwImportCount;

/* ─── Phase 3: Replace raw <textarea> with <Textarea> ────────── */
console.log('\n=== Phase 3: Adopt Textarea component ===');
// Find files with <textarea and replace with <Textarea
// We need to add the import and change the element
let textareaCount = 0;
walk('src/components', '.tsx', (filePath) => {
  let raw = readFile(filePath);
  // Skip the Textarea component itself
  if (filePath.includes('ui/forms/Textarea.tsx')) return;
  // Skip files that don't have <textarea
  if (!raw.includes('<textarea')) return;

  // Count raw textarea elements
  const matches = raw.match(/<textarea\b/g);
  if (!matches) return;

  // Replace <textarea with <Textarea and </textarea> with </Textarea>
  let changed = false;

  // For each <textarea className="sor-form-textarea..." ...> replace the tag
  // but also handle textareas without sor- classes by wrapping them
  raw = raw.replace(/<textarea\b/g, () => { changed = true; return '<Textarea'; });
  raw = raw.replace(/<\/textarea>/g, '</Textarea>');
  // Self-closing: <textarea ... /> → <Textarea ... />
  // Already handled by the <textarea → <Textarea replacement

  if (changed) {
    // Determine the variant by checking the className
    // If className includes sor-form-textarea-sm → variant="form-sm"
    // If className includes sor-form-textarea-xs → variant="form-xs"
    // If className includes sor-form-textarea → variant="form" (default, can omit)
    // If no sor- class → add variant="form"

    // Remove sor-form-textarea* from className since Textarea applies it
    raw = raw.replace(/className="sor-form-textarea-sm([^"]*)"/g, 'variant="form-sm" className="$1"');
    raw = raw.replace(/className="sor-form-textarea-xs([^"]*)"/g, 'variant="form-xs" className="$1"');
    raw = raw.replace(/className="sor-form-textarea([^"]*)"/g, (match, rest) => {
      if (rest.trim()) return `className="${rest.trim()}"`;
      return ''; // Remove empty className
    });
    // Clean up empty className=""
    raw = raw.replace(/\s*className=""\s*/g, ' ');
    // Clean up className=" trailing-classes" → className="trailing-classes"
    raw = raw.replace(/className="\s+/g, 'className="');

    // Add Textarea import if not already present
    if (!raw.includes("import") || !raw.match(/import\s+.*Textarea.*from/)) {
      // Find the right import path
      const relDir = path.relative(path.dirname(filePath), 'src/components/ui/forms').replace(/\\/g, '/');
      const importLine = `import { Textarea } from '${relDir}';`;

      // Check if there's already a forms import we can extend
      const formsImportRe = /import\s*{([^}]+)}\s*from\s*['"]([^'"]*\/ui\/forms(?:\/index)?)['"]\s*;/;
      const formsMatch = raw.match(formsImportRe);
      if (formsMatch && !formsMatch[1].includes('Textarea')) {
        raw = raw.replace(formsImportRe, (match, imports, path) => {
          const newImports = imports.trimEnd() + ', Textarea';
          return `import {${newImports}} from '${path}';`;
        });
      } else if (!raw.includes('Textarea') || !raw.match(/from\s+['"][^'"]*\/forms/)) {
        // Add new import after the last import
        const lastImport = raw.lastIndexOf('\nimport ');
        if (lastImport >= 0) {
          const lineEnd = raw.indexOf('\n', lastImport + 1);
          raw = raw.slice(0, lineEnd + 1) + importLine + '\n' + raw.slice(lineEnd + 1);
        }
      }
    }

    writeFile(filePath, raw);
    textareaCount += matches.length;
    touchedFiles.add(path.basename(filePath));
  }
});
console.log(`Replaced ${textareaCount} raw <textarea> elements with <Textarea>`);
totalChanges += textareaCount;

/* ─── Summary ────────────────────────────────────────────────── */
console.log(`\n=== Summary ===`);
console.log(`${totalChanges} total changes across ${touchedFiles.size} files`);
[...touchedFiles].sort().forEach(f => console.log(`  ${f}`));
