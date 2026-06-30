export interface BotMeta {
  key: string;       // canonical id: "quantum-queen"
  label: string;     // ≤4-char X-axis label: "QQ"
  name: string;      // display name: "Quantum Queen MT5"
  url: string;       // MQL5 market product page
  image: string;     // cover artwork (200×200 from c.mql5.com)
  rating: number;    // star rating 1–5 (0 = unavailable/unverified)
  reviews: number;   // review count (0 = unavailable/unverified)
  price: string;     // display price e.g. "1 999.99 USD" ("—" = delisted)
}

interface BotMatcher {
  meta: BotMeta;
  patterns: RegExp[];
}

// ---------------------------------------------------------------------------
// Registry — 18 known EAs. Add new entries here; order inside registry does
// NOT matter (only MATCHERS order matters for first-match resolution).
// image/rating/reviews/price fetched from MQL5 market 2026-06-25.
// ---------------------------------------------------------------------------
export const BOT_REGISTRY: Record<string, BotMeta> = {
  "quantum-queen": {
    key: "quantum-queen", label: "QQ", name: "Quantum Queen MT5",
    url: "https://www.mql5.com/en/market/product/118805",
    image: "https://c.mql5.com/31/2073/quantum-queen-mt5-logo-200x200-1749.png",
    rating: 4.98, reviews: 803, price: "1,999.99 USD",
  },
  "quantum-emperor": {
    key: "quantum-emperor", label: "QE", name: "Quantum Emperor MT5",
    url: "https://www.mql5.com/en/market/product/103452",
    image: "https://c.mql5.com/31/2001/quantum-emperor-mt5-logo-200x200-7471.png",
    rating: 4.86, reviews: 584, price: "799.99 USD",
  },
  "gold-house": {
    key: "gold-house", label: "HOU", name: "Gold House MT5",
    url: "https://www.mql5.com/en/market/product/165036",
    image: "https://c.mql5.com/31/1811/gold-house-mt5-logo-200x200-6748.png",
    rating: 4.62, reviews: 55, price: "524.30 USD",
  },
  "wall-street": {
    key: "wall-street", label: "WAL", name: "Wall Street Robot MT5",
    url: "https://www.mql5.com/en/market/product/162905",
    image: "https://c.mql5.com/31/1963/wall-street-robot-mt5-logo-200x200-9259.png",
    rating: 3.95, reviews: 19, price: "1,299 USD",
  },
  "full-throttle": {
    key: "full-throttle", label: "FUL", name: "Full Throttle DMX",
    url: "https://www.mql5.com/en/market/product/167600",
    image: "https://c.mql5.com/31/1867/full-throttle-dmx-logo-200x200-5045.png",
    rating: 5, reviews: 10, price: "699 USD",
  },
  "axonshift": {
    key: "axonshift", label: "AXO", name: "Axonshift EA MT5",
    url: "https://www.mql5.com/en/market/product/145873",
    image: "https://c.mql5.com/31/1477/axonshift-ea-mt5-logo-200x200-7620.png",
    rating: 3.84, reviews: 45, price: "799 USD",
  },
  "twisterpro": {
    key: "twisterpro", label: "TWI", name: "TwisterPro Scalper",
    url: "https://www.mql5.com/en/market/product/166740",
    image: "https://c.mql5.com/31/2077/twisterpro-scalper-logo-200x200-8236.png",
    rating: 4.45, reviews: 122, price: "399 USD",
  },
  "ane": {
    key: "ane", label: "ANE", name: "AnE",
    url: "https://www.mql5.com/en/market/product/175171",
    image: "https://c.mql5.com/31/2081/ane-logo-200x200-5632.png",
    rating: 1.88, reviews: 11, price: "189 USD",
  },
  "bb-return": {
    key: "bb-return", label: "BB", name: "BB Return MT5",
    url: "https://www.mql5.com/en/market/product/162150",
    image: "https://c.mql5.com/31/2047/bb-return-mt5-logo-200x200-5872.png",
    rating: 4.58, reviews: 129, price: "649 USD",
  },
  "aurum-ai": {
    key: "aurum-ai", label: "AUR", name: "Aurum AI MT5",
    url: "https://www.mql5.com/en/market/product/126802",
    image: "https://c.mql5.com/31/1659/aurum-ai-mt5-logo-200x200-4284.png",
    rating: 4.81, reviews: 54, price: "499 USD",
  },
  "goldwave": {
    key: "goldwave", label: "GW", name: "Goldwave EA MT5",
    url: "https://www.mql5.com/en/market/product/158203",
    image: "https://c.mql5.com/31/1939/goldwave-ea-mt5-logo-200x200-4825.png",
    rating: 4.75, reviews: 74, price: "999 USD",
  },
  "axio-gold": {
    key: "axio-gold", label: "AX", name: "AXIO Gold EA",
    url: "https://www.mql5.com/en/market/product/173872",
    image: "https://c.mql5.com/31/1964/axio-gold-ea-logo-60x60-4785.png",
    rating: 0, reviews: 0, price: "—",  // delisted from MQL5 market
  },
  "chiroptera": {
    key: "chiroptera", label: "CHI", name: "Chiroptera",
    url: "https://www.mql5.com/en/market/product/152565",
    image: "https://c.mql5.com/31/2114/chiroptera-logo-200x200-4677.png",
    rating: 4.53, reviews: 50, price: "899 USD",
  },
  "gold-opr-killer": {
    key: "gold-opr-killer", label: "OPR", name: "Gold OPR Killer",
    url: "https://www.mql5.com/en/market/product/177265",
    image: "https://c.mql5.com/31/2030/gold-opr-killer-logo-60x60-7228.png",
    rating: 0, reviews: 0, price: "—",  // delisted from MQL5 market
  },
  "nexorion": {
    key: "nexorion", label: "NEX", name: "Nexorion Initium Novum EA",
    url: "https://www.mql5.com/en/market/product/176296",
    image: "https://c.mql5.com/31/2139/nexorion-initium-novum-ea-logo-200x200-9217.png",
    rating: 5, reviews: 8, price: "699 USD",
  },
  "node-neural": {
    key: "node-neural", label: "NOD", name: "NODE Neural EA MT5",
    url: "https://www.mql5.com/en/market/product/126605",
    image: "https://c.mql5.com/31/1236/node-neural-ea-for-mt5-logo-60x60-9003.png",
    rating: 0, reviews: 0, price: "—",  // delisted from MQL5 market
  },
  "goldfish": {
    key: "goldfish", label: "GFI", name: "GoldFish Scalper",
    url: "https://www.mql5.com/en/market/product/140979",
    image: "https://c.mql5.com/31/1541/goldfish-scalper-logo-200x200-6842.png",
    rating: 1, reviews: 55, price: "38.50 USD",
  },
  "aria-connector": {
    key: "aria-connector", label: "ARI", name: "ARIA Connector EA",
    url: "https://www.mql5.com/en/market/product/140434",
    image: "https://c.mql5.com/31/1919/aria-connector-ea-logo-200x200-6346.png",
    rating: 2.66, reviews: 31, price: "1,400 USD",
  },
};

