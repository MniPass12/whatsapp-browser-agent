import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_EXTENSIONS_DIR = '/tmp/chrome-extensions';

const CHROME_VERSION = '133.0.0.0';

const EXTENSION_SPECS = [
  {
    key: 'ubol',
    name: 'uBlock Origin Lite',
    crxId: 'ddkjiahejlhfcafbddmgiahcphecmpfh',
    githubReleaseRepo: 'uBlockOrigin/uBOL-home',
    githubAssetPattern: /chromium.*\.zip$/i,
  },
  {
    key: 'vimium',
    name: 'Vimium',
    crxId: 'dbepggeogbaibhgnhhndojpepiihcmeb',
  },
];

function extractZip(zipPath, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', outDir], { stdio: 'pipe' });
  } catch {
    execFileSync('python3', ['-m', 'zipfile', '-e', zipPath, outDir], { stdio: 'pipe' });
  }
}

function stripCrxHeaderToZip(buf) {
  if (buf.length < 16) {
    throw new Error('CRX payload too small');
  }
  const magic = buf.subarray(0, 4).toString('utf8');
  if (magic === 'PK\x03\x04') {
    return buf;
  }
  if (magic === 'Cr24') {
    const version = buf.readUInt32LE(4);
    if (version === 3) {
      const headerSize = buf.readUInt32LE(8);
      return buf.subarray(12 + headerSize);
    }
    if (version === 2) {
      const pubKeyLen = buf.readUInt32LE(8);
      const sigLen = buf.readUInt32LE(12);
      return buf.subarray(16 + pubKeyLen + sigLen);
    }
  }
  const pkIdx = buf.indexOf(Buffer.from('PK\x03\x04'));
  if (pkIdx >= 0) {
    return buf.subarray(pkIdx);
  }
  throw new Error(`Unrecognized CRX/ZIP header (${magic})`);
}

async function downloadFromGitHubRelease(repo, assetPattern, destZip) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'whatsapp-browser-runner' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`GitHub releases HTTP ${res.status}`);
  }
  const data = await res.json();
  const asset = (data.assets || []).find((a) => assetPattern.test(a.name || ''));
  if (!asset?.browser_download_url) {
    throw new Error(`No matching release asset in ${repo}`);
  }
  const dlRes = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'whatsapp-browser-runner' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!dlRes.ok) {
    throw new Error(`Asset download HTTP ${dlRes.status}`);
  }
  const buf = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(destZip, buf);
}

async function downloadCrxAsZip(crxId, destZip) {
  const url =
    `https://clients2.google.com/service/update2/crx?response=redirect` +
    `&os=linux&arch=x64&os_arch=x64&nacl_arch=x86-64` +
    `&prod=chromecrx&prodchannel=stable&prodversion=${CHROME_VERSION}` +
    `&acceptformat=crx2,crx3&x=id%3D${encodeURIComponent(crxId)}%26uc`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`Chrome Web Store CRX HTTP ${res.status}`);
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const zipBuf = stripCrxHeaderToZip(raw);
  fs.writeFileSync(destZip, zipBuf);
}

function validateManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest.json in ${dir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    name: manifest.name || path.basename(dir),
    version: manifest.version || 'unknown',
    mv: manifest.manifest_version || 3,
  };
}

/**
 * Ensures uBlock Origin Lite (adblocker) and Vimium (keyboard browser control)
 * are downloaded, unpacked, and validated for Chromium --load-extension.
 * Never throws fatally if a single extension cannot be fetched.
 */
export async function ensureExtensions(baseDir = DEFAULT_EXTENSIONS_DIR) {
  fs.mkdirSync(baseDir, { recursive: true });
  const loadedDirs = [];

  for (const spec of EXTENSION_SPECS) {
    const extDir = path.join(baseDir, spec.key);
    const zipPath = path.join(baseDir, `${spec.key}.zip`);

    try {
      if (fs.existsSync(path.join(extDir, 'manifest.json'))) {
        const info = validateManifest(extDir);
        console.log(`Extension cached: ${spec.name} v${info.version} (MV${info.mv})`);
        loadedDirs.push(extDir);
        continue;
      }

      let downloaded = false;
      if (spec.githubReleaseRepo && spec.githubAssetPattern) {
        try {
          await downloadFromGitHubRelease(spec.githubReleaseRepo, spec.githubAssetPattern, zipPath);
          downloaded = true;
        } catch (ghErr) {
          console.warn(`${spec.name} GitHub release fallback triggered: ${ghErr.message}`);
        }
      }

      if (!downloaded) {
        await downloadCrxAsZip(spec.crxId, zipPath);
      }

      extractZip(zipPath, extDir);
      fs.rmSync(zipPath, { force: true });

      const info = validateManifest(extDir);
      console.log(`Extension ready: ${spec.name} v${info.version} (MV${info.mv})`);
      loadedDirs.push(extDir);
    } catch (err) {
      fs.rmSync(zipPath, { force: true });
      console.warn(`Failed to setup extension ${spec.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return loadedDirs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureExtensions()
    .then((dirs) => {
      console.log(`Prepared ${dirs.length} Chromium extension(s): ${dirs.join(', ') || 'none'}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Extension setup failed:', err);
      process.exit(0);
    });
}
