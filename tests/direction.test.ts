import { describe, expect, it } from 'vitest';
import { daysHeld, winRateByDirection, winRateByMarketCombo, VWAP_LABELS, MACD_LABELS } from '../src/lib/analytics';
import type { Trade } from '../src/lib/types';

function trade(over: Partial<Trade>): Trade {
  return {
      id: 't', createdAt: '2026-08-01T10:00:00Z', timezone: 'America/New_York', tradeDate: '2026-08-01',
      symbol: 'SPY', marketExcitement: 'up', fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true,
      emaCrossed: true, withinPortfolioRiskLimit: true, buyingType: 'call', contractCount: 1,
      purchasePrice: 10, sellingPrice: 11, fees: 0, status: 'closed',
    ...over,
  };
}

describe('winRateByDirection (VWAP / MACD)', () => {
  it('buckets VWAP direction with win/loss rates', () => {
    const trades = [
      trade({ vwapDirection: 'up', sellingPrice: 12 }),
      trade({ vwapDirection: 'up', sellingPrice: 11.5 }),
      trade({ vwapDirection: 'down', sellingPrice: 8 }),
      trade({ vwapDirection: 'down', sellingPrice: 8 }),
    ];
    const rows = winRateByDirection(trades, 'vwapDirection', VWAP_LABELS);
    // up: 2/2 win -> 1.0; down: 0/2 -> 0.0; sorted desc => up first
    expect(rows[0]!.value).toBe('up');
    expect(rows[0]!.winRate).toBeCloseTo(1);
    expect(rows[0]!.trades).toBe(2);
    const d = rows.find((r) => r.value === 'down');
    expect(d!.winRate).toBeCloseTo(0);
    expect(d!.lossRate).toBeCloseTo(1);
  });
  it('buckets MACD trend raising/falling', () => {
    const trades = [
      trade({ macdTrend: 'rising', sellingPrice: 12 }),
      trade({ macdTrend: 'falling', sellingPrice: 8 }),
    ];
    const rows = winRateByDirection(trades, 'macdTrend', MACD_LABELS);
    expect(rows).toHaveLength(2);
    const r = rows.find((x) => x.value === 'rising');
    expect(r!.winRate).toBeCloseTo(1);
  });
  it('ignores trades with no direction set', () => {
    expect(winRateByDirection([trade({})], 'vwapDirection', VWAP_LABELS)).toHaveLength(0);
  });
});

describe('daysHeld', () => {
  it('returns whole days held (0 if under 1 day)', () => {
    const day = 86400000;
    expect(daysHeld(trade({ createdAt: '2026-08-20T10:00:00Z', closedAt: '2026-08-20T11:00:00Z' }))).toBe(0);
    expect(daysHeld(trade({ createdAt: '2026-08-20T10:00:00Z', closedAt: '2026-08-22T10:00:00Z' }))).toBe(2);
    expect(daysHeld(trade({ createdAt: '2026-08-20T10:00:00Z', closedAt: '2026-08-21T11:00:00Z' }))).toBe(1);
  });
  it('returns 0 when closedAt is missing', () => {
    expect(daysHeld(trade({ createdAt: '2026-08-20T10:00:00Z' }))).toBe(0); // no closedAt
  });
});

describe('winRateByMarketCombo', () => {
  it('buckets by Market x VWAP x MACD x Type and ranks best first', () => {
    const trades = [
      trade({ marketExcitement: 'up', vwapDirection: 'up', macdTrend: 'rising', buyingType: 'call', sellingPrice: 12 }),
      trade({ marketExcitement: 'up', vwapDirection: 'up', macdTrend: 'rising', buyingType: 'call', sellingPrice: 11.5 }),
      trade({ marketExcitement: 'up', vwapDirection: 'up', macdTrend: 'rising', buyingType: 'call', sellingPrice: 8 }),
      trade({ marketExcitement: 'down', vwapDirection: 'down', macdTrend: 'falling', buyingType: 'put', sellingPrice: 8 }),
    ];
    const rows = winRateByMarketCombo(trades);
    expect(rows.length).toBe(2);
    const top = rows[0]!;
    expect(top.label).toContain('Up');
    expect(top.label).toContain('Call');
    expect(top.winRate).toBeCloseTo(2 / 3);
    expect(top.trades).toBe(3);
    // sorted desc by win rate -> up/call (67%) before down/put (0%)
    expect(rows[1]!.winRate).toBeCloseTo(0);
  });
  it('handles missing direction with placeholder and still buckets by what exists', () => {
    const rows = winRateByMarketCombo([trade({})]); // market=up, type=call, vwap/macd missing
    expect(rows.length).toBe(1);
    expect(rows[0]!.label).toContain('—'); // placeholder for missing VWAP/MACD
  });
});