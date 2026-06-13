import * as bullish from "./bullish";
import * as bearish from "./bearish";
import { CandlestickPattern } from "./types";

export const allPatterns: CandlestickPattern[] = [
  bullish.hammer,
  bullish.piercingLine,
  bullish.morningStar,
  bullish.morningDojiStar,
  bullish.threeWhiteSoldiers,
  bullish.bullishMeetingLines,
  bearish.hangingMan,
  bearish.eveningStar,
  bearish.eveningDojiStar,
  bearish.threeBlackCrows,
  bearish.darkCloudCover,
  bearish.bearishMeetingLines,
];

export * from "./types";
