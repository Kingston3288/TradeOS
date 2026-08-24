import { demoSettings, demoTrades } from '../data/seed';
import { Settings, Trade } from './types';

export interface LocalDatabase {
  trades: Trade[];
  settings: Settings;
}

export const localDatabase: LocalDatabase = {
  trades: demoTrades,
  settings: demoSettings,
};

export function createTradeDraft(timezone = demoSettings.timezone): Trade {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    timezone,
    tradeDate: now.toISOString().slice(0, 10),
    symbol: '',
    marketExcitement: 'neutral',
    fifteenMinutesPassed: false,
    entryRespectsFifteenMinuteHighLow: false,
    emaCrossed: false,
    withinPortfolioRiskLimit: true,
    closingBell: false,
    tradeTime: '',
    weekday: 'Mon',
    vwapDirection: 'up',
    macdTrend: 'raising',
    buyingType: 'call',
    contractCount: 1,
    purchasePrice: 0,
    sellingPrice: null,
    fees: 0,
    status: 'open',
    notes: '',
    screenshotUrls: [],
  };
}
