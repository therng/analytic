export interface DashboardMetricDescriptor {
  id: string;
  label: string;
  meta?: string;
  hint?: string;
  source?: string;
  formula?: string;
  apiField?: string;
  displayTarget?: string;
}

export const DASHBOARD_METRICS: DashboardMetricDescriptor[] = [
  {
    id: "gain",
    label: "GAIN",
    meta: "Net income",
    hint: "กำไรสุทธิหลังหักค่าธรรมเนียม",
  },
  {
    id: "dd",
    label: "DD",
    meta: "Max floating",
    hint: "Drawdown สูงสุดในช่วงเวลา",
  },
  {
    id: "max-balance-drawdown",
    label: "MAX",
    meta: "Max balance DD",
    hint: "จำนวนเงินที่ Balance ลดลงสูงสุดจากจุดสูงสุดถึงจุดต่ำสุดในช่วงเวลา",
    source: "Deal",
    formula: "Largest peak-to-valley decline on the scoped balance curve",
    apiField: "balanceDetail.summary.maximalDrawdownAmount",
    displayTarget: "DD detail MAX chip",
  },
  {
    id: "pips",
    label: "PIPS",
    meta: "Net movement",
    hint: "จำนวน pip สุทธิจาก position ที่ปิดแล้ว",
  },
  {
    id: "trades",
    label: "TRADES",
    meta: "Closed",
    hint: "จำนวน trade ที่ปิดแล้วในช่วงเวลา",
  },
  {
    id: "opens",
    label: "OPENS",
    meta: "Live",
    hint: "จำนวน position ที่เปิดอยู่ตอนนี้",
  },
  {
    id: "commission",
    label: "COMM.",
    meta: "Commission",
  },
  {
    id: "swap",
    label: "SWAP",
    meta: "Swap",
  },
  {
    id: "deposit",
    label: "DEPOS.",
    meta: "Deposits",
  },
  {
    id: "withdrawal",
    label: "WITHD.",
    meta: "Withdrawals",
  },
  {
    id: "floating-pl",
    label: "P/L",
    meta: "Floating",
  },
  {
    id: "margin",
    label: "MARGIN",
    meta: "Used",
  },
  {
    id: "free-margin",
    label: "FREE",
    meta: "Available",
  },
  {
    id: "margin-level",
    label: "LEVEL",
    meta: "Margin %",
  },
  {
    id: "max-deposit-load",
    label: "LOAD",
    meta: "Deposit load",
  },
  {
    id: "deposit-load-by-volume",
    label: "EST.",
    meta: "Volume est.",
    hint: "est. margin = lots x 410.3 (XAUUSD)",
    source: "OpenPosition + AccountSnapshot/Redis equity",
    formula: "XAUUSD open lots x 410.3 / equity",
    apiField: "account.deposit_load_by_volume_pct",
    displayTarget: "OPENS detail chip beside broker margin level",
  },
] as const;

export function getDashboardMetric(id: string) {
  return DASHBOARD_METRICS.find((metric) => metric.id === id) ?? null;
}
