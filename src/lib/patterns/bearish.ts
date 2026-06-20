import { CandlestickPattern } from "./types";

export const hangingMan: CandlestickPattern = {
  id: "hanging-man",
  name: "Hanging Man",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 120, high: 122, low: 92, close: 118 }
  ],
  outcome: { startPrice: 118, endPrice: 90 }
};

export const eveningStar: CandlestickPattern = {
  id: "evening-star",
  name: "Evening Star",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 126, low: 98, close: 122 },
    { open: 128, high: 136, low: 126, close: 132 },
    { open: 126, high: 128, low: 104, close: 108 }
  ],
  outcome: { startPrice: 108, endPrice: 78 }
};

export const eveningDojiStar: CandlestickPattern = {
  id: "evening-doji-star",
  name: "Evening Doji Star",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 126, low: 98, close: 122 },
    { open: 130, high: 136, low: 126, close: 130 },
    { open: 126, high: 128, low: 104, close: 108 }
  ],
  outcome: { startPrice: 108, endPrice: 78 }
};

export const threeBlackCrows: CandlestickPattern = {
  id: "three-black-crows",
  name: "Three Black Crows",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 134, high: 136, low: 120, close: 122 },
    { open: 124, high: 126, low: 108, close: 110 },
    { open: 112, high: 114, low: 96, close: 98 }
  ],
  outcome: { startPrice: 98, endPrice: 70 }
};

export const darkCloudCover: CandlestickPattern = {
  id: "dark-cloud-cover",
  name: "Dark Cloud Cover",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 130, low: 98, close: 126 },
    { open: 134, high: 136, low: 106, close: 108 }
  ],
  outcome: { startPrice: 108, endPrice: 80 }
};

export const bearishMeetingLines: CandlestickPattern = {
  id: "bearish-meeting-lines",
  name: "Bearish Meeting Lines",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 126, low: 98, close: 122 },
    { open: 136, high: 138, low: 120, close: 122 }
  ],
  outcome: { startPrice: 122, endPrice: 98 }
};

export const bearishEngulfing: CandlestickPattern = {
  id: "bearish-engulfing",
  name: "Bearish Engulfing",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 116, low: 98, close: 114 },
    { open: 120, high: 122, low: 92, close: 96 }
  ],
  outcome: { startPrice: 96, endPrice: 68 }
};
