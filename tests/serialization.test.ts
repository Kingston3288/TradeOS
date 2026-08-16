import { describe, expect, it } from 'vitest';
import { exportTradesToCsv, exportTradesToJson, importTradesFromJson } from '../src/lib/serialization';
import { Trade } from '../src/lib/types';

const trade: Trade = {
  id: 'trade-1',
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
  fees: 1,
  status: 'closed',
  notes: 'Great setup',
  screenshotUrls: [],
};

describe('serialization', () => {
  it('exports trades as CSV with a header and row values', () => {
    const csv = exportTradesToCsv([trade]);
    expect(csv).toContain('id,userId,createdAt,timezone');
    expect(csv).toContain('trade-1');
    expect(csv).toContain('SPY');
  });

  it('exports JSON and imports back with normalized status', () => {
    const json = exportTradesToJson([{ ...trade, status: 'partial' }]);
    const imported = importTradesFromJson(json);
    expect(imported[0]?.status).toBe('partial');
  });

  it('normalizes open positions with blank selling price', () => {
    const payload = JSON.stringify([{ ...trade, sellingPrice: null, status: 'closed' }]);
    const imported = importTradesFromJson(payload);
    expect(imported[0]?.status).toBe('open');
    expect(imported[0]?.sellingPrice).toBeNull();
  });

  it('throws when import payload is not a trade array', () => {
    expect(() => importTradesFromJson('{"bad":true}')).toThrow('Import payload must be a JSON array of trades.');
  });
});
