export type MarketExcitement = 'up' | 'down' | 'neutral';
export type BuyingType = 'call' | 'put';
export type TradeStatus = 'open' | 'closed';
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
}

export interface SetupPattern {
  label: string;
  winRate: number;
  averageProfitLoss: number;
  sampleSize: number;
}

export type ConditionKey = 'fifteenMinutesPassed' | 'entryRespectsFifteenMinuteHighLow' | 'emaCrossed' | 'withinPortfolioRiskLimit';

export interface CombinedSetup {
  /** Which conditions were true for this setup, e.g. ['15m passed','EMA confirmed'] */
  conditions: string[];
  winRate: number;
  averageProfitLoss: number;
  sampleSize: number;
  /** Compatible with SetupPattern for reuse */
  label: string;
}

export interface ExpectancyMetrics {
  expectancy: number;        // average net P/L per closed trade
  profitFactor: number;      // gross wins / gross losses (1 = breakeven)
  payoffRatio: number;       // avg win / avg loss (abs)
  winRate: number;
  totalClosed: number;
}

export interface PositionSizing {
  kellyFraction: number;     // raw Kelly (capped)
  recommendedRiskPercent: number; // conservative fraction of Kelly (half-Kelly)
  edgePresent: boolean;
  message: string;
}

export interface SymbolBreakdown {
  symbol: string;
  trades: number;
  winRate: number;
  netProfitLoss: number;
  avgProfitLoss: number;
}

export interface StrategyBreakdown {
  tag: string;
  trades: number;
  winRate: number;
  netProfitLoss: number;
}
