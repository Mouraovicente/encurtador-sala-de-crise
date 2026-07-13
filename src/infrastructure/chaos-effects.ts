import type { ChaosRegistry } from '../domain/chaos.js';

const DEFAULT_POOL_SIZE = 10;
const DEFAULT_ERROR_BURST_PROBABILITY = 0.3;
const DEFAULT_LATENCY_RANGE_MS: [number, number] = [800, 2000];
const DEFAULT_MEMORY_CHUNK_BYTES = 1024 * 1024; // 1MB

export type SleepFn = (ms: number) => Promise<void>;
export type RandomFn = () => number;

export interface ChaosEffectsOptions {
  /** Size of the fake connection pool used by the 'connection-leak' scenario. */
  poolSize?: number;
  /** Probability (0..1) that a request fails with 500 while 'error-burst' is active. Injectable for deterministic tests. */
  errorBurstProbability?: number;
  /** [min, max] delay in ms applied while 'latency-spike' is active. */
  latencyRangeMs?: [number, number];
  /** Bytes leaked per request while 'memory-leak' is active. */
  memoryChunkBytes?: number;
  /** Injectable RNG returning a float in [0, 1). Defaults to Math.random. */
  random?: RandomFn;
  /** Injectable sleep function so tests never really wait. Defaults to a real setTimeout-based sleep. */
  sleep?: SleepFn;
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Holds the mutable, observable side effects of each chaos scenario:
 * a fake connection pool, a leaking memory buffer, latency delay and
 * a probabilistic error burst. All effects are gated by the ChaosRegistry
 * and reset together via reset() (mirrors DELETE /chaos).
 */
export class ChaosEffects {
  private readonly poolSize: number;
  private readonly errorBurstProbability: number;
  private readonly latencyRangeMs: [number, number];
  private readonly memoryChunkBytes: number;
  private readonly random: RandomFn;
  private readonly sleep: SleepFn;

  private leakedConnections = 0;
  private leakedChunks = 0;

  constructor(
    private readonly registry: ChaosRegistry,
    options: ChaosEffectsOptions = {}
  ) {
    this.poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
    this.errorBurstProbability = options.errorBurstProbability ?? DEFAULT_ERROR_BURST_PROBABILITY;
    this.latencyRangeMs = options.latencyRangeMs ?? DEFAULT_LATENCY_RANGE_MS;
    this.memoryChunkBytes = options.memoryChunkBytes ?? DEFAULT_MEMORY_CHUNK_BYTES;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Simulates checking out a connection from the fake pool. Only leaks
   * (decrements availability) while 'connection-leak' is active; returns
   * false once the pool is exhausted so the caller can respond with 503.
   */
  tryAcquireConnection(): boolean {
    if (!this.registry.isActive('connection-leak')) {
      return true;
    }
    if (this.leakedConnections >= this.poolSize) {
      return false;
    }
    this.leakedConnections += 1;
    return true;
  }

  /** Grows the shared leaked buffer by memoryChunkBytes, but only while 'memory-leak' is active. */
  leakMemory(): void {
    if (!this.registry.isActive('memory-leak')) {
      return;
    }
    this.leakedChunks += 1;
  }

  get memoryUsageBytes(): number {
    return this.leakedChunks * this.memoryChunkBytes;
  }

  /** Sleeps for a random delay in latencyRangeMs, but only while 'latency-spike' is active. */
  async applyLatency(): Promise<void> {
    if (!this.registry.isActive('latency-spike')) {
      return;
    }
    const [min, max] = this.latencyRangeMs;
    const delay = min + this.random() * (max - min);
    await this.sleep(delay);
  }

  /** Returns true (caller should respond 500) with errorBurstProbability chance, only while 'error-burst' is active. */
  shouldTriggerErrorBurst(): boolean {
    if (!this.registry.isActive('error-burst')) {
      return false;
    }
    return this.random() < this.errorBurstProbability;
  }

  /** Releases the fake connection pool and the leaked memory buffer. Mirrors DELETE /chaos. */
  reset(): void {
    this.leakedConnections = 0;
    this.leakedChunks = 0;
  }
}
