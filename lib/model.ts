// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers is narrow on purpose: if a protocol's record stayed exactly as the
// snapshot has it, what would a token be worth? The answer is a multiple of the protocol's own TVL, and
// the multiple is measured, not assumed. Every comparable is a protocol in the same snapshot whose
// record carries both a market cap and a TVL, so the market itself prices a dollar of TVL in that
// category; the median of those prices is the multiple. Nothing here reads a clock or a random number.
//
//   comps      = buildComps(protocols)                      median mcap/tvl, by category then group
//   multiple   = clamp(median(category or group or all), 0.02, 2.0)
//   growth     = 1 + clamp(change_7d, -30, 30) / 100 x 0.30  (null: 1)
//   maturity   = 1.10 - 0.10 x clamp(age_days / 1095, 0, 1)  (unknown listed_at: 1.05)
//   implied    = round(tvl_usd x multiple x growth x maturity), floored at 1 and capped at 1e14
//
// The board ranks every protocol in the snapshot that could still launch: it records no token, and it is
// not a wrapped, staked or bridged product of one that already trades. The watchlist is a floor, never a
// ceiling: it is 40 of those rows and the board holds all of them. Protocols whose token already trades
// are not ranked at all; their market caps are the comps.

import { ageDays, finite, isPreToken } from './snapshot.ts';
import type { Snapshot, SnapshotProtocol } from './snapshot.ts';
import { buildComps, MIN_SAMPLES, MULTIPLE_CAP, MULTIPLE_FLOOR, multipleFor } from './comps.ts';
import type { Comps } from './comps.ts';
import { farmPlan } from './farm.ts';

/** The model's constants: every number the formula uses, and nothing a name could change. */
export interface ModelConstants {
  /** The clamp on a category's measured multiple, and the samples a category needs to be measured. */
  multiple_floor: number;
  multiple_cap: number;
  min_samples: number;
  /** How much of the seven-day change a week of growth is worth, and the clamp on it. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** The age premium: a young protocol earns the ceiling, a three-year-old the floor. */
  maturity_ceiling: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_adjust: number;
  /** The gate's own bounds on a row's value. */
  value_floor: number;
  value_cap: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: MULTIPLE_FLOOR,
  multiple_cap: MULTIPLE_CAP,
  min_samples: MIN_SAMPLES,
  growth_weight: 0.3,
  growth_floor: -30,
  growth_cap: 30,
  maturity_ceiling: 1.1,
  maturity_span: 0.1,
  maturity_days: 1095,
  unknown_age_adjust: 1.05,
  value_floor: 1,
  value_cap: 100_000_000_000_000,
};

/** The model's version label: the dashboard names it and the dossier quotes it. */
export const MODEL_VERSION = 'comps-1';

/** The gate's bounds on a board, checked here so a run fails before the scorer sees it. */
export const BOARD_MIN_ROWS = 100;
export const BOARD_MAX_ROWS = 4_000;
const STEP_MIN_CHARS = 20;
const STEP_MAX_CHARS = 600;
const STEP_MIN = 3;
const STEP_MAX = 12;

/** One row of board.json: the ranked board's row, with the derivation that produced it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'records no token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row: the derivation flattened, the plan carried as written. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: string;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** Everything the dashboard needs: the board, the comps table, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  comps: Comps;
  summary: {
    protocols: number;
    pre_token: number;
    product_excluded: number;
    watchlist: number;
    rows: number;
    outside_watchlist: number;
    comps_samples: number;
  };
  rows: RadarRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One protocol's derivation: the multiple it earned, the two adjustments, and the value they imply. */
export interface Derivation {
  implied: number;
  multiple: number;
  multipleSource: string;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
}

/**
 * The implied value of one pre-token protocol: its TVL, the multiple the market pays for its category,
 * and the two small adjustments the record justifies. Deterministic in (record, as_of, comps, model).
 */
