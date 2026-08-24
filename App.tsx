import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { analyzeAllConditions, buildDashboardStats, breakDownByStrategy, breakDownBySymbol, calculateTradeFinancials, computeExpectancy, computePositionSizing, findHighProbabilitySetups, formatCurrency, formatPercent, recentForm } from './src/lib/analytics';
import { localDatabase } from './src/lib/storage';
import { Trade } from './src/lib/types';
import { validateTradeInput } from './src/lib/validation';
import { colors, shadow } from './src/theme';
import { supabase, checkApprovedStatus, OWNER_EMAIL } from './src/lib/supabase';

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

function TradingApp({ ownerEmail, onSignOut }: { ownerEmail: string; onSignOut: () => void }) {
  const isOwner = (ownerEmail || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
  const [screen, setScreen] = useState<Screen>('Dashboard');
  const [trades, setTrades] = useState<Trade[]>(localDatabase.trades);
  const [draft, setDraft] = useState<Trade>(() => ({ ...localDatabase.trades[0]!, id: 'draft', sellingPrice: null, status: 'open', notes: '' }));
  const { width } = useWindowDimensions();
  const compact = width < 780;
  const stats = useMemo(() => buildDashboardStats(trades, '2026-08-13'), [trades]);
  const analyses = useMemo(() => analyzeAllConditions(trades), [trades]);

  function saveDraft() {
    const computed = calculateTradeFinancials(draft);
    const nextTrade: Trade = { ...draft, id: `t-${Date.now()}`, status: computed.status };
    const errors = validateTradeInput(nextTrade);
    if (errors.length) return;
    setTrades((current) => [nextTrade, ...current]);
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
          {screen === 'New Trade' && <NewTrade draft={draft} setDraft={setDraft} saveDraft={saveDraft} />}
          {screen === 'Trade Log' && <TradeLog trades={trades} />}
          {screen === 'Analytics' && <Analytics analyses={analyses} stats={stats} trades={trades} />}
          {screen === 'Reports' && <Reports trades={trades} stats={stats} />}
          {screen === 'Settings' && <Settings />}
        </ScrollView>
      </View>
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

function NewTrade({ draft, setDraft, saveDraft }: { draft: Trade; setDraft: (t: Trade) => void; saveDraft: () => void }) {
  const financials = calculateTradeFinancials(draft);
  const errors = validateTradeInput(draft);
  const update = (patch: Partial<Trade>) => setDraft({ ...draft, ...patch });
  return <GlassCard>
    <Text style={styles.cardTitle}>New Trade Entry</Text><Text style={styles.muted}>Timestamp auto-detected. Selling price can stay blank until the trade closes.</Text>
    <View style={styles.formGrid}>
      <Field label="Symbol" value={draft.symbol ?? ''} onChangeText={(v) => update({ symbol: v.toUpperCase() })} />
      <Segment label="Market" value={draft.marketExcitement} options={['up', 'down', 'neutral']} onChange={(v) => update({ marketExcitement: v as Trade['marketExcitement'] })} />
      <Toggle label="15 minutes passed?" value={draft.fifteenMinutesPassed} onChange={(v) => update({ fifteenMinutesPassed: v })} />
      <Toggle label="Entry respects 15m high/low?" value={draft.entryRespectsFifteenMinuteHighLow} onChange={(v) => update({ entryRespectsFifteenMinuteHighLow: v })} />
      <Toggle label="9 or 14 EMA crossed?" value={draft.emaCrossed} onChange={(v) => update({ emaCrossed: v })} />
      <Toggle label="Within 25% portfolio?" value={draft.withinPortfolioRiskLimit} onChange={(v) => update({ withinPortfolioRiskLimit: v })} />
      <Segment label="Buying" value={draft.buyingType} options={['call', 'put']} onChange={(v) => update({ buyingType: v as Trade['buyingType'] })} />
      <Field label="Contracts" value={String(draft.contractCount)} keyboardType="numeric" onChangeText={(v) => update({ contractCount: Number(v) || 0 })} />
      <Field label="Purchase Price" value={String(draft.purchasePrice)} keyboardType="numeric" onChangeText={(v) => update({ purchasePrice: Number(v) || 0 })} />
      <Field label="Selling Price" value={draft.sellingPrice === null ? '' : String(draft.sellingPrice)} keyboardType="numeric" onChangeText={(v) => update({ sellingPrice: v === '' ? null : Number(v) || 0 })} />
    </View>
    <View style={styles.resultBox}><Text style={styles.mutedSmall}>Auto Result</Text><Text style={[styles.resultText, { color: financials.result === 'loss' ? colors.red : financials.result === 'open' ? colors.yellow : colors.green }]}>{financials.result === 'open' ? 'Open trade' : `${formatCurrency(financials.netProfitLoss ?? 0)} · ${(financials.profitLossPercentage ?? 0).toFixed(1)}%`}</Text></View>
    {errors.map((e) => <Text key={e} style={styles.error}>{e}</Text>)}
    <TouchableOpacity style={styles.primaryButton} onPress={saveDraft}><Text style={styles.primaryText}>Save Trade + Update Dashboard</Text></TouchableOpacity>
  </GlassCard>;
}

function TradeLog({ trades }: { trades: Trade[] }) {
  return <GlassCard><Text style={styles.cardTitle}>Trade Log</Text>{trades.map((trade) => { const f = calculateTradeFinancials(trade); return <View key={trade.id} style={styles.tradeRow}><View><Text style={styles.tradeSymbol}>{trade.symbol || '—'} · {trade.buyingType.toUpperCase()}</Text><Text style={styles.mutedSmall}>{trade.tradeDate} · {trade.marketExcitement} · {trade.contractCount} contracts</Text></View><Text style={{ color: f.result === 'loss' ? colors.red : f.result === 'open' ? colors.yellow : colors.green, fontWeight: '900' }}>{f.result === 'open' ? 'OPEN' : formatCurrency(f.netProfitLoss ?? 0)}</Text></View>; })}</GlassCard>;
}

function Analytics({ analyses, stats, trades }: { analyses: ReturnType<typeof analyzeAllConditions>; stats: ReturnType<typeof buildDashboardStats>; trades: Trade[] }) {
  const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
  const expectancy = computeExpectancy(trades);
  const sizing = computePositionSizing(trades, localDatabase.settings.riskLimitPercent);
  const form = recentForm(trades, 20);
  return <View style={styles.twoCol}>
    {/* Higher-probability set-ups, most important */}
    <GlassCard><Text style={styles.cardTitle}>High-Probability Setups</Text>
      <Metric label="Overall win rate" value={`${formatPercent(overallWinRate)}`} />
      {setups.length === 0 && <Text style={styles.muted}>Log more closed trades (min 3 per setup) to surface the highest-probability combos.</Text>}
      {setups.slice(0, 4).map((s) => <View key={s.label} style={styles.metric}><Text style={[styles.muted, { flex: 1 }]}>{s.label}</Text><Text style={styles.metricValue}>{formatPercent(s.winRate)} · n={s.sampleSize}</Text></View>)}
    </GlassCard>
    {/* Edge metrics */}
    <GlassCard><Text style={styles.cardTitle}>Edge & Edge Sizing</Text>
      <Metric label="Expectancy / trade" value={formatCurrency(expectancy.expectancy)} />
      <Metric label="Profit factor" value={expectancy.profitFactor === Infinity ? '∞' : expectancy.profitFactor.toFixed(2)} />
      <Metric label="Payoff ratio" value={expectancy.payoffRatio.toFixed(2)} />
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
  </View>;
}

function Reports({ trades, stats }: { trades: Trade[]; stats: ReturnType<typeof buildDashboardStats> }) {
  const expectancy = computeExpectancy(trades);
  const sizing = computePositionSizing(trades, localDatabase.settings.riskLimitPercent);
  const { setups, overallWinRate } = findHighProbabilitySetups(trades, 3);
  const form = recentForm(trades, 20);
  return <View style={styles.twoCol}><GlassCard><Text style={styles.cardTitle}>Reports</Text><Text style={styles.muted}>Daily, weekly, and monthly review summaries are generated from closed trades.</Text><Metric label="Net P/L Today" value={formatCurrency(stats.daily.netProfitLoss)} /><Metric label="Total Trades This Week" value={String(stats.weekly.totalTrades)} /><Metric label="Biggest Win" value={formatCurrency(stats.weekly.biggestWin)} /><Metric label="Biggest Loss" value={formatCurrency(stats.weekly.biggestLoss)} /></GlassCard><GlassCard><Text style={styles.cardTitle}>Probability Snapshot</Text><Metric label="Overall win rate" value={formatPercent(overallWinRate)} /><Metric label="Expectancy / trade" value={formatCurrency(expectancy.expectancy)} /><Metric label="Position size" value={sizing.recommendedRiskPercent > 0 ? `${sizing.recommendedRiskPercent.toFixed(1)}%` : '—'} /><Metric label="Recent form" value={`${formatPercent(form.recentWinRate)}`} /><TouchableOpacity style={styles.secondaryButton}><Text style={styles.buttonText}>Export CSV</Text></TouchableOpacity></GlassCard></View>;
}

function Settings() { return <GlassCard><Text style={styles.cardTitle}>Settings / Rule Engine</Text><Metric label="Timezone" value={localDatabase.settings.timezone} /><Metric label="Market Open" value={localDatabase.settings.marketOpenTime} /><Metric label="Risk Limit" value={`${localDatabase.settings.riskLimitPercent}%`} /><Metric label="Portfolio" value={formatCurrency(localDatabase.settings.portfolioValue)} /></GlassCard>; }
function GlassCard({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Kpi({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'green' | 'red' | 'cyan' | 'yellow' }) { return <GlassCard><Text style={styles.mutedSmall}>{label}</Text><Text style={[styles.kpiValue, { color: colors[tone] }]}>{value}</Text><Text style={styles.mutedSmall}>{detail}</Text></GlassCard>; }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function BarRow({ label, value, max }: { label: string; value: number; max: number }) { const width = `${Math.min(100, Math.abs(value) / max * 100)}%` as const; return <View style={styles.barWrap}><Text style={styles.mutedSmall}>{label}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width, backgroundColor: value >= 0 ? colors.green : colors.red }]} /></View><Text style={styles.metricValue}>{formatCurrency(value)}</Text></View>; }
function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, ...rest } = props; return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><TextInput {...rest} placeholderTextColor={colors.muted} style={styles.input} /></View>; }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) { return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><TouchableOpacity style={[styles.toggle, value && styles.toggleOn]} onPress={() => onChange(!value)}><Text style={styles.buttonText}>{value ? 'Yes' : 'No'}</Text></TouchableOpacity></View>; }
function Segment({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) { return <View style={styles.field}><Text style={styles.mutedSmall}>{label}</Text><View style={styles.segment}>{options.map((option) => <TouchableOpacity key={option} style={[styles.segmentItem, value === option && styles.segmentActive]} onPress={() => onChange(option)}><Text style={styles.buttonText}>{option.toUpperCase()}</Text></TouchableOpacity>)}</View></View>; }

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
  kpiValue: { fontSize: 32, fontWeight: '900', marginVertical: 6 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderBottomColor: 'rgba(255,255,255,.07)', borderBottomWidth: 1, paddingVertical: 10 },
  metricValue: { color: colors.text, fontWeight: '900' },
  barWrap: { gap: 8, marginTop: 12 },
  barTrack: { height: 12, backgroundColor: 'rgba(255,255,255,.07)', borderRadius: 99, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 99 },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  field: { minWidth: 210, flex: 1, gap: 8, padding: 12, borderRadius: 17, backgroundColor: 'rgba(255,255,255,.045)', borderColor: 'rgba(255,255,255,.07)', borderWidth: 1 },
  input: { color: colors.text, backgroundColor: 'rgba(3,8,22,.82)', borderColor: colors.line, borderWidth: 1, borderRadius: 13, padding: 12 },
  toggle: { padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,77,109,.16)', alignItems: 'center' },
  toggleOn: { backgroundColor: 'rgba(25,246,163,.18)' },
  segment: { flexDirection: 'row', gap: 6 },
  segmentItem: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,.07)', alignItems: 'center' },
  segmentActive: { backgroundColor: 'rgba(69,229,255,.18)' },
  resultBox: { padding: 16, borderRadius: 18, borderColor: colors.line, borderWidth: 1, marginVertical: 16 },
  resultText: { fontSize: 28, fontWeight: '900' },
  primaryButton: { backgroundColor: colors.cyan, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 15, alignSelf: 'flex-start' },
  primaryText: { color: '#031021', fontWeight: '900' },
  secondaryButton: { borderColor: colors.line, borderWidth: 1, padding: 13, borderRadius: 15, alignSelf: 'flex-start', marginTop: 14 },
  buttonText: { color: colors.text, fontWeight: '900' },
  error: { color: colors.red, marginBottom: 4 },
  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.07)' },
  tradeSymbol: { color: colors.text, fontWeight: '900' },
});
