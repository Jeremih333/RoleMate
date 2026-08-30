import type { EdgeFastify } from './fastify.js';

export default function helmet(app: EdgeFastify): void {
  app.configureHelmet();
}
