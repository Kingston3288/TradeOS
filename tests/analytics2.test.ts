import { describe, expect, it } from 'vitest';
import {
  findHighProbabilitySetups,
  computeExpectancy,
  computePositionSizing,
  breakDownBySymbol,
  breakDownByStrategy,
  recentForm,
} from '../src/lib/analytics';
import type { Trade } from '../src/lib/types';

function trade(over: Partial<Trade>): Trade {
  return {
    id: Math.random().toString(),
    createdAt: '2026-08-01T10:00:00Z',
    timezone: 'America/New_York',
    tradeDate: '2026-08-01',
    symbol: 'SPY',
    marketExcitement: 'up',
    fifteenMinutesPassed: true,
    entryRespectsFifteenMinuteHighLow: true,
    emaCrossed: true,
    withinPortfolioRiskLimit: true,
    buyingType: 'call',
    contractCount: 1,
    purchasePrice: 10,
    sellingPrice: 11, // one winning setup by default
    fees: 0,
    status: 'closed',
    ...over,
  };
}

describe('findHighProbabilitySetups', () => {
  it('ranks the winning condition basket above baseline', () => {
    const trades = [
      // 4 wins where all conditions true + 1 partial miss
      trade({ fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true, emaCrossed: true, withinPortfolioRiskLimit: true, sellingPrice: 11 }),
      trade({ fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true, emaCrossed: true, withinPortfolioRiskLimit: true, sellingPrice: 11.5 }),
      trade({ fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true, emaCrossed: true, withinPortfolioRiskLimit: true, sellingPrice: 12 }),
      trade({ fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true, emaCrossed: true, withinPortfolioRiskLimit: true, sellingPrice: 9 }), // loss
      trade({ fifteenMinutesPassed: false, entryRespectsFifteenMinuteHighLow: false, emaCrossed: false, withinPortfolioRiskLimit: false, sellingPrice: 8 }), // loss, bad setup
    ];
    const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
    expect(overallWinRate).toBe(0.6);
    // The 4-condition combo has 3/4 win rate = 0.75 and should be present
    const combo = setups.find((s) => s.conditions.length === 4);
    expect(combo).toBeDefined();
    expect(combo!.sampleSize).toBe(4);
    expect(combo!.winRate).toBeCloseTo(0.75);
    // The all-true combo ranks above the one-loss bad combo
    expect(combo!.winRate).toBeGreaterThan(overallWinRate);
  });

  it('filters out combos below min sample size', () => {
    const trades = [
      trade({}),
      trade({}),
    ];
    const { setups } = findHighProbabilitySetups(trades, 3);
    expect(setups).toHaveLength(0);
  });

  it('returns empty when no closed trades', () => {
    const { setups, overallWinRate } = findHighProbabilitySetups([trade({ status: 'open', sellingPrice: null })], 3);
    expect(setups).toHaveLength(0);
    expect(overallWinRate).toBe(0);
  });
});

describe('computeExpectancy', () => {
  it('computes expectancy, profit factor, payoff ratio', () => {
    const trades = [
      // wins: +$200, +$300 ; losses: -$100
      trade({ purchasePrice: 2, sellingPrice: 4, contractCount: 1 }), // +200
      trade({ purchasePrice: 2, sellingPrice: 5, contractCount: 1 }), // +300
      trade({ purchasePrice: 2, sellingPrice: 1, contractCount: 1 }), // -100
    ];
    const m = computeExpectancy(trades);
    expect(m.totalClosed).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3);
    expect(m.expectancy).toBeCloseTo((200 + 300 - 100) / 3);
    expect(m.profitFactor).toBeCloseTo(500 / 100);
    expect(m.payoffRatio).toBeCloseTo(250 / 100);
  });

  it('handles empty trades', () => {
    const m = computeExpectancy([]);
    expect(m.totalClosed).toBe(0);
    expect(m.expectancy).toBe(0);
    expect(m.profitFactor).toBe(0);
  });
});

describe('computePositionSizing', () => {
  it('returns no edge when win rate is poor', () => {
    const trades = [
      trade({ sellingPrice: 12 }), // win
      trade({ sellingPrice: 8 }), trade({ sellingPrice: 8 }), trade({ sellingPrice: 8 }), // 3 losses
    ];
    const s = computePositionSizing(trades, 25);
    expect(s.edgePresent).toBe(false);
  });

  it('recommends a positive risk fraction for a strong edge', () => {
    const trades = [
      trade({ sellingPrice: 12 }), trade({ sellingPrice: 12 }), trade({ sellingPrice: 12 }), trade({ sellingPrice: 12 }), trade({ sellingPrice: 12 }),
      trade({ sellingPrice: 9 }), trade({ sellingPrice: 9 }),
    ]; // 5 wins / 2 losses, payoff high
    const s = computePositionSizing(trades, 25);
    expect(s.edgePresent).toBe(true);
    expect(s.recommendedRiskPercent).toBeGreaterThan(0);
    expect(s.recommendedRiskPercent).toBeLessThanOrEqual(25);
  });
});

describe('breakDownBySymbol', () => {
  it('groups and sorts by symbol', () => {
    const trades = [
      trade({ symbol: 'SPY', sellingPrice: 11 }), trade({ symbol: 'SPY', sellingPrice: 8 }),
      trade({ symbol: 'NVDA', sellingPrice: 11 }),
    ];
    const rows = breakDownBySymbol(trades);
    expect(rows.find((r) => r.symbol === 'SPY')!.trades).toBe(2);
    expect(rows.find((r) => r.symbol === 'NVDA')!.trades).toBe(1);
    expect(rows[0]!.trades).toBeGreaterThanOrEqual(rows[1]!.trades);
  });
});

describe('breakDownByStrategy', () => {
  it('groups by strategy tag', () => {
    const trades = [
      trade({ strategyTag: 'breakout', sellingPrice: 11 }), trade({ strategyTag: 'breakout', sellingPrice: 8 }),
      trade({ strategyTag: 'trend', sellingPrice: 11 }),
    ];
    const rows = breakDownByStrategy(trades);
    expect(rows.find((r) => r.tag === 'breakout')!.trades).toBe(2);
    expect(rows.find((r) => r.tag === 'trend')!.trades).toBe(1);
  });
});

describe('recentForm', () => {
  it('computes recent vs overall win rate', () => {
    const trades = [
      trade({ sellingPrice: 10, id: 'old' }), trade({ sellingPrice: 10, id: 'old2' }), // 0% (both breakeven-ish: price equal => breakeven)
      trade({ sellingPrice: 11 }), trade({ sellingPrice: 11 }), // 2 wins
    ];
    const r = recentForm(trades, 20);
    expect(r.recentCount).toBe(4);
    expect(r.recentWinRate).toBeCloseTo(0.5);
  });
});