// ---------------------------------------------------------------------------
// Matchers — ordered SPECIFIC → GENERIC.
// Anchored short tokens (^GW$, ^AX$) MUST come BEFORE broad prefix patterns
// so they don't get swallowed by a partial-match higher up.
// ---------------------------------------------------------------------------
const MATCHERS: BotMatcher[] = [
  // ── Quantum Queen ────────────────────────────────────────────────────────
  // comment: "QQ[XAUUSD]1234[T1/S01]"
  { meta: BOT_REGISTRY["quantum-queen"], patterns: [/^QQ\[/i, /quantum[\s_-]?queen/i] },

  // ── Quantum Emperor ──────────────────────────────────────────────────────
  // comment: "QE[XAUUSD]..." or "Quantum Emperor"
  { meta: BOT_REGISTRY["quantum-emperor"], patterns: [/^QE\[/i, /quantum[\s_-]?emperor/i] },

  // ── Gold House ────────────────────────────────────────────────────────────
  // comment: "Gold House_PendingA" or "#xxx|GH"
  { meta: BOT_REGISTRY["gold-house"], patterns: [/gold[\s_-]?house/i, /^GH$/] },

  // ── Wall Street Robot ────────────────────────────────────────────────────
  // comment: "Wall Street"
  { meta: BOT_REGISTRY["wall-street"], patterns: [/wall[\s_-]?street/i, /^WSR$/i] },

  // ── Full Throttle DMX ────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["full-throttle"], patterns: [/full[\s_-]?throttle/i, /^FTD$/i] },

  // ── Axonshift ────────────────────────────────────────────────────────────
  // comment: "Axonshift-NX Buy" — must come BEFORE bare ^AX$ to avoid collision
  { meta: BOT_REGISTRY["axonshift"], patterns: [/axonshift/i] },

  // ── TwisterPro ───────────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["twisterpro"], patterns: [/twister[\s_-]?pro/i, /^TWI$/i] },

  // ── AnE ──────────────────────────────────────────────────────────────────
  // comment: "AnE" — exact match only to avoid false positives
  { meta: BOT_REGISTRY["ane"], patterns: [/^AnE$/i] },

  // ── BB Return ────────────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["bb-return"], patterns: [/bb[\s_-]?return/i, /^BBR$/i] },

  // ── Aurum AI ─────────────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["aurum-ai"], patterns: [/aurum[\s_-]?ai/i, /^aurum/i] },

  // ── GoldWave  (anchored — after "gold-house" to avoid ^GW$ being ambiguous)
  // comment: "#4067985731|GW" or "GoldWave EA"
  { meta: BOT_REGISTRY["goldwave"], patterns: [/^GW$/, /goldwave/i] },

  // ── AXIO Gold  (anchored — after "axonshift" so full name wins)
  // comment: "#34087419|AX"
  { meta: BOT_REGISTRY["axio-gold"], patterns: [/^AX$/, /axio[\s_-]?gold/i] },

  // ── Chiroptera ───────────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["chiroptera"], patterns: [/chiroptera/i] },

  // ── Gold OPR Killer ──────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["gold-opr-killer"], patterns: [/gold[\s_-]?opr/i, /opr[\s_-]?killer/i] },

  // ── Nexorion ─────────────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["nexorion"], patterns: [/nexorion/i] },

  // ── NODE Neural ──────────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["node-neural"], patterns: [/node[\s_-]?neural/i, /^NOD$/i] },

  // ── GoldFish ─────────────────────────────────────────────────────────────
  // "goldfish" must come AFTER "gold-house" / "gold-opr-killer"
  { meta: BOT_REGISTRY["goldfish"], patterns: [/goldfish/i] },

  // ── ARIA Connector ───────────────────────────────────────────────────────
  { meta: BOT_REGISTRY["aria-connector"], patterns: [/aria[\s_-]?connector/i, /^ARIA$/i] },
];

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------
const HASH_ID_REGEX = /^#\d+\|\s*(.+)$/;
const TP_SL_TAG_REGEX = /^\[(?:tp|sl)\b/i;
const ALNUM_TOKEN_REGEX = /[A-Za-z0-9]+/g;

// ---------------------------------------------------------------------------
// classifyBot — returns BotMeta for known EAs, null for manual/unknown
// ---------------------------------------------------------------------------
export function classifyBot(comment: string | null | undefined): BotMeta | null {
  if (!comment) return null;

  let stripped = comment.trim();
  if (!stripped) return null;

  // Strip hash-id prefix: "#4067985|GW" → "GW"
  const hashMatch = HASH_ID_REGEX.exec(stripped);
  if (hashMatch) stripped = hashMatch[1].trim();
  if (!stripped) return null;

  // Treat MT5 exit-tag comments as manual (not a bot comment)
  if (TP_SL_TAG_REGEX.test(stripped)) return null;

  // First-match wins — order of MATCHERS is significant
  for (const { meta, patterns } of MATCHERS) {
    for (const re of patterns) {
      if (re.test(stripped)) return meta;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// getBotLabel — display label for the X-axis / grouping key
//
// Returns:
//   - BotMeta.label  for registered bots   ("QUE", "GW", …)
//   - "Manual"       for null/empty/exit-tag comments
//   - fallback 3-char token                ("WAL", "AXO", …) for unknown EAs
// ---------------------------------------------------------------------------
export const MANUAL_BOT_LABEL = "Manual";

export function getBotLabel(comment: string | null | undefined): string {
  if (!comment) return MANUAL_BOT_LABEL;

  const meta = classifyBot(comment);
  if (meta) return meta.label;

  // Fallback: same token extraction as before for unrecognised EAs
  let stripped = comment.trim();
  if (!stripped) return MANUAL_BOT_LABEL;

  const hashMatch = HASH_ID_REGEX.exec(stripped);
  if (hashMatch) stripped = hashMatch[1].trim();
  if (!stripped) return MANUAL_BOT_LABEL;

  const tokens = stripped.match(ALNUM_TOKEN_REGEX) ?? [];
  const first = tokens[0] ?? "";
  // Skip leading "gold" token — doesn't distinguish the EA
  const token = first.toLowerCase() === "gold" ? (tokens[1] ?? first) : first;
  if (token) return token.slice(0, 3).toUpperCase();

  return "?";
}
