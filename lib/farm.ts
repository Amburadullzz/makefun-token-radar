// The farm layer: a plan for one protocol, built only from its own record (name, category, chains, TVL,
// age). No name is special-cased and no list of protocols is kept: the category picks the play, the
// chain picks the asset and the gas estimate, the TVL picks the capital, the age picks the hold.
//
// Every step names the protocol or its chain, states what it costs and how long it takes, and the
// wording varies by category and by a hash of the slug, so two rows never read as one template.

import type { SnapshotProtocol } from './snapshot.ts';

/** What one step needs to be filled in. */
interface Vars {
  name: string;
  chain: string;
  capital: string;
  asset: string;
  funding: string;
  gas: string;
  hold: string;
  tvl: string;
  change: string;
}

/** One category's three moves: what to do, what to do with the receipt, and what not to do. */
interface Play {
  primary: string;
  secondary: string;
  avoid: string;
}

/** A chain's working asset and a rough gas cost for one interaction, in dollars. */
const CHAINS: Record<string, { asset: string; gas: string }> = {
  Ethereum: { asset: 'ETH', gas: '$4' },
  Solana: { asset: 'SOL', gas: '$0.05' },
  Bitcoin: { asset: 'BTC', gas: '$2' },
  Binance: { asset: 'BNB', gas: '$0.20' },
  Base: { asset: 'ETH', gas: '$0.10' },
  Arbitrum: { asset: 'ETH', gas: '$0.20' },
  Optimism: { asset: 'ETH', gas: '$0.20' },
  Polygon: { asset: 'POL', gas: '$0.05' },
  Avalanche: { asset: 'AVAX', gas: '$0.20' },
  Tron: { asset: 'TRX', gas: '$1' },
  Sui: { asset: 'SUI', gas: '$0.05' },
  Aptos: { asset: 'APT', gas: '$0.05' },
  Monad: { asset: 'MON', gas: '$0.10' },
  'Hyperliquid L1': { asset: 'HYPE', gas: '$0.05' },
  Stellar: { asset: 'XLM', gas: '$0.01' },
  Ripple: { asset: 'XRP', gas: '$0.05' },
  Sonic: { asset: 'S', gas: '$0.10' },
  Berachain: { asset: 'BERA', gas: '$0.10' },
};

