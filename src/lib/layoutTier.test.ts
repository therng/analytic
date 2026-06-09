import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveLayoutTier } from "./layoutTier.ts";

describe("deriveLayoutTier", () => {
  // Desktop
  it("returns desktop at 1024px", () => {
    assert.equal(deriveLayoutTier(1024, true), "desktop");
    assert.equal(deriveLayoutTier(1024, false), "desktop");
  });
  it("returns desktop at 1920px", () => {
    assert.equal(deriveLayoutTier(1920, false), "desktop");
  });

  // Tablet portrait
  it("returns tablet-portrait at 768px portrait", () => {
    assert.equal(deriveLayoutTier(768, true), "tablet-portrait");
  });
  it("returns tablet-portrait at 1023px portrait", () => {
    assert.equal(deriveLayoutTier(1023, true), "tablet-portrait");
  });

  // Tablet landscape
  it("returns tablet-landscape at 768px landscape", () => {
    assert.equal(deriveLayoutTier(768, false), "tablet-landscape");
  });
  it("returns tablet-landscape at 1023px landscape", () => {
    assert.equal(deriveLayoutTier(1023, false), "tablet-landscape");
  });

  // Mobile landscape
  it("returns mobile-landscape at 600px", () => {
    assert.equal(deriveLayoutTier(600, false), "mobile-landscape");
    assert.equal(deriveLayoutTier(600, true), "mobile-landscape");
  });
  it("returns mobile-landscape at 767px", () => {
    assert.equal(deriveLayoutTier(767, false), "mobile-landscape");
  });

  // Mobile portrait
  it("returns mobile-portrait at 599px", () => {
    assert.equal(deriveLayoutTier(599, true), "mobile-portrait");
    assert.equal(deriveLayoutTier(599, false), "mobile-portrait");
  });
  it("returns mobile-portrait at 375px", () => {
    assert.equal(deriveLayoutTier(375, true), "mobile-portrait");
  });

  // Boundary: exactly at tier transitions
  it("boundary 767→768 portrait: 767 is mobile-landscape, 768 is tablet-portrait", () => {
    assert.equal(deriveLayoutTier(767, true), "mobile-landscape");
    assert.equal(deriveLayoutTier(768, true), "tablet-portrait");
  });
  it("boundary 1023→1024: 1023 is tablet, 1024 is desktop", () => {
    assert.equal(deriveLayoutTier(1023, false), "tablet-landscape");
    assert.equal(deriveLayoutTier(1024, false), "desktop");
  });

  // Mutually exclusive: only one tier at a time
  it("no two tiers match for same input", () => {
    const tiers = ["desktop", "tablet-portrait", "tablet-landscape", "mobile-landscape", "mobile-portrait"];
    const inputs: Array<[number, boolean]> = [
      [375, true], [600, false], [767, false], [768, true], [1024, false]
    ];
    for (const [w, p] of inputs) {
      const result = deriveLayoutTier(w, p);
      assert.ok(tiers.includes(result), `Unexpected tier ${result} for w=${w} p=${p}`);
    }
  });
});
