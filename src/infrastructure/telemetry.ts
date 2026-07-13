import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const METER_NAME = 'encurtador-sala-de-crise';
const DEFAULT_SERVICE_NAME = 'encurtador-sala-de-crise';

export interface TelemetryOptions {
  /** OTLP/HTTP base endpoint, e.g. http://localhost:4318. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT. */
  endpoint?: string;
  /** Service name reported on traces/metrics. Defaults to OTEL_SERVICE_NAME or a fixed fallback. */
  serviceName?: string;
}

export interface TelemetryHandle {
  /** True if a real OpenTelemetry SDK was started and is exporting to a collector. */
  enabled: boolean;
  shutdown: () => Promise<void>;
}

const NOOP_TELEMETRY: TelemetryHandle = {
  enabled: false,
  shutdown: async () => {}
};

/** An endpoint only counts as configured if it is present and not just whitespace. */
export function isTelemetryEnabled(endpoint: string | undefined): boolean {
  return Boolean(endpoint && endpoint.trim().length > 0);
}

/**
 * Starts the OpenTelemetry SDK (traces + metrics over OTLP/HTTP) when an
 * endpoint is configured. If it is absent, or if starting the SDK fails for
 * any reason (e.g. the collector is unreachable), this degrades gracefully:
 * the app keeps running and metric/trace calls elsewhere become no-ops,
 * because @opentelemetry/api falls back to its built-in no-op providers
 * whenever no real SDK has been registered.
 */
export function setupTelemetry(options: TelemetryOptions = {}): TelemetryHandle {
  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const serviceName = options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE_NAME;

  if (!isTelemetryEnabled(endpoint)) {
    return NOOP_TELEMETRY;
  }

  try {
    const trimmedEndpoint = (endpoint as string).trim().replace(/\/+$/, '');
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
      traceExporter: new OTLPTraceExporter({ url: `${trimmedEndpoint}/v1/traces` }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${trimmedEndpoint}/v1/metrics` })
      })
    });
    sdk.start();
    return {
      enabled: true,
      shutdown: () => sdk.shutdown()
    };
  } catch (err) {
    console.error('[telemetry] failed to start OpenTelemetry SDK, continuing without export:', err);
    return NOOP_TELEMETRY;
  }
}

// Instruments are created eagerly against the OpenTelemetry API's global
// meter provider. Before setupTelemetry() registers a real provider, the API
// package transparently returns a no-op meter, so these calls are always
// safe to make (see the "metric recorders never throw" test).
const meter = metrics.getMeter(METER_NAME);

export const redirectsTotal = meter.createCounter('shortener_redirects_total', {
  description: 'Total number of redirects served, per short code'
});

export const requestsTotal = meter.createCounter('shortener_requests_total', {
  description: 'Total number of HTTP requests, per route and status code'
});

export const requestDurationSeconds = meter.createHistogram('shortener_request_duration_seconds', {
  description: 'HTTP request duration in seconds',
  unit: 's'
});

export const errorsTotal = meter.createCounter('shortener_errors_total', {
  description: 'Total number of errors triggered by an active chaos scenario'
});

export function recordRequest(attributes: { route: string; status: number; durationSeconds: number }): void {
  requestsTotal.add(1, { route: attributes.route, status: String(attributes.status) });
  requestDurationSeconds.record(attributes.durationSeconds, { route: attributes.route });
}

export function recordRedirect(code: string): void {
  redirectsTotal.add(1, { code });
}

export function recordError(scenario: string): void {
  errorsTotal.add(1, { scenario });
}
