import { describe, expect, it } from 'vitest';
import { appTradeToDb, dbTradeToApp } from '../src/lib/tradeMapping';
import type { Trade } from '../src/lib/types';

const sampleTrade: Trade = {
  id: 't-1',
  userId: 'u-1',
  createdAt: '2026-08-03T10:00:00Z',
  timezone: 'America/New_York',
  tradeDate: '2026-08-03',
  symbol: 'SPY',
  marketExcitement: 'up',
  fifteenMinutesPassed: true,
  entryRespectsFifteenMinuteHighLow: true,
  emaCrossed: true,
  withinPortfolioRiskLimit: true,
  buyingType: 'call',
  contractCount: 2,
  purchasePrice: 3,
  sellingPrice: 4.5,
  fees: 1,
  status: 'closed',
  notes: 'nice',
  screenshotUrls: [],
  strategyTag: 'breakout',
};

describe('trade mapping', () => {
  it('maps app trade to db row', () => {
    const db = appTradeToDb(sampleTrade, 'u-1');
    expect(db.symbol).toBe('SPY');
    expect(db.contracts).toBe(2);
    expect(db.entry_price).toBe(3);
    expect(db.exit_price).toBe(4.5);
    expect(db.fees).toBe(1);
    expect(db.direction).toBe('call');
    expect(db.rule_checklist.fifteenMinutesPassed).toBe(true);
    expect(db.rule_checklist.emaCrossed).toBe(true);
    expect(db.market_conditions.excitement).toBe('up');
    expect(db.strategy).toBe('breakout');
  });

  it('maps db row back to app trade', () => {
    const db: any = {
      id: 't-1',
      user_id: 'u-1',
      symbol: 'SPY',
      strategy: 'breakout',
      asset_type: 'option',
      direction: 'call',
      contracts: 2,
      entry_price: 3,
      exit_price: 4.5,
      fees: 1,
      opened_at: '2026-08-03T10:00:00Z',
      closed_at: '2026-08-03T10:00:00Z',
      status: 'closed',
      notes: 'test',
      market_conditions: { excitement: 'up' },
      rule_checklist: { fifteenMinutesPassed: true, entryRespectsFifteenMinuteHighLow: true, emaCrossed: true, withinPortfolioRiskLimit: true },
      screenshot_urls: [],
      created_at: '2026-08-03T10:00:00Z',
      updated_at: '2026-08-03T10:00:00Z',
    };
    const app = dbTradeToApp(db);
    expect(app.symbol).toBe('SPY');
    expect(app.contractCount).toBe(2);
    expect(app.purchasePrice).toBe(3);
    expect(app.sellingPrice).toBe(4.5);
    expect(app.buyingType).toBe('call');
    expect(app.status).toBe('closed');
    expect(app.fifteenMinutesPassed).toBe(true);
    expect(app.marketExcitement).toBe('up');
  });

  it('handles null exit price as open trade', () => {
    const db: any = { ...sampleTrade, exit_price: null, status: 'open' };
    delete db.sellingPrice;
    const row = appTradeToDb({ ...sampleTrade, sellingPrice: null, status: 'open' }, 'u-1');
    expect(row.exit_price).toBeNull();
    expect(row.status).toBe('open');
    const back = dbTradeToApp({ ...sharedDb(sampleTrade), exit_price: null, status: 'open' } as any);
    expect(back.sellingPrice).toBeNull();
    expect(back.status).toBe('open');
  });
});

function sharedDb(t: Trade) {
  return {
    id: t.id,
    user_id: t.userId || '',
    symbol: t.symbol || '',
    strategy: t.strategyTag || null,
    asset_type: 'option',
    direction: t.buyingType,
    contracts: t.contractCount,
    entry_price: t.purchasePrice,
    exit_price: t.sellingPrice,
    fees: t.fees || 0,
    opened_at: t.createdAt,
    status: t.status,
    notes: t.notes || null,
    market_conditions: { excitement: t.marketExcitement },
    rule_checklist: {},
    screenshot_urls: t.screenshotUrls || [],
    created_at: t.createdAt,
    updated_at: t.createdAt,
  };
}