"use client";

import { motion } from "framer-motion";
import { tableRowMotion } from "@/lib/animations";
import { type PipsSummaryRow } from "@/lib/trading/types";
import {
  formatCompactNumber,
  formatCompactSignedNumber,
  formatPercent,
  formatSignedCurrency,
  toneFromNumber,
} from "@/components/trading-monitor/formatters";

export function PipsPerformanceTable({ rows }: { rows: PipsSummaryRow[] }) {
  if (!rows.length) {
    return null;
  }

  return (
    <section className="pips-performance" aria-label="Pips performance summary">
      <div className="pips-performance__table-shell">
        <table className="pips-performance__table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">Return</th>
              <th scope="col">Profit</th>
              <th scope="col">Pips</th>
              <th scope="col">Lot</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <motion.tr key={row.label} {...tableRowMotion(index)}>
                <th scope="row">{row.label}</th>
                <td className={`tone-${toneFromNumber(row.growth)}`}>
                  {formatPercent(row.growth, 1)}
                </td>
                <td className={`tone-${toneFromNumber(row.profit)}`}>
                  {formatSignedCurrency(row.profit, 2)}
                </td>
                <td
                  className={
                    typeof row.pips === "number" && row.pips < 0
                      ? "tone-negative"
                      : "tone-neutral"
                  }
                >
                  {formatCompactSignedNumber(row.pips, 1)}
                </td>
                <td>{formatCompactNumber(row.volume, 1)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
