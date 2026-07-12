import { loadEnvConfig } from "@next/env";

let didLoadEnv = false;

export function loadServerEnv(cwd = process.cwd(), force = false) {
  if (didLoadEnv && !force) {
    return;
  }

  loadEnvConfig(cwd);
  didLoadEnv = true;
}
