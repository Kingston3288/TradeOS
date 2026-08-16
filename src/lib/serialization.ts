import { Trade } from './types';

const CSV_HEADERS: Array<keyof Trade> = [
  'id',
  'userId',
  'createdAt',
  'timezone',
  'tradeDate',
  'symbol',
  'marketExcitement',
  'fifteenMinutesPassed',
  'entryRespectsFifteenMinuteHighLow',
  'emaCrossed',
  'withinPortfolioRiskLimit',
  'buyingType',
  'contractCount',
  'purchasePrice',
  'sellingPrice',
  'fees',
  'status',
  'notes',
  'strategyTag',
  'screenshotUrls',
];

function encodeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `"${value.join('|').replaceAll('"', '""')}"`;
  const raw = String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

export function exportTradesToCsv(trades: Trade[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const trade of trades) {
    const row = CSV_HEADERS.map((header) => encodeCsvValue(trade[header]));
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

export function exportTradesToJson(trades: Trade[]): string {
  return JSON.stringify(trades, null, 2);
}

export function importTradesFromJson(source: string): Trade[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) {
    throw new Error('Import payload must be a JSON array of trades.');
  }

  return parsed.map((candidate, index) => normalizeTrade(candidate, index));
}

function normalizeTrade(candidate: unknown, index: number): Trade {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`Trade #${index + 1} is not an object.`);
  }

  const trade = candidate as Partial<Trade>;
  if (!trade.id || !trade.createdAt || !trade.tradeDate || !trade.timezone) {
    throw new Error(`Trade #${index + 1} is missing required identity/date fields.`);
  }

  if (trade.sellingPrice === null || trade.sellingPrice === undefined) {
    return { ...trade, status: 'open', sellingPrice: null } as Trade;
  }

  const normalizedStatus = trade.status === 'partial' ? 'partial' : 'closed';
  return { ...trade, status: normalizedStatus } as Trade;
}
