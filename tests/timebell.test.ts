import { describe, expect, it } from 'vitest';
import { analyzeAllConditions, parseTradeTimeToHour, rankCombosByWinRate, winRateByTimeOfDay, winRateByWeekday } from '../src/lib/analytics';
import type { Trade } from '../src/lib/types';

function trade(over: Partial<Trade>): Trade {
  return {
    id: 't', createdAt: '2026-08-01T10:00:00Z', timezone: 'America/New_York', tradeDate: '2026-08-01',
    symbol: 'SPY', marketExcitement: 'up', fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true,
    emaCrossed: true, withinPortfolioRiskLimit: true, buyingType: 'call', contractCount: 1,
    purchasePrice: 10, sellingPrice: 11, fees: 0, status: 'closed', ...over,
  };
}

describe('closingBell condition', () => {
  it('is included in condition analysis', () => {
    // 2 wins at closing bell, 1 loss not at closing bell
    const trades = [
      trade({ closingBell: true, sellingPrice: 12 }),
      trade({ closingBell: true, sellingPrice: 11.5 }),
      trade({ closingBell: false, sellingPrice: 8 }),
    ];
    const analyses = analyzeAllConditions(trades);
    const bell = analyses.find((a) => a.key === 'closingBell');
    expect(bell).toBeDefined();
    expect(bell!.label).toContain('Closing bell');
    // true (closing bell) win rate should be 100% (2/2)
    expect(bell!.trueWinRate).toBeCloseTo(1);
    expect(bell!.trueSampleSize).toBe(2);
  });
});

describe('winRateByTimeOfDay', () => {
  it('buckets closed trades by logged hour and computes win rate', () => {
    const trades = [
      trade({ tradeTime: '09:30', sellingPrice: 12 }), // 9am win
      trade({ tradeTime: '09:45', sellingPrice: 8 }),  // 9am loss
      trade({ tradeTime: '15:45', sellingPrice: 12 }), // 3pm win
      trade({ tradeTime: '15:50', sellingPrice: 12 }), // 3pm win
    ];
    const rows = winRateByTimeOfDay(trades);
    expect(rows).toHaveLength(2);
    const r9 = rows.find((r) => r.hour === 9);
    const r15 = rows.find((r) => r.hour === 15);
    expect(r9!.trades).toBe(2);
    expect(r9!.winRate).toBeCloseTo(0.5);
    expect(r15!.trades).toBe(2);
    expect(r15!.winRate).toBeCloseTo(1);
  });
  it('ignores trades without a time', () => {
    const rows = winRateByTimeOfDay([trade({})]);
    expect(rows).toHaveLength(0);
  });
});

describe('parseTradeTimeToHour', () => {
  it('parses 12h AM/PM and 24h formats', () => {
    expect(parseTradeTimeToHour('3:45 PM')).toBe(15);
    expect(parseTradeTimeToHour('9:30 AM')).toBe(9);
    expect(parseTradeTimeToHour('12:00 PM')).toBe(12);
    expect(parseTradeTimeToHour('12:15 AM')).toBe(0);
    expect(parseTradeTimeToHour('15:45')).toBe(15);
    expect(parseTradeTimeToHour('09:05')).toBe(9);
    expect(parseTradeTimeToHour('3:45pm')).toBe(15);
  });
  it('returns -1 for invalid', () => {
    expect(parseTradeTimeToHour(undefined)).toBe(-1);
    expect(parseTradeTimeToHour('bad')).toBe(-1);
    expect(parseTradeTimeToHour('25:00')).toBe(-1);
    expect(parseTradeTimeToHour('')).toBe(-1);
  });
});

describe('winRateByWeekday', () => {
  it('buckets by weekday in Mon-Fri order', () => {
    const trades = [
      trade({ weekday: 'Fri', sellingPrice: 12 }),
      trade({ weekday: 'Mon', sellingPrice: 8 }),
      trade({ weekday: 'Mon', sellingPrice: 12 }),
    ];
    const rows = winRateByWeekday(trades);
    expect(rows.map((r) => r.weekday)).toEqual(['Mon', 'Fri']);
    expect(rows[0]!.trades).toBe(2);
    expect(rows[0]!.winRate).toBeCloseTo(0.5);
    expect(rows[1]!.winRate).toBeCloseTo(1);
  });
  it('returns empty if no weekday set', () => {
    expect(winRateByWeekday([trade({})])).toHaveLength(0);
  });
});

describe('rankCombosByWinRate', () => {
  it('ranks combos with win+loss rate and orders best first', () => {
    const trades = [
      trade({ emaCrossed: true, fifteenMinutesPassed: true, sellingPrice: 12 }),
      trade({ emaCrossed: true, fifteenMinutesPassed: true, sellingPrice: 11.5 }),
      trade({ emaCrossed: true, fifteenMinutesPassed: true, sellingPrice: 8 }),
      trade({ emaCrossed: false, fifteenMinutesPassed: false, sellingPrice: 8 }),
    ];
    const { combos, overallWinRate } = rankCombosByWinRate(trades, 2);
    expect(overallWinRate).toBeCloseTo(0.5);
    expect(combos.length).toBeGreaterThan(0);
    // The 2-combo (EMA+15m) should appear with win+loss rates summing to <=1
    const combo = combos.find((c) => c.label.includes('15m passed') && c.label.includes('EMA confirmed'));
    expect(combo).toBeDefined();
    expect(combo!.winRate + combo!.lossRate).toBeLessThanOrEqual(1);
    expect(combo!.winRate + combo!.lossRate).toBeGreaterThanOrEqual(0.9);
    // sorted descending by win rate
    for (let i = 1; i < combos.length; i++) {
      expect(combos[i - 1]!.winRate).toBeGreaterThanOrEqual(combos[i]!.winRate);
    }
  });
});