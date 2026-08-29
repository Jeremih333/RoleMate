import { ru } from '@rolemate/shared';

type HeaderValue = string | string[] | undefined;

interface EdgeRequest {
  body: unknown;
  cookies: Record<string, string>;
  headers: Record<string, HeaderValue>;
  id: string;
  ip: string;
  log: EdgeLogger;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  url: string;
}

interface EdgeLogger {
  error(payload: unknown, message?: string): void;
  info(payload: unknown, message?: string): void;
}

interface EdgeReply {
  clearCookie(name: string, options?: { path?: string }): EdgeReply;
  code(status: number): EdgeReply;
  header(name: string, value: string): EdgeReply;
  send(body: unknown): EdgeReply;
  setCookie(
    name: string,
    value: string,
    options?: {
      expires?: Date;
      httpOnly?: boolean;
      path?: string;
      sameSite?: 'strict' | 'lax' | 'none';
      secure?: boolean;
    },
  ): EdgeReply;
}

type RouteHandler = (request: EdgeRequest, reply: EdgeReply) => unknown;
type HookHandler = (request?: EdgeRequest, reply?: EdgeReply) => unknown;
type ErrorHandler = (error: unknown, request: EdgeRequest, reply: EdgeReply) => unknown;
type Plugin = (app: EdgeFastify, options: Record<string, unknown>) => unknown;

interface RouteOptions {
  bodyLimit?: number;
  config?: {
    rateLimit?:
      | false
      | {
          max?: number;
          timeWindow?: string;
        };
  };
}

interface Route {
  bodyLimit?: number;
  handler: RouteHandler;
  rateLimitDisabled?: boolean;
  maxRequests?: number;
  method: string;
  parameterNames: string[];
  pattern: RegExp;
  rateLimitKey: string;
}

interface ReplyState {
  body: unknown;
  headers: Headers;
  sent: boolean;
  status: number;
}

interface RateWindow {
  count: number;
  startedAt: number;
}

const BODY_LIMIT = 256 * 1024;
const DEFAULT_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

function compilePath(path: string): { pattern: RegExp; parameterNames: string[] } {
  const parameterNames: string[] = [];
  const source = path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      parameterNames.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { pattern: new RegExp(`^${source}$`), parameterNames };
}

function parseCookies(value: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!value) return cookies;
  for (const item of value.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const rawValue = item.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

function queryRecord(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else result[key] = [existing, value];
  }
  return result;
}

function requestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    expires?: Date;
    httpOnly?: boolean;
    path?: string;
    sameSite?: 'strict' | 'lax' | 'none';
    secure?: boolean;
  } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite[0]!.toUpperCase()}${options.sameSite.slice(1)}`);
  }
  return parts.join('; ');
}

function responseBody(body: unknown, headers: Headers): BodyInit | null {
  if (body === undefined || body === null) return null;
  if (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof ReadableStream
  ) {
    return body as BodyInit;
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return JSON.stringify(body);
}

export class EdgeFastify {
  readonly server = { listen: (_port: number) => undefined };
  readonly log: EdgeLogger = {
    error: (payload, message) => console.error(message ?? 'edge error', payload),
    info: (payload, message) => console.info(message ?? 'edge info', payload),
  };

  private readonly routes: Route[] = [];
  private readonly preHandlers: HookHandler[] = [];
  private readonly readyHandlers: Array<() => unknown> = [];
  private readonly closeHandlers: Array<() => unknown> = [];
  private readonly rateWindows = new Map<string, RateWindow>();
  private allowedOrigins: string[] = [];
  private corsCredentials = false;
  private corsMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  private errorHandler?: ErrorHandler;
  private useSecurityHeaders = false;
  private defaultRateLimit = DEFAULT_RATE_LIMIT;

  configureCors(options: {
    credentials?: boolean;
    methods?: string[];
    origin?: string | string[];
  }): void {
    this.allowedOrigins =
      typeof options.origin === 'string' ? [options.origin] : (options.origin ?? []);
    this.corsCredentials = options.credentials === true;
    this.corsMethods = options.methods ?? this.corsMethods;
  }

  configureHelmet(): void {
    this.useSecurityHeaders = true;
  }

  configureRateLimit(options: { max?: number }): void {
    this.defaultRateLimit = options.max ?? DEFAULT_RATE_LIMIT;
  }

  async register(plugin: Plugin, options: Record<string, unknown> = {}): Promise<void> {
    await plugin(this, options);
  }

  addHook(name: string, handler: HookHandler): void {
    if (name === 'preHandler') this.preHandlers.push(handler);
    else if (name === 'onReady') this.readyHandlers.push(handler);
    else if (name === 'onClose') this.closeHandlers.push(handler);
  }

  // GET takes route options like every other verb. Without this overload a
  // `get(path, { config }, handler)` call — the shape Fastify accepts and the
  // types allow — passed the options object where the handler belonged, and the
  // route answered every request with a 500.
  get(path: string, options: RouteOptions | RouteHandler, handler?: RouteHandler): void {
    this.addRoute('GET', path, options, handler);
  }

  post(path: string, options: RouteOptions | RouteHandler, handler?: RouteHandler): void {
    this.addRoute('POST', path, options, handler);
  }

  put(path: string, options: RouteOptions | RouteHandler, handler?: RouteHandler): void {
    this.addRoute('PUT', path, options, handler);
  }

  delete(path: string, options: RouteOptions | RouteHandler, handler?: RouteHandler): void {
    this.addRoute('DELETE', path, options, handler);
  }

  setErrorHandler(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  async ready(): Promise<void> {
    for (const handler of this.readyHandlers) await handler();
  }

  async close(): Promise<void> {
    for (const handler of this.closeHandlers) await handler();
  }

  async edgeFetch(input: Request): Promise<Response | undefined> {
    const url = new URL(input.url);
    const match = this.routes
      .filter((route) => route.method === input.method)
      .map((route) => ({ route, match: route.pattern.exec(url.pathname) }))
      .find((candidate) => candidate.match !== null);
    if (!match) {
      if (input.method === 'OPTIONS') return this.preflight(input);
      return undefined;
    }

    const requestId = input.headers.get('x-request-id') || crypto.randomUUID();
    const ip =
      input.headers.get('cf-connecting-ip') ||
      input.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const state: ReplyState = { body: undefined, headers: new Headers(), sent: false, status: 200 };
    const reply = this.createReply(state);
    const request: EdgeRequest = {
      body: undefined,
      cookies: parseCookies(input.headers.get('cookie')),
      headers: requestHeaders(input.headers),
      id: requestId,
      ip,
      log: this.log,
      params: Object.fromEntries(
        match.route.parameterNames.map((name, index) => [
          name,
          decodeURIComponent(match.match![index + 1] ?? ''),
        ]),
      ),
      query: queryRecord(url),
      url: `${url.pathname}${url.search}`,
    };

    try {
      if (
        !match.route.rateLimitDisabled &&
        !this.consumeRateLimit(
          `${ip}:${match.route.rateLimitKey}`,
          match.route.maxRequests ?? this.defaultRateLimit,
        )
      ) {
        state.status = 429;
        state.body = {
          statusCode: 429,
          error: 'RATE_LIMITED',
          message: ru.api.rateLimit,
        };
        state.sent = true;
      }
      if (!state.sent) request.body = await this.readBody(input, match.route.bodyLimit);
      for (const hook of this.preHandlers) {
        if (state.sent) break;
        await hook(request, reply);
      }
      if (!state.sent) {
        const result = await match.route.handler(request, reply);
        if (!state.sent) state.body = result;
      }
    } catch (error) {
      if (!this.errorHandler) throw error;
      state.sent = false;
      const result = await this.errorHandler(error, request, reply);
      if (!state.sent) state.body = result;
    }

    state.headers.set('x-request-id', requestId);
    this.applySharedHeaders(input, state.headers);
    return new Response(responseBody(state.body, state.headers), {
      status: state.status,
      headers: state.headers,
    });
  }

  private addRoute(
    method: string,
    path: string,
    options: RouteOptions | RouteHandler,
    handler?: RouteHandler,
  ): void {
    const actualHandler = typeof options === 'function' ? options : handler;
    if (!actualHandler) throw new Error(`Missing handler for ${method} ${path}`);
    const compiled = compilePath(path);
    const routeRateLimit = typeof options === 'function' ? undefined : options.config?.rateLimit;
    const maxRequests =
      routeRateLimit && typeof routeRateLimit === 'object' ? routeRateLimit.max : undefined;
    const bodyLimit = typeof options === 'function' ? undefined : options.bodyLimit;
    this.routes.push({
      method,
      handler: actualHandler,
      rateLimitKey: `${method}:${path}`,
      ...(routeRateLimit === false ? { rateLimitDisabled: true } : {}),
      ...(maxRequests === undefined ? {} : { maxRequests }),
      ...(bodyLimit === undefined ? {} : { bodyLimit }),
      ...compiled,
    });
  }

  private createReply(state: ReplyState): EdgeReply {
    const reply: EdgeReply = {
      clearCookie: (name, options = {}) => {
        state.headers.append(
          'set-cookie',
          serializeCookie(name, '', {
            ...(options.path ? { path: options.path } : {}),
            expires: new Date(0),
          }),
        );
        return reply;
      },
      code: (status) => {
        state.status = status;
        return reply;
      },
      header: (name, value) => {
        state.headers.set(name, value);
        return reply;
      },
      send: (body) => {
        state.body = body;
        state.sent = true;
        return reply;
      },
      setCookie: (name, value, options = {}) => {
        state.headers.append('set-cookie', serializeCookie(name, value, options));
        return reply;
      },
    };
    return reply;
  }

  private async readBody(input: Request, routeBodyLimit?: number): Promise<unknown> {
    if (input.method === 'GET' || input.method === 'HEAD') return undefined;
    const bodyLimit = routeBodyLimit ?? BODY_LIMIT;
    const contentLength = Number(input.headers.get('content-length') ?? '0');
    if (contentLength > bodyLimit) throw new Error('BODY_TOO_LARGE');
    const text = await input.text();
    if (new TextEncoder().encode(text).byteLength > bodyLimit) throw new Error('BODY_TOO_LARGE');
    if (!text) return undefined;
    if (input.headers.get('content-type')?.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('INVALID_JSON');
      }
    }
    return text;
  }

  private consumeRateLimit(ip: string, max: number): boolean {
    const now = Date.now();
    const existing = this.rateWindows.get(ip);
    if (!existing || now - existing.startedAt >= RATE_WINDOW_MS) {
      this.rateWindows.set(ip, { count: 1, startedAt: now });
      return true;
    }
    existing.count += 1;
    if (this.rateWindows.size > 5_000) {
      for (const [key, value] of this.rateWindows) {
        if (now - value.startedAt >= RATE_WINDOW_MS) this.rateWindows.delete(key);
      }
    }
    return existing.count <= max;
  }

  private preflight(input: Request): Response {
    const headers = new Headers();
    this.applySharedHeaders(input, headers);
    headers.set('access-control-allow-headers', 'content-type,x-csrf-token,x-request-id');
    headers.set('access-control-allow-methods', this.corsMethods.join(','));
    return new Response(null, { status: 204, headers });
  }

  private applySharedHeaders(input: Request, headers: Headers): void {
    const origin = input.headers.get('origin');
    if (origin && this.allowedOrigins.includes(origin)) {
      headers.set('access-control-allow-origin', origin);
      headers.append('vary', 'Origin');
      if (this.corsCredentials) headers.set('access-control-allow-credentials', 'true');
    }
    if (!this.useSecurityHeaders) return;
    headers.set(
      'content-security-policy',
      [
        "default-src 'self'",
        "script-src 'self' https://telegram.org https://challenges.cloudflare.com",
        "frame-src 'self' https://challenges.cloudflare.com https://t.me",
        "connect-src 'self' https://telegram.org https://challenges.cloudflare.com",
        "img-src 'self' data: blob: https:",
        "style-src 'self' 'unsafe-inline'",
      ].join('; '),
    );
    headers.set('referrer-policy', 'no-referrer');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('x-frame-options', 'SAMEORIGIN');
  }
}

export default function Fastify(): EdgeFastify {
  return new EdgeFastify();
}
