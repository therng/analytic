import { CandlestickPattern } from "./types";

export const hammer: CandlestickPattern = {
  id: "hammer",
  name: "Hammer",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 96, high: 100, low: 66, close: 98 }
  ],
  outcome: { startPrice: 98, endPrice: 120 }
};

export const piercingLine: CandlestickPattern = {
  id: "piercing-line",
  name: "Piercing Line",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 120, high: 122, low: 90, close: 94 },
    { open: 88, high: 112, low: 86, close: 110 }
  ],
  outcome: { startPrice: 110, endPrice: 132 }
};

export const morningStar: CandlestickPattern = {
  id: "morning-star",
  name: "Morning Star",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 132, high: 134, low: 106, close: 110 },
    { open: 102, high: 106, low: 96, close: 100 },
    { open: 104, high: 128, low: 102, close: 124 }
  ],
  outcome: { startPrice: 124, endPrice: 148 }
};

export const morningDojiStar: CandlestickPattern = {
  id: "morning-doji-star",
  name: "Morning Doji Star",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 132, high: 134, low: 106, close: 110 },
    { open: 100, high: 106, low: 94, close: 100 },
    { open: 104, high: 128, low: 102, close: 124 }
  ],
  outcome: { startPrice: 124, endPrice: 148 }
};

export const threeWhiteSoldiers: CandlestickPattern = {
  id: "three-white-soldiers",
  name: "Three White Soldiers",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 100, high: 114, low: 98, close: 112 },
    { open: 110, high: 124, low: 108, close: 122 },
    { open: 120, high: 136, low: 118, close: 134 }
  ],
  outcome: { startPrice: 134, endPrice: 155 }
};

export const bullishMeetingLines: CandlestickPattern = {
  id: "bullish-meeting-lines",
  name: "Bullish Meeting Lines",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 122, high: 124, low: 94, close: 100 },
    { open: 84, high: 104, low: 82, close: 100 }
  ],
  outcome: { startPrice: 100, endPrice: 124 }
};

export const bullishHarami: CandlestickPattern = {
  id: "bullish-harami",
  name: "Bullish Harami",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 130, high: 132, low: 98, close: 103 },
    { open: 108, high: 118, low: 106, close: 118 }
  ],
  outcome: { startPrice: 118, endPrice: 142 }
};
