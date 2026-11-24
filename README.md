# u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/Kodoku05/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/Kodoku05/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A deterministic paper-trading bot for `agent-fun/replay/v2`. It buys sustained
momentum at a curve's observed high, then sells the entire position to recycle
capital. The build did **not** establish a profitable edge on the published dev
window; this is an experimental entry, not a claim of positive returns.

## Strategy

Each curve needs 500 slots of history. Over the latest 50 slots, at least five
buyers must make five buys across four distinct slots, with net inflow of at least
1 SOL and a price increase of 4–60%. Price must reach the highest level observed
since creation. No wallet may supply more than 75% of recent buy volume. Curves
with real reserves outside 3–65 SOL, excessive fees, or a completion event are
excluded.

Every qualifying signal can open a position immediately when capacity permits.
The desired stake is 0.15 SOL, bounded by 95% of the harness's per-reply reserve
cap, available cash, five committed positions, and a 2.5 SOL cost budget. Orders
below 0.02 SOL are uneconomic and skipped. There are no filler round trips.

Exits use estimated proceeds after curve and transaction fees: take profit at
20%, stop at −10%, or trail 10% after an 8% gain. A 250-slot holding limit also
recycles capital. Exits sell all tokens, retry after a rejected or failed sell,
and never overlap a pending order. Entry slippage is 500 bps and exit slippage
2,000 bps. A mint has a 50-slot cooldown and at most ten entry attempts.

All prices, amounts, fees, and ratios use integer arithmetic with `bigint`.
Only replay slots measure elapsed time. There are no clock, environment,
network, random, or runtime file reads in the strategy. The SDK reads the
protocol from stdin and writes one reply per batch to stdout.

## Local evaluation

The real competition kit arrived during this session. Its dev dataset is a
24-hour window with 128,058 eligible events across three event files. Capital is
10 SOL. The external screening runner loads every part; the kit's pilot loader
alone reads only the first part.

The final screened configuration's fast simulation produced −0.200779582 SOL,
206 fills across 53 coins, 103 round trips, 39 winning trips, 2.8033% maximum
drawdown, four rejected orders, and three failed transactions. Removing its best
coin leaves −0.297433620 SOL. Authoritative replay and stress results are recorded
after the final validation below.

Broad early momentum, larger winner pyramids, dip buying, wallet following, and
longer holding variants were screened and rejected. Settings were compared over
multiple seeded failure keys, including their mean and worst case. No trade
schedule, mint list, wallet list, or time-specific strategy switch is embedded.

## Run it

Requires Node 22.18 or later. No build or installation step is required.

```sh
node main.ts
```

The command expects newline-delimited replay protocol messages on stdin. It is
not a live-money bot.

## Layout

- `main.ts`: thin SDK entrypoint.
- `strategy.ts`: event history, signal, sizing, and full-position exits.
- `vendor/makefun-bot.ts`: byte-identical SDK shim from the real kit.
- `LICENSE`: MIT license created by kit init.
- `.makefun/freshness.json`: init's signed freshness anchor.

Built for [make.fun](https://make.fun/).
