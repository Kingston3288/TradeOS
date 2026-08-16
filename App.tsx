import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { analyzeAllConditions, buildDashboardStats, calculateTradeFinancials, formatCurrency, formatPercent } from './src/lib/analytics';
import { exportTradesToCsv, exportTradesToJson, importTradesFromJson } from './src/lib/serialization';
import { localDatabase } from './src/lib/storage';
import { Trade } from './src/lib/types';
import { validateTradeInput } from './src/lib/validation';
import { colors, shadow } from './src/theme';

type Screen = 'Dashboard' | 'New Trade' | 'Trade Log' | 'Analytics' | 'Reports' | 'Settings';

const screens: Screen[] = ['Dashboard', 'New Trade', 'Trade Log', 'Analytics', 'Reports', 'Settings'];

export default function App() {
  const [screen, setScreen] = useState<Screen>('Dashboard');
  const [trades, setTrades] = useState<Trade[]>(localDatabase.trades);
  const [draft, setDraft] = useState<Trade>(() => ({ ...localDatabase.trades[0]!, id: 'draft', sellingPrice: null, status: 'open', notes: '' }));
  const [reportOutput, setReportOutput] = useState('');
  const [importPayload, setImportPayload] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
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

  function exportCsv() {
    setReportOutput(exportTradesToCsv(trades));
  }

  function exportJson() {
    setReportOutput(exportTradesToJson(trades));
  }

  function importJson() {
    try {
      const imported = importTradesFromJson(importPayload);
      const valid = imported.filter((trade) => validateTradeInput(trade).length === 0);
      const byId = new Map(trades.map((trade) => [trade.id, trade]));
      for (const trade of valid) byId.set(trade.id, trade);
      setTrades([...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      setImportError(null);
      setReportOutput(`Imported ${valid.length} trade(s).`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import trades.');
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
          <View style={[styles.nav, compact && styles.navCompact]}>
            {screens.map((item) => (
              <TouchableOpacity key={item} onPress={() => setScreen(item)} style={[styles.navItem, screen === item && styles.navActive]}>
                <Text style={[styles.navText, screen === item && styles.navTextActive]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!compact && <GlassCard><Text style={styles.mutedSmall}>Today’s AI read</Text><Text style={styles.cardTitle}>High discipline day</Text><Text style={styles.muted}>Best win probability appears when the 15-minute rule and EMA cross confirm before entry.</Text></GlassCard>}
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
          {screen === 'Analytics' && <Analytics analyses={analyses} stats={stats} />}
          {screen === 'Reports' && <Reports stats={stats} reportOutput={reportOutput} importPayload={importPayload} importError={importError} setImportPayload={setImportPayload} onExportCsv={exportCsv} onExportJson={exportJson} onImportJson={importJson} />}
          {screen === 'Settings' && <Settings />}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Dashboard({ stats, compact }: { stats: ReturnType<typeof buildDashboardStats>; compact: boolean }) {
  return <View>
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
  const update = (patch: Partial<Trade>) => {
    const next = { ...draft, ...patch };
    if (next.sellingPrice === null) {
      next.status = 'open';
    } else if (next.status === 'open') {
      next.status = 'closed';
    }
    setDraft(next);
  };
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
      <Segment label="Position" value={draft.status} options={draft.sellingPrice === null ? ['open'] : ['partial', 'closed']} onChange={(v) => update({ status: v as Trade['status'] })} />
    </View>
    <View style={styles.resultBox}><Text style={styles.mutedSmall}>Auto Result</Text><Text style={[styles.resultText, { color: financials.result === 'loss' ? colors.red : financials.result === 'open' ? colors.yellow : colors.green }]}>{financials.result === 'open' ? 'Open trade' : `${formatCurrency(financials.netProfitLoss ?? 0)} · ${(financials.profitLossPercentage ?? 0).toFixed(1)}%`}</Text></View>
    {errors.map((e) => <Text key={e} style={styles.error}>{e}</Text>)}
    <TouchableOpacity style={styles.primaryButton} onPress={saveDraft}><Text style={styles.primaryText}>Save Trade + Update Dashboard</Text></TouchableOpacity>
  </GlassCard>;
}

function TradeLog({ trades }: { trades: Trade[] }) {
  return <GlassCard><Text style={styles.cardTitle}>Trade Log</Text>{trades.map((trade) => { const f = calculateTradeFinancials(trade); return <View key={trade.id} style={styles.tradeRow}><View><Text style={styles.tradeSymbol}>{trade.symbol || '—'} · {trade.buyingType.toUpperCase()}</Text><Text style={styles.mutedSmall}>{trade.tradeDate} · {trade.marketExcitement} · {trade.contractCount} contracts · {trade.status.toUpperCase()}</Text></View><Text style={{ color: f.result === 'loss' ? colors.red : f.result === 'open' ? colors.yellow : colors.green, fontWeight: '900' }}>{f.result === 'open' ? 'OPEN' : formatCurrency(f.netProfitLoss ?? 0)}</Text></View>; })}</GlassCard>;
}

function Analytics({ analyses, stats }: { analyses: ReturnType<typeof analyzeAllConditions>; stats: ReturnType<typeof buildDashboardStats> }) {
  return <View style={styles.twoCol}>{analyses.map((a) => <GlassCard key={String(a.key)}><Text style={styles.cardTitle}>{a.label}</Text><Metric label="True win rate" value={`${formatPercent(a.trueWinRate)} · n=${a.trueSampleSize}`} /><Metric label="False win rate" value={`${formatPercent(a.falseWinRate)} · n=${a.falseSampleSize}`} /><Metric label="Win lift" value={`${(a.winLift * 100).toFixed(0)} pts`} /><Metric label="Avg P/L true" value={formatCurrency(a.trueAverageProfitLoss)} />{a.trueSampleWarning && <Text style={styles.warning}>{a.trueSampleWarning}</Text>}{a.falseSampleWarning && <Text style={styles.warning}>{a.falseSampleWarning}</Text>}</GlassCard>)}<GlassCard><Text style={styles.cardTitle}>Best Pattern</Text><Text style={styles.muted}>{stats.bestSetupPattern?.label}</Text><Metric label="Sample" value={`n=${stats.bestSetupPattern?.sampleSize ?? 0}`} /></GlassCard><GlassCard><Text style={styles.cardTitle}>Worst Pattern</Text><Text style={styles.muted}>{stats.worstSetupPattern?.label}</Text><Metric label="Sample" value={`n=${stats.worstSetupPattern?.sampleSize ?? 0}`} /></GlassCard></View>;
}

function Reports({ stats, reportOutput, importPayload, importError, setImportPayload, onExportCsv, onExportJson, onImportJson }: { stats: ReturnType<typeof buildDashboardStats>; reportOutput: string; importPayload: string; importError: string | null; setImportPayload: (value: string) => void; onExportCsv: () => void; onExportJson: () => void; onImportJson: () => void }) {
  return <GlassCard><Text style={styles.cardTitle}>Reports</Text><Text style={styles.muted}>Daily, weekly, and monthly review summaries are generated from realized trades (closed + partial).</Text><Metric label="Net P/L Today" value={formatCurrency(stats.daily.netProfitLoss)} /><Metric label="Total Trades This Week" value={String(stats.weekly.totalTrades)} /><Metric label="Biggest Win" value={formatCurrency(stats.weekly.biggestWin)} /><Metric label="Biggest Loss" value={formatCurrency(stats.weekly.biggestLoss)} /><View style={styles.reportActions}><TouchableOpacity style={styles.secondaryButton} onPress={onExportCsv}><Text style={styles.buttonText}>Export CSV</Text></TouchableOpacity><TouchableOpacity style={styles.secondaryButton} onPress={onExportJson}><Text style={styles.buttonText}>Export JSON</Text></TouchableOpacity></View><Field label="Import JSON" value={importPayload} multiline numberOfLines={6} onChangeText={setImportPayload} /><TouchableOpacity style={styles.primaryButton} onPress={onImportJson}><Text style={styles.primaryText}>Import Trades</Text></TouchableOpacity>{importError && <Text style={styles.error}>{importError}</Text>}{reportOutput ? <View style={styles.reportOutput}><Text style={styles.mutedSmall}>Export / Import Output</Text><Text selectable style={styles.reportText}>{reportOutput}</Text></View> : null}</GlassCard>;
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
  reportActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reportOutput: { marginTop: 14, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 12, backgroundColor: 'rgba(3,8,22,.82)' },
  reportText: { color: colors.text, fontSize: 12, marginTop: 8 },
  buttonText: { color: colors.text, fontWeight: '900' },
  error: { color: colors.red, marginBottom: 4 },
  warning: { color: colors.yellow, marginTop: 8, fontSize: 12 },
  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.07)' },
  tradeSymbol: { color: colors.text, fontWeight: '900' },
});
