/**
 * Domain registry of chaos scenarios used by the "sala de crise" exercise.
 * Pure module: only in-memory state, no I/O.
 */

export const CHAOS_SCENARIOS = [
  'latency-spike',
  'error-burst',
  'connection-leak',
  'memory-leak'
] as const;

export type ChaosScenario = (typeof CHAOS_SCENARIOS)[number];

export function isChaosScenario(value: string): value is ChaosScenario {
  return (CHAOS_SCENARIOS as readonly string[]).includes(value);
}

export class ChaosRegistry {
  private readonly active = new Set<ChaosScenario>();

  enable(scenario: ChaosScenario): void {
    this.active.add(scenario);
  }

  disable(scenario: ChaosScenario): void {
    this.active.delete(scenario);
  }

  reset(): void {
    this.active.clear();
  }

  isActive(scenario: ChaosScenario): boolean {
    return this.active.has(scenario);
  }

  activeScenarios(): ChaosScenario[] {
    return Array.from(this.active);
  }
}