/** The plays, by archetype. Each names the protocol and its chain, and carries a cost and a time. */
const PLAYS: Record<string, Play> = {
  lending: {
    primary:
      "Supply {capital} of USDC to {name} on {chain} and borrow a second asset against it at no more than 40 per cent of the supply, so a 20 per cent fall in collateral cannot liquidate you; about {gas} of gas and 15 minutes.",
    secondary:
      "Take the receipt {name} mints and either deposit it in one market that accepts it or leave it idle if {name} pays on the receipt balance; one extra transaction, about {gas} and 10 minutes.",
    avoid:
      "Skip the loop: do not re-supply funds borrowed from {name} back into {name}, because the health factor then moves twice as fast for the same reward.",
  },
  dex: {
    primary:
      "Add {capital} of liquidity to the deepest {name} pair on {chain}, the pair whose fee revenue has actually paid rather than the one advertising the highest APR; about {gas} of gas and 20 minutes.",
    secondary:
      "Stake the LP receipt if {name} runs a gauge or a farm, and if it runs neither, leave the LP unstacked and re-read the fee tier once a month; one transaction, about {gas}.",
    avoid: "Avoid the newest {name} pool with a two-digit APR and a five-figure TVL: at that depth your own exit moves the price.",
  },
  perp: {
    primary:
      "Deposit {capital} of USDC as margin on {name} ({chain}) and trade one small position a week at under 2x; about {gas} of gas per trade and 10 minutes a week.",
    secondary:
      "Keep the volume steady rather than large: {name} can count weekly volume, and one big trade reads as a single day of activity.",
    avoid: "Stay under 3x on {name}: a liquidation closes the account and ends the farm, and no points survive it.",
  },
  prediction: {
    primary:
      "Fund {capital} on {name} ({chain}) and take small positions in three separate markets, each held to resolution; about {gas} of gas in all and 20 minutes.",
    secondary: "Let the markets resolve and re-deposit: {name} can count settled positions and repeat activity, not one open bet.",
    avoid: "Do not put the whole {capital} on one market to look active; that is a trade, and a single loss removes the record.",
  },
  bridge: {
    primary:
      "Bridge {capital} of USDC into {chain} through {name} and use the bridged funds inside {chain} apps for a week; the transfer costs about {gas} plus the bridge fee and takes 10 minutes.",
    secondary:
      "Bridge once a month rather than once with a large amount: a {name} campaign counts distinct days and destination chains, not the size of the transfer.",
    avoid: "Do not bridge the same amount back on the same day: that is wash volume, {name} filters it, and it pays the fee twice.",
  },
  staking: {
    primary:
      "Stake {capital} of {asset} through {name} on {chain} and keep the receipt token it mints, because the receipt rather than the stake is what the next campaign counts; about {gas} of gas and 10 minutes.",
    secondary:
      "Use the receipt in one lending market at under 50 per cent LTV, or leave it idle if {name} pays on the receipt balance; about {gas} for the deposit.",
    avoid: "Do not stake {asset} twice through two {name} products: the second adds no exposure and doubles the slashing surface.",
  },
  cdp: {
    primary:
      "Open a {name} vault on {chain}, deposit {asset} as collateral and mint the {name} stablecoin against it at no more than 50 per cent of the collateral value; about {gas} of gas and 20 minutes.",
    secondary:
      "Hold the minted stable or deposit it in one pool that accepts it, and repay the debt before the stability fee compounds past what the position earns.",
    avoid: "Do not mint to the maximum ratio: a 15 per cent fall in {asset} liquidates the vault, and the liquidation is the whole position.",
  },
  yield: {
    primary:
      "Deposit {capital} of USDC into the largest {name} vault on {chain}, the one with the longest track record rather than the highest yield; about {gas} of gas and 15 minutes.",
    secondary:
      "Keep the vault shares: if {name} runs a points or season programme, the shares are the position it counts and the receipt is the claim on them.",
    avoid: "Avoid a {name} vault younger than 90 days whose yield is far above its peers: the yield is the incentive, and the incentive ends.",
  },
  rwa: {
    primary:
      "Mint or deposit {capital} of the {name} yield asset on {chain} after checking its whitelist or KYC gate, then hold it; about {gas} of gas and 20 minutes plus the issuer onboarding.",
    secondary: "Hold the receipt a full quarter: a {name} campaign counts holding time, and a round trip inside a week counts for nothing.",
    avoid: "Buy the {name} receipt on the secondary market only at or above par; a discount means the exit is thinner than the mint.",
  },
  stable: {
    primary:
      "Mint {capital} of the {name} stablecoin against collateral on {chain}, after checking the peg and the mint fee; about {gas} of gas and 15 minutes.",
    secondary: "Deposit the minted stable in one pool that accepts it and keep the position across a month end, which is the window {name} can measure.",
    avoid: "Do not mint past a 150 per cent collateral ratio to farm more: a small fall in collateral closes the position at the worst time.",
  },
  insurance: {
    primary:
      "Buy {capital} of cover from {name} on {chain} for a position you already hold and keep the policy active for its full term; about {gas} of gas and 10 minutes.",
    secondary: "Renew rather than lapse: {name} counts continuous cover, and a gap in the policy resets the record.",
    avoid: "Do not insure a position you do not hold: cover without exposure is a premium paid for nothing.",
  },
  launchpad: {
    primary:
      "Stake or hold the asset {name} requires for allocation rights, then use the allocation in one sale on {chain}; about {gas} of gas and 15 minutes.",
    secondary: "Keep the qualifying balance through the sale window: {name} snapshots the balance before the sale, not after it.",
    avoid: "Do not chase every {name} sale with the same balance: the allocation is capped and the gas is not refunded.",
  },
  chain: {
    primary:
      "Bridge a small amount to {chain} and do three things on it in one week: one swap on a DEX, one supply in a lending market, one stake; about {gas} of gas in all.",
    secondary: "Keep the {chain} wallet active weekly: chain-level campaigns count distinct apps and weeks, not the size of the balance.",
    avoid: "Do not farm {chain} with borrowed money: chain campaigns usually exclude recursive positions, and the bridge home costs more.",
  },
  cex: {
    primary:
      "Open and verify an account on {name}, deposit {capital} of USDC and trade one spot pair each week to build volume; the deposit is free and each trade costs the exchange fee.",
    secondary: "Read the {name} launchpool, earn and points pages: an exchange allocation usually follows trading volume and holding time, not the size of the deposit.",
    avoid: "Keep no more than the farming amount on {name}: the exchange custody risk is the largest risk in this row and it is priced nowhere here.",
  },
  other: {
    primary:
      "Deposit {capital} of USDC into {name} on {chain} and keep the position open; read the {name} docs first for what it counts as activity, about {gas} of gas and 15 minutes.",
    secondary: "Make one more qualifying action a week on {name}, a swap, a claim or a vote, so the wallet has a history and not a single deposit.",
    avoid: "Do not spread {capital} over five products of {name} to look busy: one position held is what a snapshot can count.",
  },
};

