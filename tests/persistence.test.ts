import { describe, expect, it } from 'vitest';
import { createAuthConfig, isDatabaseConfigured } from '../src/lib/config';
import { createInMemoryTradeRepository } from '../src/lib/tradeRepository';
import { createTradeDraft } from '../src/lib/storage';

describe('private launch persistence foundation', () => {
  it('detects when database credentials are missing so launch cannot pretend to be production-ready', () => {
    const config = createAuthConfig({});

    expect(config.isConfigured).toBe(false);
    expect(config.missing).toEqual(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
    expect(isDatabaseConfigured(config)).toBe(false);
  });

  it('detects when Supabase credentials are present for authenticated database mode', () => {
    const config = createAuthConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'https://tradeos.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    });

    expect(config.isConfigured).toBe(true);
    expect(config.supabaseUrl).toBe('https://tradeos.supabase.co');
    expect(config.supabaseAnonKey).toBe('anon-key');
    expect(config.missing).toEqual([]);
  });

  it('persists user-owned trades through the repository interface', async () => {
    const repository = createInMemoryTradeRepository();
    const draft = { ...createTradeDraft(), symbol: 'SPY', purchasePrice: 2.4, userId: 'user-1' };

    await repository.saveTrade('user-1', draft);
    await repository.saveTrade('user-2', { ...draft, id: 'other-trade', symbol: 'QQQ', userId: 'user-2' });

    const userOneTrades = await repository.listTrades('user-1');
    const userTwoTrades = await repository.listTrades('user-2');

    expect(userOneTrades).toHaveLength(1);
    expect(userOneTrades[0]?.symbol).toBe('SPY');
    expect(userTwoTrades).toHaveLength(1);
    expect(userTwoTrades[0]?.symbol).toBe('QQQ');
  });
});
