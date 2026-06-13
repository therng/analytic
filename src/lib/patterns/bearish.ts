import { CandlestickPattern } from "./types";

export const hangingMan: CandlestickPattern = {
  id: "hanging-man",
  name: "Hanging Man",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 120, high: 122, low: 95, close: 118 }
  ],
  outcome: { startPrice: 118, endPrice: 90 }
};

export const eveningStar: CandlestickPattern = {
  id: "evening-star",
  name: "Evening Star",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 125, low: 98, close: 120 }, // Bull
    { open: 125, high: 135, low: 122, close: 130 }, // Star
    { open: 125, high: 127, low: 105, close: 110 } // Bear
  ],
  outcome: { startPrice: 110, endPrice: 80 }
};

export const eveningDojiStar: CandlestickPattern = {
  id: "evening-doji-star",
  name: "Evening Doji Star",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 125, low: 98, close: 120 }, // Bull
    { open: 130, high: 135, low: 125, close: 130 }, // Doji
    { open: 125, high: 127, low: 105, close: 110 } // Bear
  ],
  outcome: { startPrice: 110, endPrice: 80 }
};

export const threeBlackCrows: CandlestickPattern = {
  id: "three-black-crows",
  name: "Three Black Crows",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 130, high: 132, low: 115, close: 118 },
    { open: 120, high: 122, low: 105, close: 108 },
    { open: 110, high: 112, low: 95, close: 98 }
  ],
  outcome: { startPrice: 98, endPrice: 70 }
};

export const darkCloudCover: CandlestickPattern = {
  id: "dark-cloud-cover",
  name: "Dark Cloud Cover",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 130, low: 98, close: 125 }, // Bull
    { open: 135, high: 137, low: 105, close: 108 } // Bear clossing deep
  ],
  outcome: { startPrice: 108, endPrice: 80 }
};

export const bearishMeetingLines: CandlestickPattern = {
  id: "bearish-meeting-lines",
  name: "Bearish Meeting Lines",
  type: "bearish",
  trend: "up",
  formation: [
    { open: 100, high: 125, low: 98, close: 120 }, // Bull
    { open: 135, high: 137, low: 118, close: 120 } // Bear gaps up, meets at close
  ],
  outcome: { startPrice: 120, endPrice: 100 }
};
