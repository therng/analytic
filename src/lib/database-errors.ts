function safeParseDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const databaseName = parsed.pathname.replace(/^\//, "");
    const host = parsed.hostname || "unknown-host";
    const port = parsed.port || "default-port";
    return databaseName ? `${host}:${port}/${databaseName}` : `${host}:${port}`;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

function buildDatabaseTargetHint(databaseTarget: string | null) {
  if (!databaseTarget) {
    return " Start Postgres and verify DATABASE_URL.";
  }

  return ` Start Postgres and verify DATABASE_URL points to ${databaseTarget}.`;
}

export function getDatabaseErrorDetails(
  error: unknown,
  fallbackMessage: string,
) {
  const message = getErrorMessage(error);
  const databaseTarget = safeParseDatabaseUrl(process.env.DATABASE_URL);

  if (message.includes("Environment variable not found: DATABASE_URL")) {
    return {
      status: 503,
      message: "Database is not configured. Set DATABASE_URL and try again.",
    };
  }

  if (message.includes("Can't reach database server")) {
    return {
      status: 503,
      message: `Database is unavailable.${buildDatabaseTargetHint(databaseTarget)}`,
    };
  }

  if (message.includes("Authentication failed against database server")) {
    const suffix = databaseTarget ? ` for ${databaseTarget}` : "";
    return {
      status: 503,
      message: `Database credentials were rejected${suffix}. Check DATABASE_URL and try again.`,
    };
  }

  return {
    status: 500,
    message: fallbackMessage,
  };
}

export function isDatabaseUnavailableError(error: unknown) {
  return getDatabaseErrorDetails(error, "").status === 503;
}
