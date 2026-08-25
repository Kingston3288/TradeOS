import { ConditionAnalysis, CombinedSetup, ConditionKey, ExpectancyMetrics, PeriodStats, PositionSizing, SetupPattern, StrategyBreakdown, SymbolBreakdown, Trade, TradeFinancials } from './types';

const CONTRACT_MULTIPLIER = 100;
const CONDITION_KEYS: Array<{ key: keyof Trade; label: string }> = [
  { key: 'fifteenMinutesPassed', label: '15 minutes passed' },
  { key: 'entryRespectsFifteenMinuteHighLow', label: 'Entry respected first 15m high/low' },
  { key: 'emaCrossed', label: 'EMA crossed' },
  { key: 'withinPortfolioRiskLimit', label: 'Within portfolio risk limit' },
  { key: 'closingBell', label: 'Closing bell (end of day)' },
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

function isWithinDays(trade: Trade, currentDate: string, days: number, timezone = 'America/New_York'): boolean {
  const current = dateInTz(currentDate + 'T12:00:00Z', timezone);
  const candidate = dateInTz(trade.closedAt || trade.createdAt || trade.tradeDate, timezone);
  const cMs = new Date(current + 'T12:00:00Z').getTime();
  const candMs = new Date(candidate + 'T12:00:00Z').getTime();
  const diffDays = (cMs - candMs) / 86_400_000;
  return diffDays >= 0 && diffDays < days;
}

/** Today's date (YYYY-MM-DD) in a given IANA timezone — NOT UTC. */
export function todayInTz(timezone = 'America/New_York'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function buildDashboardStats(trades: Trade[], currentDate: string = todayInTz('America/New_York'), timezone = 'America/New_York') {
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
  // "Today" resolved in the user's timezone, and trades bucketed by their CLOSE date
  // (not open date) so a trade closed today but opened earlier counts toward today.
  const today = dateInTz(new Date(currentDate + 'T12:00:00Z'), timezone);

  return {
    daily: summarizePeriod(closedTrades(trades).filter((t) => dateInTz(t.closedAt || t.createdAt || t.tradeDate, timezone) === today)),
    weekly: summarizePeriod(trades.filter((trade) => isWithinDays(trade, currentDate, 7, timezone))),
    monthly: summarizePeriod(trades.filter((trade) => isWithinDays(trade, currentDate, 31, timezone))),
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

/** Format an ISO timestamp as YYYY-MM-DD in a given IANA timezone. */
function dateInTz(iso: string | Date, tz: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return String(iso).slice(0, 10);
  }
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

// ============ Higher-probability analytics ============

const CONDITION_LABELS: Record<ConditionKey, string> = {
  fifteenMinutesPassed: '15m passed',
  entryRespectsFifteenMinuteHighLow: '15m HL respected',
  emaCrossed: 'EMA confirmed',
  withinPortfolioRiskLimit: 'Within risk',
  closingBell: 'Closing bell',
};

const CONDITION_KEYS_TYPED: ConditionKey[] = [
  'fifteenMinutesPassed',
  'entryRespectsFifteenMinuteHighLow',
  'emaCrossed',
  'withinPortfolioRiskLimit',
  'closingBell',
];

/**
 * Combined-condition engine: computes the win rate for every combination of
 * the boolean conditions (2^n combos), filtered to require a minimum sample size.
 * Ranked so the trader sees which condition baskets actually deliver higher
 * probability wins — not single-checkbox noise.
 */
export function findHighProbabilitySetups(
  trades: Trade[],
  minSampleSize = 3,
): { setups: CombinedSetup[]; overallWinRate: number } {
  const closed = closedTrades(trades);
  const overallWinRate = winRate(closed);
  const n = CONDITION_KEYS_TYPED.length;
  const combos: CombinedSetup[] = [];

  for (let mask = 0; mask < (1 << n); mask++) {
    const conditions = CONDITION_KEYS_TYPED.filter((_, i) => mask & (1 << i));
    // skip the "none" empty combination
    if (conditions.length === 0) continue;

    const matched = closed.filter((t) => conditions.every((c) => Boolean(t[c])));
    if (matched.length === 0 || matched.length < minSampleSize) continue;

    combos.push({
      conditions: conditions.map((c) => CONDITION_LABELS[c]),
      label: conditions.map((c) => CONDITION_LABELS[c]).join(' + '),
      winRate: winRate(matched),
      averageProfitLoss: average(matched.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0)),
      sampleSize: matched.length,
    });
  }

  // Rank by win rate, then avg P/L, then sample size
  combos.sort((a, b) => b.winRate - a.winRate || b.averageProfitLoss - a.averageProfitLoss || b.sampleSize - a.sampleSize);
  return { setups: combos, overallWinRate };
}

/** Expectancy (EV per trade) + profit factor + payoff ratio. */
export function computeExpectancy(trades: Trade[]): ExpectancyMetrics {
  const closed = closedTrades(trades);
  const results = closed.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
  const wins = results.filter((v) => v > 0);
  const losses = results.filter((v) => v < 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const avgWin = average(wins);
  const avgLoss = average(losses.map((v) => Math.abs(v)));

  return {
    expectancy: results.length ? results.reduce((s, v) => s + v, 0) / results.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    winRate: winRate(closed),
    totalClosed: closed.length,
  };
}

/**
 * Kelly / position sizing recommendation.
 * Recommended risk = half-Kelly (conservative), converted to % of portfolio.
 * Kelly = p - (1-p)/b, where p = winRate, b = payoff ratio.
 */
export function computePositionSizing(trades: Trade[], riskLimitPercent = 25): PositionSizing {
  const { winRate: p, payoffRatio: b } = computeExpectancy(trades);
  if (p <= 0 || b <= 0) {
    return { kellyFraction: 0, recommendedRiskPercent: 0, edgePresent: false, message: 'Not enough data to size positions yet.' };
  }
  const kelly = p - (1 - p) / b;
  if (kelly <= 0) {
    return { kellyFraction: 0, recommendedRiskPercent: 0, edgePresent: false, message: 'No positive edge detected — reduce or pause size until win rate/expecitancy improves.' };
  }
  // Half-Kelly, capped at the user's portfolio risk limit %, and never absurdly high.
  const halfKelly = kelly / 2;
  const recommended = Math.max(0.01, Math.min(halfKelly, riskLimitPercent / 100));
  return {
    kellyFraction: kelly,
    recommendedRiskPercent: recommended * 100,
    edgePresent: true,
    message: `Risk up to ~${(recommended * 100).toFixed(1)}% of portfolio per trade on this edge.`,
  };
}

/** Per-symbol breakdown. */
export function breakDownBySymbol(trades: Trade[]): SymbolBreakdown[] {
  const closed = closedTrades(trades);
  const bySymbol = new Map<string, Trade[]>();
  for (const t of closed) {
    const s = (t.symbol || '—').toUpperCase();
    bySymbol.set(s, [...(bySymbol.get(s) ?? []), t]);
  }
  const rows = [...bySymbol.entries()].map(([symbol, group]) => {
    const results = group.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
    return {
      symbol,
      trades: group.length,
      winRate: winRate(group),
      netProfitLoss: results.reduce((s, v) => s + v, 0),
      avgProfitLoss: average(results),
    };
  });
  return rows.sort((a, b) => b.trades - a.trades);
}

/** Per-strategy (strategyTag / notes tag) breakdown. */
export function breakDownByStrategy(trades: Trade[]): StrategyBreakdown[] {
  const closed = closedTrades(trades);
  const byTag = new Map<string, Trade[]>();
  for (const t of closed) {
    const tag = (t.strategyTag || 'untagged').trim();
    byTag.set(tag, [...(byTag.get(tag) ?? []), t]);
  }
  const rows = [...byTag.entries()].map(([tag, group]) => {
    const results = group.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
    return {
      tag,
      trades: group.length,
      winRate: winRate(group),
      netProfitLoss: results.reduce((s, v) => s + v, 0),
    };
  });
  return rows.sort((a, b) => b.trades - a.trades);
}

/** Rolling recent-form: win rate over the last N closed trades vs overall. */
export function recentForm(trades: Trade[], lookback = 20): { recentWinRate: number; overallWinRate: number; recentCount: number } {
  const closed = closedTrades(trades);
  // closed list is in insertion order; take the last N
  const recent = closed.slice(-lookback);
  return {
    recentWinRate: winRate(recent),
    overallWinRate: winRate(closed),
    recentCount: recent.length,
  };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string of all trades (for export). */
export function buildTradesCsv(trades: Trade[]): string {
  const headers = ['id', 'tradeDate', 'symbol', 'type', 'market', 'contracts', 'entry', 'exit', 'fees', 'netPL', 'status', 'strategy', 'notes'];
  const rows = trades.map((t) => {
    const f = calculateTradeFinancials(t);
    return [
      t.id, t.tradeDate, t.symbol || '', t.buyingType, t.marketExcitement,
      t.contractCount, t.purchasePrice, t.sellingPrice === null ? '' : t.sellingPrice,
      t.fees || 0, f.netProfitLoss === null ? '' : f.netProfitLoss,
      t.status, t.strategyTag || '', t.notes || '',
    ].map(csvEscape).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

/** Determine the "best" condition basket to recommend on a new entry. */
export function bestRecommendedSetup(trades: Trade[]): { label: string; winRate: number; sampleSize: number; conditions: string[] } | null {
  const { setups } = findHighProbabilitySetups(trades, 3);
  if (setups.length === 0) return null;
  const top = setups[0];
  if (!top) return null;
  return { label: top.label, winRate: top.winRate, sampleSize: top.sampleSize, conditions: top.conditions };
}

/**
 * Predict success % for a prospective trade by matching its currently-selected
 * conditions to the closest historical combo (exact match first, then the
 * best-known setup). Falls back to overall win rate when no match exists.
 * Returns confidence (High/Med/Low) based on sample size.
 */
export function predictSuccessRate(draft: Trade, trades: Trade[]): { percent: number; matched: string; sampleSize: number; confidence: 'High' | 'Med' | 'Low' } {
  const { combos, overallWinRate } = rankCombosByWinRate(trades, 2);
  const activeConditions = CONDITION_KEYS_TYPED.filter((c) => Boolean(draft[c]));
  const activeLabels = activeConditions.map((c) => CONDITION_LABELS[c]);
  const conf = (n: number): 'High' | 'Med' | 'Low' => (n >= 10 ? 'High' : n >= 4 ? 'Med' : 'Low');
  if (activeConditions.length === 0) {
    return { percent: Math.round(overallWinRate * 100), matched: 'All trades (no condition selected)', sampleSize: rankCombosByWinRate(trades, 2).totalClosed, confidence: conf(rankCombosByWinRate(trades, 2).totalClosed) };
  }
  // Exact match on the set of active conditions
  const exact = combos.find((c) => {
    const sameSize = c.conditions.length === activeLabels.length;
    return sameSize && activeLabels.every((l) => c.conditions.includes(l));
  });
  if (exact) return { percent: Math.round(exact.winRate * 100), matched: exact.label, sampleSize: exact.sampleSize, confidence: conf(exact.sampleSize) };
  // Otherwise use the best-known combo win rate as a proxy
  const best = combos[0];
  if (best) return { percent: Math.round(best.winRate * 100), matched: `closest: ${best.label}`, sampleSize: best.sampleSize, confidence: conf(best.sampleSize) };
  return { percent: Math.round(overallWinRate * 100), matched: 'Overall win rate', sampleSize: 0, confidence: 'Low' };
}

/** Probability grade: which color band a percent falls into (green/amber/red). */
export function probGrade(pct: number): 'green' | 'amber' | 'red' {
  if (pct >= 60) return 'green';
  if (pct >= 45) return 'amber';
  return 'red';
}

/**
 * Risk / reward: reward = |target - entry|, risk = |entry - stop|.
 * Returns ratio, and whether it clears the quality gate (RR >= 1.5).
 */
export function riskReward(trade: Pick<Trade, 'purchasePrice' | 'targetPrice' | 'stopLoss' | 'buyingType'>): { ratio: number | null; reward: number; risk: number; passes: boolean } {
  const entry = trade.purchasePrice;
  const target = trade.targetPrice;
  const stop = trade.stopLoss;
  if (!entry || entry <= 0 || target === null || target === undefined || target <= 0 || stop === null || stop === undefined || stop <= 0) {
    return { ratio: null, reward: 0, risk: 0, passes: false };
  }
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk === 0) return { ratio: null, reward, risk: 0, passes: false };
  const ratio = reward / risk;
  return { ratio, reward, risk, passes: ratio >= 1.5 };
}

export interface ComboRanking extends CombinedSetup {
  lossRate: number;
  breakevenCount: number;
}

export interface ComboRankings {
  combos: ComboRanking[];
  overallWinRate: number;
  totalClosed: number;
}

export function rankCombosByWinRate(trades: Trade[], minSampleSize = 2): ComboRankings {
  const closed = closedTrades(trades);
  const n = CONDITION_KEYS_TYPED.length;
  const combos: ComboRanking[] = [];
  for (let mask = 0; mask < (1 << n); mask++) {
    const conditions = CONDITION_KEYS_TYPED.filter((_, i) => mask & (1 << i));
    if (conditions.length === 0) continue;
    const matched = closed.filter((t) => conditions.every((c) => Boolean(t[c])));
    if (matched.length < minSampleSize) continue;
    const wins = matched.filter((t) => calculateTradeFinancials(t).result === 'gain');
    const losses = matched.filter((t) => calculateTradeFinancials(t).result === 'loss');
    const breakevens = matched.filter((t) => calculateTradeFinancials(t).result === 'breakeven');
    combos.push({
      label: conditions.map((c) => CONDITION_LABELS[c]).join(' + '),
      winRate: winRate(matched),
      lossRate: losses.length / matched.length,
      sampleSize: matched.length,
      averageProfitLoss: average(matched.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0)),
      breakevenCount: breakevens.length,
      conditions: conditions.map((c) => CONDITION_LABELS[c]),
    });
  }
  combos.sort((a, b) => b.winRate - a.winRate || b.sampleSize - a.sampleSize);
  return { combos, overallWinRate: winRate(closed), totalClosed: closed.length };
}

/** Parse a trade time string ("3:45 PM", "15:45", "3:45pm") into a 24h hour (0-23), or -1 if invalid. */
export function parseTradeTimeToHour(tm?: string): number {
  if (!tm) return -1;
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(tm.trim());
  if (!m || !m[1] || !m[2]) return -1;
  const hour0 = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (minute < 0 || minute > 59) return -1;
  const meridiem = (m[3] || '').toLowerCase();
  let hour = hour0;
  if (meridiem) {
    // 12h with AM/PM
    if (hour0 < 1 || hour0 > 12) return -1;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else {
    // 24h (no meridiem): allow 0-23
    if (hour0 > 23) return -1;
  }
  return hour;
}

export interface TimeOfDayStat {
  hour: number; // 0-23
  label: string; // e.g. "9:00-10:00"
  trades: number;
  winRate: number;
  netProfitLoss: number;
}

/** Win/loss probability bucketed by the trade's logged time-of-day. */
function to12h(h: number): string {
  const hr = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${hr}:00 ${ampm}`;
}
function timeRange(h: number): string {
  return `${to12h(h)}–${to12h((h + 1) % 24)}`;
}

export function winRateByTimeOfDay(trades: Trade[]): TimeOfDayStat[] {
  const closed = closedTrades(trades);
  const byHour = new Map<number, Trade[]>();
  for (const t of closed) {
    const h = parseTradeTimeToHour(t.tradeTime);
    if (h < 0) continue;
    byHour.set(h, [...(byHour.get(h) ?? []), t]);
  }
  const rows: TimeOfDayStat[] = [];
  for (const [hour, group] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
    const results = group.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
    rows.push({
      hour,
      label: timeRange(hour),
      trades: group.length,
      winRate: winRate(group),
      netProfitLoss: results.reduce((s, v) => s + v, 0),
    });
  }
  return rows;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;

export interface WeekdayStat {
  weekday: string; // e.g. 'Mon'
  trades: number;
  winRate: number;
  netProfitLoss: number;
}

/** Win/loss probability bucketed by weekday (Mon-Fri). */
export function winRateByWeekday(trades: Trade[]): WeekdayStat[] {
  const closed = closedTrades(trades);
  const byDay = new Map<string, Trade[]>();
  for (const t of closed) {
    const d = t.weekday;
    if (!d) continue;
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  // Order by Mon..Fri, then any others
  const order = new Map<string, number>();
  WEEKDAYS.forEach((d, i) => order.set(d, i));
  const rows: WeekdayStat[] = [...byDay.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([weekday, group]) => {
      const results = group.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
      return {
        weekday,
        trades: group.length,
        winRate: winRate(group),
        netProfitLoss: results.reduce((s, v) => s + v, 0),
      };
    });
  return rows;
}

export interface DirectionStat {
  value: string;   // e.g. 'up' | 'down' | 'raising' | 'falling'
  label: string;
  trades: number;
  winRate: number;
  lossRate: number;
  netProfitLoss: number;
  averageProfitLoss: number;
}

/** Win/loss probability bucketed by a multi-value direction condition (VWAP, MACD). */
export function winRateByDirection(trades: Trade[], field: 'vwapDirection' | 'macdTrend', labels: Record<string, string>): DirectionStat[] {
  const closed = closedTrades(trades);
  const byVal = new Map<string, Trade[]>();
  for (const t of closed) {
    const v = t[field];
    if (!v) continue;
    byVal.set(v, [...(byVal.get(v) ?? []), t]);
  }
  const rows: DirectionStat[] = [...byVal.entries()].map(([value, group]) => {
    const pls = group.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
    const losses = group.filter((t) => (calculateTradeFinancials(t).result === 'loss')).length;
    return {
      value,
      label: labels[value] ?? value,
      trades: group.length,
      winRate: winRate(group),
      lossRate: losses / group.length,
      netProfitLoss: pls.reduce((s, v) => s + v, 0),
      averageProfitLoss: average(pls),
    };
  });
  return rows.sort((a, b) => b.winRate - a.winRate);
}

export interface MarketComboStat {
  /** Human label, e.g. "Up · VWAP up · MACD rising · Call" */
  label: string;
  trades: number;
  winRate: number;
  lossRate: number;
  netProfitLoss: number;
}

/** Win-rate for the key directional combo: Market × VWAP × MACD × Buying type. */
export function winRateByMarketCombo(trades: Trade[]): MarketComboStat[] {
  const closed = closedTrades(trades);
  const byKey = new Map<string, Trade[]>();
  for (const t of closed) {
    const key = [t.marketExcitement, t.vwapDirection ?? '—', t.macdTrend ?? '—', t.buyingType].join('|');
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  const rows: MarketComboStat[] = [...byKey.entries()].map(([key, group]) => {
    const [mkt, vwap, macd, type] = key.split('|');
    const pls = group.map((t) => calculateTradeFinancials(t).netProfitLoss ?? 0);
    const losses = group.filter((t) => calculateTradeFinancials(t).result === 'loss').length;
    const cap = (s?: string) => { const v = s || '—'; return v.charAt(0).toUpperCase() + v.slice(1); };
    return {
      label: `${cap(mkt)} · VWAP ${vwap} · MACD ${macd} · ${cap(type)}`,
      trades: group.length,
      winRate: winRate(group),
      lossRate: losses / group.length,
      netProfitLoss: pls.reduce((s, v) => s + v, 0),
    };
  });
  return rows.sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
}

/** Best combo (min sample) for recommendation on New Trade. */
export function bestMarketCombo(trades: Trade[], minSample = 3): MarketComboStat | null {
  const rows = winRateByMarketCombo(trades).filter((r) => r.trades >= minSample);
  return rows[0] ?? null;
}

export const VWAP_LABELS = { up: 'Price above VWAP', down: 'Price below VWAP' };
export const MACD_LABELS = { rising: 'MACD rising', falling: 'MACD falling' };

/** Whole days a closed trade was held. 0 if held less than 1 day (or undeterminable). */
export function daysHeld(trade: Trade): number {
  if (!trade.closedAt || !trade.createdAt) return 0;
  const ms = new Date(trade.closedAt).getTime() - new Date(trade.createdAt).getTime();
  if (!isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86400000);
}

/** Average days held across closed trades. */
export function averageDaysHeld(trades: Trade[]): number {
  const closed = closedTrades(trades).filter((t) => t.closedAt);
  if (closed.length === 0) return 0;
  return closed.reduce((s, t) => s + daysHeld(t), 0) / closed.length;
}
