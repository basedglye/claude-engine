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

function scanFile(filePath) {
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
      const regex = new RegExp(`\\bfrom\\s+['"](${builtin})['"]|\\brequire\\s*\\(\\s*['"](${builtin})['"]\s*\\)`, 'i');
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
    }
  });

  return violations;
}

function scanDirectory(dir) {
  const violations = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const fileViolations = scanFile(fullPath);
        violations.push(...fileViolations);
      }
    }
  }

  walk(dir);
  return violations;
}

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

    // Run scans
    const violations1 = scanFile(file1);
    const violations2 = scanFile(file2);
    const violations3 = scanFile(file3);

    // Verify results
    const hasThreeViolation = violations1.some((v) => v.type === 'three-import');
    const hasNodeBuiltinViolation = violations2.some((v) => v.type === 'node-builtin-import');
    const hasMathRandomViolation = violations3.some((v) => v.type === 'math-random');

    const allPass = hasThreeViolation && hasNodeBuiltinViolation && hasMathRandomViolation;

    if (allPass) {
      console.log('PASS: Self-test detected all violation classes');
      console.log(`  - Three import: CAUGHT`);
      console.log(`  - Node builtin (node:fs): CAUGHT`);
      console.log(`  - Math.random call: CAUGHT`);
      return 0;
    } else {
      console.error('FAIL: Self-test did not detect all violations');
      if (!hasThreeViolation) console.error('  - Three import: NOT CAUGHT');
      if (!hasNodeBuiltinViolation) console.error('  - Node builtin: NOT CAUGHT');
      if (!hasMathRandomViolation) console.error('  - Math.random: NOT CAUGHT');
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

  const coreDir = path.join(REPO_ROOT, 'packages', 'core', 'src');

  if (!fs.existsSync(coreDir)) {
    console.error(`packages/core/src directory not found at ${coreDir}`);
    return 2;
  }

  const violations = scanDirectory(coreDir);

  if (violations.length === 0) {
    console.log('✓ No purity violations found in packages/core/src');
    return 0;
  }

  violations.forEach((v) => {
    const relPath = path.relative(REPO_ROOT, v.file);
    console.error(`${relPath}:${v.line}: ${v.message}`);
  });

  console.error(`\nFound ${violations.length} purity violation(s)`);
  return 1;
}

process.exit(main());
