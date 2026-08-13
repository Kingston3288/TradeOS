import { describe, expect, it } from 'vitest';
import {
  analyzeCondition,
  buildDashboardStats,
  calculateTradeFinancials,
  getBestAndWorstPatterns,
} from '../src/lib/analytics';
import { Trade } from '../src/lib/types';

const baseTrade: Trade = {
  id: 'base',
  createdAt: '2026-08-13T10:00:00-04:00',
  timezone: 'America/New_York',
  tradeDate: '2026-08-13',
  symbol: 'SPY',
  marketExcitement: 'up',
  fifteenMinutesPassed: true,
  entryRespectsFifteenMinuteHighLow: true,
  emaCrossed: true,
  withinPortfolioRiskLimit: true,
  buyingType: 'call',
  contractCount: 2,
  purchasePrice: 1.5,
  sellingPrice: 2,
  fees: 0,
  status: 'closed',
  notes: '',
  screenshotUrls: [],
};

const trade = (overrides: Partial<Trade>): Trade => ({ ...baseTrade, ...overrides });

describe('calculateTradeFinancials', () => {
  it('calculates options gross/net profit and percentage with 100x multiplier', () => {
    expect(calculateTradeFinancials(baseTrade)).toEqual({
      status: 'closed',
      grossProfitLoss: 100,
      netProfitLoss: 100,
      profitLossPercentage: 33.33333333333333,
      result: 'gain',
    });
  });

  it('keeps trades open and excludes win/loss numbers when selling price is blank', () => {
    expect(calculateTradeFinancials(trade({ sellingPrice: null, status: 'open' }))).toEqual({
      status: 'open',
      grossProfitLoss: null,
      netProfitLoss: null,
      profitLossPercentage: null,
      result: 'open',
    });
  });

  it('subtracts fees and classifies loss or breakeven from net P/L', () => {
    expect(calculateTradeFinancials(trade({ sellingPrice: 1.25, fees: 20 })).result).toBe('loss');
    expect(calculateTradeFinancials(trade({ sellingPrice: 1.5, fees: 0 })).result).toBe('breakeven');
  });
});

describe('analyzeCondition', () => {
  const trades = [
    trade({ id: '1', emaCrossed: true, sellingPrice: 2 }),
    trade({ id: '2', emaCrossed: true, sellingPrice: 2.1 }),
    trade({ id: '3', emaCrossed: false, sellingPrice: 1 }),
    trade({ id: '4', emaCrossed: false, sellingPrice: null, status: 'open' }),
  ];

  it('calculates true/false win rates, average P/L, win lift, and sample sizes using closed trades only', () => {
    const result = analyzeCondition(trades, 'emaCrossed', 'EMA crossed');
    expect(result).toMatchObject({
      label: 'EMA crossed',
      trueSampleSize: 2,
      falseSampleSize: 1,
      trueWinRate: 1,
      falseWinRate: 0,
    });
    expect(result.baselineWinRate).toBeCloseTo(2 / 3);
    expect(result.winLift).toBeCloseTo(1 / 3);
  });
});

describe('dashboard and setup patterns', () => {
  const trades = [
    trade({ id: '1', tradeDate: '2026-08-13', sellingPrice: 2, fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true, emaCrossed: true }),
    trade({ id: '2', tradeDate: '2026-08-13', sellingPrice: 1, fifteenMinutesPassed: false, entryRespectsFifteenMinuteHighLow: false, emaCrossed: false }),
    trade({ id: '3', tradeDate: '2026-08-12', sellingPrice: 1.75, buyingType: 'put', marketExcitement: 'down' }),
  ];

  it('builds dashboard stats for P/L, wins/losses, averages, and rule discipline', () => {
    const stats = buildDashboardStats(trades, '2026-08-13');
    expect(stats.daily.netProfitLoss).toBe(0);
    expect(stats.weekly.totalTrades).toBe(3);
    expect(stats.totalWins).toBe(2);
    expect(stats.totalLosses).toBe(1);
    expect(stats.winRate).toBe(2 / 3);
    expect(stats.averageWinningTrade).toBeGreaterThan(0);
    expect(stats.averageLosingTrade).toBeLessThan(0);
    expect(stats.ruleDisciplineScore).toBeGreaterThan(0);
  });

  it('highlights best and worst condition combinations with sample sizes', () => {
    const patterns = getBestAndWorstPatterns(trades);
    expect(patterns.best?.sampleSize).toBeGreaterThan(0);
    expect(patterns.worst?.sampleSize).toBeGreaterThan(0);
  });
});
