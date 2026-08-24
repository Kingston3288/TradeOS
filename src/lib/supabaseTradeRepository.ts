import { supabase } from './supabase';
import { appTradeToDb, dbTradeToApp, DbTrade } from './tradeMapping';
import { Trade } from './types';

export interface SupabaseTradeRepository {
  listTrades(userId: string): Promise<Trade[]>;
  saveTrade(userId: string, trade: Trade): Promise<Trade>;
  deleteTrade(userId: string, tradeId: string): Promise<void>;
}

export function createSupabaseTradeRepository(): SupabaseTradeRepository {
  return {
    async listTrades(userId: string): Promise<Trade[]> {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((r: any) => dbTradeToApp(r as DbTrade));
    },

    async saveTrade(userId: string, trade: Trade): Promise<Trade> {
      const payload = { ...appTradeToDb(trade, userId), id: trade.id || undefined };
      const { data, error } = await supabase
        .from('trades')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return dbTradeToApp(data as DbTrade);
    },

    async deleteTrade(userId: string, tradeId: string): Promise<void> {
      const { error } = await supabase
        .from('trades')
        .delete()
        .eq('id', tradeId)
        .eq('user_id', userId);
      if (error) throw error;
    },
  };
}

export async function saveAnalyticsSnapshot(userId: string, period: string, metrics: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('analytics_snapshots')
    .insert({ user_id: userId, period, metrics });
  if (error) throw error;
}