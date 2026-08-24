import { Trade } from './types';

// Pure mapping between the app's Trade shape <-> the DB `trades` table.
// Kept separate (no supabase import) so it's unit-testable without a client.

export type DbTrade = {
  id: string;
  user_id: string;
  symbol: string;
  strategy?: string | null;
  asset_type: string;
  direction: string;
  contracts: number;
  entry_price: number;
  exit_price: number | null;
  fees: number;
  opened_at: string;
  closed_at?: string | null;
  status: string;
  notes?: string | null;
  market_conditions: Record<string, unknown>;
  rule_checklist: Record<string, unknown>;
  screenshot_urls: string[];
  created_at: string;
  updated_at: string;
};

export function dbTradeToApp(row: DbTrade): Trade {
  const direction = row.direction === 'put' ? 'put' : 'call';
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    timezone: 'America/New_York',
    tradeDate: (row.opened_at || row.created_at || '').slice(0, 10),
    symbol: row.symbol || '',
    marketExcitement: ((row.market_conditions as any)?.excitement as Trade['marketExcitement']) || 'neutral',
    fifteenMinutesPassed: Boolean((row.rule_checklist as any)?.fifteenMinutesPassed),
    entryRespectsFifteenMinuteHighLow: Boolean((row.rule_checklist as any)?.entryRespectsFifteenMinuteHighLow),
    emaCrossed: Boolean((row.rule_checklist as any)?.emaCrossed),
    withinPortfolioRiskLimit: Boolean((row.rule_checklist as any)?.withinPortfolioRiskLimit),
    closingBell: Boolean((row.rule_checklist as any)?.closingBell),
    tradeTime: (row.rule_checklist as any)?.tradeTime || undefined,
    buyingType: direction,
    contractCount: Number(row.contracts),
    purchasePrice: Number(row.entry_price),
    sellingPrice: row.exit_price === null || row.exit_price === undefined ? null : Number(row.exit_price),
    fees: Number(row.fees || 0),
    status: (row.status as Trade['status']) || 'open',
    notes: row.notes || '',
    screenshotUrls: row.screenshot_urls || [],
    strategyTag: row.strategy || '',
  };
}

export function appTradeToDb(trade: Trade, userId: string): Omit<DbTrade, 'id' | 'created_at' | 'updated_at'> {
  return {
    user_id: userId,
    symbol: trade.symbol || '',
    strategy: trade.strategyTag || null,
    asset_type: 'option',
    direction: trade.buyingType,
    contracts: Number(trade.contractCount || 1),
    entry_price: Number(trade.purchasePrice || 0),
    exit_price: trade.sellingPrice === null || trade.sellingPrice === undefined ? null : Number(trade.sellingPrice),
    fees: Number(trade.fees || 0),
    opened_at: trade.createdAt || new Date().toISOString(),
    closed_at: trade.status === 'closed' ? trade.createdAt : null,
    status: trade.status || 'open',
    notes: trade.notes || null,
    market_conditions: { excitement: trade.marketExcitement || 'neutral' },
    rule_checklist: {
      fifteenMinutesPassed: Boolean(trade.fifteenMinutesPassed),
      entryRespectsFifteenMinuteHighLow: Boolean(trade.entryRespectsFifteenMinuteHighLow),
      emaCrossed: Boolean(trade.emaCrossed),
      withinPortfolioRiskLimit: Boolean(trade.withinPortfolioRiskLimit),
      closingBell: Boolean(trade.closingBell),
      tradeTime: trade.tradeTime || null,
    },
    screenshot_urls: trade.screenshotUrls || [],
  };
}