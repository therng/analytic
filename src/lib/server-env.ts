import { loadEnvConfig } from "@next/env";

let didLoadEnv = false;

export function loadServerEnv(cwd = process.cwd(), force = false) {
  if (didLoadEnv && !force) {
    return;
  }

  loadEnvConfig(cwd);
  didLoadEnv = true;
}

export function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is not configured. Copy .env.example to .env or export ${name} before running this process.`,
    );
  }

  return value;
}
