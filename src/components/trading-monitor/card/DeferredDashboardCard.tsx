"use client";

import { useEffect, useRef } from "react";
import { displayName } from "@/components/trading-monitor/formatters";
import { type SerializedAccount } from "@/lib/trading/types";
import { AccountCardStrip } from "./AccountCardStrip";

const ACCOUNT_CARD_PRELOAD_MARGIN = "720px 360px";
const DEFERRED_LOAD_FALLBACK_MS = 4000;

export function DeferredDashboardCard({
  account,
  onLoad,
}: {
  account: SerializedAccount;
  onLoad: () => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const active = account.status === "Active";
  const accountDisplayName = displayName(account);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) {
      return;
    }

    let done = false;
    const trigger = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(fallback);
      onLoad();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
          )
        ) {
          trigger();
        }
      },
      {
        root: null,
        rootMargin: ACCOUNT_CARD_PRELOAD_MARGIN,
        threshold: 0.01,
      },
    );

    observer.observe(node);
    const fallback = setTimeout(trigger, DEFERRED_LOAD_FALLBACK_MS);

    return () => {
      done = true;
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [onLoad]);

  return (
    <article
      ref={cardRef}
      className={`card account-card account-card--deferred ${active ? "account-card--active" : "account-card--inactive"}`}
      aria-label={`${accountDisplayName} loading`}
    >
      <div className="sp-wrap">
        <AccountCardStrip
          account={account}
          active={active}
          equity={account.equity}
        />

        <div className="tf-row" aria-hidden="true">
          <div className="timeframe-strip timeframe-strip--deferred">
            {["D", "W", "M", "Y"].map((label) => (
              <span
                key={label}
                className="timeframe-pill timeframe-pill--skeleton"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <div
          className="skeleton-chart account-card__chart-skeleton"
          aria-hidden="true"
        />
      </div>

      <div className="kpi-stack" aria-hidden="true">
        <div className="kgrid">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="kchip kchip--skeleton">
              <span className="kl">&nbsp;</span>
              <strong className="kv">&nbsp;</strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
