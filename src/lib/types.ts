export type MarketExcitement = 'up' | 'down' | 'neutral';
export type BuyingType = 'call' | 'put';
export type TradeStatus = 'open' | 'partial' | 'closed';
export type TradeResult = 'gain' | 'loss' | 'breakeven';
export type ComputedResult = TradeResult | 'open';

export interface Trade {
  id: string;
  userId?: string;
  createdAt: string;
  timezone: string;
  tradeDate: string;
  symbol?: string;
  marketExcitement: MarketExcitement;
  fifteenMinutesPassed: boolean;
  entryRespectsFifteenMinuteHighLow: boolean;
  emaCrossed: boolean;
  withinPortfolioRiskLimit: boolean;
  buyingType: BuyingType;
  contractCount: number;
  purchasePrice: number;
  sellingPrice: number | null;
  fees?: number;
  status: TradeStatus;
  notes?: string;
  screenshotUrls?: string[];
  strategyTag?: string;
}

export interface Settings {
  userId: string;
  timezone: string;
  marketOpenTime: string;
  riskLimitPercent: number;
  portfolioValue: number;
  preferredCurrency: string;
  emaOptions: '9' | '14' | 'both';
  themePreference: 'dark' | 'system';
}

export interface TradeFinancials {
  status: TradeStatus;
  grossProfitLoss: number | null;
  netProfitLoss: number | null;
  profitLossPercentage: number | null;
  result: ComputedResult;
}

export interface PeriodStats {
  netProfitLoss: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  averageWinningTrade: number;
  averageLosingTrade: number;
  biggestWin: number;
  biggestLoss: number;
}

export interface ConditionAnalysis {
  key: keyof Trade;
  label: string;
  baselineWinRate: number;
  trueWinRate: number;
  falseWinRate: number;
  trueAverageProfitLoss: number;
  falseAverageProfitLoss: number;
  winLift: number;
  trueSampleSize: number;
  falseSampleSize: number;
  trueSampleWarning: string | null;
  falseSampleWarning: string | null;
}

export interface SetupPattern {
  label: string;
  winRate: number;
  averageProfitLoss: number;
  sampleSize: number;
}
