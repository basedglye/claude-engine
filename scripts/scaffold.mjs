#!/usr/bin/env node
/**
 * Scaffold command (docs/PHASE-2.md Scope A):
 *   npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>
 *
 * Copies templates/<template>/ to apps/<app-name>/, rewriting the package
 * name to @claude-engine/<app-name> and any __NAME__ placeholders. stdout
 * carries exactly one JSON document; diagnostics go to stderr.
 * Exit 0 created; 2 invalid name, existing directory, or unknown template.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..");

const KNOWN_TEMPLATES = new Set(["3d-world", "topdown-2d"]);
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function parseArgs(argv) {
  let appName;
  let template;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--template") {
      template = argv[++i];
      if (!template) {
        console.error("--template requires a value");
        process.exit(2);
      }
    } else if (!appName && !arg.startsWith("--")) {
      appName = arg;
    } else {
      console.error(`Unrecognized argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!appName || !template) {
    console.error("Usage: npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>");
    process.exit(2);
  }
  return { appName, template };
}

function copyDir(src, dest, replacements) {
  const files = [];
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destName = entry.name.replaceAll("__NAME__", replacements.name);
    const destPath = join(dest, destName);
    if (entry.isDirectory()) {
      files.push(...copyDir(srcPath, destPath, replacements));
    } else {
      let content = readFileSync(srcPath, "utf8");
      content = content.replaceAll("__NAME__", replacements.name).replaceAll("__PACKAGE_NAME__", replacements.packageName);
      writeFileSync(destPath, content, "utf8");
      files.push(relative(repoRoot, destPath).split("\\").join("/"));
    }
  }
  return files;
}

function main() {
  const { appName, template } = parseArgs(process.argv.slice(2));

  if (!NAME_PATTERN.test(appName)) {
    console.error(`Invalid app name "${appName}": must be kebab-case (lowercase letters, digits, hyphens; starting with a letter).`);
    process.exit(2);
    return;
  }
  if (!KNOWN_TEMPLATES.has(template)) {
    console.error(`Unknown template "${template}". Known templates: ${[...KNOWN_TEMPLATES].join(", ")}`);
    process.exit(2);
    return;
  }

  const templateDir = resolve(repoRoot, "templates", template);
  if (!existsSync(templateDir)) {
    console.error(`Template directory not found: ${templateDir}`);
    process.exit(2);
    return;
  }

  const appDir = resolve(repoRoot, "apps", appName);
  if (existsSync(appDir)) {
    console.error(`apps/${appName} already exists.`);
    process.exit(2);
    return;
  }
  // Guard against traversal via a crafted --template-adjacent name; not
  // reachable through the validated NAME_PATTERN, but cheap to assert.
  if (statSync(resolve(repoRoot, "apps")).isDirectory() === false) {
    console.error("apps/ is not a directory");
    process.exit(2);
    return;
  }

  const files = copyDir(templateDir, appDir, { name: appName, packageName: `@claude-engine/${appName}` });

  const json = JSON.stringify({ app: appName, template, path: relative(repoRoot, appDir).split("\\").join("/"), files }, null, 2);
  console.log(json);
  process.exit(0);
}

main();
