export interface DashboardMetricDescriptor {
  id: string;
  label: string;
  meta?: string;
  hint?: string;
  source: string;
  formula: string;
  apiField: string;
  displayTarget: string;
}

export const DASHBOARD_METRICS: DashboardMetricDescriptor[] = [
  {
    id: "gain",
    label: "GAIN",
    meta: "Net income",
    hint: "กำไรสุทธิหลังหักค่าธรรมเนียม",
    source: "Deal",
    formula: "Sum profit + swap + commission for scoped trading deals, excluding balance operations",
    apiField: "overview.kpis.netProfit",
    displayTarget: "GAIN KPI chip",
  },
  {
    id: "dd",
    label: "DD",
    meta: "Balance curve",
    hint: "Drawdown สูงสุดในช่วงเวลา",
    source: "Deal",
    formula: "Maximum peak-to-valley balance decline divided by peak balance over the scoped balance curve",
    apiField: "overview.kpis.drawdown",
    displayTarget: "DD KPI chip",
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
    source: "Position",
    formula: "Sum net pips from scoped closed positions",
    apiField: "overview.kpis.netPips",
    displayTarget: "PIPS KPI chip",
  },
  {
    id: "trades",
    label: "TRADES",
    meta: "Closed",
    hint: "จำนวน trade ที่ปิดแล้วในช่วงเวลา",
    source: "Position",
    formula: "Count scoped closed positions",
    apiField: "overview.kpis.trades",
    displayTarget: "TRADES KPI chip",
  },
  {
    id: "opens",
    label: "OPENS",
    meta: "Live",
    hint: "จำนวน position ที่เปิดอยู่ตอนนี้",
    source: "OpenPosition",
    formula: "Count current open positions, preferring the fresher live position snapshot",
    apiField: "overview.kpis.openCount",
    displayTarget: "OPENS KPI chip",
  },
  {
    id: "commission",
    label: "COMM.",
    meta: "Commission",
    source: "Deal",
    formula: "Sum commission for scoped trading deals",
    apiField: "overview.kpis.totalCommission",
    displayTarget: "GAIN detail COMM. chip",
  },
  {
    id: "swap",
    label: "SWAP",
    meta: "Swap",
    source: "Deal",
    formula: "Sum swap for scoped trading deals",
    apiField: "overview.kpis.totalSwap",
    displayTarget: "GAIN detail SWAP chip",
  },
  {
    id: "deposit",
    label: "DEPOS.",
    meta: "Deposits",
    source: "Deal",
    formula: "Sum positive scoped deposit balance operations",
    apiField: "overview.kpis.totalDeposit",
    displayTarget: "GAIN detail DEPOS. chip",
  },
  {
    id: "withdrawal",
    label: "WITHD.",
    meta: "Withdrawals",
    source: "Deal",
    formula: "Sum absolute values of negative scoped withdrawal balance operations",
    apiField: "overview.kpis.totalWithdrawal",
    displayTarget: "GAIN detail WITHD. chip",
  },
  {
    id: "floating-pl",
    label: "P/L",
    meta: "Floating",
    source: "OpenPosition / AccountSnapshot / Redis",
    formula: "Current floating profit or loss from the freshest live snapshot",
    apiField: "account.floating_pl",
    displayTarget: "OPENS detail P/L chip",
  },
  {
    id: "margin",
    label: "MARGIN",
    meta: "Used",
    source: "AccountSnapshot / Redis",
    formula: "Current broker-reported used margin from the freshest live snapshot",
    apiField: "account.margin",
    displayTarget: "OPENS detail MARGIN chip",
  },
  {
    id: "free-margin",
    label: "FREE",
    meta: "Available",
    source: "AccountSnapshot / Redis",
    formula: "Current free margin, falling back to equity minus used margin",
    apiField: "live.freeMargin / account.equity - account.margin",
    displayTarget: "OPENS detail FREE chip",
  },
  {
    id: "margin-level",
    label: "LEVEL",
    meta: "Margin %",
    source: "AccountSnapshot / Redis",
    formula: "Current broker-reported margin level percentage from the freshest live snapshot",
    apiField: "account.margin_level",
    displayTarget: "OPENS detail LEVEL chip",
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
] as const;

export function getDashboardMetric(id: string) {
  return DASHBOARD_METRICS.find((metric) => metric.id === id) ?? null;
}
