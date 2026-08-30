import type { EdgeFastify } from './fastify.js';

export default function rateLimit(app: EdgeFastify, options: { max?: number }): void {
  app.configureRateLimit(options);
}
