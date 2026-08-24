import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal, PanResponder, Animated, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { analyzeAllConditions, averageDaysHeld, bestRecommendedSetup, buildDashboardStats, buildTradesCsv, breakDownByStrategy, breakDownBySymbol, calculateTradeFinancials, computeExpectancy, computePositionSizing, findHighProbabilitySetups, formatCurrency, formatPercent, predictSuccessRate, rankCombosByWinRate, recentForm, winRateByTimeOfDay, winRateByWeekday, winRateByDirection, VWAP_LABELS, MACD_LABELS } from './src/lib/analytics';
import { createTradeDraft, localDatabase } from './src/lib/storage';
import { Trade } from './src/lib/types';
import { validateTradeInput } from './src/lib/validation';
import { colors, shadow } from './src/theme';
import { supabase, checkApprovedStatus, OWNER_EMAIL } from './src/lib/supabase';
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
  const stats = useMemo(() => buildDashboardStats(trades, new Date().toISOString().slice(0, 10)), [trades]);
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
    const nextTrade: Trade = { ...draft, id: draft.id && draft.id !== 'draft' ? draft.id : crypto.randomUUID(), createdAt: draft.createdAt || new Date().toISOString(), status: computed.status };
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
    () => (pendingSave ? predictSuccessRate(pendingSave, trades) : { percent: 0, matched: '', sampleSize: 0 }),
    [pendingSave, trades],
  );

  function openSaveConfirm(t: Trade) { setPendingSave(t); setConfirmVisible(true); }
  function closeSaveConfirm() { setConfirmVisible(false); }
  function confirmSave() { if (pendingSave) { /* persist the pending draft */ const t = pendingSave; setPendingSave(null); setConfirmVisible(false); saveDraftToRepo(t); } }
  async function saveDraftToRepo(t: Trade) { const computed = calculateTradeFinancials(t); const tr: Trade = { ...t, id: t.id && t.id !== 'draft' ? t.id : crypto.randomUUID(), createdAt: t.createdAt || new Date().toISOString(), ...(computed.status === 'closed' && !t.closedAt ? { closedAt: new Date().toISOString() } : {}), status: computed.status }; const errors = validateTradeInput(tr); if (errors.length) return; try { const userId = (await supabase.auth.getUser()).data.user?.id; if (!userId) { setDbError('Not signed in.'); return; } const saved = await repo.saveTrade(userId, tr); setTrades((c) => [saved, ...c.filter((x) => x.id !== saved.id)]); setDraft({ ...createEmptyDraft(), id: 'draft' }); setScreen('Trade Log'); try { await saveAnalyticsSnapshot(userId, 'all', { expectancy: computeExpectancy([saved, ...trades]).expectancy }); } catch {} } catch (e) { setDbError('Failed to save trade. ' + String((e as any)?.message || e)); } }

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
            <View>
              <Text style={styles.eyebrow}>Daily trading command center</Text>
              <Text style={styles.hero}>Track every setup. Learn what actually wins.</Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setScreen('New Trade')}><Text style={styles.primaryText}>Log New Trade</Text></TouchableOpacity>
          </View>

          {screen === 'Dashboard' && <Dashboard stats={stats} compact={compact} />}
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
              <View style={styles.predBox}>
                <Text style={styles.predLabel}>Predicted win success (matched conditions)</Text>
                <View style={styles.predTrack}><View style={[styles.predFill, { width: `${Math.min(100, prediction.percent)}%` }]} /></View>
                <Text style={styles.predValue}>{prediction.percent}% <Text style={styles.mutedSmall}>· {prediction.matched} · n={prediction.sampleSize}</Text></Text>
              </View>
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

