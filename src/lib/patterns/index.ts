import * as bullish from "./bullish";
import * as bearish from "./bearish";
import { CandlestickPattern } from "./types";

export const allPatterns: CandlestickPattern[] = [
  bullish.hammer,
  bearish.hangingMan,
  bullish.morningStar,
  bullish.morningDojiStar,
  bearish.eveningStar,
  bearish.eveningDojiStar,
  bullish.piercingLine,
  bearish.darkCloudCover,
  bullish.threeWhiteSoldiers,
  bearish.threeBlackCrows,
  bullish.bullishHarami,
  bearish.bearishEngulfing,
  bullish.bullishMeetingLines,
  bearish.bearishMeetingLines,
];

export * from "./types";
