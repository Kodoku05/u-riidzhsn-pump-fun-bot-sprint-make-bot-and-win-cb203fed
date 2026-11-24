import type { Bot, BotState, Batch, OrderInput } from './vendor/makefun-bot.ts';

/** All money is lamports, all ratios integer basis points, time is replay slots. */
export interface Params {
  window: number; age: number; buyers: number; buys: number;
  net: bigint; minReserve: bigint; maxReserve: bigint;
  rise: bigint; chase: bigint; dominance: bigint;
  stake: bigint; minOrder: bigint; exposure: bigint;
  profit: bigint; stop: bigint; trail: bigint; arm: bigint;
  hold: number; cooldown: number; entries: number; slip: number;
  breakout: bigint; tradeSlots: number;
}

export const DEFAULT_PARAMS: Params = {
  window: 50, age: 500, buyers: 5, buys: 5,
  net: 1_000_000_000n, minReserve: 3_000_000_000n, maxReserve: 65_000_000_000n,
  rise: 400n, chase: 6000n, dominance: 7500n,
  stake: 150_000_000n, minOrder: 20_000_000n, exposure: 2_500_000_000n,
  profit: 2000n, stop: 1000n, trail: 1000n, arm: 800n,
  hold: 250, cooldown: 50, entries: 10, slip: 500,
  breakout: 10000n, tradeSlots: 4,
};

const B = 10_000n;
const Q = 1_000_000_000_000_000_000n;
const smaller = (a: bigint, b: bigint) => a < b ? a : b;
const fee = (q: bigint, bps: bigint) => (q * bps + B - 1n) / B;
interface Tick { slot: number; price: bigint; amount: bigint; buy: boolean; user: string }
interface Tape { ticks: Tick[]; born: number; attempts: number; retry: number; fees: bigint; high: bigint }
interface Trade { opened: number; peak: bigint; exiting: boolean }

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<string, Tape>();
  const trades = new Map<string, Trade>();
  let stopped = false;
  let fallback = 125n;
  const tape = (mint: string): Tape => {
    let t = tapes.get(mint);
    if (!t) {
      t = { ticks: [], born: -1, attempts: 0, retry: -1, fees: fallback, high: 0n };
      tapes.set(mint, t);
    }
    return t;
  };

  return {
    onHello(state) {
      fallback = BigInt(state.hello.fees.protocol_bps_fallback + state.hello.fees.creator_bps_fallback);
    },
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      if (stopped) return [];
      const now = batch.slot;
      const active = new Set<string>();
      for (const e of batch.events) {
        const t = tape(e.mint);
        if (e.event === 'CreateEvent') {
          t.born = e.slot;
          t.fees = BigInt(e.creator_fee_bps) + BigInt(state.hello.fees.protocol_bps_fallback);
        } else if (e.event === 'TradeEvent') {
          const vt = BigInt(e.virtual_token_reserves);
          if (vt === 0n) continue;
          const price = BigInt(e.virtual_quote_reserves) * Q / vt;
          if (price > t.high) t.high = price;
          t.ticks.push({ slot: e.slot, price,
            amount: BigInt(e.quote_amount), buy: e.is_buy, user: e.user });
          t.fees = BigInt(e.fee_basis_points) > 0n
            ? BigInt(e.fee_basis_points) + BigInt(e.creator_fee_basis_points) : fallback;
          active.add(e.mint);
          // Keep one observation just before the rolling window as its opening price.
          let cut = 0;
          while (cut + 1 < t.ticks.length && t.ticks[cut + 1].slot <= now - p.window) cut++;
          if (cut) t.ticks.splice(0, cut);
        }
      }
      const pending = new Set<string>();
      let exposure = 0n;
      for (const h of state.positions.values()) exposure += h.cost_lamports;
      for (const x of state.pending.values()) {
        pending.add(x.order.mint);
        if (x.order.side === 'buy') exposure += BigInt(x.order.quote_lamports);
      }
      const orders: OrderInput[] = [];
      const limit = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();
      let cash = state.freeCashLamports();

      for (const [mint, h] of trades) {
        const pos = state.positions.get(mint);
        if (!pos) {
          if (!pending.has(mint)) { trades.delete(mint); tape(mint).retry = now + p.cooldown; }
          continue;
        }
        const c = state.curves.get(mint);
        if (!c || c.complete || pending.has(mint) || orders.length >= limit) continue;
        const gross = smaller(pos.token_amount * c.virtual_quote_reserves /
          (c.virtual_token_reserves + pos.token_amount), c.real_quote_reserves);
        const value = gross - fee(gross, tape(mint).fees) - tx;
        const cost = pos.cost_lamports;
        const ratio = cost > 0n ? value * B / cost : 0n;
        if (ratio > h.peak) h.peak = ratio;
        if (value * B >= cost * (B + p.profit) || value * B <= cost * (B - p.stop)
          || (h.peak >= B + p.arm && ratio * B <= h.peak * (B - p.trail))
          || now - h.opened >= p.hold) h.exiting = true;
        if (h.exiting && cash >= tx) {
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 2000 });
          cash -= tx;
        }
      }

      let available = state.hello.caps.max_open_positions - state.committedPositionCount();
      const candidates: { mint: string; strength: bigint }[] = [];
      for (const mint of active) {
        if (pending.has(mint) || state.positions.has(mint) || trades.has(mint)) continue;
        const t = tape(mint), c = state.curves.get(mint);
        if (!c || c.complete || t.born < 0 || now - t.born < p.age || now < t.retry
          || t.attempts >= p.entries || t.fees > 150n
          || c.real_quote_reserves < p.minReserve || c.real_quote_reserves > p.maxReserve) continue;
        const xs = t.ticks;
        if (xs.length < 2) continue;
        let net = 0n, bought = 0n, count = 0;
        const wallets = new Map<string, bigint>();
        const slots = new Set<number>();
        for (const x of xs) {
          if (x.slot <= now - p.window) continue;
          net += x.buy ? x.amount : -x.amount;
          if (x.buy) { count++; slots.add(x.slot); bought += x.amount; wallets.set(x.user, (wallets.get(x.user) ?? 0n) + x.amount); }
        }
        const last = xs[xs.length - 1];
        const open = xs[0].price;
        if (!last.buy || count < p.buys || wallets.size < p.buyers || net < p.net || open <= 0n
          || slots.size < p.tradeSlots || last.price * B < t.high * p.breakout) continue;
        const relative = last.price * B / open;
        if (relative < B + p.rise || relative > B + p.chase) continue;
        let top = 0n;
        for (const amount of wallets.values()) if (amount > top) top = amount;
        if (top * B > bought * p.dominance) continue;
        candidates.push({ mint, strength: net });
      }
      candidates.sort((a, b) => a.strength > b.strength ? -1 : a.strength < b.strength ? 1
        : a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0);
      for (const { mint } of candidates) {
        if (available <= 0 || orders.length >= limit) break;
        // Marks include our impact, while a delivered trade may refresh public reserves.
        // Leave room below the shared decision-time cap rather than repeatedly rejecting.
        const amount = smaller(smaller(p.stake, state.maxBuyLamports(mint) * 9500n / B),
          smaller(p.exposure - exposure, cash - tx));
        if (amount < p.minOrder) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.slip });
        trades.set(mint, { opened: now, peak: 0n, exiting: false });
        tape(mint).attempts++;
        exposure += amount; cash -= amount + tx; available--;
      }
      return orders;
    },
    onDone() { stopped = true; },
  };
}
