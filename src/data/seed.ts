import { Settings, Trade } from '../lib/types';

export const demoSettings: Settings = {
  userId: 'local-demo',
  timezone: 'America/New_York',
  marketOpenTime: '09:30',
  riskLimitPercent: 25,
  portfolioValue: 25000,
  preferredCurrency: 'USD',
  emaOptions: 'both',
  themePreference: 'dark',
};

export const demoTrades: Trade[] = [];
