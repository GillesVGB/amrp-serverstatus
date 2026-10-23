const QUOTA_COOLDOWN_SECONDS = 300;
const TRANSIENT_COOLDOWN_SECONDS = 30;

let unavailableUntil = 0;
let unavailableBecauseOfQuota = false;

export class DatabaseUnavailableError extends Error {
  readonly retryAfterSeconds: number;
  readonly quotaExceeded: boolean;

  constructor(retryAfterSeconds: number, quotaExceeded: boolean) {
    super("De statusgegevens zijn tijdelijk niet beschikbaar.");
    this.name = "DatabaseUnavailableError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.quotaExceeded = quotaExceeded;
  }
}

function quotaError(error: unknown) {
  let current = error;
  const quotaMessage = /exceeded\s+(?:the\s+)?quota|quota[\s_-]*exceeded|\bHTTP(?:\s+status)?(?:\s+code)?\s*[:=]?\s*402\b/i;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current === "string") return quotaMessage.test(current);
    if (!current || typeof current !== "object") return false;
    const detail = current as Record<string, unknown>;
    if ([detail.status, detail.statusCode, detail.httpStatus].some((status) => status === 402 || status === "402")) return true;
    if (detail.response && typeof detail.response === "object" && "status" in detail.response && (detail.response.status === 402 || detail.response.status === "402")) return true;
    if (typeof detail.message === "string" && quotaMessage.test(detail.message)) return true;
    current = detail.cause;
  }
  return false;
}

function currentUnavailableError() {
  return new DatabaseUnavailableError(Math.max(1, Math.ceil((unavailableUntil - Date.now()) / 1000)), unavailableBecauseOfQuota);
}

export function assertDatabaseAvailable() {
  if (Date.now() < unavailableUntil) throw currentUnavailableError();
}

export function markDatabaseUnavailable(error: unknown): DatabaseUnavailableError {
  if (error instanceof DatabaseUnavailableError) return error;
  const now = Date.now();
  const quotaExceeded = quotaError(error);
  if (now >= unavailableUntil || (quotaExceeded && !unavailableBecauseOfQuota)) {
    unavailableBecauseOfQuota = quotaExceeded;
    unavailableUntil = now + (quotaExceeded ? QUOTA_COOLDOWN_SECONDS : TRANSIENT_COOLDOWN_SECONDS) * 1000;
  }
  return currentUnavailableError();
}

export function clearDatabaseUnavailable() {
  unavailableUntil = 0;
  unavailableBecauseOfQuota = false;
}
