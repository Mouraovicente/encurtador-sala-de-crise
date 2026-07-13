import { describe, expect, it } from 'vitest';
import { ChaosRegistry } from '../../src/domain/chaos.js';
import { ChaosEffects } from '../../src/infrastructure/chaos-effects.js';

describe('ChaosEffects connection pool', () => {
  it('acquires successfully while under the pool size', () => {
    const registry = new ChaosRegistry();
    registry.enable('connection-leak');
    const effects = new ChaosEffects(registry, { poolSize: 2 });
    expect(effects.tryAcquireConnection()).toBe(true);
    expect(effects.tryAcquireConnection()).toBe(true);
  });

  it('exhausts after poolSize acquisitions', () => {
    const registry = new ChaosRegistry();
    registry.enable('connection-leak');
    const effects = new ChaosEffects(registry, { poolSize: 2 });
    expect(effects.tryAcquireConnection()).toBe(true);
    expect(effects.tryAcquireConnection()).toBe(true);
    expect(effects.tryAcquireConnection()).toBe(false);
  });

  it('reset() frees all leaked connections', () => {
    const registry = new ChaosRegistry();
    registry.enable('connection-leak');
    const effects = new ChaosEffects(registry, { poolSize: 1 });
    expect(effects.tryAcquireConnection()).toBe(true);
    expect(effects.tryAcquireConnection()).toBe(false);
    effects.reset();
    expect(effects.tryAcquireConnection()).toBe(true);
  });
});

describe('ChaosEffects memory leak buffer', () => {
  it('grows by memoryChunkBytes per leak() call while the scenario is active', () => {
    const registry = new ChaosRegistry();
    registry.enable('memory-leak');
    const effects = new ChaosEffects(registry, { memoryChunkBytes: 1024 * 1024 });
    expect(effects.memoryUsageBytes).toBe(0);
    effects.leakMemory();
    expect(effects.memoryUsageBytes).toBe(1024 * 1024);
    effects.leakMemory();
    expect(effects.memoryUsageBytes).toBe(2 * 1024 * 1024);
  });

  it('does nothing when memory-leak is not active', () => {
    const registry = new ChaosRegistry();
    const effects = new ChaosEffects(registry, { memoryChunkBytes: 1024 });
    effects.leakMemory();
    expect(effects.memoryUsageBytes).toBe(0);
  });

  it('reset() releases the leaked buffer', () => {
    const registry = new ChaosRegistry();
    registry.enable('memory-leak');
    const effects = new ChaosEffects(registry, { memoryChunkBytes: 1024 });
    effects.leakMemory();
    effects.reset();
    expect(effects.memoryUsageBytes).toBe(0);
  });
});

describe('ChaosEffects latency spike', () => {
  it('sleeps for a duration within the configured range using injected random + sleep', async () => {
    const registry = new ChaosRegistry();
    registry.enable('latency-spike');
    const recordedDelays: number[] = [];
    const effects = new ChaosEffects(registry, {
      latencyRangeMs: [800, 2000],
      random: () => 0.5,
      sleep: async (ms: number) => {
        recordedDelays.push(ms);
      }
    });
    await effects.applyLatency();
    expect(recordedDelays).toHaveLength(1);
    expect(recordedDelays[0]).toBeGreaterThanOrEqual(800);
    expect(recordedDelays[0]).toBeLessThanOrEqual(2000);
  });

  it('does nothing when latency-spike is not active', async () => {
    const registry = new ChaosRegistry();
    const recordedDelays: number[] = [];
    const effects = new ChaosEffects(registry, {
      sleep: async (ms: number) => {
        recordedDelays.push(ms);
      }
    });
    await effects.applyLatency();
    expect(recordedDelays).toHaveLength(0);
  });
});

describe('ChaosEffects error burst', () => {
  it('never triggers when the scenario is inactive', () => {
    const registry = new ChaosRegistry();
    const effects = new ChaosEffects(registry, { errorBurstProbability: 1, random: () => 0 });
    expect(effects.shouldTriggerErrorBurst()).toBe(false);
  });

  it('always triggers when probability is forced to 1', () => {
    const registry = new ChaosRegistry();
    registry.enable('error-burst');
    const effects = new ChaosEffects(registry, { errorBurstProbability: 1, random: () => 0.999 });
    expect(effects.shouldTriggerErrorBurst()).toBe(true);
  });

  it('never triggers when probability is forced to 0', () => {
    const registry = new ChaosRegistry();
    registry.enable('error-burst');
    const effects = new ChaosEffects(registry, { errorBurstProbability: 0, random: () => 0 });
    expect(effects.shouldTriggerErrorBurst()).toBe(false);
  });
});
