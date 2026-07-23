import {
  addBangkokDays,
  startOfBangkokDay,
  startOfBangkokMonth,
  startOfBangkokWeek,
  startOfBangkokYear,
} from "@/lib/time";
import {
  computeCompoundedGrowth,
  dealNet,
  filterByDateRange,
  isClosedPosition,
  isFundingDeal,
} from "@/lib/trading/analytics";
import type { DealRow, PositionRow } from "../preaggregated-cache";
import { getPositionPips } from "./positions";

function startOfReportDay(date: Date) {
  return startOfBangkokDay(date) ?? date;
}

export function buildPipsSummaryRows(
  deals: DealRow[],
  positions: PositionRow[],
  reportTime: Date,
) {
  const buildRow = (
    label: string,
    sinceDate: Date | null,
    untilDate: Date | null = null,
  ) => {
    const periodDeals = filterByDateRange(
      deals,
      (deal) => deal.time,
      sinceDate,
      untilDate,
    );
    const periodPositions = filterByDateRange(
      positions,
      (position) => position.closeTime,
      sinceDate,
      untilDate,
    );
    const periodClosedPositions = periodPositions.filter((position) =>
      isClosedPosition(position),
    );
    const profit = periodDeals
      .filter((deal) => !isFundingDeal(deal.type, deal.comment, dealNet(deal)))
      .reduce((total, deal) => total + dealNet(deal), 0);
    const growth = computeCompoundedGrowth(deals, sinceDate, untilDate);
    const pips = periodClosedPositions
      .map((position) => getPositionPips(position))
      .filter((value): value is number => Number.isFinite(value))
      .reduce((total, value) => total + value, 0);
    const volume = periodClosedPositions.reduce(
      (total, position) => total + Number(position.volume ?? 0),
      0,
    );
    return { label, profit, growth, pips, volume };
  };

  // Calendar-anchored periods (Bangkok time), not rolling N-day windows.
  const todayStart = startOfReportDay(reportTime);
  const yesterdayStart = startOfReportDay(
    addBangkokDays(reportTime, -1) ?? reportTime,
  );
  const weekStart = startOfReportDay(
    startOfBangkokWeek(reportTime) ?? reportTime,
  );
  const monthStart = startOfReportDay(
    startOfBangkokMonth(reportTime) ?? reportTime,
  );
  const yearStart = startOfReportDay(
    startOfBangkokYear(reportTime) ?? reportTime,
  );

  return [
    buildRow("เมื่อวาน", yesterdayStart, new Date(todayStart.getTime() - 1)),
    buildRow("วันนี้", todayStart),
    buildRow("สัปดาห์นี้", weekStart),
    buildRow("เดือนนี้", monthStart),
    buildRow("ปีนี้", yearStart),
  ];
}
