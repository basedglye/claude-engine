#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Node built-ins that are banned in packages/core
const NODE_BUILTINS = new Set([
  'fs',
  'path',
  'os',
  'child_process',
  'stream',
  'http',
  'https',
  'net',
  'crypto',
  'events',
  'util',
  'buffer',
  'assert',
  'cluster',
  'tls',
  'dgram',
  'dns',
  'domain',
  'querystring',
  'readline',
  'repl',
  'tty',
  'url',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
  'perf_hooks',
  'async_hooks',
  'inspector',
  'module',
]);

function scanFile(filePath, opts = {}) {
  const banTranscendentals = opts.banTranscendentals ?? false;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Check for 'three' imports
    if (/\bfrom\s+['"]three['"]/i.test(line) || /\brequire\s*\(\s*['"]three['"]\s*\)/.test(line)) {
      violations.push({
        file: filePath,
        line: lineNum,
        type: 'three-import',
        message: `Three.js import detected`,
      });
    }

    // Check for node: prefixed imports
    if (/\bfrom\s+['"]node:/i.test(line) || /\brequire\s*\(\s*['"]node:/i.test(line)) {
      const match = line.match(/\bfrom\s+['"]node:([^'"]+)['"]/) || line.match(/\brequire\s*\(\s*['"]node:([^'"]+)['"]\s*\)/);
      const module = match ? match[1] : 'unknown';
      violations.push({
        file: filePath,
        line: lineNum,
        type: 'node-builtin-import',
        message: `Node built-in import detected: node:${module}`,
      });
    }

    // Check for bare Node built-in imports
    NODE_BUILTINS.forEach((builtin) => {
      const regex = new RegExp(`\\bfrom\\s+['"](${builtin})['"]|\\brequire\\s*\\(\\s*['"](${builtin})['"]\\s*\\)`, 'i');
      if (regex.test(line)) {
        violations.push({
          file: filePath,
          line: lineNum,
          type: 'node-builtin-import',
          message: `Node built-in import detected: ${builtin}`,
        });
      }
    });

    // Check for Math.random calls (exclude pure comment lines)
    const trimmed = line.trim();
    // Skip lines that are pure comments
    if (!trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.endsWith('*/')) {
      if (/Math\.random\s*\(/.test(line)) {
        violations.push({
          file: filePath,
          line: lineNum,
          type: 'math-random',
          message: `Math.random() call detected`,
        });
      }

      // Check for banned transcendental Math.* calls (opt-in per root via
      // banTranscendentals). float sin/cos/etc drift across platforms/engine
      // versions, which breaks cross-machine replay determinism; longest-first
      // alternation so atan2/log2 match before atan/log.
      if (
        banTranscendentals &&
        /\bMath\.(sin|cos|tan|asin|acos|atan2|atan|exp|log2|log10|log|pow|hypot|cbrt)\s*\(/.test(line)
      ) {
        violations.push({
          file: filePath,
          line: lineNum,
          type: 'math-transcendental',
          message: `Banned transcendental Math.* call detected (use the seeded LUT/integer math instead)`,
        });
      }
    }
  });

  return violations;
}

/**
 * @param {string} dir
 * @param {{ excludeDirNames?: Set<string>, banTranscendentals?: boolean }} [opts]
 *   `excludeDirNames`: directory basenames to skip entirely while walking
 *   (e.g. a package's DOM/Three.js-touching web adapter, which is
 *   intentionally exempt from purity rules). `banTranscendentals`: opt-in
 *   flag propagated to `scanFile` for the `math-transcendental` check.
 */
function scanDirectory(dir, opts = {}) {
  const excludeDirNames = opts.excludeDirNames ?? new Set();
  const banTranscendentals = opts.banTranscendentals ?? false;
  const violations = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && excludeDirNames.has(entry.name)) continue;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const fileViolations = scanFile(fullPath, { banTranscendentals });
        violations.push(...fileViolations);
      }
    }
  }

  walk(dir);
  return violations;
}

