import { randomBytes } from 'node:crypto';
import type { WorkerInput, WorkerOperation, WorkerResponse } from '@rolemate/database-contracts';
import { signInternalRequest } from '@rolemate/shared';

export class DataApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function findDataApiError(error: unknown): DataApiError | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    if (current instanceof DataApiError) return current;
    seen.add(current);
    if (typeof current !== 'object') return undefined;
    if ('error' in current) {
      current = current.error;
      continue;
    }
    if ('cause' in current) {
      current = current.cause;
      continue;
    }
    return undefined;
  }
  return undefined;
}

export interface DataApiClientOptions {
  baseUrl: string;
  serviceId: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

export class DataApiClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly options: DataApiClientOptions) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async execute<T = unknown, O extends WorkerOperation = WorkerOperation>(
    operation: O,
    input: WorkerInput<O>,
  ): Promise<T> {
    if (!this.options.baseUrl)
      throw new DataApiError('DATA_API_UNCONFIGURED', 'Data API is not configured', 503);
    const path = '/v1/execute';
    const body = JSON.stringify({ operation, input });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const nonce = randomBytes(18).toString('base64url');
    const signature = await signInternalRequest({
      method: 'POST',
      path,
      timestamp,
      nonce,
      body,
      secret: this.options.secret,
    });
    const response = await this.#fetch(new URL(path, this.options.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Id': this.options.serviceId,
        'X-Request-Timestamp': timestamp,
        'X-Request-Nonce': nonce,
        'X-Request-Signature': signature,
        'X-Request-Id': crypto.randomUUID(),
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    const rawPayload: unknown = await response.json();
    const payload = rawPayload as WorkerResponse<T>;
    if (!response.ok || !payload.ok) {
      const error = payload.ok
        ? { code: 'DATA_API_ERROR', message: 'Data API request failed' }
        : payload.error;
      throw new DataApiError(error.code, error.message, response.status);
    }
    return payload.data;
  }

  async health(): Promise<boolean> {
    if (!this.options.baseUrl) return false;
    try {
      const response = await this.#fetch(new URL('/health/ready', this.options.baseUrl), {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
