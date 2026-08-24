import { describe, expect, it } from 'vitest';
import { buildTradesCsv, bestRecommendedSetup } from '../src/lib/analytics';
import type { Trade } from '../src/lib/types';

function trade(over: Partial<Trade>): Trade {
  return {
    id: 't', createdAt: '2026-08-01T10:00:00Z', timezone: 'America/New_York', tradeDate: '2026-08-01',
    symbol: 'SPY', marketExcitement: 'up', fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true,
    emaCrossed: true, withinPortfolioRiskLimit: true, buyingType: 'call', contractCount: 1,
    purchasePrice: 10, sellingPrice: 11, fees: 0, status: 'closed', ...over,
  };
}

describe('buildTradesCsv', () => {
  it('includes header row and a data row', () => {
    const csv = buildTradesCsv([trade({})]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('symbol');
    expect(lines[0]).toContain('netPL');
    expect(lines[1]).toContain('SPY');
  });
  it('escapes commas and quotes in notes', () => {
    const csv = buildTradesCsv([trade({ notes: 'hello, "world"' })]);
    expect(csv).toContain('"hello, ""world"""');
  });
});

describe('bestRecommendedSetup', () => {
  it('returns a recommended setup when a minimum sample exists', () => {
    const trades = Array.from({ length: 4 }, () => trade({ fifteenMinutesPassed: true, emaCrossed: true, sellingPrice: 12 }));
    const best = bestRecommendedSetup(trades);
    expect(best).not.toBeNull();
    expect(best!.sampleSize).toBeGreaterThanOrEqual(3);
    expect(best!.winRate).toBeGreaterThan(0);
  });
  it('returns null when not enough trades', () => {
    expect(bestRecommendedSetup([])).toBeNull();
    expect(bestRecommendedSetup([trade({})])).toBeNull();
  });
});