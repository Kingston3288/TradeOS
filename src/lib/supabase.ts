import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const OWNER_EMAIL = 'kingston3288@gmail.com';

export interface AccessRequest {
  id: string;
  email?: string;
  status?: string;
}

// Check whether the signed-in user is approved to access the TradeOS app.
// Owner is always allowed; others must have an approved access request.
export async function checkApprovedStatus(email: string): Promise<'approved' | 'pending' | 'denied'> {
  if ((email || '').toLowerCase() === OWNER_EMAIL.toLowerCase()) return 'approved';
  const { data, error } = await supabase
    .from('tradeos_access_requests')
    .select('status')
    .eq('email', email)
    .maybeSingle();
  if (error || !data) return 'pending';
  if (data.status === 'approved') return 'approved';
  if (data.status === 'denied') return 'denied';
  return 'pending';
}

// Friendly message for a login that succeeded at auth but has no approved access.
export function accessDeniedMessage(status: 'pending' | 'denied' | 'none'): string {
  if (status === 'pending') return 'Your application is still under review. You\u2019ll be able to log in once you\u2019re approved.';
  if (status === 'denied') return 'This account was not approved for TradeOS access. Contact us if you believe this is a mistake.';
  return 'No access approved for this account. Request access at tradeos.win/apply to get started.';
}