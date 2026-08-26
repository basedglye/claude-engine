/**
 * PRICER — nightly rates, plus the deliberately fuzzy demand graph
 * (DESIGN §4). Pure; same purity root as reserva-app.ts.
 *
 * Two rulings live here.
 *
 * The fuzz is DISPLAY data, not state and not randomness (H2 determinism
 * rule 5): each tier's bar is a stateless hash of (day, tier) quantised to
 * a coarse bucket. It never draws from an Rng, never enters a component,
 * and is recomputed identically on every repaint and every replay. A demand
 * graph that jittered per repaint would be a lie the player could not plan
 * against; one drawn from an Rng would perturb a stream by being LOOKED at.
 *
 * The graph ships at its coarsest fidelity and stays there. The "sharpening
 * with upgrades" track is Phase 4 (H2 non-goals), so there is deliberately
 * no accuracy parameter here to tune.
 */
import type { PaintNode, Rect, ScreenAppDef, ScreenEffect, ScreenWorldView } from "@claude-engine/surface-ui";
import { GLYPH_H, hitRect } from "@claude-engine/surface-ui";
import type { ScreenViewData } from "./screen-data.js";

/** `selectedTier` 0 = none selected. Integers only — hashed verbatim. */
export interface PricerState {
  selectedTier: number;
}

const TIER_ROW_X = 8;
const TIER_ROW_Y = 60;
const TIER_ROW_H = 20;
const TIER_ROW_W = 220;
const DOWN_RECT: Rect = { x: 8, y: 420, w: 96, h: 18 };
const UP_RECT: Rect = { x: 112, y: 420, w: 96, h: 18 };

const GRAPH_X = 300;
const GRAPH_Y = 80;
const GRAPH_BAR_H = 12;
const GRAPH_UNIT_W = 24;
/** Coarsest useful resolution: nine buckets, 0..8. */
export const DEMAND_BUCKETS = 9;

function viewData(view: ScreenWorldView): ScreenViewData {
  return view.data as unknown as ScreenViewData;
}

function tierRowKey(tier: number): string {
  return `tier:${tier}`;
}

/** Sorted tier keys — the component is JSON-plain so its keys are strings,
 *  and sorting them keeps row order (and therefore hit-rect order)
 *  independent of object key insertion order. */
function tiersOf(data: ScreenViewData): number[] {
  return Object.keys(data.pricing.rateByTier)
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

function layoutRects(view: ScreenWorldView): Record<string, Rect> {
  const rects: Record<string, Rect> = { down: DOWN_RECT, up: UP_RECT };
  let y = TIER_ROW_Y;
  for (const tier of tiersOf(viewData(view))) {
    rects[tierRowKey(tier)] = { x: TIER_ROW_X, y, w: TIER_ROW_W, h: TIER_ROW_H };
    y += TIER_ROW_H;
  }
  return rects;
}

export const pricerApp: ScreenAppDef<PricerState> = {
  id: "pricer",

  init(): PricerState {
    return { selectedTier: 0 };
  },

  reduce(state, input, view) {
    if (input.kind !== "click") return state;
    const data = viewData(view);
    const hit = hitRect(layoutRects(view), input.px, input.py);
    if (hit === undefined) return state;

    if (hit.startsWith("tier:")) {
      return { selectedTier: Number.parseInt(hit.slice("tier:".length), 10) };
    }

    // The guard: no tier selected means no effect at all. Same shape as
    // RESERVA's accept-guard, and covered by the same kind of test.
    if (state.selectedTier === 0) return state;
    const current = data.pricing.rateByTier[String(state.selectedTier)];
    if (current === undefined) return state;

    const step = data.pricing.stepMinor;
    const next = hit === "up" ? current + step : hit === "down" ? current - step : current;
    // Clamping in the app is a courtesy to the player, not the safety
    // barrier: `screenSystem`'s validated apply function re-checks the
    // bounds and the step, because the app's output is a proposal.
    if (next < data.pricing.minRateMinor || next > data.pricing.maxRateMinor) return state;
    if (next === current) return state;

    const effect: ScreenEffect = {
      type: "pricer.setRate",
      payload: { tier: state.selectedTier, rateMinor: next },
    };
    return { state, effect };
  },

  layout(_state, view) {
    return layoutRects(view);
  },

  paintSpec(state, view) {
    const data = viewData(view);
    const nodes: PaintNode[] = [];
    nodes.push({ kind: "panel", rect: { x: 0, y: 0, w: 640, h: 456 }, fill: 0 });
    nodes.push({ kind: "text", x: 8, y: 4, text: "PRICER - NIGHTLY RATES", color: 11 });
    nodes.push({
      kind: "text",
      x: 8,
      y: 24,
      text: `Range ${formatMinor(data.pricing.minRateMinor)}-${formatMinor(data.pricing.maxRateMinor)}, step ${formatMinor(data.pricing.stepMinor)}`,
      color: 14,
    });
    nodes.push({ kind: "text", x: 8, y: 44, text: "TIERS", color: 8 });

    let y = TIER_ROW_Y;
    for (const tier of tiersOf(data)) {
      const rate = data.pricing.rateByTier[String(tier)]!;
      nodes.push({
        kind: "button",
        rect: { x: TIER_ROW_X, y, w: TIER_ROW_W, h: TIER_ROW_H },
        label: `Tier ${tier}: ${formatMinor(rate)}`,
        color: 15,
        pressed: tier === state.selectedTier,
      });
      y += TIER_ROW_H;
    }

    nodes.push({ kind: "text", x: GRAPH_X, y: 44, text: "DEMAND (approx.)", color: 12 });
    let gy = GRAPH_Y;
    for (const bar of data.pricing.demandBuckets) {
      nodes.push({ kind: "text", x: GRAPH_X, y: gy, text: `T${bar.tier}`, color: 8 });
      nodes.push({
        kind: "panel",
        rect: { x: GRAPH_X + 32, y: gy, w: Math.max(1, bar.bucket) * GRAPH_UNIT_W, h: GRAPH_BAR_H },
        fill: 9,
      });
      gy += GRAPH_BAR_H + GLYPH_H;
    }
    nodes.push({ kind: "text", x: GRAPH_X, y: gy + 8, text: "Figures are approximate.", color: 14 });

    nodes.push({ kind: "button", rect: DOWN_RECT, label: "RATE -", color: 10 });
    nodes.push({ kind: "button", rect: UP_RECT, label: "RATE +", color: 9 });
    return nodes;
  },
};

function formatMinor(minor: number): string {
  const major = Math.trunc(minor / 100);
  const cents = minor % 100;
  return `$${major}.${cents < 10 ? "0" : ""}${cents}`;
}
