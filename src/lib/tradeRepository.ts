import { Trade } from './types';

export interface TradeRepository {
  listTrades(userId: string): Promise<Trade[]>;
  saveTrade(userId: string, trade: Trade): Promise<Trade>;
  deleteTrade(userId: string, tradeId: string): Promise<void>;
}

export function createInMemoryTradeRepository(initialTrades: Trade[] = []): TradeRepository {
  const trades = new Map<string, Trade[]>();
  for (const trade of initialTrades) {
    const owner = trade.userId ?? 'demo-user';
    trades.set(owner, [trade, ...(trades.get(owner) ?? [])]);
  }

  return {
    async listTrades(userId: string) {
      return [...(trades.get(userId) ?? [])];
    },
    async saveTrade(userId: string, trade: Trade) {
      const ownerTrade: Trade = { ...trade, userId };
      const existing = trades.get(userId) ?? [];
      const withoutDuplicate = existing.filter((item) => item.id !== ownerTrade.id);
      trades.set(userId, [ownerTrade, ...withoutDuplicate]);
      return ownerTrade;
    },
    async deleteTrade(userId: string, tradeId: string) {
      const existing = trades.get(userId) ?? [];
      trades.set(userId, existing.filter((trade) => trade.id !== tradeId));
    },
  };
}
