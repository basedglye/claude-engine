#!/usr/bin/env node
/**
 * Plugin validity gate (docs/PHASE-2.md Scope A): mechanical checks that the
 * worldforge plugin and its templates are well-formed, wired into CI.
 * `npm run check:plugin` exits 0 if every check passes, 1 otherwise.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

const errors = [];
function fail(message) {
  errors.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// 1. plugin.json parses and carries required fields.
const pluginJsonPath = resolve(repoRoot, "plugin", ".claude-plugin", "plugin.json");
if (!existsSync(pluginJsonPath)) {
  fail(`Missing ${rel(pluginJsonPath)}`);
} else {
  try {
    const plugin = readJson(pluginJsonPath);
    for (const field of ["name", "description", "version"]) {
      if (!plugin[field]) fail(`plugin.json missing required field "${field}"`);
    }
  } catch (err) {
    fail(`plugin.json failed to parse: ${err.message}`);
  }
}

// 2. marketplace.json parses and carries required fields.
const marketplaceJsonPath = resolve(repoRoot, ".claude-plugin", "marketplace.json");
if (!existsSync(marketplaceJsonPath)) {
  fail(`Missing ${rel(marketplaceJsonPath)}`);
} else {
  try {
    const marketplace = readJson(marketplaceJsonPath);
    if (!marketplace.name) fail("marketplace.json missing required field \"name\"");
    if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
      fail("marketplace.json must list at least one plugin in \"plugins\"");
    } else {
      for (const entry of marketplace.plugins) {
        for (const field of ["name", "source"]) {
          if (!entry[field]) fail(`marketplace.json plugin entry missing required field "${field}"`);
        }
      }
    }
  } catch (err) {
    fail(`marketplace.json failed to parse: ${err.message}`);
  }
}

// 3. SKILL.md frontmatter has name/description/version; every references/
//    file it links exists.
const skillPath = resolve(repoRoot, "plugin", "skills", "worldforge", "SKILL.md");
if (!existsSync(skillPath)) {
  fail(`Missing ${rel(skillPath)}`);
} else {
  const content = readFileSync(skillPath, "utf8");
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    fail("SKILL.md has no frontmatter block");
  } else {
    const frontmatter = frontmatterMatch[1];
    for (const field of ["name", "description", "version"]) {
      if (!new RegExp(`^${field}:`, "m").test(frontmatter)) {
        fail(`SKILL.md frontmatter missing required field "${field}"`);
      }
    }
  }

  const referencesDir = resolve(repoRoot, "plugin", "skills", "worldforge", "references");
  const linkedRefs = [...content.matchAll(/references\/([a-zA-Z0-9_-]+\.md)/g)].map((m) => m[1]);
  for (const refFile of new Set(linkedRefs)) {
    if (!existsSync(join(referencesDir, refFile))) {
      fail(`SKILL.md links references/${refFile} but the file does not exist`);
    }
  }
}

// 4. The new-game slash command exists with valid frontmatter.
const newGameCommandPath = resolve(repoRoot, "plugin", "commands", "new-game.md");
if (!existsSync(newGameCommandPath)) {
  fail(`Missing ${rel(newGameCommandPath)}`);
} else {
  const content = readFileSync(newGameCommandPath, "utf8");
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    fail("plugin/commands/new-game.md has no frontmatter block");
  } else {
    for (const field of ["name", "description"]) {
      if (!new RegExp(`^${field}:`, "m").test(frontmatterMatch[1])) {
        fail(`plugin/commands/new-game.md frontmatter missing required field "${field}"`);
      }
    }
  }
}

// 5. Every template contains the required files.
const templatesDir = resolve(repoRoot, "templates");
const REQUIRED_TEMPLATE_FILES = ["package.json", "src/game.ts", "src/main.ts"];
if (!existsSync(templatesDir)) {
  fail(`Missing ${rel(templatesDir)}`);
} else {
  for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const templateDir = join(templatesDir, entry.name);
    for (const required of REQUIRED_TEMPLATE_FILES) {
      if (!existsSync(join(templateDir, required))) {
        fail(`templates/${entry.name} is missing required file "${required}"`);
      }
    }
    const scenariosDir = join(templateDir, "scenarios");
    const hasScenario =
      existsSync(scenariosDir) && readdirSync(scenariosDir).some((f) => f.endsWith(".scenario.mjs"));
    if (!hasScenario) {
      fail(`templates/${entry.name} is missing a scenarios/*.scenario.mjs file`);
    }
  }
}

function rel(path) {
  return path.replace(repoRoot + "\\", "").replace(repoRoot + "/", "");
}

if (errors.length === 0) {
  console.log("✓ Plugin manifest, marketplace listing, SKILL.md, and all templates are well-formed");
  process.exit(0);
} else {
  errors.forEach((e) => console.error(`✗ ${e}`));
  console.error(`\n${errors.length} plugin validity error(s)`);
  process.exit(1);
}
