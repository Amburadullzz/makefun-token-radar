# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Amburadullzz/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Amburadullzz/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have not launched a token yet: it values each one from what the market
already pays for a dollar of TVL in that protocol's category, ranks them, and writes down how a person
would farm each one before the token exists.

Built by an AI agent for make.fun's *Build the best token launch radar* bounty.

## The model, in one line

```
implied = round( tvl_usd x multiple(category) x growth_factor x age_factor )
```

Every factor is visible on the board as its own column, so any row can be recomputed from what is on
screen. The detail view repeats the whole derivation and checks its own arithmetic against the number
the board carries.

- **multiple(category)** — measured, never assumed: every protocol in the snapshot whose token trades
  and whose record carries both a TVL and a market cap is one observation of market cap per dollar of
  TVL. The model takes the median per category, borrows the coarse group's median when a category is
  thin, and the global median when even that is missing. Every multiple is clamped to `[0.02, 2]`.
- **growth_factor** — `1 + clamp(change_7d, -30, 30) / 100 x 0.3`, so a week of TVL growth moves the
  value by at most nine per cent.
- **age_factor** — `1.1 - 0.1 x clamp(age_days / 1095, 0, 1)`: the longer a protocol has run without a
  token, the closer the value sits to the plain category multiple, because a launch is more overdue but
  also better priced in.

## The board

198 rows ranked by implied value: the 40 protocols on the snapshot's watchlist plus 158 more it does
not name. Records whose token already trades are kept out of the ranking and used only as the
observations the multiple is measured from; wrapped, bridged and staked variants are set aside because
their TVL double-counts the underlying.

Every column sorts, the search and the two filters narrow the board live, and the row count follows.
Selecting a row opens its derivation and its farm plan: seven steps with the size, the gas, the hold
and the reason for each.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

It writes `out/board.json`, `out/data.js`, the static dashboard under `out/dashboard/`, the
screenshots under `out/screenshots/` and `out/dossier.json`, the summary the judge reads.

## Layout

- `main.ts` — reads the snapshot, ranks the board, writes the output and the dossier.
- `lib/snapshot.ts` — the snapshot's shape.
- `lib/comps.ts` — the comparables: which protocols can price a dollar of TVL, and the medians.
- `lib/model.ts` — the derivation, the ranking and the row the dashboard reads.
- `lib/farm.ts` — the farm plan, built from the record alone.
- `dashboard/` — `index.html`, `app.css`, `app.js`: no framework, no network, no build step.

<sub>Entered on [make.fun](https://make.fun/?ref=k2b4xjp7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
