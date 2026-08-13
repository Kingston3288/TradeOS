import { Trade } from './types';

export function validateTradeInput(trade: Trade): string[] {
  const errors: string[] = [];
  if (trade.contractCount <= 0 || !Number.isFinite(trade.contractCount)) errors.push('Contract count must be greater than 0.');
  if (trade.purchasePrice <= 0 || !Number.isFinite(trade.purchasePrice)) errors.push('Purchase price must be greater than 0.');
  if (trade.sellingPrice !== null && (trade.sellingPrice < 0 || !Number.isFinite(trade.sellingPrice))) errors.push('Selling price must be blank or 0+.');
  if ((trade.fees ?? 0) < 0) errors.push('Fees cannot be negative.');
  if (!trade.timezone) errors.push('Timezone is required.');
  return errors;
}
