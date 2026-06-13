import { CandlestickPattern } from "./types";

export const hammer: CandlestickPattern = {
  id: "hammer",
  name: "Hammer",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 100, high: 102, low: 70, close: 98 }
  ],
  outcome: { startPrice: 98, endPrice: 120 }
};

export const piercingLine: CandlestickPattern = {
  id: "piercing-line",
  name: "Piercing Line",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 120, high: 122, low: 90, close: 95 }, // Long bear
    { open: 92, high: 112, low: 90, close: 110 } // Bull penetrates > 50%
  ],
  outcome: { startPrice: 110, endPrice: 130 }
};

export const morningStar: CandlestickPattern = {
  id: "morning-star",
  name: "Morning Star",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 130, high: 132, low: 105, close: 110 }, // Bear
    { open: 102, high: 105, low: 95, close: 100 },  // Star
    { open: 105, high: 125, low: 103, close: 120 } // Bull
  ],
  outcome: { startPrice: 120, endPrice: 140 }
};

export const morningDojiStar: CandlestickPattern = {
  id: "morning-doji-star",
  name: "Morning Doji Star",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 130, high: 132, low: 105, close: 110 }, // Bear
    { open: 100, high: 105, low: 95, close: 100 },  // Doji
    { open: 105, high: 125, low: 103, close: 120 } // Bull
  ],
  outcome: { startPrice: 120, endPrice: 140 }
};

export const threeWhiteSoldiers: CandlestickPattern = {
  id: "three-white-soldiers",
  name: "Three White Soldiers",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 100, high: 115, low: 98, close: 112 },
    { open: 110, high: 125, low: 108, close: 122 },
    { open: 120, high: 135, low: 118, close: 132 }
  ],
  outcome: { startPrice: 132, endPrice: 150 }
};

export const bullishMeetingLines: CandlestickPattern = {
  id: "bullish-meeting-lines",
  name: "Bullish Meeting Lines",
  type: "bullish",
  trend: "down",
  formation: [
    { open: 120, high: 122, low: 95, close: 100 }, // Bear
    { open: 85, high: 102, low: 83, close: 100 }   // Bull gaps down, meets at close
  ],
  outcome: { startPrice: 100, endPrice: 120 }
};