// Purity roots enforced by this script (mirrors eslint.config.mjs's
// per-package restricted-imports/globals/properties blocks): zero DOM /
// Three.js / Node imports, no Math.random. packages/assets ships a /web
// subpath adapter that's exempt by design (docs/PHASE-2.md Scope B).
const PURITY_ROOTS = [
  {
    name: 'packages/core/src',
    dir: path.join(REPO_ROOT, 'packages', 'core', 'src'),
    excludeDirNames: new Set(),
    banTranscendentals: true,
  },
  // packages/assets' Math.sin/cos uses (mesh.ts, icon.ts) are legitimate:
  // asset-synthesis output (meshes, icons, terrain heightfields, music) is
  // presentation data, never hashed into sim state or reasoned about by the
  // sim with float precision (see CLAUDE.md invariant 2) — so this root does
  // NOT opt into banTranscendentals.
  {
    name: 'packages/assets/src (excluding src/web)',
    dir: path.join(REPO_ROOT, 'packages', 'assets', 'src'),
    excludeDirNames: new Set(['web']),
  },
  {
    name: 'packages/net/src (excluding src/web)',
    dir: path.join(REPO_ROOT, 'packages', 'net', 'src'),
    excludeDirNames: new Set(['web']),
    banTranscendentals: true,
  },
  {
    name: 'packages/bots/src',
    dir: path.join(REPO_ROOT, 'packages', 'bots', 'src'),
    excludeDirNames: new Set(),
    banTranscendentals: true,
  },
  {
    name: 'packages/space/src',
    dir: path.join(REPO_ROOT, 'packages', 'space', 'src'),
    excludeDirNames: new Set(),
    banTranscendentals: true,
  },
  {
    name: 'packages/interiors/src',
    dir: path.join(REPO_ROOT, 'packages', 'interiors', 'src'),
    excludeDirNames: new Set(),
    banTranscendentals: true,
  },
];

