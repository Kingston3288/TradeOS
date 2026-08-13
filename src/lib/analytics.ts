import { ConditionAnalysis, PeriodStats, SetupPattern, Trade, TradeFinancials } from './types';

const CONTRACT_MULTIPLIER = 100;
const CONDITION_KEYS: Array<{ key: keyof Trade; label: string }> = [
  { key: 'fifteenMinutesPassed', label: '15 minutes passed' },
  { key: 'entryRespectsFifteenMinuteHighLow', label: 'Entry respected first 15m high/low' },
  { key: 'emaCrossed', label: 'EMA crossed' },
  { key: 'withinPortfolioRiskLimit', label: 'Within portfolio risk limit' },
];

export function calculateTradeFinancials(trade: Trade): TradeFinancials {
  if (trade.sellingPrice === null || trade.sellingPrice === undefined) {
    return { status: 'open', grossProfitLoss: null, netProfitLoss: null, profitLossPercentage: null, result: 'open' };
  }

  const grossProfitLoss = (trade.sellingPrice - trade.purchasePrice) * trade.contractCount * CONTRACT_MULTIPLIER;
  const netProfitLoss = grossProfitLoss - (trade.fees ?? 0);
  const profitLossPercentage = trade.purchasePrice === 0 ? 0 : ((trade.sellingPrice - trade.purchasePrice) / trade.purchasePrice) * 100;
  const result = netProfitLoss > 0 ? 'gain' : netProfitLoss < 0 ? 'loss' : 'breakeven';

  return { status: 'closed', grossProfitLoss, netProfitLoss, profitLossPercentage, result };
}

