import { buildApp } from './api.js';
import { createSqliteLinkRepo } from './infrastructure/db.js';
import { setupTelemetry } from './infrastructure/telemetry.js';

// Telemetry is set up before the app is built so that, if OTEL_EXPORTER_OTLP_ENDPOINT
// is configured, the OpenTelemetry SDK is registered before any metric/trace
// instrument is used. If it is absent (or the collector is unreachable),
// setupTelemetry() degrades gracefully and the app runs normally with no export.
const telemetry = setupTelemetry();

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? './data/links.sqlite';
const publicBaseUrl = process.env.PUBLIC_BASE_URL;

const linkRepo = createSqliteLinkRepo(dbPath);
const app = buildApp({ linkRepo, publicBaseUrl });

async function start(): Promise<void> {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(
      `encurtador-sala-de-crise listening on port ${port} (telemetry ${
        telemetry.enabled ? 'enabled' : 'disabled'
      })`
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await telemetry.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

void start();
