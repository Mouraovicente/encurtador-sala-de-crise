import { metrics } from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startMock = vi.fn();
const shutdownMock = vi.fn().mockResolvedValue(undefined);
const nodeSdkCtor = vi.fn().mockImplementation(function FakeNodeSDK(this: { start: typeof startMock; shutdown: typeof shutdownMock }) {
  this.start = startMock;
  this.shutdown = shutdownMock;
});

// The real NodeSDK talks to the network on start()/shutdown(); we mock it so
// this suite never depends on a collector being up, per the project's
// offline-testing requirement.
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: nodeSdkCtor
}));

const { isTelemetryEnabled, setupTelemetry, recordError, recordRedirect, recordRequest, getProcessMemoryGauge } =
  await import('../../src/infrastructure/telemetry.js');

describe('isTelemetryEnabled', () => {
  it('is false when the endpoint is missing, empty or blank', () => {
    expect(isTelemetryEnabled(undefined)).toBe(false);
    expect(isTelemetryEnabled('')).toBe(false);
    expect(isTelemetryEnabled('   ')).toBe(false);
  });

  it('is true for a non-empty endpoint', () => {
    expect(isTelemetryEnabled('http://localhost:4318')).toBe(true);
  });
});

describe('setupTelemetry', () => {
  beforeEach(() => {
    startMock.mockClear();
    shutdownMock.mockClear();
    nodeSdkCtor.mockClear();
  });

  it('stays disabled and never constructs an SDK when the endpoint is absent (zero crash)', async () => {
    const telemetry = setupTelemetry({ endpoint: undefined });
    expect(telemetry.enabled).toBe(false);
    expect(nodeSdkCtor).not.toHaveBeenCalled();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('starts the SDK when the endpoint is present', async () => {
    const telemetry = setupTelemetry({ endpoint: 'http://localhost:4318', serviceName: 'test-service' });
    expect(telemetry.enabled).toBe(true);
    expect(nodeSdkCtor).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
    await telemetry.shutdown();
    expect(shutdownMock).toHaveBeenCalledTimes(1);
  });

  it('degrades gracefully to disabled if constructing the SDK throws', async () => {
    nodeSdkCtor.mockImplementationOnce(() => {
      throw new Error('boom: collector unreachable');
    });
    const telemetry = setupTelemetry({ endpoint: 'http://localhost:4318' });
    expect(telemetry.enabled).toBe(false);
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('creates metric instruments only after the SDK has started, so they bind to the real provider', () => {
    // @opentelemetry/api's metrics.getMeter() has no delegation/proxy: a
    // meter/instrument obtained before the real MeterProvider is registered
    // stays a no-op forever. Instruments must therefore be (re)created after
    // sdk.start(), never eagerly at module load time.
    const getMeterSpy = vi.spyOn(metrics, 'getMeter');
    setupTelemetry({ endpoint: 'http://localhost:4318' });
    const startOrder = startMock.mock.invocationCallOrder[0] as number;
    const getMeterOrders = getMeterSpy.mock.invocationCallOrder;
    expect(getMeterOrders.some((order) => order > startOrder)).toBe(true);
    getMeterSpy.mockRestore();
  });
});

describe('metric recorders', () => {
  it('never throw, whether or not a real SDK is running', () => {
    expect(() => recordRequest({ route: '/health', status: 200, durationSeconds: 0.01 })).not.toThrow();
    expect(() => recordRedirect('ABCDEF')).not.toThrow();
    expect(() => recordError('error-burst')).not.toThrow();
  });
});

describe('getProcessMemoryGauge', () => {
  it('returns the registered observable gauge instrument', () => {
    expect(getProcessMemoryGauge()).toBeDefined();
  });
});
