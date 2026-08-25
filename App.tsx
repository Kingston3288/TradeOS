import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, PanResponder, Animated, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { analyzeAllConditions, averageDaysHeld, bestRecommendedSetup, buildDashboardStats, buildTradesCsv, breakDownByStrategy, breakDownBySymbol, calculateTradeFinancials, computeExpectancy, computePositionSizing, findHighProbabilitySetups, formatCurrency, formatPercent, predictSuccessRate, probGrade, riskReward, rankCombosByWinRate, recentForm, todayInTz, winRateByTimeOfDay, winRateByWeekday, winRateByDirection, winRateByMarketCombo, VWAP_LABELS, MACD_LABELS } from './src/lib/analytics';
import { createTradeDraft, localDatabase } from './src/lib/storage';
import type { Trade, PeriodStats } from './src/lib/types';
import { validateTradeInput } from './src/lib/validation';
import { uuid } from './src/lib/uuid';
import { colors, shadow } from './src/theme';
import { supabase, checkApprovedStatus, OWNER_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY } from './src/lib/supabase';
import { createSupabaseTradeRepository, saveAnalyticsSnapshot } from './src/lib/supabaseTradeRepository';

type Screen = 'Dashboard' | 'New Trade' | 'Trade Log' | 'Analytics' | 'Reports' | 'Settings';
type AccessState = 'checking' | 'approved' | 'pending' | 'denied';

const screens: Screen[] = ['Dashboard', 'New Trade', 'Trade Log', 'Analytics', 'Reports', 'Settings'];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<AccessState>('checking');
  const [mustChange, setMustChange] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      // If the token expires or the session is signed out/refreshed invalid, go back to login.
      if (!s || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !s) {
        setAccess('checking');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolve access whenever the session changes.
  useEffect(() => {
    if (!session?.user?.email) { setAccess('checking'); return; }
    let alive = true;
    checkApprovedStatus(session.user.email).then((s) => {
      if (alive) setAccess(s);
      // If approved, check whether the user must change their password on first login.
      if (s === 'approved') {
        supabase.from('tradeos_access_requests')
          .select('must_change_password')
          .eq('email', session.user.email)
          .maybeSingle()
          .then(({ data }) => { if (alive && data?.must_change_password) setMustChange(true); });
      }
    });
    return () => { alive = false; };
  }, [session?.user?.email]);

  if (loading) return <Centered><Text style={styles.mutedSmall}>Loading…</Text></Centered>;

  // Not signed in -> Login
  if (!session) return <LoginScreen />;

  // Signed in but not approved -> status gate
  if (access !== 'approved') return <AccessGate email={session.user.email ?? ''} state={access} onSignOut={() => supabase.auth.signOut()} />;

  // First login -> force password change
  if (mustChange) return <ChangePasswordScreen email={session.user.email ?? ''} onDone={() => setMustChange(false)} onSignOut={() => supabase.auth.signOut()} />;

  // Approved -> the trading app
  return <TradingApp ownerEmail={session.user.email ?? ''} onSignOut={() => supabase.auth.signOut()} />;
}