function runSelfTest() {
  const tempDir = path.join(REPO_ROOT, '.tmp-purity-test');
  const testFiles = [];

  try {
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Test 1: three import
    const file1 = path.join(tempDir, 'test-three.ts');
    fs.writeFileSync(file1, "import * as THREE from 'three';\n");
    testFiles.push(file1);

    // Test 2: node: builtin import
    const file2 = path.join(tempDir, 'test-node-builtin.ts');
    fs.writeFileSync(file2, "import fs from 'node:fs';\n");
    testFiles.push(file2);

    // Test 3: Math.random call
    const file3 = path.join(tempDir, 'test-math-random.ts');
    fs.writeFileSync(file3, "const x = Math.random();\n");
    testFiles.push(file3);

    // Test 4 (line-76 regex fix regression): require('fs' ) with whitespace
    // before the closing paren, require-form only.
    const file4 = path.join(tempDir, 'test-node-builtin-spaced.ts');
    fs.writeFileSync(file4, "const x = require('fs' );\n");
    testFiles.push(file4);

    // Run scans
    const violations1 = scanFile(file1);
    const violations2 = scanFile(file2);
    const violations3 = scanFile(file3);
    const violations4 = scanFile(file4);

    // Verify results
    const hasThreeViolation = violations1.some((v) => v.type === 'three-import');
    const hasNodeBuiltinViolation = violations2.some((v) => v.type === 'node-builtin-import');
    const hasMathRandomViolation = violations3.some((v) => v.type === 'math-random');
    const hasSpacedBuiltinViolation = violations4.some((v) => v.type === 'node-builtin-import');

    // Test 5+: for each purity root that ships a /web exclusion, plant a
    // Math.random violation in the pure root and a three-import "violation"
    // in web/ — exercised through the real scanDirectory()/PURITY_ROOTS
    // machinery (not scanFile() in isolation), confirming both that the
    // root is actually scanned AND that its web/ exclusion actually excludes.
    function testWebExclusion(rootNamePrefix) {
      const root = PURITY_ROOTS.find((r) => r.name.startsWith(rootNamePrefix));
      if (!root || !fs.existsSync(root.dir)) return { hasPathViolation: false, webCorrectlyExcluded: true, ran: false };
      const rootSelfTestDir = path.join(root.dir, '.tmp-purity-selftest');
      const webSelfTestDir = path.join(root.dir, 'web', '.tmp-purity-selftest');
      fs.mkdirSync(rootSelfTestDir, { recursive: true });
      fs.mkdirSync(webSelfTestDir, { recursive: true });
      const rootBadFile = path.join(rootSelfTestDir, 'bad.ts');
      const webBadFile = path.join(webSelfTestDir, 'bad.ts');
      fs.writeFileSync(rootBadFile, "const x = Math.random();\n");
      fs.writeFileSync(webBadFile, "import * as THREE from 'three';\n");
      try {
        const scan = scanDirectory(root.dir, { excludeDirNames: root.excludeDirNames });
        return {
          hasPathViolation: scan.some((v) => v.file === rootBadFile),
          webCorrectlyExcluded: !scan.some((v) => v.file === webBadFile),
          ran: true,
        };
      } finally {
        fs.rmSync(rootSelfTestDir, { recursive: true, force: true });
        fs.rmSync(webSelfTestDir, { recursive: true, force: true });
      }
    }

    // Test: a purity root with no /web exclusion (bots) still gets a planted-
    // violation check — docs/PHASE-3.md exit criterion 1 names it explicitly.
    function testPlainRoot(rootNamePrefix) {
      const root = PURITY_ROOTS.find((r) => r.name.startsWith(rootNamePrefix));
      if (!root || !fs.existsSync(root.dir)) return { hasPathViolation: false, ran: false };
      const selfTestDir = path.join(root.dir, '.tmp-purity-selftest');
      fs.mkdirSync(selfTestDir, { recursive: true });
      const badFile = path.join(selfTestDir, 'bad.ts');
      fs.writeFileSync(badFile, "const x = Math.random();\n");
      try {
        const scan = scanDirectory(root.dir, { excludeDirNames: root.excludeDirNames });
        return { hasPathViolation: scan.some((v) => v.file === badFile), ran: true };
      } finally {
        fs.rmSync(selfTestDir, { recursive: true, force: true });
      }
    }

    // Test: math-transcendental, planted through the real
    // scanDirectory()/PURITY_ROOTS machinery (not scanFile() in isolation).
    // Proves both directions: CAUGHT in a banTranscendentals root, and
    // correctly NOT flagged in packages/assets/src (carve-out) — plus a
    // Math.floor() control in a banned root, which must stay legal (floor/
    // round/abs/min/max/sign/trunc are exactly specified by ECMAScript).
    function testTranscendentalBan(rootNamePrefix) {
      const root = PURITY_ROOTS.find((r) => r.name.startsWith(rootNamePrefix));
      if (!root || !fs.existsSync(root.dir)) return { hasAtan2Violation: false, floorNotFlagged: true, ran: false };
      const selfTestDir = path.join(root.dir, '.tmp-purity-selftest-trig');
      fs.mkdirSync(selfTestDir, { recursive: true });
      const atan2File = path.join(selfTestDir, 'bad-atan2.ts');
      const floorFile = path.join(selfTestDir, 'ok-floor.ts');
      fs.writeFileSync(atan2File, "const a = Math.atan2(1, 2);\n");
      fs.writeFileSync(floorFile, "const b = Math.floor(1.5);\n");
      try {
        const scan = scanDirectory(root.dir, {
          excludeDirNames: root.excludeDirNames,
          banTranscendentals: root.banTranscendentals,
        });
        return {
          hasAtan2Violation: scan.some((v) => v.file === atan2File && v.type === 'math-transcendental'),
          floorNotFlagged: !scan.some((v) => v.file === floorFile),
          ran: true,
        };
      } finally {
        fs.rmSync(selfTestDir, { recursive: true, force: true });
      }
    }

    function testTranscendentalNotBanned(rootNamePrefix) {
      const root = PURITY_ROOTS.find((r) => r.name.startsWith(rootNamePrefix));
      if (!root || !fs.existsSync(root.dir)) return { cosNotFlagged: true, ran: false };
      const selfTestDir = path.join(root.dir, '.tmp-purity-selftest-trig');
      fs.mkdirSync(selfTestDir, { recursive: true });
      const cosFile = path.join(selfTestDir, 'ok-cos.ts');
      fs.writeFileSync(cosFile, "const c = Math.cos(1);\n");
      try {
        const scan = scanDirectory(root.dir, {
          excludeDirNames: root.excludeDirNames,
          banTranscendentals: root.banTranscendentals,
        });
        return { cosNotFlagged: !scan.some((v) => v.file === cosFile), ran: true };
      } finally {
        fs.rmSync(selfTestDir, { recursive: true, force: true });
      }
    }

    const assetsCheck = testWebExclusion('packages/assets');
    const netCheck = testWebExclusion('packages/net');
    const botsCheck = testPlainRoot('packages/bots');
    const trigBanCheck = testTranscendentalBan('packages/core/src');
    const trigNotBannedCheck = testTranscendentalNotBanned('packages/assets/src (excluding');

    const allPass =
      hasThreeViolation &&
      hasNodeBuiltinViolation &&
      hasMathRandomViolation &&
      hasSpacedBuiltinViolation &&
      assetsCheck.hasPathViolation &&
      assetsCheck.webCorrectlyExcluded &&
      netCheck.hasPathViolation &&
      netCheck.webCorrectlyExcluded &&
      botsCheck.hasPathViolation &&
      trigBanCheck.hasAtan2Violation &&
      trigBanCheck.floorNotFlagged &&
      trigNotBannedCheck.cosNotFlagged;

    if (allPass) {
      console.log('PASS: Self-test detected all violation classes');
      console.log(`  - Three import: CAUGHT`);
      console.log(`  - Node builtin (node:fs): CAUGHT`);
      console.log(`  - Math.random call: CAUGHT`);
      console.log(`  - Node builtin, space before closing paren (require('fs' )): CAUGHT`);
      console.log(`  - Math.random planted in packages/assets/src: CAUGHT`);
      console.log(`  - three import planted in packages/assets/src/web: correctly EXCLUDED`);
      console.log(`  - Math.random planted in packages/net/src: CAUGHT`);
      console.log(`  - three import planted in packages/net/src/web: correctly EXCLUDED`);
      console.log(`  - Math.random planted in packages/bots/src: CAUGHT`);
      console.log(`  - Math.atan2 planted in packages/core/src: CAUGHT`);
      console.log(`  - Math.floor planted in packages/core/src: correctly NOT flagged`);
      console.log(`  - Math.cos planted in packages/assets/src: correctly NOT flagged`);
      return 0;
    } else {
      console.error('FAIL: Self-test did not detect all violations');
      if (!hasThreeViolation) console.error('  - Three import: NOT CAUGHT');
      if (!hasNodeBuiltinViolation) console.error('  - Node builtin: NOT CAUGHT');
      if (!hasMathRandomViolation) console.error('  - Math.random: NOT CAUGHT');
      if (!hasSpacedBuiltinViolation) console.error("  - Node builtin require('fs' ) (spaced): NOT CAUGHT");
      if (!assetsCheck.hasPathViolation) console.error('  - Math.random planted in packages/assets/src: NOT CAUGHT');
      if (!assetsCheck.webCorrectlyExcluded) console.error('  - packages/assets/src/web exclusion: NOT WORKING (false positive)');
      if (!netCheck.hasPathViolation) console.error('  - Math.random planted in packages/net/src: NOT CAUGHT');
      if (!netCheck.webCorrectlyExcluded) console.error('  - packages/net/src/web exclusion: NOT WORKING (false positive)');
      if (!botsCheck.hasPathViolation) console.error('  - Math.random planted in packages/bots/src: NOT CAUGHT');
      if (!trigBanCheck.hasAtan2Violation) console.error('  - Math.atan2 planted in packages/core/src: NOT CAUGHT');
      if (!trigBanCheck.floorNotFlagged) console.error('  - Math.floor planted in packages/core/src: FALSE POSITIVE');
      if (!trigNotBannedCheck.cosNotFlagged) console.error('  - Math.cos planted in packages/assets/src: FALSE POSITIVE');
      return 1;
    }
  } finally {
    // Cleanup
    for (const file of testFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    return runSelfTest();
  }

  const allViolations = [];
  for (const root of PURITY_ROOTS) {
    if (!fs.existsSync(root.dir)) {
      // Concurrently-developed roots (packages/space/src,
      // packages/interiors/src during Phase H0) may not exist yet on a
      // given checkout — skip gracefully rather than failing the whole
      // check, matching the self-test helpers' existsSync guard below.
      console.log(`(skip) ${root.name} not found at ${root.dir} yet`);
      continue;
    }
    allViolations.push(
      ...scanDirectory(root.dir, { excludeDirNames: root.excludeDirNames, banTranscendentals: root.banTranscendentals })
    );
  }

  if (allViolations.length === 0) {
    for (const root of PURITY_ROOTS) console.log(`✓ No purity violations found in ${root.name}`);
    return 0;
  }

  allViolations.forEach((v) => {
    const relPath = path.relative(REPO_ROOT, v.file);
    console.error(`${relPath}:${v.line}: ${v.message}`);
  });

  console.error(`\nFound ${allViolations.length} purity violation(s)`);
  return 1;
}

process.exit(main());
