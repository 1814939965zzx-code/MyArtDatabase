// Shared by deploy/setup. Never run npm ci against the live node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const log = (message) => console.log(`[deploy] ${message}`);
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => JSON.parse(read(file));
const hash = (...values) => createHash('sha256').update(values.join('')).digest('hex');
const canonical = (value) => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
const installFields = (pkg) => Object.fromEntries(
  ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
    'peerDependenciesMeta', 'overrides', 'engines', 'os', 'cpu', 'libc', 'workspaces']
    .map((key) => [key, pkg[key]]).filter(([, value]) => value !== undefined)
);
const lifecycle = (pkg) => Object.fromEntries(
  ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare']
    .filter((key) => pkg.scripts?.[key]).map((key) => [key, pkg.scripts[key]])
);

export function fingerprint(app) {
  const pkg = json(path.join(app, 'package.json'));
  // Application commands such as test/build do not change the installed tree.
  return 'v2:' + hash(canonical(installFields(pkg)), canonical(lifecycle(pkg)),
    read(path.join(app, 'package-lock.json')), process.version, process.platform, process.arch,
    fs.existsSync(path.join(app, '.npmrc')) ? read(path.join(app, '.npmrc')) : '');
}

function run(command, args, cwd, { quiet = false, env = process.env, timeout = 60_000 } = {}) {
  const result = spawnSync(command, args, { cwd, env, timeout, killSignal: 'SIGKILL',
    // npm lifecycle children share this process group; kill the whole group on timeout below.
    detached: process.platform !== 'win32', stdio: quiet ? 'pipe' : 'inherit' });
  if (result.error || result.signal) {
    if (result.pid && process.platform !== 'win32') {
      try { process.kill(-result.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
  }
  return !result.error && result.status === 0;
}

function usable(app) {
  return run('npm', ['ls', '--depth=0', '--include=dev'], app, { quiet: true }) &&
    run(process.execPath, ['-e', `
      require('sharp');
      const {execFileSync} = require('node:child_process');
      execFileSync(require('ffmpeg-static'), ['-version'], {timeout: 10000, stdio: 'ignore'});
    `], app, { quiet: true, env: { ...process.env, FFMPEG_BIN: '' } });
}

function legacyMatches(app, repo, saved) {
  // Recognize the old successful install even when only package.json commands changed.
  // The old digest includes the exact lock bytes and Node version, so a different lock
  // or runtime cannot accidentally be adopted merely because npm ls passes.
  if (!/^[a-f0-9]{64}$/.test(saved)) return false;
  if (fs.existsSync(path.join(app, '.npmrc'))) return false;
  const lock = read(path.join(app, 'package-lock.json'));
  const manifest = (pkg) => canonical([installFields(pkg), lifecycle(pkg)]);
  const current = manifest(json(path.join(app, 'package.json')));
  const relative = path.relative(repo, path.join(app, 'package.json')).split(path.sep).join('/');
  const history = spawnSync('git', ['log', '-n', '30', '--format=%H', '--', relative],
    { cwd: repo, encoding: 'utf8' });
  const candidates = [read(path.join(app, 'package.json'))];
  for (const rev of (history.stdout || '').trim().split('\n').filter(Boolean)) {
    const result = spawnSync('git', ['show', `${rev}:${relative}`], { cwd: repo, encoding: 'utf8' });
    if (result.status === 0) candidates.push(result.stdout);
  }
  return candidates.some((raw) => manifest(JSON.parse(raw)) === current &&
    hash(raw, lock, process.versions.node) === saved);
}

export function installDeps(app) {
  app = path.resolve(app);
  const repo = path.dirname(app);
  const temp = path.join(repo, 'tmp');
  fs.mkdirSync(temp, { recursive: true });
  const state = path.join(temp, 'installed-deps.sha256');
  const desired = fingerprint(app);
  const saved = fs.existsSync(state) ? read(state).trim() : '';
  const saveState = () => {
    fs.writeFileSync(`${state}.new`, desired + '\n');
    fs.renameSync(`${state}.new`, state);
  };
  if ((saved === desired || legacyMatches(app, repo, saved)) && usable(app)) {
    saveState();
    log('依赖未变化且 node_modules 完整，跳过 npm ci');
    return;
  }

  const lock = json(path.join(app, 'package-lock.json'));
  const ffmpegVersion = lock.packages['node_modules/ffmpeg-static'].version;
  const cache = path.join(temp, 'ffmpeg-cache', `${ffmpegVersion}-${process.platform}-${process.arch}`);
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const validBinary = (file) => fs.existsSync(file) && run(file, ['-version'], app, { quiet: true, timeout: 10_000 });
  const existingPackage = path.join(app, 'node_modules/ffmpeg-static');
  if (!validBinary(cache) && fs.existsSync(path.join(existingPackage, 'package.json')) &&
      json(path.join(existingPackage, 'package.json')).version === ffmpegVersion &&
      validBinary(path.join(existingPackage, binaryName))) {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.copyFileSync(path.join(existingPackage, binaryName), cache);
    fs.chmodSync(cache, 0o755);
  }
  const reuse = validBinary(cache);
  log('依赖需要安装：在临时目录执行 npm ci，现有依赖保留');
  if (reuse) log('复用已验证的 ffmpeg 缓存，跳过二进制下载');
  const stage = fs.mkdtempSync(path.join(temp, 'deps-install-'));
  const live = path.join(app, 'node_modules');
  const previous = path.join(stage, 'previous-node_modules');
  try {
    for (const file of ['package.json', 'package-lock.json', '.npmrc']) {
      if (fs.existsSync(path.join(app, file))) fs.copyFileSync(path.join(app, file), path.join(stage, file));
    }
    const env = { ...process.env, FFMPEG_BIN: reuse ? cache : '', NODE_ENV: 'development' };
    if (!run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund', '--foreground-scripts'], stage, { env, timeout: 0 })) {
      throw new Error('npm ci 失败；原 node_modules 与依赖记录未替换，服务未重启');
    }
    const stagedBinary = path.join(stage, 'node_modules/ffmpeg-static', binaryName);
    if (reuse) fs.copyFileSync(cache, stagedBinary);
    if (!usable(stage)) throw new Error('新依赖检查失败；原 node_modules 与依赖记录未替换');
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.copyFileSync(stagedBinary, cache);
    fs.chmodSync(cache, 0o755);
    const hadLive = fs.existsSync(live);
    if (hadLive) fs.renameSync(live, previous);
    try {
      fs.renameSync(path.join(stage, 'node_modules'), live);
      saveState();
    } catch (error) {
      fs.rmSync(live, { recursive: true, force: true });
      if (hadLive) fs.renameSync(previous, live);
      throw error;
    }
    log('新依赖检查通过，已替换 node_modules');
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { installDeps(process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app')); }
  catch (error) { console.error(`[deploy] 错误：${error.message}`); process.exitCode = 1; }
}
