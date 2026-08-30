import type { EdgeFastify } from './fastify.js';

export default function cors(
  app: EdgeFastify,
  options: { credentials?: boolean; methods?: string[]; origin?: string | string[] },
): void {
  app.configureCors(options);
}