export function closedTrades(trades: Trade[]): Trade[] {
  return trades.filter((trade) => calculateTradeFinancials(trade).status === 'closed');
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function winRate(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  return trades.filter((trade) => calculateTradeFinancials(trade).result === 'gain').length / trades.length;
}

function summarizePeriod(trades: Trade[]): PeriodStats {
  const closed = closedTrades(trades);
  const results = closed.map((trade) => calculateTradeFinancials(trade).netProfitLoss ?? 0);
  const wins = results.filter((value) => value > 0);
  const losses = results.filter((value) => value < 0);

  return {
    netProfitLoss: results.reduce((sum, value) => sum + value, 0),
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: results.filter((value) => value === 0).length,
    winRate: winRate(closed),
    averageWinningTrade: average(wins),
    averageLosingTrade: average(losses),
    biggestWin: wins.length ? Math.max(...wins) : 0,
    biggestLoss: losses.length ? Math.min(...losses) : 0,
  };
}

function parseTradeDate(tradeDate: string): Date {
  return new Date(`${tradeDate}T12:00:00Z`);
}

function isWithinDays(trade: Trade, currentDate: string, days: number): boolean {
  const current = parseTradeDate(currentDate).getTime();
  const candidate = parseTradeDate(trade.tradeDate).getTime();
  const diffDays = (current - candidate) / 86_400_000;
  return diffDays >= 0 && diffDays < days;
}

export function buildDashboardStats(trades: Trade[], currentDate = new Date().toISOString().slice(0, 10)) {
  const closed = closedTrades(trades);
  const winningValues = closed.map(calculateTradeFinancials).map((r) => r.netProfitLoss ?? 0).filter((value) => value > 0);
  const losingValues = closed.map(calculateTradeFinancials).map((r) => r.netProfitLoss ?? 0).filter((value) => value < 0);
  const ruleChecks = trades.flatMap((trade) => [
    trade.fifteenMinutesPassed,
    trade.entryRespectsFifteenMinuteHighLow,
    trade.emaCrossed,
    trade.withinPortfolioRiskLimit,
  ]);
  const patterns = getBestAndWorstPatterns(trades);

  return {
    daily: summarizePeriod(trades.filter((trade) => trade.tradeDate === currentDate)),
    weekly: summarizePeriod(trades.filter((trade) => isWithinDays(trade, currentDate, 7))),
    monthly: summarizePeriod(trades.filter((trade) => isWithinDays(trade, currentDate, 31))),
    winRate: winRate(closed),
    totalWins: winningValues.length,
    totalLosses: losingValues.length,
    averageWinningTrade: average(winningValues),
    averageLosingTrade: average(losingValues),
    ruleDisciplineScore: ruleChecks.length ? ruleChecks.filter(Boolean).length / ruleChecks.length : 0,
    bestSetupPattern: patterns.best,
    worstSetupPattern: patterns.worst,
    summary: buildAiSummary(trades),
  };
}

export function analyzeCondition(trades: Trade[], key: keyof Trade, label: string): ConditionAnalysis {
  const closed = closedTrades(trades);
  const trueTrades = closed.filter((trade) => Boolean(trade[key]));
  const falseTrades = closed.filter((trade) => !Boolean(trade[key]));
  const trueAverageProfitLoss = average(trueTrades.map((trade) => calculateTradeFinancials(trade).netProfitLoss ?? 0));
  const falseAverageProfitLoss = average(falseTrades.map((trade) => calculateTradeFinancials(trade).netProfitLoss ?? 0));
  const baselineWinRate = winRate(closed);
  const trueWinRate = winRate(trueTrades);

  return {
    key,
    label,
    baselineWinRate,
    trueWinRate,
    falseWinRate: winRate(falseTrades),
    trueAverageProfitLoss,
    falseAverageProfitLoss,
    winLift: trueWinRate - baselineWinRate,
    trueSampleSize: trueTrades.length,
    falseSampleSize: falseTrades.length,
  };
}

export function analyzeAllConditions(trades: Trade[]): ConditionAnalysis[] {
  return CONDITION_KEYS.map(({ key, label }) => analyzeCondition(trades, key, label));
}

function patternLabel(trade: Trade): string {
  const parts = [
    trade.fifteenMinutesPassed ? '15m waited' : 'No 15m wait',
    trade.entryRespectsFifteenMinuteHighLow ? '15m level respected' : '15m level missed',
    trade.emaCrossed ? 'EMA confirmed' : 'No EMA',
    trade.withinPortfolioRiskLimit ? 'Risk respected' : 'Risk exceeded',
  ];
  return `${trade.buyingType.toUpperCase()} · ${trade.marketExcitement} · ${parts.join(' + ')}`;
}

export function getBestAndWorstPatterns(trades: Trade[]): { best: SetupPattern | null; worst: SetupPattern | null } {
  const groups = new Map<string, Trade[]>();
  for (const trade of closedTrades(trades)) {
    const label = patternLabel(trade);
    groups.set(label, [...(groups.get(label) ?? []), trade]);
  }

  const patterns = [...groups.entries()].map(([label, group]) => ({
    label,
    winRate: winRate(group),
    averageProfitLoss: average(group.map((trade) => calculateTradeFinancials(trade).netProfitLoss ?? 0)),
    sampleSize: group.length,
  }));

  const sorted = patterns.sort((a, b) => b.winRate - a.winRate || b.averageProfitLoss - a.averageProfitLoss || b.sampleSize - a.sampleSize);
  return { best: sorted[0] ?? null, worst: sorted[sorted.length - 1] ?? null };
}

export function buildAiSummary(trades: Trade[]): string {
  const stats = buildDashboardStatsWithoutSummary(trades);
  const best = stats.bestSetupPattern?.label ?? 'No closed setup yet';
  const worst = stats.worstSetupPattern?.label ?? 'No weak setup yet';
  return `Best edge: ${best}. Weakest pattern: ${worst}. Tomorrow, protect the risk limit and wait for 15-minute plus EMA confirmation before scaling.`;
}

function buildDashboardStatsWithoutSummary(trades: Trade[]) {
  const closed = closedTrades(trades);
  const ruleChecks = trades.flatMap((trade) => [trade.fifteenMinutesPassed, trade.entryRespectsFifteenMinuteHighLow, trade.emaCrossed, trade.withinPortfolioRiskLimit]);
  const patterns = getBestAndWorstPatterns(trades);
  return {
    winRate: winRate(closed),
    ruleDisciplineScore: ruleChecks.length ? ruleChecks.filter(Boolean).length / ruleChecks.length : 0,
    bestSetupPattern: patterns.best,
    worstSetupPattern: patterns.worst,
  };
}

export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
