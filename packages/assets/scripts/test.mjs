// Determinism tests for @claude-engine/assets, run against the built dist/
// (npm run test -w @claude-engine/assets builds first). Hand-rolled
// assert-and-exit-nonzero script, matching this repo's scripts/smoke.mjs
// style rather than pulling in Node's test runner.
import { Rng } from "../../core/dist/index.js";
import {
  generateTerrain,
  heightAt,
  generateCreatureMesh,
  generatePropMesh,
  generateIconSvg,
  generateScore,
  hashAsset,
} from "../dist/index.js";

const SEED_A = "assets-golden-1";
const SEED_B = "assets-golden-2";

// Golden hashes for SEED_A — committed so a silent behavior-changing refactor
// is caught by CI diffing these numbers. Regenerate deliberately with
// scripts/gen-goldens.mjs and update here when a generator intentionally
// changes.
const GOLDENS = {
  terrain: 776427365,
  creature: 3897413768,
  rock: 3186743547,
  tree: 1012491514,
  crystal: 1996448330,
  icon: 2269353749,
  score: 1262062229,
};

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

function checkGenerator(name, generate, goldenKey) {
  const a1 = generate(new Rng(SEED_A));
  const a2 = generate(new Rng(SEED_A));
  const b = generate(new Rng(SEED_B));

  const hashA1 = hashAsset(a1);
  const hashA2 = hashAsset(a2);
  const hashB = hashAsset(b);

  check(`${name}: same seed twice -> byte-identical hash`, hashA1 === hashA2);
  check(`${name}: different seed -> different hash`, hashA1 !== hashB);
  const golden = GOLDENS[goldenKey];
  check(
    `${name}: matches committed golden (${golden})`,
    hashA1 === golden
  );
  if (hashA1 !== golden) {
    console.log(`  got ${hashA1} for seed ${SEED_A}`);
  }
}

checkGenerator(
  "generateTerrain",
  (rng) => generateTerrain(rng, { size: 32, resolution: 17, heightScale: 4 }),
  "terrain"
);
checkGenerator("generateCreatureMesh", (rng) => generateCreatureMesh(rng), "creature");
checkGenerator("generatePropMesh(rock)", (rng) => generatePropMesh(rng, "rock"), "rock");
checkGenerator("generatePropMesh(tree)", (rng) => generatePropMesh(rng, "tree"), "tree");
checkGenerator("generatePropMesh(crystal)", (rng) => generatePropMesh(rng, "crystal"), "crystal");
checkGenerator("generateIconSvg", (rng) => generateIconSvg(rng), "icon");
checkGenerator("generateScore", (rng) => generateScore(rng), "score");

// Extra sanity checks beyond the golden-hash contract.
{
  const terrain = generateTerrain(new Rng(SEED_A), { size: 32, resolution: 17, heightScale: 4 });
  check("terrain heights length == resolution^2", terrain.heights.length === 17 * 17);

  const center = heightAt(terrain, 0, 0);
  check("heightAt at center is finite", Number.isFinite(center));

  const farOut = heightAt(terrain, 10_000, 10_000);
  const edge = heightAt(terrain, terrain.size / 2, terrain.size / 2);
  check("heightAt clamps out-of-bounds to the edge value", farOut === edge);

  const mesh = generateCreatureMesh(new Rng(SEED_A));
  check("creature mesh has triangles", mesh.triCount > 0);
  check(
    "creature mesh index/position counts agree",
    mesh.indices.length === mesh.triCount * 3 && mesh.positions.length % 3 === 0
  );

  const icon = generateIconSvg(new Rng(SEED_A));
  check("icon SVG has a viewBox and root <svg> tag", icon.startsWith("<svg") && icon.includes("viewBox"));

  const score = generateScore(new Rng(SEED_A));
  check("score has at least one track with notes", score.tracks.some((t) => t.notes.length > 0));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exit(1);
