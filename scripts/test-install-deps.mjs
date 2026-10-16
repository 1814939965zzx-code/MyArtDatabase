import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './install-deps.mjs';

const installer = fileURLToPath(new URL('./install-deps.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artdb-deps-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(app); fs.mkdirSync(bin); fs.mkdirSync(path.join(root, 'tmp'));
  const pkg = { name: 'fixture', version: '1.0.0', dependencies: { 'ffmpeg-static': '5.3.0', sharp: '1.0.0' }, scripts: { test: 'old test' } };
  const lock = { lockfileVersion: 3, packages: { '': pkg, 'node_modules/ffmpeg-static': { version: '5.3.0' } } };
  const write = (name, value) => fs.writeFileSync(path.join(app, name), JSON.stringify(value));
  write('package.json', pkg); write('package-lock.json', lock);
  const modules = path.join(app, 'node_modules');
  fs.mkdirSync(path.join(modules, 'sharp'), { recursive: true });
  fs.writeFileSync(path.join(modules, 'sharp/index.js'), 'module.exports = {}');
  fs.mkdirSync(path.join(modules, 'ffmpeg-static'));
  fs.writeFileSync(path.join(modules, 'ffmpeg-static/package.json'), '{"version":"5.3.0"}');
  fs.writeFileSync(path.join(modules, 'ffmpeg-static/index.js'), 'module.exports = process.env.FFMPEG_BIN || __dirname + "/ffmpeg"');
  fs.writeFileSync(path.join(modules, 'ffmpeg-static/ffmpeg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(modules, 'live-marker'), 'original');
  const template = path.join(root, 'template');
  fs.cpSync(modules, template, { recursive: true });
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    if (args[0] === 'ls') process.exit(fs.existsSync('node_modules/broken') ? 1 : 0);
    fs.appendFileSync(process.env.INSTALL_LOG, process.cwd() + '\\n' + process.env.FFMPEG_BIN + '\\n');
    if (process.env.INSTALL_MODE === 'hang') { setTimeout(() => {}, 60000); }
    else if (process.env.INSTALL_MODE === 'fail') process.exit(42);
    else {
      fs.cpSync(process.env.DEPS_TEMPLATE, 'node_modules', {recursive: true});
      fs.rmSync('node_modules/live-marker');
      // Model ffmpeg-static postinstall skipping its package binary when FFMPEG_BIN exists.
      if (process.env.FFMPEG_BIN) fs.rmSync('node_modules/ffmpeg-static/ffmpeg');
    }
  `, { mode: 0o755 });
  const state = path.join(root, 'tmp/installed-deps.sha256');
  const log = path.join(root, 'install.log');
  const run = (mode = '') => spawnSync(process.execPath, [installer, app], {
    encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      INSTALL_MODE: mode, INSTALL_LOG: log, DEPS_TEMPLATE: template, DEPS_INSTALL_TIMEOUT_SECONDS: mode === 'hang' ? '2' : '5' }
  });
  return { root, app, modules, pkg, lock, write, state, log, run };
}

test('commands-only changes skip install; lock, dependency and install-hook changes invalidate fingerprint', (t) => {
  const f = fixture(t);
  const original = fingerprint(f.app);
  fs.writeFileSync(f.state, original);
  f.pkg.scripts.test = 'new test'; f.write('package.json', f.pkg);
  assert.equal(fingerprint(f.app), original);
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(f.log), false);
  f.pkg.dependencies.sharp = '2.0.0'; f.write('package.json', f.pkg);
  assert.notEqual(fingerprint(f.app), original);
  f.pkg.dependencies.sharp = '1.0.0'; f.pkg.scripts.postinstall = 'node setup.js'; f.write('package.json', f.pkg);
  assert.notEqual(fingerprint(f.app), original);
  delete f.pkg.scripts.postinstall; f.write('package.json', f.pkg);
  f.lock.packages['node_modules/sharp'] = { version: '1.0.1' }; f.write('package-lock.json', f.lock);
  assert.notEqual(fingerprint(f.app), original);
});

test('legacy successful install is adopted after test command changes', (t) => {
  const f = fixture(t);
  const git = (...args) => assert.equal(spawnSync('git', args, { cwd: f.root, stdio: 'pipe' }).status, 0);
  git('init', '-q'); git('add', 'app/package.json');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'old');
  const old = createHash('sha256').update(fs.readFileSync(path.join(f.app, 'package.json')))
    .update(fs.readFileSync(path.join(f.app, 'package-lock.json'))).update(process.versions.node).digest('hex');
  fs.writeFileSync(f.state, old);
  f.pkg.scripts.test = 'new test'; f.write('package.json', f.pkg);
  assert.equal(f.run().status, 0);
  assert.equal(fs.existsSync(f.log), false);
  assert.equal(fs.readFileSync(f.state, 'utf8').trim(), fingerprint(f.app));
});

for (const mode of ['fail', 'hang']) {
  test(`install ${mode} preserves live dependencies and state; temporary directory cleaned`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.state, 'old-runtime-or-lock');
    const result = f.run(mode);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(path.join(f.modules, 'live-marker'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(f.state, 'utf8'), 'old-runtime-or-lock');
    assert.equal(fs.readdirSync(path.join(f.root, 'tmp')).some((name) => name.startsWith('deps-install-')), false);
    assert.match(fs.readFileSync(f.log, 'utf8'), /tmp\/deps-install-/);
  });
}

test('successful staged install reuses verified ffmpeg, swaps dependencies, and records state', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(fs.readFileSync(f.log, 'utf8'), /ffmpeg-cache\/5.3.0-/);
  assert.equal(fs.existsSync(path.join(f.modules, 'live-marker')), false);
  assert.equal(fs.existsSync(path.join(f.modules, 'ffmpeg-static/ffmpeg')), true);
  assert.equal(fs.readFileSync(f.state, 'utf8').trim(), fingerprint(f.app));
});

test('verification failure after npm success also preserves live dependencies and state', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.state, 'previous-success');
  fs.writeFileSync(path.join(f.root, 'template/sharp/index.js'), 'throw new Error("broken native dependency")');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /新依赖检查失败/);
  assert.equal(fs.readFileSync(path.join(f.modules, 'live-marker'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(f.state, 'utf8'), 'previous-success');
});

test('incomplete tree is repaired despite matching fingerprint; invalid binary is never reused', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.state, fingerprint(f.app));
  fs.writeFileSync(path.join(f.modules, 'broken'), '');
  fs.writeFileSync(path.join(f.modules, 'ffmpeg-static/ffmpeg'), '#!/bin/sh\nexit 1\n');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(fs.readFileSync(f.log, 'utf8'), /ffmpeg-cache/);
  assert.equal(fs.existsSync(path.join(f.modules, 'broken')), false);
});
