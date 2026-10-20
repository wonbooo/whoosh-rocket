import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.5.2';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'src-tauri', 'resources', 'freelm');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const nodeDest = path.join(dest, nodeName);
const pkgPath = path.join(dest, 'node_modules', 'freelm', 'package.json');

async function ready() {
  try {
    await access(nodeDest);
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    return pkg.version === VERSION;
  } catch {
    return false;
  }
}

if (await ready()) {
  process.exit(0);
}

const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 20) {
  console.error(`准备 FreeLM 运行时需要 Node 20 或更高版本，当前是 ${process.version}`);
  process.exit(1);
}

await mkdir(dest, { recursive: true });
await cp(process.execPath, nodeDest);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npm,
  [
    'install',
    `freelm@${VERSION}`,
    '--omit=dev',
    '--no-fund',
    '--no-audit',
    '--prefix',
    dest,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
