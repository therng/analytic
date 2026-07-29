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
    label: "MAX LOAD",
    meta: "Peak deposit load",
    hint: "Deposit load สูงสุดในช่วงเวลา (interim: อิง margin ของโบรกเกอร์)",
    source: "EquitySnapshot.depositLoad / maxDepositLoad (interim historical path)",
    formula:
      "max(broker margin / equity) over scoped samples; \"all\" reads the persisted running high-water mark instead, since it survives 7-day row retention",
    apiField: "balanceDetail.summary.maximalDepositLoad",
    displayTarget: "Performance radar deposit-load axis",
  },
  {
    id: "deposit-load-by-volume",
    label: "LOAD",
    meta: "Deposit load",
    hint: "deposit load = filled XAUUSD order lots x 410.3 / balance",
    source: "Order.state=filled + AccountSnapshot/Redis balance",
    formula: "sum(filled XAUUSD order lots) x 410.3 / balance",
    apiField: "account.deposit_load_pct",
    displayTarget: "OPENS detail chip",
  },
] as const;

export function getDashboardMetric(id: string) {
  return DASHBOARD_METRICS.find((metric) => metric.id === id) ?? null;
}