function Dashboard({ stats, compact }: { stats: ReturnType<typeof buildDashboardStats>; compact: boolean }) {
  const hasTrades = (stats.daily.totalTrades || stats.weekly.totalTrades || stats.monthly.totalTrades) > 0;
  return <View>
    {!hasTrades && (
      <View style={[styles.card, { marginBottom: 16 }]}>
        <Text style={styles.cardTitle}>Welcome — no trades yet</Text>
        <Text style={[styles.muted, { marginTop: 6 }]}>Your dashboard is clean. Log your first trade to start building your journal and analytics. Head to "New Trade" to get started.</Text>
      </View>
    )}
    <View style={[styles.kpiGrid, compact && styles.oneCol]}>
      <Kpi label="Daily P/L" value={formatCurrency(stats.daily.netProfitLoss)} tone={stats.daily.netProfitLoss >= 0 ? 'green' : 'red'} detail={`${stats.daily.wins} wins / ${stats.daily.losses} losses`} />
      <Kpi label="Weekly P/L" value={formatCurrency(stats.weekly.netProfitLoss)} tone="cyan" detail={`${formatPercent(stats.weekly.winRate)} win rate`} />
      <Kpi label="Monthly P/L" value={formatCurrency(stats.monthly.netProfitLoss)} tone="yellow" detail={`${stats.monthly.totalTrades} closed trades`} />
      <Kpi label="Rule Discipline" value={formatPercent(stats.ruleDisciplineScore)} tone="green" detail="Checklist adherence" />
    </View>
    <View style={[styles.twoCol, compact && styles.oneCol]}>
      <GlassCard><Text style={styles.cardTitle}>Daily / Weekly / Monthly Comparison</Text><BarRow label="Daily" value={stats.daily.netProfitLoss} max={1200} /><BarRow label="Weekly" value={stats.weekly.netProfitLoss} max={2500} /><BarRow label="Monthly" value={stats.monthly.netProfitLoss} max={5000} /></GlassCard>
      <GlassCard><Text style={styles.cardTitle}>Command Summary</Text><Metric label="Win Rate" value={formatPercent(stats.winRate)} /><Metric label="Average Win" value={formatCurrency(stats.averageWinningTrade)} /><Metric label="Average Loss" value={formatCurrency(stats.averageLosingTrade)} /><Text style={styles.muted}>{stats.summary}</Text></GlassCard>
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
      <Field label="Contracts" value={String(draft.contractCount)} keyboardType="numeric" onChangeText={(v) => update({ contractCount: Math.max(1, Math.round(parseFloat(v) || 1)) })} />
      <MoneyField label="Purchase Price ($)" initial={draft.purchasePrice} placeholder="e.g. 2.50" onChange={(n) => update({ purchasePrice: n ?? 0 })} />
      <MoneyField label="Selling Price ($)" initial={draft.sellingPrice} placeholder="e.g. 3.25" allowNull onChange={(n) => update({ sellingPrice: n })} />
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
  const results = trades.map((t) => { const f = calculateTradeFinancials(t); return { id: t.id, symbol: t.symbol || '—', net: f.netProfitLoss ?? 0, date: t.tradeDate, open: f.result === 'open' }; });
  return <GlassCard>
    <Text style={styles.cardTitle}>Trade Log</Text>
    {trades.length === 0 && <Text style={styles.muted}>No trades yet. Log your first trade in "New Trade".</Text>}
    {results.length >= 2 && <ResultLineChart results={results} />}
    <Text style={styles.mutedSmall}>Tip: tap ✎ to edit a trade. Swipe a closed trade left for quick edit.</Text>
    {trades.map((trade) => {
      const f = calculateTradeFinancials(trade);
      const buyV = trade.purchasePrice > 0 ? `$${trade.purchasePrice.toFixed(2)}` : '—';
      const sellV = trade.sellingPrice !== null && trade.sellingPrice !== undefined ? `$${trade.sellingPrice.toFixed(2)}` : null;
      const row = (
        <>
          <View style={{ flex: 1 }}>
            <Text style={styles.tradeSymbol}>{trade.symbol || '—'} · {trade.buyingType.toUpperCase()}</Text>
            <Text style={styles.mutedSmall}>{trade.tradeDate} · {trade.marketExcitement} · {trade.contractCount} contracts</Text>
            <Text style={styles.mutedSmall}>Buy: {buyV}</Text>
            {trade.tradeTime ? <Text style={styles.mutedSmall}>Time: {trade.tradeTime}</Text> : null}
            {sellV !== null && <Text style={[styles.mutedSmall, { color: colors.green }]}>Sell: {sellV}</Text>}
          </View>
          <Text style={{ color: f.result === 'loss' ? colors.red : f.result === 'open' ? colors.yellow : colors.green, fontWeight: '900' }}>{f.result === 'open' ? 'OPEN' : formatCurrency(f.netProfitLoss ?? 0)}</Text>
          <TouchableOpacity onPress={() => onOpenEdit(trade)} style={{ marginLeft: 12, paddingHorizontal: 8 }}><Text style={{ color: colors.cyan, fontSize: 11 }}>✎ Edit</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(trade.id)} style={{ marginLeft: 8, paddingHorizontal: 6 }}><Text style={{ color: colors.red }}>✕</Text></TouchableOpacity>
        </>
      );
      return trade.status === 'closed' ? (
        <SwipeableRow key={trade.id} onEdit={() => onOpenEdit(trade)}>{row}</SwipeableRow>
      ) : (
        <View key={trade.id} style={styles.tradeRow}>{row}</View>
      );
    })}
  </GlassCard>;
}

