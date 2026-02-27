// Run: node scripts/fetch_humanoid.mjs
// Downloads a known-good humanoid GLB and stores it at:
//   client/assets/avatars/_humanoid_default.glb
// Then prints triangle count + bbox height (meters) as verification.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const ROOT = process.cwd();
const DEST = path.join(ROOT, 'client', 'assets', 'avatars', '_humanoid_default.glb');
const USER_AGENT = 'DominoSaloonGame/1.0 (humanoid fetch; local dev)';
const HUMANOID_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function resolveRedirect(baseUrl, nextUrl) {
  try { return new URL(nextUrl, baseUrl).toString(); } catch { return nextUrl; }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const out = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirected = resolveRedirect(url, res.headers.location);
        res.resume();
        out.close(() => {
          try { fs.unlinkSync(dest); } catch {}
          resolve(downloadFile(redirected, dest));
        });
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        out.close(() => {
          try { fs.unlinkSync(dest); } catch {}
          reject(new Error(`Download failed ${res.statusCode} for ${url}`));
        });
        return;
      }
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
    });
    req.on('error', (err) => {
      try { out.close(); } catch {}
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function parseGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file'); // glTF
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
  const totalLength = buf.readUInt32LE(8);
  if (totalLength !== buf.length) throw new Error('GLB length mismatch');

  let offset = 12;
  let json = null;
  let binChunk = null;
  while (offset < buf.length) {
    const chunkLength = buf.readUInt32LE(offset); offset += 4;
    const chunkType = buf.readUInt32LE(offset); offset += 4;
    const chunkData = buf.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    if (chunkType === 0x4E4F534A) json = JSON.parse(chunkData.toString('utf8'));
    if (chunkType === 0x004E4942) binChunk = chunkData;
  }
  if (!json) throw new Error('GLB missing JSON chunk');
  return { json, binChunk };
}

function numComponents(type) {
  return ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 })[type] || 1;
}

function componentByteSize(componentType) {
  return ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 })[componentType] || 0;
}

function readAccessorVec3MinMax(glb, accessorIndex) {
  const { json, binChunk } = glb;
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) return null;
  if (accessor.type !== 'VEC3') return null;
  if (Array.isArray(accessor.min) && Array.isArray(accessor.max)) return { min: accessor.min, max: accessor.max };
  if (!binChunk) return null;
  if (accessor.componentType !== 5126) return null; // float only
  const bv = json.bufferViews?.[accessor.bufferView];
  if (!bv) return null;
  const compSize = componentByteSize(accessor.componentType);
  const comps = numComponents(accessor.type);
  const stride = bv.byteStride || compSize * comps;
  const base = (bv.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count || 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i += 1) {
    const o = base + i * stride;
    const x = binChunk.readFloatLE(o);
    const y = binChunk.readFloatLE(o + 4);
    const z = binChunk.readFloatLE(o + 8);
    if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
  }
  if (!Number.isFinite(min[0])) return null;
  return { min, max };
}

function analyzeHumanoidGLB(filePath) {
  const glb = parseGLB(filePath);
  const { json } = glb;
  let triangles = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode ?? 4; // TRIANGLES
      if (mode !== 4) continue;
      if (prim.indices != null) {
        const ia = json.accessors?.[prim.indices];
        if (ia?.count) triangles += Math.floor(ia.count / 3);
      } else if (prim.attributes?.POSITION != null) {
        const pa = json.accessors?.[prim.attributes.POSITION];
        if (pa?.count) triangles += Math.floor(pa.count / 3);
      }

      if (prim.attributes?.POSITION != null) {
        const mm = readAccessorVec3MinMax(glb, prim.attributes.POSITION);
        if (mm) {
          minY = Math.min(minY, mm.min[1]);
          maxY = Math.max(maxY, mm.max[1]);
        }
      }
    }
  }

  const height = Number.isFinite(minY) && Number.isFinite(maxY) ? (maxY - minY) : null;
  return { triangles, heightMeters: height };
}

async function main() {
  console.log('Downloading humanoid GLB fallback...');
  await downloadFile(HUMANOID_URL, DEST);
  console.log('Saved:', DEST);

  const stats = analyzeHumanoidGLB(DEST);
  console.log('Verification:');
  console.log(' - triangleCount:', stats.triangles);
  console.log(' - heightMeters:', stats.heightMeters != null ? Number(stats.heightMeters.toFixed(3)) : 'unknown');

  if (stats.triangles < 8000 || (stats.heightMeters != null && (stats.heightMeters < 0.9 || stats.heightMeters > 2.4))) {
    console.warn('WARNING: downloaded humanoid does not meet quality gate thresholds');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
