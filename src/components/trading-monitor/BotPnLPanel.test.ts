import assert from "node:assert/strict";
import test from "node:test";

import { getBotPnlChartStyle, MAX_VISIBLE_BOT_BARS, normalizeBotName } from "./BotPnLPanel";

test("getBotPnlChartStyle keeps up to six bot bars in the viewport", () => {
  assert.equal(MAX_VISIBLE_BOT_BARS, 6);
  assert.deepEqual(getBotPnlChartStyle(0), {
    width: "100%",
    height: "100%",
  });
  assert.deepEqual(getBotPnlChartStyle(6), {
    width: "100%",
    height: "100%",
  });
});

test("getBotPnlChartStyle expands wider than the viewport after six bots", () => {
  assert.deepEqual(getBotPnlChartStyle(12), {
    width: "200%",
    minWidth: "528px",
    height: "100%",
  });
});

test("normalizeBotName falls back to Manual for empty input", () => {
  assert.equal(normalizeBotName(null), "Manual");
  assert.equal(normalizeBotName(undefined), "Manual");
  assert.equal(normalizeBotName(""), "Manual");
  assert.equal(normalizeBotName("   "), "Manual");
});

test("normalizeBotName strips #N|... position id prefix before slicing", () => {
  assert.equal(normalizeBotName("#2231|GX"), "GX");
  assert.equal(normalizeBotName("#2231| AxonShift"), "Axo");
  assert.equal(normalizeBotName("#42|BB_Return"), "BB");
});

test("normalizeBotName takes leading alphanumeric run capped at three characters", () => {
  assert.equal(normalizeBotName("AxonShift"), "Axo");
  assert.equal(normalizeBotName("AxonGold"), "Axo");
  assert.equal(normalizeBotName("BB_Return"), "BB");
  assert.equal(normalizeBotName("BB_Reversal"), "BB");
  assert.equal(normalizeBotName("QQ"), "QQ");
  assert.equal(normalizeBotName("Full Throttle"), "Ful");
  assert.equal(normalizeBotName("Aurora"), "Aur");
  assert.equal(normalizeBotName("GX_blah"), "GX");
});

test("normalizeBotName returns Manual when no leading alphanumerics are present", () => {
  assert.equal(normalizeBotName("---"), "Manual");
  assert.equal(normalizeBotName("#99| "), "Manual");
});