function Analytics({ analyses, stats, trades }: { analyses: ReturnType<typeof analyzeAllConditions>; stats: ReturnType<typeof buildDashboardStats>; trades: Trade[] }) {
  const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
  const rankings = rankCombosByWinRate(trades, 2);
  const expectancy = computeExpectancy(trades);
  const sizing = computePositionSizing(trades, localDatabase.settings.riskLimitPercent);
  const form = recentForm(trades, 20);
  return <View style={styles.twoCol}>
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
      {breakDownBySymbol(trades).slice(0, 6).map((s) => <View key={s.symbol} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.symbol}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · {s.trades} trades</Text></View>)}
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
      {winRateByTimeOfDay(trades).map((s) => <View key={s.hour} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.label}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · n={s.trades}</Text></View>)}
    </GlassCard>
    {/* Win rate by weekday */}
    <GlassCard><Text style={styles.cardTitle}>Win Rate by Day of Week</Text>
      {winRateByWeekday(trades).length === 0 && <Text style={styles.muted}>Set a day of week (Mon-Fri) on trades to see your best trading days.</Text>}
      {winRateByWeekday(trades).map((s) => <View key={s.weekday} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.weekday}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · n={s.trades}</Text></View>)}
    </GlassCard>
    {/* Direction win-rate (VWAP / MACD) */}
    <GlassCard><Text style={styles.cardTitle}>Edge by Condition</Text>
      <Metric label="Overall win rate" value={`${formatPercent(overallWinRate)}`} />
      {winRateByDirection(trades, 'vwapDirection', VWAP_LABELS).length === 0 && <Text style={styles.muted}>Log more closed trades to rank VWAP / MACD values.</Text>}
      {winRateByDirection(trades, 'vwapDirection', VWAP_LABELS).map((s) => <View key={s.value} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.label}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · n={s.trades}</Text></View>)}
    </GlassCard>
    {/* Win rate by MACD trend */}
    <GlassCard><Text style={styles.cardTitle}>Win Rate by MACD Trend</Text>
      {winRateByDirection(trades, 'macdTrend', MACD_LABELS).length === 0 && <Text style={styles.muted}>Log more closed trades to rank MACD trend values.</Text>}
      {winRateByDirection(trades, 'macdTrend', MACD_LABELS).map((s) => <View key={s.value} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.label}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · n={s.trades}</Text></View>)}
    </GlassCard>
  </View>;
}

function Reports({ trades, stats }: { trades: Trade[]; stats: ReturnType<typeof buildDashboardStats> }) {
  const expectancy = computeExpectancy(trades);
  const sizing = computePositionSizing(trades, localDatabase.settings.riskLimitPercent);
  const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
  const form = recentForm(trades, 20);
  function exportCsv() {
    const csv = buildTradesCsv(trades);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tradeos-trades-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  return <View style={styles.twoCol}><GlassCard><Text style={styles.cardTitle}>Reports</Text><Text style={styles.muted}>Daily, weekly, and monthly review summaries are generated from closed trades.</Text><Metric label="Net P/L Today" value={formatCurrency(stats.daily.netProfitLoss)} /><Metric label="Total Trades This Week" value={String(stats.weekly.totalTrades)} /><Metric label="# Days Hold (avg)" value={String(averageDaysHeld(trades))} /><Metric label="Biggest Win" value={formatCurrency(stats.weekly.biggestWin)} /><Metric label="Biggest Loss" value={formatCurrency(stats.weekly.biggestLoss)} /><TouchableOpacity style={styles.secondaryButton} onPress={exportCsv}><Text style={styles.buttonText}>Export CSV ({trades.length})</Text></TouchableOpacity></GlassCard><GlassCard><Text style={styles.cardTitle}>Probability Snapshot</Text><Metric label="Overall win rate" value={formatPercent(overallWinRate)} /><Metric label="Expectancy / trade" value={formatCurrency(expectancy.expectancy)} /><Metric label="Position size" value={sizing.recommendedRiskPercent > 0 ? `${sizing.recommendedRiskPercent.toFixed(1)}%` : '—'} /><Metric label="Recent form" value={`${formatPercent(form.recentWinRate)}`} /></GlassCard></View>;
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
function Kpi({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'green' | 'red' | 'cyan' | 'yellow' }) { return <GlassCard><Text style={styles.mutedSmall}>{label}</Text><Text style={[styles.kpiValue, { color: colors[tone] }]}>{value}</Text><Text style={styles.mutedSmall}>{detail}</Text></GlassCard>; }

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

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function BarRow({ label, value, max }: { label: string; value: number; max: number }) { const width = `${Math.min(100, Math.abs(value) / max * 100)}%` as const; return <View style={styles.barWrap}><Text style={styles.mutedSmall}>{label}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width, backgroundColor: value >= 0 ? colors.green : colors.red }]} /></View><Text style={styles.metricValue}>{formatCurrency(value)}</Text></View>; }
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
  navActive: { backgroundColor: 'rgba(69,229,255,.10)', borderColor: colors.line },
  navText: { color: colors.muted, fontWeight: '800' },
  navTextActive: { color: colors.text },
  main: { flex: 1 },
  mainContent: { padding: 24, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' },
  eyebrow: { color: colors.cyan, textTransform: 'uppercase', letterSpacing: 2, fontSize: 11, fontWeight: '900' },
  hero: { color: colors.text, fontSize: 38, lineHeight: 42, fontWeight: '900', maxWidth: 760 },
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
  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.07)' },
  editUnderlay: { position: 'absolute', top: 0, bottom: 0, width: 96, right: 0, backgroundColor: '#35ff9b', justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 22, borderRadius: 14 },
  editBtn: { width: '100%', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: 'transparent', alignItems: 'flex-start' },
  tradeSymbol: { color: colors.text, fontWeight: '900' },
});
