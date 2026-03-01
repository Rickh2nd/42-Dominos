import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const INPUT_ZIP = '/Users/rickhale/Downloads/drive-download-20260301T010607Z-1-001.zip';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(ROOT, 'client', 'assets', 'avatars', 'models');
const CATALOG_PATH = path.join(ROOT, 'client', 'assets', 'avatars', 'avatars.json');

function toTitleCase(raw) {
  return raw
    .replace(/^\.+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function pruneMetadata(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX') {
        await fs.rm(full, { recursive: true, force: true });
        continue;
      }
      await pruneMetadata(full);
      continue;
    }

    if (entry.name.startsWith('._')) {
      await fs.rm(full, { force: true });
    }
  }
}

function normalizePosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function ensureUniqueId(baseId, used) {
  if (!used.has(baseId)) {
    used.add(baseId);
    return baseId;
  }
  let i = 2;
  while (used.has(`${baseId}-${i}`)) i += 1;
  const id = `${baseId}-${i}`;
  used.add(id);
  return id;
}

async function main() {
  await fs.access(INPUT_ZIP);

  await fs.rm(MODELS_DIR, { recursive: true, force: true });
  await fs.mkdir(MODELS_DIR, { recursive: true });

  const zip = new AdmZip(INPUT_ZIP);
  zip.extractAllTo(MODELS_DIR, true);
  await pruneMetadata(MODELS_DIR);

  const files = await walk(MODELS_DIR);
  const modelFiles = files.filter((file) => {
    const rel = normalizePosix(path.relative(MODELS_DIR, file));
    const base = path.basename(rel);
    if (rel.includes('/__MACOSX/') || rel.startsWith('__MACOSX/') || base.startsWith('._')) {
      return false;
    }
    const lower = file.toLowerCase();
    return lower.endsWith('.glb') || lower.endsWith('.gltf');
  });

  const preferred = new Map();
  for (const model of modelFiles) {
    const rel = normalizePosix(path.relative(MODELS_DIR, model));
    const ext = path.extname(rel).toLowerCase();
    const base = rel.slice(0, -ext.length);
    const existing = preferred.get(base);
    if (!existing) {
      preferred.set(base, rel);
      continue;
    }
    if (path.extname(existing).toLowerCase() === '.gltf' && ext === '.glb') {
      preferred.set(base, rel);
    }
  }

  const usedIds = new Set();
  const avatars = [...preferred.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((relPath) => {
      const fileName = path.basename(relPath, path.extname(relPath));
      const safeBase = fileName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'avatar';
      const id = ensureUniqueId(safeBase, usedIds);
      return {
        id,
        label: toTitleCase(fileName),
        url: `/assets/avatars/models/${normalizePosix(relPath)}`
      };
    });

  await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
  await fs.writeFile(CATALOG_PATH, `${JSON.stringify(avatars, null, 2)}\n`, 'utf8');

  console.log(`Extracted ${avatars.length} avatar models.`);
  console.log(`Catalog written to ${CATALOG_PATH}`);
}

main().catch((error) => {
  console.error('Avatar extraction failed:', error.message);
  process.exitCode = 1;
});
