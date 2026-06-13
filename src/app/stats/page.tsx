"use client";
import { TradingMonitorSharedStyles, InlineState } from "@/components/trading-monitor/shared";
import { useApiResource } from "@/components/trading-monitor/useApiResource";
import type { SerializedAccount } from "@/lib/trading/types";
import { formatCurrency } from "@/components/trading-monitor/formatters";
import { LoadingScreen } from "@/components/trading-monitor/LoadingScreen";

export default function StatsPage() {
  const accounts = useApiResource<SerializedAccount[]>("/api/accounts");

  return (
    <main className="monitor-page">
      <TradingMonitorSharedStyles />
      <div className="app-scroll dashboard-scroll" style={{ paddingBottom: "16px" }}>
        <section className="dashboard-section" aria-label="Account statistics">
          {accounts.loading && !accounts.data ? (
            <InlineState tone="info" title="Loading stats" message="Calculating aggregated data..." />
          ) : accounts.error ? (
            <LoadingScreen />
          ) : (
            <>
              {/* Account List */}
              {accounts.data?.map(acc => (
                <article key={acc.id} className={`card account-card ${acc.status === "Active" ? "account-card--active" : "account-card--inactive"}`} style={{ minHeight: "auto", paddingBottom: "14px" }}>
                  <div className="sp-wrap" style={{ marginBottom: 0 }}>
                    <div className="sp-header" style={{ marginBottom: 0 }}>
                      <div className="sp-top sp-top--compact">
                        <div className="sp-identity sp-identity--header">
                          <div className="sp-name" style={{ fontSize: "16px" }}>{acc.owner_name || "Unnamed Account"}</div>
                          <div className="sp-account">
                            <span>#{acc.account_number}</span>
                            <span className={`sp-account-status ${acc.status === "Active" ? "is-active" : "is-inactive"}`} />
                          </div>
                        </div>
                        <div className="sp-side">
                          <div className="sp-balance">
                            <strong style={{ fontSize: "18px" }}>{formatCurrency(acc.balance, 0)}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