function ChangePasswordScreen({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (p1.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (p1 !== p2) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    const { error: e } = await supabase.auth.updateUser({ password: p1 });
    if (e) { setError(e.message || 'Could not update password.'); setBusy(false); return; }
    // Clear the must-change flag
    await supabase.from('tradeos_access_requests')
      .update({ must_change_password: false, temp_password: null })
      .eq('email', email);
    setBusy(false);
    onDone();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={[styles.logoTitle, { marginBottom: 8 }]}>Set a new password</Text>
        <Text style={[styles.muted, { textAlign: 'center', maxWidth: 340, marginBottom: 24 }]}>For security, please choose a new password before continuing.</Text>
        <View style={{ width: '100%', maxWidth: 380, gap: 12 }}>
          <Text style={styles.mutedSmall}>New password</Text>
          <TextInput style={styles.input} value={p1} onChangeText={setP1} secureTextEntry placeholder="At least 8 characters" placeholderTextColor={colors.muted} />
          <Text style={styles.mutedSmall}>Confirm password</Text>
          <TextInput style={styles.input} value={p2} onChangeText={setP2} secureTextEntry placeholder="Repeat password" placeholderTextColor={colors.muted} />
          {!!error && <Text style={{ color: colors.red }}>{error}</Text>}
          <TouchableOpacity style={[styles.primaryButton, { alignSelf: 'stretch', alignItems: 'center' }]} onPress={submit} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Update password'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSignOut}><Text style={[styles.muted, { textAlign: 'center', fontSize: 13 }]}>Sign out</Text></TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe}><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{children}</View></SafeAreaView>;
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError('');
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (e) {
      const m = (e.message || '').toLowerCase();
      if (m.includes('invalid login') || m.includes('invalid credentials')) {
        setError('Incorrect email or password. If you haven\u2019t been approved yet, request access at tradeos.win/apply, or use the link below to reset your password.');
      } else {
        setError(e.message || 'Unable to sign in.');
      }
    }
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={[styles.logoRow, { marginBottom: 8 }]}>
          <View style={styles.logoMark}><Text style={styles.logoMarkText}>T</Text></View>
          <Text style={styles.logoTitle}>TradeOS</Text>
        </View>
        <Text style={[styles.muted, { marginBottom: 24, textAlign: 'center' }]}>Private trading command center</Text>
        <View style={{ width: '100%', maxWidth: 380, gap: 12 }}>
          <Text style={styles.mutedSmall}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@email.com" placeholderTextColor={colors.muted} />
          <Text style={styles.mutedSmall}>Password</Text>
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />
          {!!error && <Text style={{ color: colors.red }}>{error}</Text>}
          <TouchableOpacity style={[styles.primaryButton, { alignSelf: 'stretch', alignItems: 'center' }]} onPress={submit} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Signing in…' : 'Log In'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => supabase.auth.signUp({ email: email.trim(), password })}>
            <Text style={[styles.muted, { textAlign: 'center', fontSize: 13 }]}>Need an account? Request access at tradeos.win/apply</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.href })}>
            <Text style={[styles.muted, { textAlign: 'center', fontSize: 13 }]}>Forgot password? Reset it here</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={async () => {
            if (!email.trim()) { setError('Enter your email first to send a magic link.'); return; }
            setBusy(true); setError('');
            const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim() });
            if (e) { setError(e.message || 'Could not send magic link.'); }
            else { setError(''); alert('A sign-in link (magic link) was sent to your email. Please check your inbox.'); }
            setBusy(false);
          }}>
            <Text style={[styles.muted, { textAlign: 'center', fontSize: 13 }]}>Or sign in with a magic link (no password needed)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function AccessGate({ email, state, onSignOut }: { email: string; state: AccessState; onSignOut: () => void }) {
  const copy =
    state === 'pending'
      ? { title: 'Application pending', body: 'Your request is under review. You\'ll be notified once you\'re approved.' }
      : state === 'denied'
      ? { title: 'Access not granted', body: 'Your application was not approved. Contact us if you believe this is a mistake.' }
      : { title: 'Sorry', body: 'We couldn\'t verify your access yet. Please try again later.' };
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={[styles.logoTitle, { marginBottom: 12 }]}>{copy.title}</Text>
        <Text style={[styles.muted, { textAlign: 'center', maxWidth: 360, marginBottom: 24 }]}>{copy.body}</Text>
        <Text style={[styles.mutedSmall, { marginBottom: 12 }]}>Signed in as {email}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={onSignOut}><Text style={styles.primaryText}>Sign out</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function prepareDraft(): Trade {
  return createTradeDraft();
}
function createEmptyDraft(): Trade {
  return createTradeDraft();
}

function TradingApp({ ownerEmail, onSignOut }: { ownerEmail: string; onSignOut: () => void }) {
  const isOwner = (ownerEmail || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
  const [screen, setScreen] = useState<Screen>('Dashboard');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [draft, setDraft] = useState<Trade>(() => ({ ...prepareDraft(), id: 'draft', sellingPrice: null, status: 'open', notes: '' }));
  const [dbError, setDbError] = useState('');
  const repo = useMemo(() => createSupabaseTradeRepository(), []);
  const { width } = useWindowDimensions();
  const compact = width < 780;
  const tz = localDatabase.settings.timezone || 'America/New_York';
  const stats = useMemo(() => buildDashboardStats(trades, todayInTz(tz), tz), [trades, tz]);
  const analyses = useMemo(() => analyzeAllConditions(trades), [trades]);

  // Load trades from Supabase once the user's session is approved (ownerEmail is set).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const userId = (await supabase.auth.getUser()).data.user?.id;
        if (!userId) return;
        const loaded = await repo.listTrades(userId);
        if (alive) setTrades(loaded);
      } catch (e) {
        if (alive) setDbError('Could not load trades from database. ' + String((e as any)?.message || e));
      }
    })();
    return () => { alive = false; };
  }, [repo]);

  async function saveDraft() {
    const computed = calculateTradeFinancials(draft);
    const nextTrade: Trade = { ...draft, id: draft.id && draft.id !== 'draft' ? draft.id : uuid(), createdAt: draft.createdAt || new Date().toISOString(), status: computed.status };
    const errors = validateTradeInput(nextTrade);
    if (errors.length) return;
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) { setDbError('Not signed in.'); return; }
      const saved = await repo.saveTrade(userId, nextTrade);
      setTrades((current) => [saved, ...current.filter((t) => t.id !== saved.id)]);
      setDraft({ ...createEmptyDraft(), id: 'draft' });
      // Snapshot key analytics after each save (best-effort)
      try { await saveAnalyticsSnapshot(userId, 'all', { expectancy: computeExpectancy([saved, ...trades]).expectancy, recordedAt: new Date().toISOString() }); } catch {}
    } catch (e) {
      setDbError('Failed to save trade. ' + String((e as any)?.message || e));
    }
  }

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [pendingSave, setPendingSave] = useState<Trade | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const prediction = useMemo(
    () => (pendingSave ? predictSuccessRate(pendingSave, trades) : { percent: 0, matched: '', sampleSize: 0, confidence: 'Low' as const }),
    [pendingSave, trades],
  );
  const rr = useMemo(() => (pendingSave ? riskReward(pendingSave) : { ratio: null, reward: 0, risk: 0, passes: false }), [pendingSave]);

  function openSaveConfirm(t: Trade) { setPendingSave(t); setConfirmVisible(true); }
  function closeSaveConfirm() { setConfirmVisible(false); }
  function confirmSave() { if (pendingSave) { /* persist the pending draft */ const t = pendingSave; setPendingSave(null); setConfirmVisible(false); saveDraftToRepo(t); } }
  async function saveDraftToRepo(t: Trade) { const computed = calculateTradeFinancials(t); const tr: Trade = { ...t, id: t.id && t.id !== 'draft' ? t.id : uuid(), createdAt: t.createdAt || new Date().toISOString(), ...(computed.status === 'closed' && !t.closedAt ? { closedAt: new Date().toISOString() } : {}), status: computed.status }; const errors = validateTradeInput(tr); if (errors.length) return; try { const userId = (await supabase.auth.getUser()).data.user?.id; if (!userId) { setDbError('Not signed in.'); return; } const saved = await repo.saveTrade(userId, tr); setTrades((c) => [saved, ...c.filter((x) => x.id !== saved.id)]); setDraft({ ...createEmptyDraft(), id: 'draft' }); setScreen('Trade Log'); try { await saveAnalyticsSnapshot(userId, 'all', { expectancy: computeExpectancy([saved, ...trades]).expectancy }); } catch {} } catch (e) { setDbError('Failed to save trade. ' + String((e as any)?.message || e)); } }

  function deleteTrade(id: string) { setDeleteConfirmId(id); }
  function cancelDelete() { setDeleteConfirmId(null); }
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  function openEditTrade(t: Trade) { setEditingTrade(t); }
  function closeEditTrade() { setEditingTrade(null); }
  async function commitEditTrade(updated: Trade) {
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) return;
      const saved = await repo.saveTrade(userId, updated);
      setTrades((c) => c.map((t) => (t.id === saved.id ? saved : t)));
      setEditingTrade(null);
    } catch (e) { setDbError('Failed to update trade. ' + String((e as any)?.message || e)); }
  }
  async function performDeleteTrade() {
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    if (!id) return;
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) return;
      await repo.deleteTrade(userId, id);
      setTrades((current) => current.filter((t) => t.id !== id));
    } catch (e) {
      setDbError('Failed to delete trade. ' + String((e as any)?.message || e));
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={[styles.app, compact && styles.appCompact]}>
        <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
          <View style={styles.logoRow}>
            <View style={styles.logoMark}><Text style={styles.logoMarkText}>T</Text></View>
            <View><Text style={styles.logoTitle}>TradeOS</Text><Text style={styles.mutedSmall}>Options journal intelligence</Text></View>
          </View>
          <View style={{ paddingVertical: 2, paddingLeft: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.cyan + '22' }}>
                <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: .08, textTransform: 'uppercase', color: colors.cyan }}>Private Beta</Text>
              </View>
            </View>
            <Text style={[styles.mutedSmall, { marginTop: 4, fontSize: 11 }]} numberOfLines={1}>{ownerEmail}</Text>
          </View>
          <TickerStrip trades={trades} />
          <View style={[styles.nav, compact && styles.navCompact]}>
            {screens.map((item) => (
              <TouchableOpacity key={item} onPress={() => setScreen(item)} style={[styles.navItem, screen === item && styles.navActive]}>
                <Text style={[styles.navText, screen === item && styles.navTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!compact && <GlassCard><Text style={styles.mutedSmall}>Today’s AI read</Text><Text style={styles.cardTitle}>High discipline day</Text><Text style={styles.muted}>Best win probability appears when the 15-minute rule and EMA cross confirm before entry.</Text></GlassCard>}
          <TouchableOpacity style={[styles.navItem, { marginTop: 'auto' }]} onPress={onSignOut}>
            <Text style={styles.navText}>Sign out {isOwner ? '(owner)' : ''}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.main} contentContainerStyle={styles.mainContent}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>Daily trading command center</Text>
              <Text style={[styles.hero, compact && { fontSize: 26, lineHeight: 30 }]}>Track every setup. Learn what actually wins.</Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen('New Trade')}><Text style={styles.primaryText}>Log New Trade</Text></TouchableOpacity>
          </View>

          {screen === 'Dashboard' && <Dashboard stats={stats} compact={compact} trades={trades} onNewTrade={() => setScreen('New Trade')} />}
          {screen === 'New Trade' && <NewTrade draft={draft} setDraft={setDraft} trades={trades} onSaveAttempt={openSaveConfirm} />}
          {screen === 'Trade Log' && <TradeLog trades={trades} onOpenEdit={openEditTrade} onDelete={deleteTrade} />}
          {screen === 'Analytics' && <Analytics analyses={analyses} stats={stats} trades={trades} />}
          {screen === 'Reports' && <Reports trades={trades} stats={stats} />}
          {screen === 'Settings' && <Settings />}
          {!!dbError && <Text style={styles.error}>{dbError}</Text>}
        </ScrollView>
      </View>

      {deleteConfirmId && (
        <Modal transparent visible animationType="fade" onRequestClose={cancelDelete}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Delete this trade?</Text>
              <Text style={styles.mutedSmall}>Deleting this will affect your overall Win/Loss analytics. This cannot be undone.</Text>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={cancelDelete}><Text style={styles.buttonText}>No, keep it</Text></TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={performDeleteTrade}><Text style={styles.buttonText}>Yes, delete</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Save-confirm popup */}
      <Modal transparent visible={confirmVisible} animationType="fade" onRequestClose={closeSaveConfirm}>
        <View style={styles.modalBackdrop}>
          {pendingSave && (
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Save this trade?</Text>
              {pendingSave.symbol ? <Text style={[styles.mutedSmall, { marginBottom: 8 }]}>{pendingSave.symbol.toUpperCase()} · {pendingSave.buyingType.toUpperCase()} · {pendingSave.contractCount} contracts</Text> : null}
              <View style={styles.predBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={styles.predLabel}>Predicted win success (matched conditions)</Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: (prediction.confidence === 'High' ? colors.green : prediction.confidence === 'Med' ? colors.yellow : colors.red) + '22' }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: prediction.confidence === 'High' ? colors.green : prediction.confidence === 'Med' ? colors.yellow : colors.red }}>{prediction.confidence} confidence</Text>
                  </View>
                </View>
                {(() => { const c = probGrade(prediction.percent); const track = c === 'green' ? colors.green : c === 'amber' ? colors.yellow : colors.red; return (
                  <View style={[styles.predTrack, { height: 22 }]}><View style={[styles.predFill, { width: `${Math.min(100, prediction.percent)}%`, height: 22, backgroundColor: track, shadowColor: track, shadowOpacity: .7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } }]} /></View>
                ); })()}
                <Text style={styles.predValue}><Text style={{ color: probGrade(prediction.percent) === 'green' ? colors.green : probGrade(prediction.percent) === 'amber' ? colors.yellow : colors.red }}>{prediction.percent}%</Text> <Text style={styles.mutedSmall}>· {prediction.matched} · n={prediction.sampleSize}</Text></Text>
              </View>
              {rr.ratio !== null && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ color: rr.passes ? colors.green : colors.red, fontWeight: '900' }}>R:R {rr.ratio.toFixed(2)}</Text>
                  <Text style={[styles.mutedSmall, { flex: 1 }]}>Risk ${rr.risk.toFixed(2)} → Reward ${rr.reward.toFixed(2)}</Text>
                </View>
              )}
              {prediction.percent < 45 && <Text style={[styles.error, { marginBottom: 10 }]}>⚠ This setup has won only {prediction.percent}% historically — proceed with caution and small size.</Text>}
              <Text style={styles.mutedSmall}>Based on your closest matching condition combo from your trade history.</Text>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeSaveConfirm}><Text style={styles.buttonText}>No, cancel</Text></TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={confirmSave}><Text style={styles.buttonText}>Yes, save</Text></TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Edit trade modal */}
      <EditTradeModal trade={editingTrade} onClose={closeEditTrade} onSave={commitEditTrade} />
    </SafeAreaView>
  );
}

