// One-off helper: prints hashAsset() goldens for the fixed seed used by
// scripts/test.mjs. Not part of the test run itself — run manually after a
// deliberate generator change, then paste the numbers into test.mjs.
import { Rng } from "../../core/dist/index.js";
import {
  generateTerrain,
  generateCreatureMesh,
  generatePropMesh,
  generateIconSvg,
  generateScore,
  hashAsset,
} from "../dist/index.js";

const SEED = "assets-golden-1";

const terrain = generateTerrain(new Rng(SEED), { size: 32, resolution: 17, heightScale: 4 });
const creature = generateCreatureMesh(new Rng(SEED));
const rock = generatePropMesh(new Rng(SEED), "rock");
const tree = generatePropMesh(new Rng(SEED), "tree");
const crystal = generatePropMesh(new Rng(SEED), "crystal");
const icon = generateIconSvg(new Rng(SEED));
const score = generateScore(new Rng(SEED));

console.log(
  JSON.stringify(
    {
      terrain: hashAsset(terrain),
      creature: hashAsset(creature),
      rock: hashAsset(rock),
      tree: hashAsset(tree),
      crystal: hashAsset(crystal),
      icon: hashAsset(icon),
      score: hashAsset(score),
    },
    null,
    2
  )
);
