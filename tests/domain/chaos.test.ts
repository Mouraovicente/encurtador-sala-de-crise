import { describe, expect, it } from 'vitest';
import { CHAOS_SCENARIOS, ChaosRegistry, isChaosScenario } from '../../src/domain/chaos.js';

describe('ChaosRegistry', () => {
  it('starts with no active scenarios', () => {
    const registry = new ChaosRegistry();
    for (const scenario of CHAOS_SCENARIOS) {
      expect(registry.isActive(scenario)).toBe(false);
    }
    expect(registry.activeScenarios()).toEqual([]);
  });

  it('enables a scenario', () => {
    const registry = new ChaosRegistry();
    registry.enable('latency-spike');
    expect(registry.isActive('latency-spike')).toBe(true);
    expect(registry.isActive('error-burst')).toBe(false);
  });

  it('disables a specific scenario', () => {
    const registry = new ChaosRegistry();
    registry.enable('latency-spike');
    registry.enable('error-burst');
    registry.disable('latency-spike');
    expect(registry.isActive('latency-spike')).toBe(false);
    expect(registry.isActive('error-burst')).toBe(true);
  });

  it('resets all scenarios at once', () => {
    const registry = new ChaosRegistry();
    registry.enable('latency-spike');
    registry.enable('connection-leak');
    registry.enable('memory-leak');
    registry.reset();
    expect(registry.activeScenarios()).toEqual([]);
  });

  it('lists every active scenario', () => {
    const registry = new ChaosRegistry();
    registry.enable('error-burst');
    registry.enable('memory-leak');
    expect(registry.activeScenarios().sort()).toEqual(['error-burst', 'memory-leak']);
  });

  it('enabling twice is idempotent', () => {
    const registry = new ChaosRegistry();
    registry.enable('latency-spike');
    registry.enable('latency-spike');
    expect(registry.activeScenarios()).toEqual(['latency-spike']);
  });
});

describe('isChaosScenario', () => {
  it('accepts the four known scenarios', () => {
    expect(isChaosScenario('latency-spike')).toBe(true);
    expect(isChaosScenario('error-burst')).toBe(true);
    expect(isChaosScenario('connection-leak')).toBe(true);
    expect(isChaosScenario('memory-leak')).toBe(true);
  });

  it('rejects unknown scenario names', () => {
    expect(isChaosScenario('cpu-spike')).toBe(false);
    expect(isChaosScenario('')).toBe(false);
  });
});
