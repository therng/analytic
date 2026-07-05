export type BridgeMetricSource =
  | "deal"
  | "position"
  | "open-position"
  | "snapshot"
  | "redis-live"
  | "equity-snapshot"
  | "position-excursion"
  | "derived-cache";

export type MetricTimeframeScope = "timeframe" | "snapshot" | "intraday" | "all-time";

export type MetricDisplayKind = "primary-kpi" | "detail-chip" | "panel-summary";

export type MetricToneRule = "signed" | "drawdown" | "win-rate" | "count" | "margin" | "neutral";

export type MetricFormatter =
  | "compact-signed"
  | "compact-number"
  | "compact-count"
  | "currency"
  | "percent"
  | "plain-number";

export interface DashboardMetricDescriptor {
  id: string;
  label: string;
  source: BridgeMetricSource;
  formula: string;
  timeframe: MetricTimeframeScope;
  apiField: string;
  display: {
    kind: MetricDisplayKind;
    formatter: MetricFormatter;
    toneRule: MetricToneRule;
    emptyZero: boolean;
    meta?: string;
    hint?: string;
  };
}

const BRIDGE_METRIC_SOURCES = new Set<BridgeMetricSource>([
  "deal",
  "position",
  "open-position",
  "snapshot",
  "redis-live",
  "equity-snapshot",
  "position-excursion",
  "derived-cache",
]);

export function isBridgeMetricSource(value: string): value is BridgeMetricSource {
  return BRIDGE_METRIC_SOURCES.has(value as BridgeMetricSource);
}

export const DASHBOARD_METRICS: DashboardMetricDescriptor[] = [
  {
    id: "gain",
    label: "GAIN",
    source: "deal",
    formula: "Sum of timeframe-scoped trading deal profit + commission + swap, excluding funding operations.",
    timeframe: "timeframe",
    apiField: "overview.kpis.netProfit",
    display: {
      kind: "primary-kpi",
      formatter: "compact-signed",
      toneRule: "signed",
      emptyZero: true,
      meta: "Net income",
      hint: "กำไรสุทธิหลังหักค่าธรรมเนียม",
    },
  },
  {
    id: "dd",
    label: "DD",
    source: "deal",
    formula: "Maximum peak-to-trough drawdown percent from the timeframe balance ledger.",
    timeframe: "timeframe",
    apiField: "overview.kpis.drawdown",
    display: {
      kind: "primary-kpi",
      formatter: "percent",
      toneRule: "drawdown",
      emptyZero: true,
      meta: "Max floating",
      hint: "Drawdown สูงสุดในช่วงเวลา",
    },
  },
  {
    id: "pips",
    label: "PIPS",
    source: "position",
    formula: "Sum of timeframe-scoped closed-position pips.",
    timeframe: "timeframe",
    apiField: "overview.kpis.netPips",
    display: {
      kind: "primary-kpi",
      formatter: "compact-signed",
      toneRule: "signed",
      emptyZero: true,
      meta: "Net movement",
      hint: "จำนวน pip สุทธิจาก position ที่ปิดแล้ว",
    },
  },
  {
    id: "trades",
    label: "TRADES",
    source: "position",
    formula: "Count of timeframe-scoped closed positions.",
    timeframe: "timeframe",
    apiField: "overview.kpis.trades",
    display: {
      kind: "primary-kpi",
      formatter: "compact-count",
      toneRule: "count",
      emptyZero: true,
      meta: "Closed",
      hint: "จำนวน trade ที่ปิดแล้วในช่วงเวลา",
    },
  },
  {
    id: "opens",
    label: "OPENS",
    source: "open-position",
    formula: "Count of current open positions mirrored from fresh Redis positions.",
    timeframe: "snapshot",
    apiField: "overview.kpis.openCount",
    display: {
      kind: "primary-kpi",
      formatter: "compact-count",
      toneRule: "count",
      emptyZero: false,
      meta: "Live",
      hint: "จำนวน position ที่เปิดอยู่ตอนนี้",
    },
  },
  {
    id: "commission",
    label: "COMM.",
    source: "deal",
    formula: "Sum of timeframe-scoped trading deal commission.",
    timeframe: "timeframe",
    apiField: "overview.kpis.totalCommission",
    display: { kind: "detail-chip", formatter: "compact-signed", toneRule: "signed", emptyZero: true, meta: "Commission" },
  },
  {
    id: "swap",
    label: "SWAP",
    source: "deal",
    formula: "Sum of timeframe-scoped trading deal swap.",
    timeframe: "timeframe",
    apiField: "overview.kpis.totalSwap",
    display: { kind: "detail-chip", formatter: "compact-signed", toneRule: "signed", emptyZero: true, meta: "Swap" },
  },
  {
    id: "deposit",
    label: "DEPOS.",
    source: "deal",
    formula: "Sum of timeframe-scoped positive funding deal deltas.",
    timeframe: "timeframe",
    apiField: "overview.kpis.totalDeposit",
    display: { kind: "detail-chip", formatter: "compact-number", toneRule: "signed", emptyZero: true, meta: "Deposits" },
  },
  {
    id: "withdrawal",
    label: "WITHD.",
    source: "deal",
    formula: "Absolute sum of timeframe-scoped negative funding deal deltas.",
    timeframe: "timeframe",
    apiField: "overview.kpis.totalWithdrawal",
    display: { kind: "detail-chip", formatter: "compact-number", toneRule: "signed", emptyZero: true, meta: "Withdrawals" },
  },
  {
    id: "floating-pl",
    label: "P/L",
    source: "redis-live",
    formula: "Current floating P/L from Redis live data, falling back to AccountSnapshot/OpenPosition mirror.",
    timeframe: "snapshot",
    apiField: "account.floating_pl",
    display: { kind: "detail-chip", formatter: "compact-signed", toneRule: "signed", emptyZero: true, meta: "Floating" },
  },
  {
    id: "margin",
    label: "MARGIN",
    source: "redis-live",
    formula: "Current used margin from Redis live data, falling back to AccountSnapshot.",
    timeframe: "snapshot",
    apiField: "account.margin",
    display: { kind: "detail-chip", formatter: "compact-number", toneRule: "margin", emptyZero: true, meta: "Used" },
  },
  {
    id: "free-margin",
    label: "FREE",
    source: "redis-live",
    formula: "Current free margin from Redis live data or equity minus used margin fallback.",
    timeframe: "snapshot",
    apiField: "derived.freeMargin",
    display: { kind: "detail-chip", formatter: "compact-number", toneRule: "margin", emptyZero: true, meta: "Available" },
  },
  {
    id: "margin-level",
    label: "LEVEL",
    source: "redis-live",
    formula: "Current margin level percent from Redis live data, falling back to AccountSnapshot.",
    timeframe: "snapshot",
    apiField: "account.margin_level",
    display: { kind: "detail-chip", formatter: "percent", toneRule: "margin", emptyZero: true, meta: "Margin %" },
  },
  {
    id: "max-deposit-load",
    label: "LOAD",
    source: "equity-snapshot",
    formula: "Maximum margin divided by equity across bridge-sampled equity snapshots in the timeframe.",
    timeframe: "timeframe",
    apiField: "balanceDetail.summary.maximalDepositLoad",
    display: { kind: "panel-summary", formatter: "percent", toneRule: "margin", emptyZero: true, meta: "Deposit load" },
  },
] as const;

export function getDashboardMetric(id: string) {
  return DASHBOARD_METRICS.find((metric) => metric.id === id) ?? null;
}
