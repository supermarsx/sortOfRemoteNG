#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node scripts/ci/validate-updater-feed.mjs <feed.json> [options]

Options:
  --dist-dir <dir>              Require every platform URL basename to exist in this directory.
  --require-platform <name>     Require a platform key. May be repeated.
  --require-signature-files     Require <artifact>.sig files in --dist-dir and match feed signatures.
  --allow-empty-signatures      Permit empty platform signature strings.
  --allow-empty-platforms       Permit an empty platforms object.
  --help                        Show this help text.
`;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedSignature(value) {
  return typeof value === 'string' ? value.replace(/[\r\n]/g, '').trim() : '';
}

function requireNonEmptyString(value, fieldPath, errors) {
  if (typeof value !== 'string') {
    errors.push(`${fieldPath} must be a string.`);
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    errors.push(`${fieldPath} must not be empty.`);
  }
  return trimmed;
}

function validateDate(value, fieldPath, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    return;
  }

  if (Number.isNaN(Date.parse(value))) {
    errors.push(`${fieldPath} must be a parseable date.`);
  }
}

function parsePlatformUrl(value, fieldPath, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      errors.push(`${fieldPath} must use http or https.`);
      return null;
    }
    return parsedUrl;
  } catch {
    errors.push(`${fieldPath} must be a valid URL.`);
    return null;
  }
}

function resolveArtifactPath(distDir, platformUrl, fieldPath, errors) {
  if (!distDir || !platformUrl) {
    return null;
  }

  const artifactName = decodeURIComponent(path.posix.basename(platformUrl.pathname));
  if (!artifactName) {
    errors.push(`${fieldPath} URL must include an artifact filename.`);
    return null;
  }

  const artifactPath = path.join(distDir, artifactName);
  if (!existsSync(artifactPath)) {
    errors.push(`${fieldPath} artifact ${artifactName} is missing from ${distDir}.`);
    return null;
  }

  const artifactStat = statSync(artifactPath);
  if (!artifactStat.isFile() || artifactStat.size === 0) {
    errors.push(`${fieldPath} artifact ${artifactName} must be a non-empty file.`);
    return null;
  }

  return artifactPath;
}

function validateSignatureFile(artifactPath, feedSignature, fieldPath, errors) {
  const signaturePath = `${artifactPath}.sig`;
  if (!existsSync(signaturePath)) {
    errors.push(`${fieldPath} signature file ${path.basename(signaturePath)} is missing.`);
    return;
  }

  const signatureText = normalizedSignature(readFileSync(signaturePath, 'utf8'));
  if (!signatureText) {
    errors.push(`${fieldPath} signature file ${path.basename(signaturePath)} is empty.`);
    return;
  }

  if (feedSignature && signatureText !== feedSignature) {
    errors.push(`${fieldPath} signature does not match ${path.basename(signaturePath)}.`);
  }
}

export function validateUpdaterFeed(feed, options = {}) {
  const errors = [];
  const requiredPlatforms = options.requiredPlatforms ?? [];
  const allowEmptyPlatforms = Boolean(options.allowEmptyPlatforms);
  const allowEmptySignatures = Boolean(options.allowEmptySignatures);
  const requireSignatureFiles = Boolean(options.requireSignatureFiles);
  const distDir = options.distDir ? path.resolve(options.distDir) : null;

  if (!isPlainObject(feed)) {
    return ['Feed root must be a JSON object.'];
  }

  requireNonEmptyString(feed.version, 'version', errors);
  const pubDate = requireNonEmptyString(feed.pub_date, 'pub_date', errors);
  validateDate(pubDate, 'pub_date', errors);
  requireNonEmptyString(feed.notes, 'notes', errors);

  if (!isPlainObject(feed.platforms)) {
    errors.push('platforms must be an object.');
    return errors;
  }

  const platformEntries = Object.entries(feed.platforms);
  if (platformEntries.length === 0 && !allowEmptyPlatforms) {
    errors.push('platforms must include at least one platform entry.');
  }

  for (const requiredPlatform of requiredPlatforms) {
    if (!Object.prototype.hasOwnProperty.call(feed.platforms, requiredPlatform)) {
      errors.push(`platforms.${requiredPlatform} is required.`);
    }
  }

  for (const [platformName, platformEntry] of platformEntries) {
    const platformPath = `platforms.${platformName}`;
    if (!platformName.trim()) {
      errors.push('platform key must not be empty.');
    }
    if (!isPlainObject(platformEntry)) {
      errors.push(`${platformPath} must be an object.`);
      continue;
    }

    const platformUrlValue = requireNonEmptyString(platformEntry.url, `${platformPath}.url`, errors);
    const platformUrl = parsePlatformUrl(platformUrlValue, `${platformPath}.url`, errors);

    if (typeof platformEntry.signature !== 'string') {
      errors.push(`${platformPath}.signature must be a string.`);
    }
    const feedSignature = normalizedSignature(platformEntry.signature);
    if (!feedSignature && !allowEmptySignatures) {
      errors.push(`${platformPath}.signature must not be empty.`);
    }

    for (const optionalField of ['version', 'pub_date', 'notes']) {
      if (Object.prototype.hasOwnProperty.call(platformEntry, optionalField)) {
        const optionalValue = requireNonEmptyString(
          platformEntry[optionalField],
          `${platformPath}.${optionalField}`,
          errors,
        );
        if (optionalField === 'pub_date') {
          validateDate(optionalValue, `${platformPath}.${optionalField}`, errors);
        }
      }
    }

    const artifactPath = resolveArtifactPath(distDir, platformUrl, `${platformPath}.url`, errors);
    if (artifactPath && requireSignatureFiles) {
      validateSignatureFile(artifactPath, feedSignature, platformPath, errors);
    }
  }

  return errors;
}

export function parseArgs(argv) {
  const options = {
    allowEmptyPlatforms: false,
    allowEmptySignatures: false,
    distDir: null,
    feedPath: null,
    requiredPlatforms: [],
    requireSignatureFiles: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--allow-empty-platforms') {
      options.allowEmptyPlatforms = true;
      continue;
    }

    if (arg === '--allow-empty-signatures') {
      options.allowEmptySignatures = true;
      continue;
    }

    if (arg === '--require-signature-files') {
      options.requireSignatureFiles = true;
      continue;
    }

    if (arg === '--dist-dir' || arg.startsWith('--dist-dir=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++index];
      if (!value) {
        throw new Error('--dist-dir requires a value.');
      }
      options.distDir = value;
      continue;
    }

    if (arg === '--require-platform' || arg.startsWith('--require-platform=')) {
      const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++index];
      if (!value) {
        throw new Error('--require-platform requires a value.');
      }
      options.requiredPlatforms.push(value);
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.feedPath) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    options.feedPath = arg;
  }

  return options;
}

function readFeed(feedPath) {
  if (!feedPath) {
    throw new Error('A feed JSON path is required.');
  }

  const feedText = readFileSync(feedPath, 'utf8');
  return JSON.parse(feedText);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(USAGE);
    process.exit(2);
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  let feed;
  try {
    feed = readFeed(options.feedPath);
  } catch (error) {
    console.error(`Failed to read updater feed: ${error.message}`);
    process.exit(1);
  }

  const errors = validateUpdaterFeed(feed, options);
  if (errors.length > 0) {
    console.error(`Invalid updater feed ${options.feedPath}:`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const platformCount = Object.keys(feed.platforms ?? {}).length;
  console.log(`Validated updater feed ${options.feedPath} (${platformCount} platform entries).`);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  main();
}