function Dashboard({ stats, compact, trades, onNewTrade }: { stats: ReturnType<typeof buildDashboardStats>; compact: boolean; trades: Trade[]; onNewTrade: () => void }) {
  const hasTrades = (stats.daily.totalTrades || stats.weekly.totalTrades || stats.monthly.totalTrades) > 0;
  const results = trades.map((t) => { const f = calculateTradeFinancials(t); return { id: t.id, symbol: t.symbol || '—', net: f.netProfitLoss ?? 0, date: t.tradeDate, open: f.result === 'open' }; });
  const openCount = trades.filter((t) => t.status === 'open').length;
  const hour = new Date().getHours();
  const morning = hour >= 8 && hour < 11;
  const [statModal, setStatModal] = React.useState<{ title: string; rows: Array<{ period: string; value: string; detail?: string; tone: 'green' | 'red' | 'cyan' | 'yellow' | 'muted' }> } | null>(null);
  const topSetups = findHighProbabilitySetups(trades, 5).setups;
  const p = (period: string, value: string, tone: 'green' | 'red' | 'cyan' | 'yellow' | 'muted', detail?: string) => detail === undefined ? { period, value, tone } : { period, value, tone, detail };
  const modalD = (periods: { daily: PeriodStats; weekly: PeriodStats; monthly: PeriodStats }) => [
    p('Today', formatCurrency(periods.daily.netProfitLoss), periods.daily.netProfitLoss >= 0 ? 'green' : 'red', `${periods.daily.wins}W/${periods.daily.losses}L · ${periods.daily.totalTrades} trades`),
    p('This Week', formatCurrency(periods.weekly.netProfitLoss), periods.weekly.netProfitLoss >= 0 ? 'green' : 'red', `${periods.weekly.wins}W/${periods.weekly.losses}L · ${periods.weekly.totalTrades} trades`),
    p('This Month', formatCurrency(periods.monthly.netProfitLoss), periods.monthly.netProfitLoss >= 0 ? 'green' : 'red', `${periods.monthly.wins}W/${periods.monthly.losses}L · ${periods.monthly.totalTrades} trades`),
  ];
  return <View>
    <NotifierBanner morning={morning} openCount={openCount} hasTrades={hasTrades} onAction={onNewTrade} />
    {!hasTrades && (
      <View style={[styles.card, { marginBottom: 16 }]}>
        <Text style={styles.cardTitle}>Welcome to TradeOS</Text>
        <Text style={[styles.muted, { marginTop: 6 }]}>Start building your edge in 3 quick steps:</Text>
        <View style={{ marginTop: 12, gap: 10 }}>
          {['1 · Log your first trade with its conditions', '2 · Record your sell price when you exit', '3 · Watch the probability engine reveal what wins'].map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,.03)' }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: i === 0 ? colors.cyan : colors.violet, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#041018', fontWeight: '900' }}>{i + 1}</Text></View>
              <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>{s}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[styles.primaryButton, { marginTop: 16, alignSelf: 'flex-start' }]} onPress={onNewTrade}><Text style={styles.primaryText}>Log Your First Trade →</Text></TouchableOpacity>
      </View>
    )}
    <View style={[styles.kpiGrid, compact && styles.oneCol]}>
      <Kpi label="Daily P/L" value={formatCurrency(stats.daily.netProfitLoss)} tone={stats.daily.netProfitLoss >= 0 ? 'green' : 'red'} detail={`${stats.daily.wins}W / ${stats.daily.losses}L`} onPress={() => setStatModal({ title: 'Profit / Loss', rows: modalD(stats) })} />
      <Kpi label="Win Rate" value={formatPercent(stats.winRate)} tone="cyan" detail={`${stats.totalWins}W / ${stats.totalLosses}L closed`} onPress={() => setStatModal({ title: 'Win Rate', rows: [
        p('Today', formatPercent(stats.daily.winRate), 'cyan', `${stats.daily.wins}W/${stats.daily.losses}L`),
        p('This Week', formatPercent(stats.weekly.winRate), 'cyan', `${stats.weekly.wins}W/${stats.weekly.losses}L`),
        p('This Month', formatPercent(stats.monthly.winRate), 'cyan', `${stats.monthly.wins}W/${stats.monthly.losses}L`),
      ] })} />
      <Kpi label="Average Win" value={formatCurrency(stats.averageWinningTrade)} tone="green" detail="Avg winning trade" onPress={() => setStatModal({ title: 'Average Win', rows: [
        p('Today', formatCurrency(stats.daily.averageWinningTrade), 'green'),
        p('This Week', formatCurrency(stats.weekly.averageWinningTrade), 'green'),
        p('This Month', formatCurrency(stats.monthly.averageWinningTrade), 'green'),
      ] })} />
      <Kpi label="Average Loss" value={formatCurrency(stats.averageLosingTrade)} tone="yellow" detail="Avg losing trade" onPress={() => setStatModal({ title: 'Average Loss', rows: [
        p('Today', formatCurrency(stats.daily.averageLosingTrade), 'yellow'),
        p('This Week', formatCurrency(stats.weekly.averageLosingTrade), 'yellow'),
        p('This Month', formatCurrency(stats.monthly.averageLosingTrade), 'yellow'),
      ] })} />
      <Kpi label="Rule Discipline" value={formatPercent(stats.ruleDisciplineScore)} tone="green" detail="Checklist adherence" />
    </View>
    {statModal ? <StatsModal title={statModal.title} rows={statModal.rows} onClose={() => setStatModal(null)} /> : null}
    <View style={[styles.twoCol, compact && styles.oneCol, { marginTop: 4 }]}>
      <View style={{ flex: 1.4, minWidth: 300 }}>
        {results.length >= 2 ? <ResultLineChart results={results} /> : <GlassCard><Text style={styles.cardTitle}>Results Trend</Text><Text style={styles.muted}>Log 2+ trades to see your cumulative P/L trend here.</Text></GlassCard>}
      </View>
      <View style={{ flex: 1, gap: 16, minWidth: 260 }}>
        <TouchableOpacity onPress={() => topSetups.length && setStatModal({ title: 'Top Setups (Win Rate)', rows: topSetups.map((s, i) => p(`#${i + 1} · ${s.label}`, formatPercent(s.winRate), s.winRate >= 0.5 ? 'green' : 'yellow', `n=${s.sampleSize}`)) })} activeOpacity={0.85}>
          <GlassCard>
            <Text style={styles.cardTitle}>Best Setup {topSetups.length ? '▸' : ''}</Text>
            {stats.bestSetupPattern ? <><Text style={{ fontSize: 22, fontWeight: '900', color: colors.green, marginVertical: 6 }}>{formatPercent(stats.bestSetupPattern.winRate)}</Text><Text style={styles.mutedSmall}>{stats.bestSetupPattern.label} · n={stats.bestSetupPattern.sampleSize}</Text></> : <Text style={styles.muted}>Log more closed trades to surface your best setup.</Text>}
            {topSetups.length ? <Text style={[styles.mutedSmall, { marginTop: 6, color: colors.cyan }]}>Tap to see top {Math.min(5, topSetups.length)} setups ▸</Text> : null}
          </GlassCard>
        </TouchableOpacity>
        <GlassCard>
          <Text style={styles.cardTitle}>Rule Discipline</Text>
          <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.round(stats.ruleDisciplineScore * 100)}%`, backgroundColor: colors.green }]} /></View>
          <Text style={[styles.muted, { marginTop: 10 }]}>{stats.summary}</Text>
        </GlassCard>
      </View>
    </View>
  </View>;
}

function NewTrade({ draft, setDraft, trades, onSaveAttempt }: { draft: Trade; setDraft: (t: Trade) => void; trades: Trade[]; onSaveAttempt: (t: Trade) => void }) {
  const financials = calculateTradeFinancials(draft);
  const errors = validateTradeInput(draft);
  const [touched, setTouched] = React.useState(false);
  // Clear error state when the form is reset to a pristine new draft (e.g. after a successful save).
  React.useEffect(() => {
    if (draft.purchasePrice === 0 && !draft.symbol) setTouched(false);
  }, [draft.purchasePrice, draft.symbol]);
  const update = (patch: Partial<Trade>) => { setTouched(true); setDraft({ ...draft, ...patch }); };
  const best = bestRecommendedSetup(trades);
  const showErrors = touched && errors.length > 0;
  return <GlassCard>
    <Text style={styles.cardTitle}>New Trade Entry</Text>
    {best && (
      <View style={{ padding: 12, borderRadius: 14, borderColor: colors.cyan + '55', borderWidth: 1, backgroundColor: colors.cyan + '12', marginBottom: 12 }}>
        <Text style={{ color: colors.cyan, fontWeight: '900', fontSize: 12 }}>⚡ Highest-probability setup ({formatPercent(best.winRate)} · n={best.sampleSize})</Text>
        <Text style={styles.mutedSmall}>{best.label}</Text>
      </View>
    )}
    <Text style={styles.muted}>Timestamp auto-detected. Selling price can stay blank until the trade closes.</Text>
    <View style={styles.formGrid}>
      <Field label="Symbol" value={draft.symbol ?? ''} onChangeText={(v) => update({ symbol: v.toUpperCase() })} />
      <Segment label="Market" value={draft.marketExcitement} options={['up', 'down', 'neutral']} onChange={(v) => update({ marketExcitement: v as Trade['marketExcitement'] })} />
      <Toggle label="15 minutes passed?" value={draft.fifteenMinutesPassed} onChange={(v) => update({ fifteenMinutesPassed: v })} />
      <Toggle label="Entry respects 15m high/low?" value={draft.entryRespectsFifteenMinuteHighLow} onChange={(v) => update({ entryRespectsFifteenMinuteHighLow: v })} />
      <Toggle label="9 or 14 EMA crossed?" value={draft.emaCrossed} onChange={(v) => update({ emaCrossed: v })} />
      <Toggle label="Within 25% portfolio?" value={draft.withinPortfolioRiskLimit} onChange={(v) => update({ withinPortfolioRiskLimit: v })} />
      <Toggle label="Closing bell?" value={draft.closingBell ?? false} onChange={(v) => update({ closingBell: v })} />
      <Segment label="Day of week" value={draft.weekday ?? 'Mon'} options={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} onChange={(v) => update({ weekday: v })} />
      <Segment label="VWAP direction" value={draft.vwapDirection ?? 'up'} options={['up', 'down']} onChange={(v) => update({ vwapDirection: (v === 'down' ? 'down' : 'up') as 'up' })} />
      <Segment label="MACD trend" value={draft.macdTrend ?? 'rising'} options={['rising', 'falling']} onChange={(v) => update({ macdTrend: (v === 'falling' ? 'falling' : 'rising') as 'rising' })} />
      <Field label="Trade time (12h, e.g. 3:45 PM)" value={draft.tradeTime ?? ''} placeholder="e.g. 3:45 PM" onChangeText={(v) => update({ tradeTime: v })} />
      <Segment label="Buying" value={draft.buyingType} options={['call', 'put']} onChange={(v) => update({ buyingType: v as Trade['buyingType'] })} />
      <Field label="Contracts" value={draft.contractCount === 1 ? '' : String(draft.contractCount)} placeholder="e.g. 1" keyboardType="numeric" onChangeText={(v) => update({ contractCount: Math.max(1, Math.round(parseFloat(v) || 1)) })} />
      <MoneyField label="Purchase Price ($)" initial={draft.purchasePrice} placeholder="e.g. 2.50" onChange={(n) => update({ purchasePrice: n ?? 0 })} />
      <MoneyField label="Selling Price ($)" initial={draft.sellingPrice} placeholder="e.g. 3.25" allowNull onChange={(n) => update({ sellingPrice: n })} />
      <MoneyField label="Stop Loss ($)" initial={draft.stopLoss ?? null} placeholder="e.g. 2.20" allowNull onChange={(n) => update({ stopLoss: n })} />
      <MoneyField label="Target Price ($)" initial={draft.targetPrice ?? null} placeholder="e.g. 3.50" allowNull onChange={(n) => update({ targetPrice: n })} />
    </View>
    <View style={styles.resultBox}><Text style={styles.mutedSmall}>Auto Result</Text><Text style={[styles.resultText, { color: financials.result === 'loss' ? colors.red : financials.result === 'open' ? colors.yellow : colors.green }]}>{financials.result === 'open' ? 'Open trade' : `${formatCurrency(financials.netProfitLoss ?? 0)} · ${(financials.profitLossPercentage ?? 0).toFixed(1)}%`}</Text></View>
    {errors.length > 0 && touched && errors.slice(0, 1).map((e) => <Text key={e} style={styles.error}>{e}</Text>)}
    <TouchableOpacity style={styles.primaryButton} onPress={() => onSaveAttempt(draft)}><Text style={styles.primaryText}>Save Trade + Update Dashboard</Text></TouchableOpacity>
  </GlassCard>;
}

function SwipeableRow({ onEdit, children }: { onEdit: () => void; children: React.ReactNode }) {
  const tx = useRef(new Animated.Value(0)).current;
  const dxRef = useRef(0);
  const [open, setOpen] = useState(false);
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => { const dx = Math.max(-90, Math.min(0, dxRef.current + g.dx)); dxRef.current = dx; tx.setValue(dx); if (dx < -8) setOpen(true); },
    onPanResponderRelease: (_, g) => {
      const next = g.dx < -40 ? -80 : 0;
      dxRef.current = next;
      setOpen(next < 0);
      Animated.spring(tx, { toValue: next, useNativeDriver: false, bounciness: 4 }).start();
    },
    onPanResponderTerminate: () => { dxRef.current = 0; setOpen(false); Animated.spring(tx, { toValue: 0, useNativeDriver: false }).start(); },
  });
  // White pen (pencil) icon as inline SVG — only shown when revealed.
  const penIcon = React.createElement('div', {
    dangerouslySetInnerHTML: {
      __html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="white"/></svg>`,
    },
  });
  return (
    <View style={{ position: 'relative', overflow: 'hidden' }}>
      {open && (
        <Animated.View style={[styles.editUnderlay, { right: 0, opacity: tx.interpolate({ inputRange: [-90, 0], outputRange: [1, 0.3] }) }]}>
          <TouchableOpacity onPress={onEdit} style={styles.editBtn}>{penIcon}</TouchableOpacity>
        </Animated.View>
      )}
      <Animated.View {...pan.panHandlers} style={[styles.tradeRow, { transform: [{ translateX: tx }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

function TradeLog({ trades, onOpenEdit, onDelete }: { trades: Trade[]; onOpenEdit: (t: Trade) => void; onDelete: (id: string) => void }) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const results = trades.map((t) => { const f = calculateTradeFinancials(t); return { id: t.id, symbol: t.symbol || '—', net: f.netProfitLoss ?? 0, date: t.tradeDate, open: f.result === 'open' }; });
  const chip = (label: string, on: boolean | string) => (
    <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, borderWidth: 1, borderColor: on ? 'rgba(53,255,155,.5)' : colors.line, backgroundColor: on ? 'rgba(53,255,155,.12)' : 'rgba(255,255,255,.04)' }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: on ? colors.green : colors.muted }}>{label}</Text>
    </View>
  );
  return <GlassCard>
    <Text style={styles.cardTitle}>Trade Log</Text>
    {trades.length === 0 && <Text style={styles.muted}>No trades yet. Log your first trade in "New Trade".</Text>}
    {results.length >= 2 && <ResultLineChart results={results} />}
    <Text style={styles.mutedSmall}>Tip: tap a trade to expand details · ✎ to edit · ✕ to delete · swipe closed trade left for quick edit.</Text>
    {trades.map((trade) => {
      const f = calculateTradeFinancials(trade);
      const buyV = trade.purchasePrice > 0 ? `$${trade.purchasePrice.toFixed(2)}` : '—';
      const sellV = trade.sellingPrice !== null && trade.sellingPrice !== undefined ? `$${trade.sellingPrice.toFixed(2)}` : null;
      const expanded = expandedId === trade.id;
      const row = (
        <>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setExpandedId(expanded ? null : trade.id)}>
            <Text style={styles.tradeSymbol}>{trade.symbol || '—'} · {trade.buyingType.toUpperCase()}</Text>
            <Text style={styles.mutedSmall}>{trade.tradeDate} · {trade.marketExcitement} · {trade.contractCount} contracts</Text>
            <Text style={styles.mutedSmall}>Buy: {buyV}</Text>
            {trade.tradeTime ? <Text style={styles.mutedSmall}>Time: {trade.tradeTime}</Text> : null}
            {sellV !== null && <Text style={[styles.mutedSmall, { color: colors.green }]}>Sell: {sellV}</Text>}
          </TouchableOpacity>
          <Text style={{ color: f.result === 'loss' ? colors.red : f.result === 'open' ? colors.yellow : colors.green, fontWeight: '900' }}>{f.result === 'open' ? 'OPEN' : formatCurrency(f.netProfitLoss ?? 0)}</Text>
          <TouchableOpacity onPress={() => onOpenEdit(trade)} style={{ marginLeft: 12, paddingHorizontal: 8 }}><Text style={{ color: colors.cyan, fontSize: 11 }}>✎</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(trade.id)} style={{ marginLeft: 8, paddingHorizontal: 6 }}><Text style={{ color: colors.red }}>✕</Text></TouchableOpacity>
        </>
      );
      const detail = expanded && (
        <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.07)' }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {chip('15m passed', trade.fifteenMinutesPassed)}
            {chip('15m HL', trade.entryRespectsFifteenMinuteHighLow)}
            {chip('EMA', trade.emaCrossed)}
            {chip('Risk', trade.withinPortfolioRiskLimit)}
            {chip('Closing bell', trade.closingBell ?? false)}
            {chip(`VWAP ${trade.vwapDirection ?? '—'}`, trade.vwapDirection === 'up')}
            {chip(`MACD ${trade.macdTrend ?? '—'}`, trade.macdTrend === 'rising')}
            {chip(trade.weekday ?? '—', !!trade.weekday)}
          </View>
          {(trade.notes || trade.strategyTag) && <Text style={[styles.mutedSmall, { marginTop: 8 }]}>{(trade.strategyTag ? trade.strategyTag + ' · ' : '') + (trade.notes || '')}</Text>}
          {(trade.stopLoss != null || trade.targetPrice != null) && <Text style={[styles.mutedSmall, { marginTop: 8, color: colors.cyan }]}>Stop ${trade.stopLoss != null ? trade.stopLoss.toFixed(2) : '—'} · Target ${trade.targetPrice != null ? trade.targetPrice.toFixed(2) : '—'}</Text>}
        </View>
      );
      const comp = trade.status === 'closed' ? (
        <SwipeableRow key={trade.id} onEdit={() => onOpenEdit(trade)}>{row}</SwipeableRow>
      ) : (
        <View key={trade.id} style={styles.tradeRow}>{row}</View>
      );
      return <View key={trade.id + '-wrap'}>{comp}{detail}</View>;
    })}
  </GlassCard>;
}

