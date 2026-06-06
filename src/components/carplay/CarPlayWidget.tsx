"use client";

import type React from "react";
import { useState, useEffect } from "react";

import { SparklineChart } from "@/components/trading-monitor/shared";
import {
  formatCurrency,
  formatSignedCurrency,
  formatPercent,
  formatWholeNumber,
  displayName,
  toneFromNumber,
} from "@/components/trading-monitor/formatters";
import { useApiResource } from "@/components/trading-monitor/useApiResource";
import type { SerializedAccount, BalanceEventPoint, Timeframe } from "@/lib/trading/types";

const TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "ALL" },
];

const REFRESH_SECONDS = 30;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CHF: "Fr", AUD: "A$", CAD: "C$",
};

interface BalanceDetailResponse {
  balanceCurve: BalanceEventPoint[];
}

export function CarPlayWidget({ initialAccounts }: { initialAccounts: SerializedAccount[] }) {
  const [accountIdx, setAccountIdx] = useState(0);
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");

  // refreshTick drives both the visible countdown and the useApiResource refresh cycle
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshKey = Math.floor(refreshTick / REFRESH_SECONDS);
  const countdown = REFRESH_SECONDS - (refreshTick % REFRESH_SECONDS) || REFRESH_SECONDS;

  useEffect(() => {
    const tick = setInterval(() => setRefreshTick((t) => t + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  // Accounts list — refresh every REFRESH_SECONDS seconds via refreshKey
  const { data: accountsData } = useApiResource<SerializedAccount[]>("/api/accounts", { refreshKey });
  const accounts = accountsData ?? initialAccounts;
  const safeIdx = Math.min(accountIdx, Math.max(0, accounts.length - 1));
  const account = accounts[safeIdx] ?? null;

  // Balance curve — refresh with refreshKey; changes when account or timeframe changes too
  const balanceCurveUrl = account
    ? `/api/accounts/${account.id}/balance-detail?timeframe=${timeframe}`
    : null;
  const { data: balanceDetail } = useApiResource<BalanceDetailResponse>(balanceCurveUrl, { refreshKey });
  const balanceCurve = balanceDetail?.balanceCurve ?? [];

  if (!account) {
    return <div style={styles.empty}>No accounts available.</div>;
  }

  const sym = CURRENCY_SYMBOLS[account.currency] ?? account.currency;
  const tone = toneFromNumber(account.today_net_profit);
  const sparklineTone = (tone === "warning" ? "neutral" : tone) as "positive" | "negative" | "neutral" | "muted";
  const toneColor =
    tone === "positive" ? "var(--positive)" :
    tone === "negative" ? "var(--negative)" :
    "var(--neutral)";
  const canNav = accounts.length > 1;

  return (
    <div style={styles.root}>

      {/* ── Header ── */}
      <header style={styles.header}>
        <button
          style={{ ...styles.navBtn, opacity: canNav ? 1 : 0.25 }}
          onClick={() => setAccountIdx((safeIdx - 1 + accounts.length) % accounts.length)}
          disabled={!canNav}
          aria-label="Previous account"
        >
          ←
        </button>

        <div style={styles.headerCenter}>
          <span style={styles.accountNo}>#{account.account_number}</span>
          <span style={styles.accountName}>{displayName(account)}</span>
          {account.status === "Active" && <span style={styles.liveDot} aria-hidden="true" />}
        </div>

        <button
          style={{ ...styles.navBtn, opacity: canNav ? 1 : 0.25 }}
          onClick={() => setAccountIdx((safeIdx + 1) % accounts.length)}
          disabled={!canNav}
          aria-label="Next account"
        >
          →
        </button>
      </header>

      {/* ── Main: KPIs (left) + Chart (right) ── */}
      <main style={styles.main}>

        <section style={styles.kpiCol}>
          <div style={styles.kpiGroup}>
            <div style={styles.kpiLabel}>Balance</div>
            <div style={{ ...styles.balanceValue, color: "var(--text-primary)" }}>
              {formatCurrency(account.balance, 2, sym)}
            </div>
          </div>

          <div style={styles.kpiGroup}>
            <div style={styles.kpiLabel}>Today</div>
            <div style={{ ...styles.todayValue, color: toneColor }}>
              {formatSignedCurrency(account.today_net_profit, 2, sym)}
              <span style={styles.todayPct}>
                &nbsp;({formatPercent(account.today_growth_percent)})
              </span>
            </div>
          </div>

          <div style={styles.kpiRow}>
            <div style={styles.kpiMini}>
              <div style={styles.kpiMiniLabel}>Equity</div>
              <div style={styles.kpiMiniValue}>{formatCurrency(account.equity, 2, sym)}</div>
            </div>
            <div style={styles.kpiMini}>
              <div style={styles.kpiMiniLabel}>Float</div>
              <div style={{
                ...styles.kpiMiniValue,
                color: account.floating_pl > 0 ? "var(--positive)" :
                  account.floating_pl < 0 ? "var(--negative)" : "var(--text-secondary)",
              }}>
                {formatSignedCurrency(account.floating_pl, 2, sym)}
              </div>
            </div>
            {account.margin_level != null && (
              <div style={styles.kpiMini}>
                <div style={styles.kpiMiniLabel}>Margin</div>
                <div style={{
                  ...styles.kpiMiniValue,
                  color: account.margin_level < 150 ? "var(--negative)" :
                    account.margin_level < 300 ? "var(--warning)" : "var(--text-secondary)",
                }}>
                  {formatWholeNumber(account.margin_level)}%
                </div>
              </div>
            )}
          </div>
        </section>

        <section style={styles.chartCol}>
          <div className="cp-chart-container" style={styles.chartInner}>
            <SparklineChart
              points={balanceCurve}
              active={account.status === "Active"}
              tone={sparklineTone}
              timeframe={timeframe}
            />
          </div>
        </section>

      </main>

      {/* ── Footer: timeframe toggle + refresh countdown ── */}
      <footer style={styles.footer}>
        <div style={styles.tfGroup}>
          {TIMEFRAMES.map(({ value, label }) => (
            <button
              key={value}
              style={{ ...styles.tfBtn, ...(timeframe === value ? styles.tfBtnActive : {}) }}
              onClick={() => setTimeframe(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={styles.countdown}>↺ {countdown}s</div>
      </footer>

    </div>
  );
}

// ── Style objects ──────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "grid",
    gridTemplateRows: "48px 1fr 64px",
    height: "100dvh",
    background: "var(--bg-void)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-body)",
    overflow: "hidden",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100dvh",
    background: "var(--bg-void)",
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    fontSize: 14,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 12px",
    borderBottom: "1px solid var(--border-dim)",
  },
  headerCenter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    justifyContent: "center",
  },
  accountNo: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--text-muted)",
    letterSpacing: "0.06em",
  },
  accountName: {
    fontFamily: "var(--font-body)",
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  liveDot: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--positive)",
    boxShadow: "0 0 6px var(--positive)",
  },
  navBtn: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--r-sm)",
    color: "var(--text-secondary)",
    fontSize: 18,
    width: 44,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
  },
  main: {
    display: "grid",
    gridTemplateColumns: "38% 62%",
    overflow: "hidden",
  },
  kpiCol: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: "12px 20px",
    gap: 10,
    borderRight: "1px solid var(--border-dim)",
  },
  kpiGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  kpiLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  balanceValue: {
    fontFamily: "var(--font-display)",
    fontWeight: 800,
    fontSize: "clamp(22px, 3.2vw, 34px)",
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
  },
  todayValue: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: "clamp(17px, 2.4vw, 24px)",
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 2,
  },
  todayPct: {
    fontSize: "0.6em",
    fontWeight: 500,
    opacity: 0.85,
  },
  kpiRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  kpiMini: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  kpiMiniLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 8,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  kpiMiniValue: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--text-secondary)",
    fontWeight: 500,
    letterSpacing: "0.02em",
  },
  chartCol: {
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  chartInner: {
    flex: 1,
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    padding: "12px 8px",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderTop: "1px solid var(--border-dim)",
    gap: 8,
  },
  tfGroup: {
    display: "flex",
    gap: 6,
  },
  tfBtn: {
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    border: "1px solid var(--border-dim)",
    borderRadius: "var(--r-sm)",
    padding: "0 14px",
    height: 44,
    minWidth: 48,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    letterSpacing: "0.04em",
  },
  tfBtnActive: {
    background: "var(--gold-400)",
    color: "#000",
    border: "1px solid var(--gold-400)",
    fontWeight: 700,
  },
  countdown: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--text-ghost)",
    letterSpacing: "0.06em",
  },
};
