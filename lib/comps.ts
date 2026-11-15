// The comps layer: every multiple the model uses is measured from the snapshot's own protocols.
//
// A comparable is a protocol whose record carries both a market cap and a TVL, with a positive market
// cap (DefiLlama writes 0 for a token it has no price for, and a 0/1 ratio is not a valuation). Its
// ratio is mcap_usd / tvl_usd. A category with at least MIN_SAMPLES comparables contributes the
// MEDIAN of its ratios, never the mean: one protocol at 400x moves the mean by dollars and the median
// by nothing. A category with fewer than MIN_SAMPLES falls back to the median of its coarse group, and
// a group with fewer than MIN_SAMPLES to the global median. Every multiple is clamped into
// [MULTIPLE_FLOOR, MULTIPLE_CAP] so one odd record cannot dominate a row.

import type { SnapshotProtocol } from './snapshot.ts';

/** One observation: a protocol that already trades, and what its market pays for a dollar of TVL. */
export interface CompSample {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** A median over a set of observations: a category, a group, or the whole snapshot. */
export interface CompStat {
  key: string;
  /** The words the dashboard prints for a group; a category prints its own name. */
  label?: string;
  n: number;
  median: number;
  mean: number;
}

/** The whole comps table, as the dashboard shows it. */
export interface Comps {
  samples: CompSample[];
  global: CompStat;
  /** Categories with at least MIN_SAMPLES comparables: their own median is the multiple. */
  categories: CompStat[];
  /** The coarse groups, pooled: the fallback for a category too thin to measure. */
  groups: CompStat[];
  /** Categories too thin to measure, with the group each one falls back to. */
  thin: { category: string; n: number; group: string }[];
}

/** Below this many comparables a category's median is one protocol's opinion, so it is not used. */
export const MIN_SAMPLES = 4;

/** The clamp every multiple passes through. */
export const MULTIPLE_FLOOR = 0.02;
export const MULTIPLE_CAP = 2;

/** The coarse groups a thin category falls back to, and the words the dashboard prints for them. */
export const GROUP_LABELS: Record<string, string> = {
  cex: 'Exchange',
  bridge: 'Bridge',
  lending: 'Lending/CDP',
  trading: 'DEX/Perp/Options',
  staking: 'Staking/Restaking',
  yield: 'Yield/Curator',
  rwa: 'RWA/Payments',
  other: 'Other',
};

/** Ordered keyword rules; the first that matches a category's lowercase name names its group. */
const GROUP_RULES: [key: string, pattern: RegExp][] = [
  ['cex', /^cex$/],
  ['bridge', /bridge/],
  ['lending', /lend|cdp|collateral|borrow/],
  ['trading', /dex|perp|derivativ|option|synthet|prediction|basis trading/],
  ['staking', /stak/],
  ['yield', /yield|farm|curator|allocator|index|governance|liquidity manager|vault/],
  ['rwa', /rwa|payment|stable|privacy|insurance|card|otc|locker|real world/],
];

/** The coarse group a category belongs to; `other` when no rule matches. */
function groupOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  for (const [key, pattern] of GROUP_RULES) if (pattern.test(c)) return key;
  return 'other';
}

/** The middle of a list of numbers: even counts average the two middles. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The clamp every multiple passes through. */
function clampMultiple(multiple: number): number {
  return Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, multiple));
}

/** One statistic over a set of ratios. */
function stat(key: string, ratios: number[]): CompStat {
  return {
    key,
    n: ratios.length,
    median: median(ratios),
    mean: ratios.reduce((sum, r) => sum + r, 0) / (ratios.length || 1),
  };
}

/** The comps table, measured from the snapshot's own protocols that record both a TVL and a market cap. */
export function buildComps(protocols: SnapshotProtocol[]): Comps {
  const samples: CompSample[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    samples.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: p.mcap_usd / p.tvl_usd });
  }

  const byCategory = new Map<string, number[]>();
  const byGroup = new Map<string, number[]>();
  for (const s of samples) {
    if (s.category !== null) {
      const list = byCategory.get(s.category) ?? [];
      list.push(s.ratio);
      byCategory.set(s.category, list);
    }
    const group = groupOf(s.category);
    const pooled = byGroup.get(group) ?? [];
    pooled.push(s.ratio);
    byGroup.set(group, pooled);
  }

  const categories: CompStat[] = [];
  const thin: { category: string; n: number; group: string }[] = [];
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= MIN_SAMPLES) categories.push(stat(category, ratios));
    else thin.push({ category, n: ratios.length, group: groupOf(category) });
  }
  categories.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
  thin.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));

  // `other` is the absence of a group rather than one, so it is not offered as a fallback: a category
  // with no group borrows the global median, and the table says so.
  const groups = [...byGroup.entries()]
    .filter(([key]) => key !== 'other')
    .map(([key, ratios]) => ({ ...stat(key, ratios), label: GROUP_LABELS[key] ?? key }))
    .sort((a, b) => b.n - a.n);
  return { samples, global: stat('all', samples.map((s) => s.ratio)), categories, groups, thin };
}

/** The multiple one category earns, and the words that say where it came from. */
export interface MultipleUse {
  multiple: number;
  source: string;
}

/** The multiple for a category: its own median, else its group's pooled median, else the global median,
 * clamped. `other` is the absence of a group rather than a group, so it falls straight to the global
 * median. `source` is the sentence fragment the dashboard prints beside the number. */
export function multipleFor(comps: Comps, category: string | null): MultipleUse {
  const own = category === null ? undefined : comps.categories.find((c) => c.key === category);
  if (own !== undefined) return { multiple: clampMultiple(own.median), source: `${own.key} median (n=${own.n})` };
  const group = groupOf(category);
  const pooled = comps.groups.find((g) => g.key === group);
  if (group !== 'other' && pooled !== undefined && pooled.n >= MIN_SAMPLES) {
    return { multiple: clampMultiple(pooled.median), source: `${GROUP_LABELS[group] ?? group} group median (n=${pooled.n})` };
  }
  return { multiple: clampMultiple(comps.global.median), source: `global median (n=${comps.global.n})` };
}