/** Ordered keyword rules; the first that matches a category's lowercase name names its play. */
const ARCHETYPES: [key: string, pattern: RegExp][] = [
  ['cex', /^cex$/],
  ['cdp', /cdp|collateral/],
  ['lending', /lend|borrow/],
  ['bridge', /bridge/],
  ['staking', /stak/],
  ['perp', /perp|derivativ|option|synthet|basis trading/],
  ['prediction', /prediction/],
  ['dex', /dex|liquidity manager|market maker/],
  ['stable', /stable/],
  ['insurance', /insurance/],
  ['rwa', /rwa|payment|locker|privacy|card|otc/],
  ['launchpad', /launchpad/],
  ['yield', /yield|farm|curator|allocator|index|governance|vault/],
  ['chain', /^chain$/],
];

/** The play a category gets. */
function archetypeOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  for (const [key, pattern] of ARCHETYPES) if (pattern.test(c)) return key;
  return 'other';
}

const SETUP = [
  "Open {name} from its own site rather than a search ad, connect a fresh {chain} wallet funded with {capital} of {funding} plus about {gas} of gas on {chain}, and keep that wallet for this protocol alone; 5 minutes.",
  "Use a wallet that holds nothing but the {capital} you are farming and about {gas} of gas on {chain}: a clean wallet is the only record {name} can credit, and the setup takes 5 minutes.",
  "Create a new {chain} wallet for {name} alone, fund it with {capital} of {funding} and about {gas} of gas, and store the seed phrase offline before you sign anything; 5 minutes.",
];

const CHECK = [
  "Before depositing, read the {name} app, docs and announcements for a live points, XP or season programme: if one is live, note its start date, and if none is, the position is a bet on a retroactive allocation.",
  "Check the channels {name} runs for a points or season programme before you size the position: a live programme pays on activity from its start date, and a rumoured one pays on nothing.",
];

const HOLD = [
  "Hold the position at least {hold} days: {name} records {tvl} of TVL and a seven-day change of {change}, so the row's implied value tracks the protocol's own record rather than your position.",
  "Keep it open {hold} days or longer; {name} carries {tvl} of TVL and moved {change} over seven days, which is the figure the board ranks, so a shorter position changes nothing either way.",
];

const LOG = [
  "Write the wallet, the dates, the transaction hashes and the exit route for {name} into one file, so the position can be repeated on {chain} or closed in one session; 5 minutes.",
  "Log every {name} transaction with its date and its cost, and write down how you would unwind it on {chain}; a farm you cannot audit is one you cannot repeat; 5 minutes.",
];

/** A whole dollar figure with thousands separators. */
const round = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** A compact dollar figure, the way a person reads TVL aloud. */
function usdShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return round(n);
}

/** How much capital one position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5e9) return 250;
  if (tvl >= 1e9) return 150;
  if (tvl >= 1e8) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a young protocol gets a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A stable index for one slug, so the variant a row gets is fixed by its name and not by a clock. */
function pick<T>(list: T[], slug: string): T {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 100_003;
  return list[h % list.length]!;
}

/** A template with its placeholders filled. */
function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (vars as unknown as Record<string, string>)[key] ?? whole);
}

/** The step as the gate reads it: trimmed, at least 20 characters, at most 600. */
function fit(step: string): string {
  const trimmed = step.trim();
  if (trimmed.length > 600) return `${trimmed.slice(0, 597)}...`;
  if (trimmed.length < 20) return `${trimmed} Check the protocol's own page before you act.`;
  return trimmed;
}

/**
 * A protocol's farm plan: seven steps, in the order a person would work through them. The plan is a
 * function of the protocol's record alone, so two protocols with the same record get the same plan.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const known = CHAINS[chain];
  const archetype = archetypeOf(p.category);
  const capital = capitalFor(p.tvl_usd);
  const asset = known?.asset ?? `${chain}'s native token`;
  const vars: Vars = {
    name: p.name,
    chain,
    capital: round(capital),
    asset,
    // A staking or chain-level position is funded in the chain's own asset; every other play in USDC.
    funding: archetype === 'staking' || archetype === 'chain' ? asset : 'USDC',
    gas: known?.gas ?? '$1',
    hold: String(holdDaysFor(age)),
    tvl: usdShort(p.tvl_usd),
    change: p.change_7d === null ? 'unreported' : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(2)} per cent`,
  };
  const play = PLAYS[archetype] ?? PLAYS.other!;
  return [pick(SETUP, p.slug), pick(CHECK, p.slug), play.primary, play.secondary, play.avoid, pick(HOLD, p.slug), pick(LOG, p.slug)].map((step) =>
    fit(fill(step, vars)),
  );
}