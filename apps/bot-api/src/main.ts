import 'dotenv/config';
import { buildServer } from './server.js';
import { readEnv } from './env.js';

const env = readEnv();
const app = await buildServer(env);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'graceful shutdown started');
  await app.close();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.fatal(error);
  process.exit(1);
}