export function impliedValue(p: SnapshotProtocol, asOf: string, comps: Comps, model: ModelConstants = MODEL): Derivation {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, source } = multipleFor(comps, p.category);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // The adjustments are rounded before they are multiplied, so the number the page recomputes from the
  // published figures is exactly the number board.json carries.
  const growthMult = p.change_7d === null ? 1 : round4(1 + (growthPct / 100) * model.growth_weight);
  const maturityMult =
    age === null
      ? model.unknown_age_adjust
      : round4(model.maturity_ceiling - model.maturity_span * Math.min(Math.max(age / model.maturity_days, 0), 1));
  const raw = p.tvl_usd * multiple * growthMult * maturityMult;
  const implied = Math.min(model.value_cap, Math.max(model.value_floor, Math.round(raw)));
  return { implied, multiple, multipleSource: source, growthPct, growthMult, maturityMult, age };
}

/**
 * The categories the house's own watchlist rule reads as a product rather than a protocol: a bridged,
 * staked or restaked asset, or an exchange's custody business. A protocol in one of them records no
 * token, but the token it would issue is a wrapped or staked form of one that already trades.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that says out loud it is a wrapped or staked product. */
const STAKED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's, whose token is a corporate listing and not a launch. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/**
 * Whether a protocol could still launch: it records no token, and it is not a wrapped, staked or
 * bridged product of a token that already trades. The test is the house's own watchlist rule, applied
 * to the whole snapshot rather than only to the protocols above the floor; the board ranks the
 * protocols this returns true for.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !PRODUCT_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name) && !STAKED_WORD.test(p.name) && !EXCHANGE_PREFIX.test(p.name);
}

/**
 * The rows the board ranks: every protocol in the snapshot that could still launch. The watchlist is a
 * floor, so a watchlist slug is kept even if a future snapshot changed its record; nothing else is
 * added, because a protocol whose token already trades belongs in the comps and not in the ranking.
 */
function selected(snapshot: Snapshot): SnapshotProtocol[] {
  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) if (isLaunchCandidate(p)) chosen.set(p.slug, p);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.has(slug)) chosen.set(slug, p);
  }
  return [...chosen.values()];
}

/** The ranked board: strongest implied value first, ranks 1..n, one row per slug. */
export function buildBoard(snapshot: Snapshot, comps: Comps, model: ModelConstants = MODEL): BoardRow[] {
  const scored = selected(snapshot).map((p) => ({ p, d: impliedValue(p, snapshot.as_of, comps, model) }));
  scored.sort((a, b) => b.d.implied - a.d.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    gecko_id: null,
    symbol: null,
    token_status: 'records no token',
    age_days: s.d.age,
    implied_value_usd: s.d.implied,
    model: {
      multiple: s.d.multiple,
      multiple_source: s.d.multipleSource,
      growth_pct: s.d.growthPct,
      growth_multiplier: s.d.growthMult,
      maturity_multiplier: s.d.maturityMult,
      age_days: s.d.age,
    },
    farm_steps: farmPlan(s.p, s.d.age),
  }));
}

/** A board row in the dashboard's shape: the plan and the derivation travel with it. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot: the board and the comps it was built from. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const comps = buildComps(snapshot.protocols);
  const board = buildBoard(snapshot, comps, model);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    comps,
    summary: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      product_excluded: snapshot.protocols.filter((p) => isPreToken(p) && !isLaunchCandidate(p)).length,
      watchlist: snapshot.watchlist.length,
      rows: board.length,
      outside_watchlist: board.filter((r) => !watchlist.has(r.slug)).length,
      comps_samples: comps.samples.length,
    },
    rows: board.map((r) => radarRow(r, watchlist)),
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < BOARD_MIN_ROWS || board.length > BOARD_MAX_ROWS) return `the board holds ${board.length} rows`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < STEP_MIN || steps.length > STEP_MAX) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < STEP_MIN_CHARS || trimmed.length > STEP_MAX_CHARS) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > MODEL.value_cap) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.model.multiple >= MODEL.multiple_floor && r.model.multiple <= MODEL.multiple_cap)) return `${r.slug} uses the multiple ${r.model.multiple}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}