import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
);

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