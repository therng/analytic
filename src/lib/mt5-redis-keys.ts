// Canonical Redis key builders for the native bridge (bridge/) contract:
// mt5:account:{login}:<resource> — braces around login are a literal Redis
// Cluster hash tag (see bridge/redis_transport.py's cluster_keys), not a
// template placeholder. Mirror any change here in cluster_keys().

export const MT5_LIVE_KEY_PREFIX = "mt5:account:{";
export const MT5_LIVE_KEY_SUFFIX = "}:live";

export function mt5LiveKey(login: string): string {
  return `${MT5_LIVE_KEY_PREFIX}${login}${MT5_LIVE_KEY_SUFFIX}`;
}

export function mt5HistoryStreamKey(login: string): string {
  return `mt5:account:{${login}}:stream:history`;
}

export function accountNoFromMt5LiveKey(key: string): string | null {
  if (
    !key.startsWith(MT5_LIVE_KEY_PREFIX) ||
    !key.endsWith(MT5_LIVE_KEY_SUFFIX)
  ) {
    return null;
  }

  const accountNo = key
    .slice(MT5_LIVE_KEY_PREFIX.length, -MT5_LIVE_KEY_SUFFIX.length)
    .trim();
  return accountNo ? accountNo : null;
}