function Analytics({ analyses, stats, trades }: { analyses: ReturnType<typeof analyzeAllConditions>; stats: ReturnType<typeof buildDashboardStats>; trades: Trade[] }) {
  const { width } = useWindowDimensions();
  const compact = width < 780;
  const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
  const rankings = rankCombosByWinRate(trades, 2);
  const expectancy = computeExpectancy(trades);
  const sizing = computePositionSizing(trades, localDatabase.settings.riskLimitPercent);
  const form = recentForm(trades, 20);
  const [drillKey, setDrillKey] = React.useState<string | null>(null);
  const drillTrades = drillKey ? trades.filter((t) => {
    const key = [t.marketExcitement, t.vwapDirection ?? '—', t.macdTrend ?? '—', t.buyingType].join('|');
    return key === drillKey;
  }) : [];
  const toneColor = (tone: string) => ({ green: colors.green, cyan: colors.cyan, violet: colors.violet, red: colors.red, yellow: colors.yellow } as Record<string, string>)[tone] || colors.cyan;
  const hero = [
    { label: 'Overall Win Rate', value: formatPercent(overallWinRate), tone: 'green', detail: `${rankings.totalClosed} closed` },
    { label: 'Expectancy / Trade', value: formatCurrency(expectancy.expectancy), tone: 'cyan', detail: 'avg net P/L' },
    { label: 'Profit Factor', value: expectancy.profitFactor === Infinity ? '∞' : expectancy.profitFactor.toFixed(2), tone: 'violet', detail: 'gross win : loss' },
    { label: 'Recent Form', value: formatPercent(form.recentWinRate), tone: 'yellow', detail: `last ${form.recentCount} vs overall` },
  ];
  return <View style={styles.twoCol}>
    {/* Probability engine hero strip */}
    <GlassCard>
      <Text style={styles.eyebrow}>Probability Engine</Text>
      <View style={[styles.kpiGrid, compact && styles.oneCol]}>
        {hero.map((h) => <View key={h.label} style={{ flex: 1, minWidth: 160, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,.03)' }}><Text style={styles.mutedSmall}>{h.label}</Text><CountUp value={h.value} color={toneColor(h.tone)} /><Text style={styles.mutedSmall}>{h.detail}</Text></View>)}
      </View>
    </GlassCard>
    {/* Directional market combo */}
    <GlassCard><Text style={styles.cardTitle}>Top Winning Combos (tap to see trades)</Text>
      {winRateByMarketCombo(trades).length === 0 && <Text style={styles.muted}>Log closed trades with market/VWAP/MACD to see your strongest direction combo.</Text>}
      {winRateByMarketCombo(trades).slice(0, 6).map((c, i) => {
        const first = c.label.split(' · ')[0] || '';
        const comboKey = [first.toLowerCase(), c.label.includes('VWAP down') ? 'down' : 'up', c.label.includes('MACD falling') ? 'falling' : 'rising', c.label.includes('Put') ? 'put' : 'call'].join('|');
        const open = drillKey === comboKey;
        return (
          <View key={c.label}>
            <TouchableOpacity style={styles.metric} onPress={() => setDrillKey(open ? null : comboKey)}>
              <Text style={[styles.muted, { flex: 1 }]}><Text style={{ color: colors.cyan, fontWeight: '900' }}>#{i + 1}</Text> {c.label} · n={c.trades}</Text>
              <Text style={styles.metricValue}><Text style={{ color: colors.green }}>{formatPercent(c.winRate)}</Text> / <Text style={{ color: colors.red }}>{formatPercent(c.lossRate)}</Text></Text>
            </TouchableOpacity>
            {open && drillTrades.map((d) => { const f = calculateTradeFinancials(d); return (
              <View key={d.id} style={{ paddingVertical: 6, paddingHorizontal: 12, borderLeftWidth: 2, borderLeftColor: colors.cyan + '66' }}>
                <Text style={styles.mutedSmall}>{d.symbol || '—'} · {d.tradeDate} · {d.contractCount}@{d.purchasePrice}</Text>
                <Text style={{ fontSize: 12, fontWeight: '800', color: f.result === 'loss' ? colors.red : f.result === 'gain' ? colors.green : colors.yellow }}>{(f.netProfitLoss ?? 0) > 0 ? '+' : ''}{formatCurrency(f.netProfitLoss ?? 0)}</Text>
              </View>
            ); })}
            {open && drillTrades.length === 0 && <Text style={[styles.mutedSmall, { paddingLeft: 12 }]}>No trades in this combo.</Text>}
          </View>
        );
      })}
    </GlassCard>
    {/* Higher-probability set-ups, most important */}
    <GlassCard><Text style={styles.cardTitle}>Combos: Best → Least (Win / Loss rate)</Text>
      <Metric label="Overall win rate" value={`${formatPercent(overallWinRate)}`} />
      {rankings.combos.length === 0 && <Text style={styles.muted}>Log more closed trades (min 2 per combo) to rank combinations.</Text>}
      {rankings.combos.map((s, i) => <View key={s.label} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}><Text style={{ color: colors.green, fontWeight: '900' }}>#{i + 1}</Text> {s.label}</Text><Text style={styles.metricValue}><Text style={{ color: colors.green }}>{formatPercent(s.winRate)}</Text> / <Text style={{ color: colors.red }}>{formatPercent(s.lossRate)}</Text> · n={s.sampleSize}</Text></View>)}
    </GlassCard>
    {/* Edge metrics */}
    <GlassCard><Text style={styles.cardTitle}>Edge & Edge Sizing</Text>
      <Metric label="Expectancy / trade" value={formatCurrency(expectancy.expectancy)} />
      <Metric label="Profit factor" value={expectancy.profitFactor === Infinity ? '∞' : expectancy.profitFactor.toFixed(2)} />
      <Metric label="Payoff ratio" value={expectancy.payoffRatio.toFixed(2)} />
      <Text style={styles.mutedSmall}>Profit Factor = total profit ÷ total loss (net-positive if &gt;1). Payoff = avg win ÷ avg loss (reward per $1 risked). PF ≈ Payoff × (win rate ÷ loss rate).</Text>
      <Metric label="Recent form (last 20)" value={`${formatPercent(form.recentWinRate)} vs ${formatPercent(form.overallWinRate)}`} />
      <Text style={styles.mutedSmall}>{sizing.message}</Text>
    </GlassCard>
    {/* per-symbol */}
    <GlassCard><Text style={styles.cardTitle}>Edge by Symbol</Text>
      {breakDownBySymbol(trades).slice(0, 6).length > 0 && <AnimatedBarChart data={breakDownBySymbol(trades).slice(0, 8).map((s) => ({ label: s.symbol, value: s.winRate, pct: Math.round(s.winRate * 100), sub: `${s.trades} trades` }))} unit="" />}
    </GlassCard>
    {/* per-strategy */}
    <GlassCard><Text style={styles.cardTitle}>Edge by Strategy</Text>
      {breakDownByStrategy(trades).slice(0, 6).map((s) => <View key={s.tag} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.tag}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · n={s.trades}</Text></View>)}
    </GlassCard>
    {/* legacy condition cards */}
    <GlassCard><Text style={styles.cardTitle}>Single-Condition Lift</Text>{analyses.slice(0, 3).map((a) => <View key={String(a.key)} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{a.label}</Text><Text style={styles.metricValue}>{formatPercent(a.trueWinRate)} · +{(a.winLift * 100).toFixed(0)}pts</Text></View>)}</GlassCard>
    {/* Time of day win rate */}
    <GlassCard><Text style={styles.cardTitle}>Win Rate by Time of Day</Text>
      {winRateByTimeOfDay(trades).length === 0 && <Text style={styles.muted}>Add a trade time (HH:MM) to trades to see when you win most.</Text>}
      {winRateByTimeOfDay(trades).length > 0 && <AnimatedBarChart data={winRateByTimeOfDay(trades).map((s) => ({ label: s.label.split('–')[0] || s.label, value: s.winRate, pct: Math.round(s.winRate * 100), sub: `n=${s.trades}` }))} unit="" />}
    </GlassCard>
    {/* Win rate by weekday */}
    <GlassCard><Text style={styles.cardTitle}>Win Rate by Day of Week</Text>
      {winRateByWeekday(trades).length === 0 && <Text style={styles.muted}>Set a day of week (Mon-Fri) on trades to see your best trading days.</Text>}
      {winRateByWeekday(trades).length > 0 && <AnimatedBarChart data={winRateByWeekday(trades).map((s) => ({ label: s.weekday, value: s.winRate, pct: Math.round(s.winRate * 100), sub: `n=${s.trades}` }))} unit="" />}
    </GlassCard>
    {/* Direction win-rate (VWAP / MACD) */}
    <GlassCard><Text style={styles.cardTitle}>Edge by Condition — VWAP</Text>
      {winRateByDirection(trades, 'vwapDirection', VWAP_LABELS).length === 0 && <Text style={styles.muted}>Log more closed trades to rank VWAP values.</Text>}
      {winRateByDirection(trades, 'vwapDirection', VWAP_LABELS).length > 0 && <AnimatedBarChart data={winRateByDirection(trades, 'vwapDirection', VWAP_LABELS).map((s) => ({ label: s.value.toUpperCase(), value: s.winRate, pct: Math.round(s.winRate * 100), sub: s.label, color: s.value === 'up' ? '#45e5ff' : '#7b61ff' }))} unit="" />}
    </GlassCard>
    {/* Win rate by MACD trend */}
    <GlassCard><Text style={styles.cardTitle}>Win Rate by MACD Trend</Text>
      {winRateByDirection(trades, 'macdTrend', MACD_LABELS).length === 0 && <Text style={styles.muted}>Log more closed trades to rank MACD trend values.</Text>}
      {winRateByDirection(trades, 'macdTrend', MACD_LABELS).length > 0 && <AnimatedBarChart data={winRateByDirection(trades, 'macdTrend', MACD_LABELS).map((s) => ({ label: s.value.toUpperCase(), value: s.winRate, pct: Math.round(s.winRate * 100), sub: s.label, color: s.value === 'rising' ? '#35ff9b' : '#ff4d6d' }))} unit="" />}
    </GlassCard>
  </View>;
}

function Reports({ trades, stats }: { trades: Trade[]; stats: ReturnType<typeof buildDashboardStats> }) {
  const expectancy = computeExpectancy(trades);
  const sizing = computePositionSizing(trades, localDatabase.settings.riskLimitPercent);
  const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
  const form = recentForm(trades, 20);
  const { width } = useWindowDimensions();
  const compact = width < 780;
  function exportCsv() {
    const csv = buildTradesCsv(trades);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tradeos-trades-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  function exportPdf() {
    const rows = trades.map((t) => { const f = calculateTradeFinancials(t); return `<tr><td>${t.tradeDate}</td><td>${t.symbol || '—'}</td><td>${t.buyingType.toUpperCase()}</td><td>${t.contractCount}</td><td>$${(t.purchasePrice || 0).toFixed(2)}</td><td>${t.sellingPrice !== null ? '$' + t.sellingPrice.toFixed(2) : '—'}</td><td style="color:${f.result === 'loss' ? '#ff4d6d' : f.result === 'gain' ? '#35ff9b' : '#ffcc66'}">${f.result === 'open' ? 'OPEN' : formatCurrency(f.netProfitLoss ?? 0)}</td></tr>`; }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>TradeOS — Weekly Review</title><style>body{font-family:Inter,system-ui,sans-serif;color:#0b1220;padding:28px}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;font-size:13px}th{color:#5b6b82;text-transform:uppercase;font-size:11px}.kpis{display:flex;gap:16px;margin:16px 0}.kpi{background:#f1f5f9;border-radius:12px;padding:14px}.kpi small{color:#5b6b82}.kpi b{display:block;font-size:20px}</style></head><body><h1>TradeOS — Weekly Review</h1><div class="kpis"><div class="kpi"><small>Net P/L This Week</small><b>${formatCurrency(stats.weekly.netProfitLoss)}</b></div><div class="kpi"><small>Win Rate</small><b>${formatPercent(stats.winRate)}</b></div><div class="kpi"><small>Trades</small><b>${stats.weekly.totalTrades}</b></div><div class="kpi"><small>Avg Win / Loss</small><b>${formatCurrency(stats.averageWinningTrade)} / ${formatCurrency(stats.averageLosingTrade)}</b></div></div><table><thead><tr><th>Date</th><th>Sym</th><th>Type</th><th>Contracts</th><th>Buy</th><th>Sell</th><th>P/L</th></tr></thead><tbody>${rows}</tbody></table><p style="color:#5b6b82;font-size:11px;margin-top:20px">Generated by TradeOS · ${new Date().toLocaleString()}</p></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  }
  const hero = [
    { label: 'Net P/L Today', value: formatCurrency(stats.daily.netProfitLoss), tone: stats.daily.netProfitLoss >= 0 ? 'green' : 'red' },
    { label: 'Trades This Week', value: String(stats.weekly.totalTrades), tone: 'cyan' },
    { label: 'Biggest Win', value: formatCurrency(stats.weekly.biggestWin), tone: 'green' },
    { label: 'Biggest Loss', value: formatCurrency(stats.weekly.biggestLoss), tone: 'red' },
  ];
  const toneColor = (tone: string) => ({ green: colors.green, cyan: colors.cyan, violet: colors.violet, red: colors.red, yellow: colors.yellow } as Record<string, string>)[tone] || colors.cyan;
  const periods = [
    { label: 'Daily', p: stats.daily, color: '#35ff9b' },
    { label: 'Weekly', p: stats.weekly, color: '#45e5ff' },
    { label: 'Monthly', p: stats.monthly, color: '#7b61ff' },
  ];
  return <View style={styles.twoCol}>
    <GlassCard>
      <Text style={styles.eyebrow}>Reports</Text>
      <View style={[styles.kpiGrid, compact && styles.oneCol]}>
        {hero.map((h) => <View key={h.label} style={{ flex: 1, minWidth: 150, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,.03)' }}><Text style={styles.mutedSmall}>{h.label}</Text><CountUp value={h.value} color={toneColor(h.tone)} /></View>)}
      </View>
      <Text style={[styles.muted, { marginTop: 16 }]}>Daily, weekly, and monthly review summaries are generated from your closed trades.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
        <TouchableOpacity style={styles.secondaryButton} onPress={exportCsv}><Text style={styles.buttonText}>Export CSV ({trades.length})</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={exportPdf}><Text style={styles.buttonText}>Print / Save PDF</Text></TouchableOpacity>
      </View>
    </GlassCard>

    <GlassCard>
      <Text style={styles.cardTitle}>Period Breakdown</Text>
      {periods.map((x) => (
        <View key={x.label} style={styles.metric}>
          <Text style={[styles.muted, { flex: 1 }]}>{x.label} · {x.p.totalTrades} trades</Text>
          <Text style={{ color: x.p.netProfitLoss >= 0 ? colors.green : colors.red, fontWeight: '900' }}>{formatCurrency(x.p.netProfitLoss)} · {formatPercent(x.p.winRate)} WR</Text>
        </View>
      ))}
      {periods.length > 0 && <AnimatedBarChart data={periods.map((x) => ({ label: x.label, value: x.p.netProfitLoss, pct: Math.max(0, Math.round((x.p.netProfitLoss / Math.max(1, Math.max(...periods.map((z) => Math.abs(z.p.netProfitLoss))), 1)) * 100)), color: x.p.netProfitLoss >= 0 ? '#35ff9b' : '#ff4d6d', sub: `${x.p.totalTrades} trades` }))} unit="" />}
    </GlassCard>

    <GlassCard>
      <Text style={styles.cardTitle}>Probability Snapshot</Text>
      <Metric label="Overall win rate" value={formatPercent(overallWinRate)} />
      <Metric label="Expectancy / trade" value={formatCurrency(expectancy.expectancy)} />
      <Metric label="Profit Factor" value={expectancy.profitFactor === Infinity ? '∞' : expectancy.profitFactor.toFixed(2)} />
      <Metric label="Payoff ratio" value={expectancy.payoffRatio.toFixed(2)} />
      <Metric label="Position size (Kelly)" value={sizing.recommendedRiskPercent > 0 ? `${sizing.recommendedRiskPercent.toFixed(1)}%` : '—'} />
      <Metric label="Recent form" value={`${formatPercent(form.recentWinRate)} (last ${form.recentCount})`} />
      <Metric label="# Days Hold (avg)" value={String(averageDaysHeld(trades))} />
    </GlassCard>
  </View>;
}

function Settings() { return <GlassCard><Text style={styles.cardTitle}>Settings / Rule Engine</Text><Metric label="Timezone" value={localDatabase.settings.timezone} /><Metric label="Market Open" value={localDatabase.settings.marketOpenTime} /><Metric label="Risk Limit" value={`${localDatabase.settings.riskLimitPercent}%`} /><Metric label="Portfolio" value={formatCurrency(localDatabase.settings.portfolioValue)} /></GlassCard>; }

function EditTradeModal({ trade, onClose, onSave }: { trade: Trade | null; onClose: () => void; onSave: (t: Trade) => void }) {
  const [symbol, setSymbol] = React.useState<string>('');
  const [buy, setBuy] = React.useState('');
  const [sell, setSell] = React.useState('');
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    if (trade) {
      setSymbol(trade.symbol ?? '');
      setBuy(trade.purchasePrice ? String(trade.purchasePrice) : '');
      setSell(trade.sellingPrice === null || trade.sellingPrice === undefined ? '' : String(trade.sellingPrice));
      setErr('');
    }
  }, [trade]);
  if (!trade) return null;
  function submit() {
    const t = trade as Trade;
    if (!symbol) { setErr('Symbol is required.'); return; }
    const buyNum = parseFloat(buy) || 0;
    if (buyNum <= 0) { setErr('Purchase price must be greater than 0.'); return; }
    const sellNum = sell === '' ? null : parseFloat(sell) || 0;
    const closed = sellNum !== null;
    const up: Trade = { ...t, symbol: symbol.toUpperCase(), purchasePrice: buyNum, sellingPrice: sellNum, status: closed ? 'closed' : 'open', ...(closed && !t.closedAt ? { closedAt: new Date().toISOString() } : {}) };
    onSave(up);
  }
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Edit Trade</Text>
          <View style={styles.field}><Text style={styles.mutedSmall}>Symbol</Text><TextInput value={symbol} onChangeText={(v) => setSymbol(v.toUpperCase())} placeholder="e.g. SPY" placeholderTextColor={colors.muted} style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.mutedSmall}>Purchase Price ($)</Text><TextInput value={buy} onChangeText={setBuy} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted} style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.mutedSmall}>Selling Price ($) — leave blank if still open</Text><TextInput value={sell} onChangeText={setSell} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted} style={styles.input} /></View>
          {err ? <Text style={styles.error}>{err}</Text> : null}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}><Text style={styles.buttonText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={styles.confirmButton} onPress={submit}><Text style={styles.buttonText}>Save</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
function GlassCard({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Kpi({ label, value, detail, tone, onPress }: { label: string; value: string; detail: string; tone: 'green' | 'red' | 'cyan' | 'yellow'; onPress?: () => void }) { return (
  <TouchableOpacity activeOpacity={onPress ? 0.8 : 1} disabled={!onPress} onPress={onPress} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: colors[tone], flex: 1, minWidth: 160 }]}>
    <Text style={styles.mutedSmall}>{label}</Text>
    <CountUp value={value} color={colors[tone]} />
    <Text style={styles.mutedSmall}>{detail}</Text>
    {onPress ? <Text style={[styles.mutedSmall, { marginTop: 4, color: colors.cyan }]}>Tap for Daily · Weekly · Monthly ▸</Text> : null}
  </TouchableOpacity>
); }

/** Popup showing a metric across Daily / Weekly / Monthly periods. */
function StatsModal({ title, rows, onClose }: { title: string; rows: Array<{ period: string; value: string; detail?: string; tone: 'green' | 'red' | 'cyan' | 'yellow' | 'muted' }>; onClose: () => void }) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted }}>✕</Text></TouchableOpacity>
          </View>
          <View style={{ marginTop: 12 }}>
            {rows.map((r) => {
              const col = r.tone === 'muted' ? colors.muted : colors[r.tone];
              return (
                <View key={r.period} style={[styles.metric, { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.06)', alignItems: 'center' }]}>
                  <Text style={[styles.muted, { flex: 1, fontWeight: '800' }]}>{r.period}</Text>
                  <Text style={{ color: col, fontWeight: '900', fontSize: 18 }}>{r.value}</Text>
                  {r.detail ? <Text style={[styles.mutedSmall, { marginLeft: 10 }]}>{r.detail}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CountUp({ value, color }: { value: string; color: string }) {
  const target = (() => { const n = parseFloat(value.replace(/[$,%]/g, '')); return isNaN(n) ? 0 : n; })();
  const [cur, setCur] = useState(0);
  useEffect(() => {
    let raf = 0; const start = performance.now(); const dur = 900;
    const step = (t: number) => { const p = Math.min(1, (t - start) / dur); const eased = 1 - Math.pow(1 - p, 3); setCur(Math.round(target * eased)); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [target]);
  // Preserve formatting: currency/percent based on the original value string.
  const prefix = value.startsWith('$') ? '$' : '';
  const suffix = value.endsWith('%') ? '%' : '';
  const formatted = target >= 1000 && !value.includes('%') ? cur.toLocaleString('en-US') : String(cur);
  return <Text style={[styles.kpiValue, { color }]}>{prefix}{formatted}{suffix}</Text>;
}

function TickerStrip({ trades }: { trades: Trade[] }) {
  // Real latest prices via Supabase edge-function proxy (server-side Yahoo fetch),
  // with deterministic offline fallback derived from the user's own trades.
  const syms: string[] = Array.from(new Set(trades.map((t) => t.symbol).filter((s): s is string => Boolean(s)))).slice(0, 6);
  type Quote = { price: number; pct: number; change: number; candles: Array<{ time: number; open: number; high: number; low: number; close: number }> };
  const [live, setLive] = React.useState<Record<string, Quote>>({});
  const [chartSym, setChartSym] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (syms.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const sess = (await supabase.auth.getSession()).data.session;
        const token = sess?.access_token;
        const out: Record<string, Quote> = {};
        await Promise.all(syms.map(async (sym) => {
          try {
            const url = `${SUPABASE_URL}/functions/v1/market-quote?symbol=${encodeURIComponent(sym)}`;
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
            if (res.ok) { const j = await res.json(); if (j.price) out[sym] = { price: j.price, pct: j.pct ?? 0, change: j.change ?? 0, candles: j.candles ?? [] }; }
          } catch { /* fallback below */ }
        }));
        if (alive) setLive(out);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syms.join(',')]);
  if (syms.length === 0) return null;
  const items = syms.map((sym) => {
    const real = live[sym];
    if (real) return { sym, quote: real, live: true };
    const buys = trades.filter((t) => t.symbol === sym && t.purchasePrice > 0);
    const base = buys.length && buys[buys.length - 1]!.purchasePrice;
    const price = base ? (base * (1 + ((sym.length % 5) - 2) / 400)).toFixed(2) : '—';
    const up = (sym.length % 3) !== 0;
    const pct = ((sym.length % 7) + 1).toFixed(2);
    return { sym, quote: { price, pct: parseFloat(pct), change: 0, candles: [] } as unknown as Quote, up, pctStr: pct, live: false };
  });
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,.02)' }}>
        {items.map((it) => {
          const q = it.quote;
          const up = (it.live ? q.pct >= 0 : it.up);
          return (
            <TouchableOpacity key={it.sym} onPress={() => { if (it.live && q.candles?.length) setChartSym(it.sym); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 3, borderRadius: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: '900', color: colors.text }}>{it.sym}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: up ? colors.green : colors.red }}>
                {it.live ? `${q.price.toFixed(2)} ${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} (${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%)` : `${q.price} ${up ? '▲' : '▼'} ${it.pctStr}%°`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {chartSym && live[chartSym]?.candles?.length ? (
        <TechnicalChartModal symbol={chartSym} quote={live[chartSym]!} onClose={() => setChartSym(null)} />
      ) : null}
    </View>
  );
}

function TechnicalChartModal({ symbol, quote, onClose }: { symbol: string; quote: { candles: Array<{ time: number; open: number; high: number; low: number; close: number }> }; onClose: () => void }) {
  const [candles, setCandles] = React.useState(quote.candles || []);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sess = (await supabase.auth.getSession()).data.session;
        const token = sess?.access_token;
        const url = `${SUPABASE_URL}/functions/v1/market-quote?symbol=${encodeURIComponent(symbol)}&interval=5m`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
        if (res.ok) { const j = await res.json(); if (alive && j.candles?.length) setCandles(j.candles); }
      } catch (e) { /* fallback to passed candles */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [symbol]);
  let svg = '';
  if (typeof window !== 'undefined' && candles.length) {
    try { svg = technicalChartSvg(candles, symbol); } catch (e) { console.error('chart svg error', e); }
  }
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { maxWidth: 820 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.modalTitle}>{symbol} — 5-Min Chart</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted }}>✕</Text></TouchableOpacity>
          </View>
          <Text style={[styles.mutedSmall, { marginBottom: 8 }]}>Candles · 9 SMA (cyan) · 20 SMA (orange) · VWAP (white) · MACD</Text>
          {loading ? (
            <View style={{ height: 466, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1330' }}>
              <Text style={styles.muted}>Loading 5-min chart…</Text>
            </View>
          ) : !candles.length ? (
            <View style={{ height: 466, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1330' }}>
              <Text style={styles.muted}>No chart data available (market may be closed).</Text>
            </View>
          ) : (
            React.createElement('div', { style: { width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#0b1330' }, dangerouslySetInnerHTML: { __html: svg } })
          )}
          {err ? <Text style={styles.error}>{err}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

/** Render 5-min candles + 9/20 SMA + VWAP + MACD as a self-contained SVG (works on any static host, no external chart lib). */
function technicalChartSvg(allCandles: Array<{ time: number; open: number; high: number; low: number; close: number }>, _symbol: string): string {
  // Scope to a single trading session: keep the most recent trading day's NY 9:30–16:00 candles.
  const fmt = (ts: number) => { const d = new Date(ts * 1000); return { ymd: [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()].join('-'), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), tz: d }; };
  const lastDay = allCandles.length ? fmt(allCandles[allCandles.length - 1]!.time).ymd : '';
  const candles = allCandles.filter((c) => {
    const f = fmt(c.time);
    if (f.ymd !== lastDay) return false;
    return f.minutes >= 570 && f.minutes <= 960; // 9:30am=570min, 4pm=960min
  });
  const n = candles.length;
  if (n === 0) return '';
  const W = 680, MAIN_H = 340, MACD_H = 110, PADL = 60, PADR = 16, TOP = 24, GAP = 16;
  const chartW = W - PADL - PADR;
  const closes = candles.map((c) => c.close);
  // SMA helper (simple moving average)
  const sma = (period: number) => {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) { sum += closes[i]!; if (i >= period) sum -= closes[i - period]!; if (i >= period - 1) out.push(sum / period); }
    return out;
  };
  const sma9 = sma(9), sma20 = sma(20);
  // VWAP
  const vwap: number[] = []; { let cumPV = 0; for (let i = 0; i < n; i++) { const c = candles[i]!; const tp = (c.high + c.low + c.close) / 3; cumPV += tp; vwap.push(cumPV / (i + 1)); } }
  // MACD (12/26) — EMA based
  const ema = (period: number) => {
    const k = 2 / (period + 1); let prev = 0; const out: number[] = [];
    for (let i = 0; i < n; i++) { prev = i === 0 ? closes[i]! : closes[i]! * k + prev * (1 - k); out.push(prev); }
    return out;
  };
  const macd: number[] = []; { const f12 = ema(12), f26 = ema(26); for (let i = 0; i < n; i++) { const f = f12[i] ?? 0, s = f26[i] ?? 0; macd.push(f - s); } }

  let min = Infinity, max = -Infinity;
  for (const c of candles) { min = Math.min(min, c.low); max = Math.max(max, c.high); }
  for (const v of [...sma9, ...sma20, ...vwap]) { min = Math.min(min, v); max = Math.max(max, v); }
  const pad = (max - min) * 0.08 || 1; min -= pad; max += pad;
  const yP = (v: number) => (MAIN_H - TOP) * (1 - (v - min) / (max - min)) + TOP;
  const xP = (i: number) => PADL + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const bodyW = Math.max(1.5, Math.min(8, (chartW / n) * 0.6));

  // MACD scale
  let macdMax = 1; for (const v of macd) macdMax = Math.max(macdMax, Math.abs(v));
  const macdY = (v: number) => (MAIN_H + GAP) + MACD_H / 2 - (v / macdMax) * (MACD_H / 2 - 6);

  let s = `<svg width="${W}" height="${MAIN_H + GAP + MACD_H}" xmlns="http://www.w3.org/2000/svg" style="display:block">`;
  s += `<rect width="${W}" height="${MAIN_H + GAP + MACD_H}" fill="#0b1330"/>`;
  // grid + price labels
  for (let g = 0; g <= 4; g++) {
    const val = min + ((max - min) / 4) * g; const y = yP(val);
    s += `<line x1="${PADL}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="rgba(255,255,255,.06)"/>`;
    s += `<text x="${PADL - 6}" y="${y + 4}" fill="#8fa6c3" font-size="10" text-anchor="end">${val.toFixed(2)}</text>`;
  }
  // MACD zero line
  s += `<line x1="${PADL}" y1="${macdY(0)}" x2="${W - PADR}" y2="${macdY(0)}" stroke="rgba(255,255,255,.18)"/>`;
  s += `<text x="${PADL}" y="${MAIN_H + GAP + MACD_H - 4}" fill="#8fa6c3" font-size="10">MACD</text>`;

  // candles
  for (let i = 0; i < n; i++) {
    const c = candles[i]!; const x = xP(i); const up = c.close >= c.open;
    const col = up ? '#35ff9b' : '#ff4d6d';
    const yO = yP(c.open), yC = yP(c.close);
    // wick
    s += `<line x1="${x}" y1="${yP(c.high)}" x2="${x}" y2="${yP(c.low)}" stroke="${col}" stroke-width="1"/>`;
    // body
    const top = Math.min(yO, yC), h = Math.max(1, Math.abs(yO - yC));
    s += `<rect x="${x - bodyW / 2}" y="${top}" width="${bodyW}" height="${h}" fill="${col}" rx="1"/>`;
    // MACD bar
    const mv = macd[i] ?? 0;
    s += `<rect x="${x - bodyW / 2}" y="${Math.min(macdY(mv), macdY(0))}" width="${bodyW}" height="${Math.max(1, Math.abs(macdY(mv) - macdY(0)))}" fill="${mv >= 0 ? 'rgba(69,229,255,.7)' : 'rgba(255,77,109,.7)'}"/>`;
  }
  // SMA9 (cyan), SMA20 (orange), VWAP (white) polylines
  const poly = (vals: number[]) => vals.map((v, i) => `${xP(i + (n - vals.length))},${yP(v)}`).join(' ');
  if (sma9.length) s += `<polyline points="${poly(sma9)}" fill="none" stroke="#45e5ff" stroke-width="2"/>`;
  if (sma20.length) s += `<polyline points="${poly(sma20)}" fill="none" stroke="#ff8c42" stroke-width="2"/>`;
  s += `<polyline points="${vwap.map((v, i) => `${xP(i)},${yP(v)}`).join(' ')}" fill="none" stroke="#ffffff" stroke-width="2" stroke-dasharray="4 3"/>`;
  s += `<text x="${PADL}" y="${TOP - 8}" fill="#8fa6c3" font-size="10">Last ${candles[n-1]!.close.toFixed(2)} · Session 9:30–4:00</text>`;
  // Time axis: label key hours (10, 11, 12, 1, 2, 3, 4) across the session
  const labels = [[10,'10'], [11,'11'], [12,'12'], [13,'1'], [14,'2'], [15,'3'], [16,'4']].map(([h, lbl]) => {
    const t = Math.max(0, Math.min(1, ((h as number) - 9.5) / 6.5));
    return `<text x="${PADL + t * chartW}" y="${MAIN_H + GAP + 12}" fill="#8fa6c3" font-size="10" text-anchor="middle">${lbl}</text>`;
  }).join('');
  s += labels;
  s += `<text x="${PADL}" y="${MAIN_H + GAP + 12}" fill="#8fa6c3" font-size="10" text-anchor="start">9:30</text>`;
  s += `<text x="${PADL + chartW}" y="${MAIN_H + GAP + 12}" fill="#8fa6c3" font-size="10" text-anchor="end">4:00</text>`;
  s += `</svg>`;
  return s;
}

function NotifierBanner({ morning, openCount, hasTrades, onAction }: { morning: boolean; openCount: number; hasTrades: boolean; onAction?: () => void }) {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  let text = '';
  let color = colors.cyan;
  if (openCount > 0) { text = `You have ${openCount} open trade${openCount > 1 ? 's' : ''}. Set your sell price when you exit.`; color = colors.yellow; }
  else if (morning && hasTrades) { text = `Plan your day. Review your best setup before the open.`; color = colors.green; }
  else if (morning && !hasTrades) { text = `It's market prep time — log today's plan in New Trade.`; color = colors.cyan; }
  else if (!hasTrades) { text = `Get started: log your first trade to begin building your edge.`; color = colors.cyan; }
  if (!text) return null;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onAction} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: color + '55', backgroundColor: color + '18' }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ flex: 1, color: colors.text, fontWeight: '700' }}>{text}</Text>
      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setDismissed(true); }}><Text style={{ color: colors.muted }}>✕</Text></TouchableOpacity>
    </TouchableOpacity>
  );
}

function ResultLineChart({ results }: { results: { id: string; symbol: string; net: number; date: string; open: boolean }[] }) {
  const W = 560, H = 180, PAD = 28;
  const cumulative: number[] = [];
  let run = 0;
  for (const r of results) { run += r.net; cumulative.push(run); }
  const max = Math.max(...cumulative, 1);
  const min = Math.min(...cumulative, 0);
  const span = max - min || 1;
  const n = cumulative.length;
  const pts: { x: number; y: number; v: number; r: { id: string; symbol: string; net: number; date: string; open: boolean } }[] = cumulative.map((v, i) => {
    const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((v - min) / span) * (H - 2 * PAD);
    return { x, y, v, r: results[i]! };
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${(W - PAD).toFixed(1)},${(H - PAD).toFixed(1)} L${PAD.toFixed(1)},${(H - PAD).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${p.r.net >= 0 ? '#35ff9b' : '#ff4d6d'}"><title>${p.r.symbol} · $${p.r.net.toFixed(0)} (${p.r.date})</title></circle>`).join('');
  const grid = [0.25, 0.5, 0.75, 1].map((t) => {
    const yv = min + t * span;
    const y = H - PAD - (t) * (H - 2 * PAD);
    return `<line x1="${PAD}" x2="${W - PAD}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,.08)" stroke-width="1"/><text x="${W - PAD + 6}" y="${y.toFixed(1) + 4}" fill="rgba(143,166,195,.8)" font-size="10">$${Math.round(yv)}</text>`;
  }).join('');
  const svg = `<svg width="100%" viewBox="0 0 ${W} ${H + 20}" style="display:block">
    <defs>
      <linearGradient id="resultgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#45e5ff" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#45e5ff" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="clipres"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
      <style>
        @keyframes drawline { from { stroke-dashoffset: 1400; } to { stroke-dashoffset: 0; } }
        #resline { stroke-dasharray: 1400; animation: drawline 1.6s ease-out forwards; }
        @keyframes fadearea { from { opacity: 0; } to { opacity: 1; } }
        #resarea { animation: fadearea 1.8s ease-out forwards; }
      </style>
    </defs>
    ${grid}
    <g clip-path="url(#clipres)">
      <path id="resarea" d="${area}" fill="url(#resultgrad)"/>
      <path id="resline" d="${line}" fill="none" stroke="#45e5ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </g>
    <text x="${PAD}" y="${H + 16}" fill="rgba(143,166,195,.9)" font-size="10">Cumulative P/L · ${n} trades${last ? ` · net ${last.v >= 0 ? '+' : ''}$${Math.round(last.v)}` : ''}</text>
  </svg>`;
  return (
    <View style={{ marginBottom: 16, borderRadius: 16, borderColor: colors.line, borderWidth: 1, padding: 10, backgroundColor: 'rgba(255,255,255,.03)' }}>
      <Text style={styles.mutedSmall}>Results Trend (cumulative P/L)</Text>
      {React.createElement('div', { dangerouslySetInnerHTML: { __html: svg } })}
    </View>
  );
}

interface BarDatum { label: string; value: number; pct: number; sub?: string; color?: string; }
function AnimatedBarChart({ data, unit }: { data: BarDatum[]; unit?: string }) {
  const W = 560, H = 200, PAD = 30, TOP = 18, BOT = 34;
  const slot = (W - 2 * PAD) / Math.max(data.length, 1);
  const barW = Math.min(46, slot * 0.5);
  const max = Math.max(1, ...data.map((d) => d.pct));
  const bars = data.map((d, i) => {
    const x = PAD + slot * i + (slot - barW) / 2;
    const h = Math.max(2, (d.pct / max) * (H - TOP - BOT));
    const y = H - BOT - h;
    const color = d.color || (d.pct >= 50 ? '#35ff9b' : d.pct >= 40 ? '#45e5ff' : '#7b61ff');
    return { x, y, h, d, color, i };
  });
  const rects = bars.map((b) =>
    `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${barW.toFixed(1)}" height="${b.h.toFixed(1)}" rx="7" fill="${b.color}" class="bar-anim" style="animation-delay:${(b.i * 0.12).toFixed(2)}s"><title>${b.d.label} · ${b.d.pct}%${b.d.sub ? ' · ' + b.d.sub : ''}</title></rect>`
  ).join('');
  const labels = bars.map((b) =>
    `<text x="${(b.x + barW / 2).toFixed(1)}" y="${H - BOT + 16}" text-anchor="middle" fill="rgba(143,166,195,.95)" font-size="11" font-weight="700">${b.d.label}</text>` +
    `<text x="${(b.x + barW / 2).toFixed(1)}" y="${(b.y - 6).toFixed(1)}" text-anchor="middle" fill="${b.d.pct >= 50 ? '#35ff9b' : '#45e5ff'}" font-size="11" font-weight="900">${b.d.pct}%${unit ? ' ' + unit : ''}</text>`
  ).join('');
  const svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
    <defs><style>
      @keyframes growbar { from { transform: scaleY(0); transform-origin: 50% 100%; } to { transform: scaleY(1); } }
      .bar-anim { transform-origin: 50% 100%; animation: growbar .7s cubic-bezier(.22,.9,.3,1) forwards; }
      @keyframes poplabel { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      .bar-anim ~ text, text.bar-label { animation: poplabel .5s ease-out both; }
    </style></defs>
    ${rects}
    ${labels}
  </svg>`;
  return (
    <View style={{ marginVertical: 10 }}>
      {React.createElement('div', { dangerouslySetInnerHTML: { __html: svg } })}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, ...rest } = props; return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><TextInput {...rest} placeholderTextColor={colors.muted} style={styles.input} /></View>; }
function MoneyField({ label, initial, placeholder, allowNull, onChange }: { label: string; initial: number | null; placeholder?: string; allowNull?: boolean; onChange: (n: number | null) => void }) {
  const [text, setText] = React.useState(initial === null || initial === 0 ? '' : String(initial));
  // Allow only digits and one decimal point while typing (keeps the decimal clickable).
  const handle = (v: string) => {
    const cleaned = v.replace(/[^0-9.]/g, '');
    setText(cleaned);
    if (cleaned === '') { onChange(allowNull ? null : 0); return; }
    const num = parseFloat(cleaned);
    if (!isNaN(num)) onChange(allowNull && num === 0 ? null : num);
  };
  return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><TextInput value={text} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input} onChangeText={handle} /></View>;
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) { return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><TouchableOpacity style={[styles.toggle, value && styles.toggleOn]} onPress={() => onChange(!value)}><Text style={value ? styles.toggleTextOn : styles.toggleTextOff}>{value ? 'Yes' : 'No'}</Text></TouchableOpacity></View>; }
function Segment({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) { return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><View style={styles.segment}>{options.map((option) => <TouchableOpacity key={option} style={[styles.segmentItem, value === option && styles.segmentActive]} onPress={() => onChange(option)}><Text style={[styles.buttonText, value === option && styles.segmentActiveText]}>{option.toUpperCase()}</Text></TouchableOpacity>)}</View></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  app: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  appCompact: { flexDirection: 'column' },
  sidebar: { width: 280, padding: 22, borderRightWidth: 1, borderRightColor: colors.line, backgroundColor: '#080d1e' },
  sidebarCompact: { width: '100%', borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.line },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  logoMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' },
  logoMarkText: { color: '#02111d', fontWeight: '900', fontSize: 20 },
  logoTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
  nav: { gap: 8, marginBottom: 18 },
  navCompact: { flexDirection: 'row', flexWrap: 'wrap' },
  navItem: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  navActive: { backgroundColor: 'rgba(69,229,255,.12)', borderColor: colors.cyan, shadowColor: colors.cyan, shadowOpacity: .45, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  navText: { color: colors.muted, fontWeight: '800' },
  navTextActive: { color: colors.text },
  main: { flex: 1 },
  mainContent: { padding: 24, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' },
  headerText: { flexShrink: 1, minWidth: 0, flexWrap: 'wrap' },
  eyebrow: { color: colors.cyan, textTransform: 'uppercase', letterSpacing: 2, fontSize: 11, fontWeight: '900' },
  hero: { color: colors.text, fontSize: 38, lineHeight: 42, fontWeight: '900', maxWidth: 760, flexShrink: 1, flexWrap: 'wrap' },
  card: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 24, padding: 18, marginBottom: 16, ...shadow },
  cardTitle: { color: colors.text, fontSize: 20, fontWeight: '900', marginBottom: 8 },
  muted: { color: colors.muted, lineHeight: 21 },
  mutedSmall: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  kpiGrid: { flexDirection: 'row', gap: 16 },
  oneCol: { flexDirection: 'column' },
  twoCol: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(3,8,22,.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#0b1330', borderColor: colors.line, borderWidth: 1, borderRadius: 24, padding: 24, maxWidth: 420, width: '100%', ...shadow },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', marginBottom: 8 },
  predBox: { marginVertical: 14 },
  predLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  predTrack: { height: 16, borderRadius: 99, backgroundColor: 'rgba(255,255,255,.1)', overflow: 'hidden' },
  predFill: { height: 16, borderRadius: 99, backgroundColor: '#35ff9b' },
  predValue: { color: colors.text, fontSize: 26, fontWeight: '900', marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelButton: { flex: 1, padding: 13, borderRadius: 14, backgroundColor: '#ff4d6d', alignItems: 'center' },
  confirmButton: { flex: 1, padding: 13, borderRadius: 14, backgroundColor: '#35ff9b', alignItems: 'center' },
  kpiValue: { fontSize: 32, fontWeight: '900', marginVertical: 6 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderBottomColor: 'rgba(255,255,255,.07)', borderBottomWidth: 1, paddingVertical: 10 },
  metricValue: { color: colors.text, fontWeight: '900' },
  barWrap: { gap: 8, marginTop: 12 },
  barTrack: { height: 12, backgroundColor: 'rgba(255,255,255,.07)', borderRadius: 99, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 99 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  field: { minWidth: 210, flex: 1, gap: 8, padding: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,.045)', borderColor: 'rgba(255,255,255,.07)', borderWidth: 1 },
  input: { color: colors.text, backgroundColor: 'rgba(3,8,22,.82)', borderColor: colors.line, borderWidth: 1, borderRadius: 13, padding: 12 },
  toggle: { padding: 12, borderRadius: 13, backgroundColor: '#ff4d6d', alignItems: 'center' },
  toggleOn: { backgroundColor: '#35ff9b', borderColor: '#35ff9b' },
  toggleTextOn: { color: '#03100b' },
  toggleTextOff: { color: '#1b0308' },
  segment: { flexDirection: 'row', gap: 6 },
  segmentItem: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.07)', alignItems: 'center' },
  segmentActive: { backgroundColor: '#19f6a3' },
  segmentActiveText: { color: '#041018' },
  resultBox: { padding: 16, borderRadius: 18, borderColor: colors.line, borderWidth: 1, marginVertical: 16 },
  resultText: { fontSize: 28, fontWeight: '900' },
  primaryButton: { backgroundColor: colors.cyan, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 15, alignSelf: 'flex-start' },
  primaryText: { color: '#031021', fontWeight: '900' },
  secondaryButton: { borderColor: colors.line, borderWidth: 1, padding: 13, borderRadius: 15, alignSelf: 'flex-start', marginTop: 14 },
  buttonText: { color: colors.text, fontWeight: '900' },
  error: { color: colors.red, marginBottom: 4 },
  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', backgroundColor: 'rgba(255,255,255,.03)', marginBottom: 10 },
  editUnderlay: { position: 'absolute', top: 0, bottom: 0, width: 96, right: 0, backgroundColor: '#35ff9b', justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 22, borderRadius: 14 },
  editBtn: { width: '100%', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: 'transparent', alignItems: 'flex-start' },
  tradeSymbol: { color: colors.text, fontWeight: '900' },
});
