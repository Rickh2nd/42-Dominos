// Run: node scripts/fetch_models.mjs
// Downloads:
//  - Human GLB fallback (CesiumMan) -> client/assets/avatars/cowboy.glb (+ seat1-4 copies)
//  - Poly Haven wooden table glTF package -> client/assets/models/table/ (extracted)
//  - Writes client/assets/models/table/manifest.json for runtime loading

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const AVATAR_DIR = path.join(ROOT, "client", "assets", "avatars");
const TABLE_DIR = path.join(ROOT, "client", "assets", "models", "table");
const TMP_DIR = path.join(ROOT, ".tmp_downloads");

const USER_AGENT = "DominoSaloonGame/1.0 (Three.js asset fetch script; local dev)";
const CESIUMMAN_GLB =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb";
const POLYHAVEN_TABLE_ID = "wooden_table_02"; // fallback in script tries painted_wooden_table too

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmrfContents(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function resolveRedirect(baseUrl, nextUrl) {
  try {
    return new URL(nextUrl, baseUrl).toString();
  } catch {
    return nextUrl;
  }
}

function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);

    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = resolveRedirect(url, res.headers.location);
        res.resume();
        file.close(() => {
          try { fs.unlinkSync(dest); } catch {}
          resolve(downloadFile(redirected, dest, headers));
        });
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        file.close(() => {
          try { fs.unlinkSync(dest); } catch {}
          reject(new Error(`Download failed ${res.statusCode} for ${url}`));
        });
        return;
      }

      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });

    req.on("error", (err) => {
      try { file.close(); } catch {}
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    let data = "";
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = resolveRedirect(url, res.headers.location);
        res.resume();
        resolve(fetchJson(redirected, headers));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`JSON fetch failed ${res.statusCode} for ${url}`));
        return;
      }
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
  });
}

function walkObject(node, visit, pathParts = []) {
  if (!node || typeof node !== "object") return;
  visit(node, pathParts);
  if (Array.isArray(node)) {
    node.forEach((child, i) => walkObject(child, visit, [...pathParts, String(i)]));
  } else {
    for (const [k, v] of Object.entries(node)) walkObject(v, visit, [...pathParts, k]);
  }
}

function pickBestGltfFile(filesJson) {
  const candidates = [];
  walkObject(filesJson, (node, pathParts) => {
    if (!node || typeof node !== "object" || typeof node.url !== "string") return;
    const url = node.url;
    const lower = url.toLowerCase();
    const pathStr = pathParts.join("/").toLowerCase();
    const isGltfPack = lower.endsWith(".zip") || lower.endsWith(".gltf") || lower.endsWith(".glb");
    if (!isGltfPack) return;
    let score = 0;
    if (pathStr.includes("gltf")) score += 50;
    if (pathStr.includes("4k")) score += 40;
    else if (pathStr.includes("2k")) score += 30;
    else if (pathStr.includes("1k")) score += 20;
    if (lower.endsWith(".zip")) score += 5; // usually includes dependencies
    if (lower.endsWith(".glb")) score += 3;
    candidates.push({ url, score, pathStr });
  });

  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) throw new Error("Could not find a downloadable glTF/GLB/zip in Poly Haven JSON");
  return candidates[0];
}

function findFilesRecursive(dir, exts, relBase = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findFilesRecursive(full, exts, relBase));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (exts.includes(ext)) out.push(path.relative(relBase, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

function chooseTableEntry(extractedDir) {
  const files = findFilesRecursive(extractedDir, [".glb", ".gltf"]);
  if (!files.length) throw new Error(`No .gltf/.glb found in ${extractedDir}`);
  const scored = files.map((f) => {
    const lower = f.toLowerCase();
    let score = 0;
    if (lower.endsWith(".glb")) score += 5;
    if (lower.includes("scene")) score += 4;
    if (lower.includes("table")) score += 4;
    if (lower.includes("lod")) score -= 2;
    if (lower.includes("preview")) score -= 5;
    return { f, score };
  });
  scored.sort((a, b) => b.score - a.score || a.f.length - b.f.length);
  return scored[0].f;
}

async function fetchPolyHavenTable(id) {
  const filesUrl = `https://api.polyhaven.com/files/${id}`;
  const filesJson = await fetchJson(filesUrl, { "User-Agent": USER_AGENT });
  const node = pickBestGltfFile(filesJson);
  return node;
}

async function main() {
  ensureDir(AVATAR_DIR);
  ensureDir(TABLE_DIR);
  ensureDir(TMP_DIR);

  console.log("1) Downloading CesiumMan human GLB fallback...");
  const cowboyPath = path.join(AVATAR_DIR, "cowboy.glb");
  await downloadFile(CESIUMMAN_GLB, cowboyPath, { "User-Agent": USER_AGENT });
  console.log("   Saved:", cowboyPath);

  for (let i = 1; i <= 4; i += 1) {
    fs.copyFileSync(cowboyPath, path.join(AVATAR_DIR, `seat${i}.glb`));
  }
  console.log("   Copied to seat1.glb ... seat4.glb");

  console.log("2) Fetching Poly Haven table package URL...");
  let tableNode;
  let tableIdUsed = POLYHAVEN_TABLE_ID;
  try {
    tableNode = await fetchPolyHavenTable(tableIdUsed);
  } catch (err) {
    console.warn(`   Failed for ${tableIdUsed}: ${err.message}`);
    tableIdUsed = "painted_wooden_table";
    tableNode = await fetchPolyHavenTable(tableIdUsed);
  }
  console.log(`   Using Poly Haven asset: ${tableIdUsed}`);
  console.log("   Download URL:", tableNode.url);

  const lowerUrl = tableNode.url.toLowerCase();
  const isZip = lowerUrl.endsWith(".zip") || lowerUrl.includes(".zip?");
  const tmpPath = path.join(TMP_DIR, isZip ? "table_asset.zip" : path.basename(new URL(tableNode.url).pathname) || "table_asset.gltf");
  await downloadFile(tableNode.url, tmpPath, { "User-Agent": USER_AGENT });
  console.log("   Downloaded:", tmpPath);

  rmrfContents(TABLE_DIR);
  ensureDir(TABLE_DIR);

  if (isZip) {
    console.log("3) Extracting table zip...");
    execSync(`unzip -o \"${tmpPath}\" -d \"${TABLE_DIR}\"`, { stdio: "inherit" });
  } else {
    fs.copyFileSync(tmpPath, path.join(TABLE_DIR, path.basename(tmpPath)));
  }

  const entry = chooseTableEntry(TABLE_DIR);
  const manifest = {
    id: tableIdUsed,
    entry,
    downloadedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(TABLE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("4) Wrote manifest:", path.join(TABLE_DIR, "manifest.json"));
  console.log("   Table runtime entry:", `/assets/models/table/${entry}`);

  console.log("\nDONE");
  console.log("Run the game, then open console and verify:");
  console.log(" - 'Loaded table model' log");
  console.log(" - 'Loaded GLB avatars' log (or fallback message)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
