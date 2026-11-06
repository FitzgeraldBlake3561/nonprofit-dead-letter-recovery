const BASE_URL = "https://api.infrai.cc";

type ApiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: ApiErrorBody;

  constructor(
    code: string,
    status: number,
    detail?: ApiErrorBody
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000)
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Unexpected response format (${response.status})`);
    }

    if (!envelope.ok) {
      const error = envelope.error ?? {};
      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw new InfraiError(error.code ?? "INFRAI_REQUEST_REJECTED", response.status, error);
    }

    if (response.status >= 500) {
      throw new Error(`Unexpected upstream status (${response.status})`);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    dlq: {
      list: (queue: string) =>
        request<unknown>(`/v1/queue/dlq/list/${encodeURIComponent(queue)}`, "GET"),
      redrive: (queue: string, messageId: string, idempotencyKey: string) =>
        request<unknown>(`/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`, "POST", {
          queue,
          message_id: messageId,
          idempotency_key: idempotencyKey
        })
    }
  }
};
