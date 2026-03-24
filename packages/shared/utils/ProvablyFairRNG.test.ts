import { describe, it, expect } from "bun:test";
import { ProvablyFairRNG } from "./ProvablyFairRNG";

describe("ProvablyFairRNG", () => {
  const serverSeed = "test_server_seed";
  const clientSeed = "test_client_seed";

  it("should generate deterministic float values", () => {
    const rng1 = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    const float1 = rng1.nextFloat();
    const float2 = rng1.nextFloat();

    const rng2 = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    expect(rng2.nextFloat()).toBe(float1);
    expect(rng2.nextFloat()).toBe(float2);
  });

  it("should match the static verify float value", () => {
    const float1 = ProvablyFairRNG.verify(serverSeed, clientSeed, 0);
    const rng = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    expect(rng.nextFloat()).toBe(float1);
  });

  it("should generate deterministic int values within requested range", () => {
    const rng1 = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    const min = 1;
    const max = 10;
    const int1 = rng1.nextInt(min, max);
    const int2 = rng1.nextInt(min, max);

    expect(int1).toBeGreaterThanOrEqual(min);
    expect(int1).toBeLessThanOrEqual(max);
    expect(int2).toBeGreaterThanOrEqual(min);
    expect(int2).toBeLessThanOrEqual(max);

    const rng2 = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    expect(rng2.nextInt(min, max)).toBe(int1);
    expect(rng2.nextInt(min, max)).toBe(int2);
  });

  it("should generate uniformly distributed integers (anti-modulo bias)", () => {
    const rng = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      const v = rng.nextInt(1, 5);
      counts[v]++;
    }

    const expected = iterations / 5;
    const tolerance = expected * 0.15; // 15% tolerance due to sample size

    for (let i = 1; i <= 5; i++) {
      expect(Math.abs(counts[i] - expected)).toBeLessThan(tolerance);
    }
  });

  it("should generate deterministic sequence", () => {
    const rng1 = new ProvablyFairRNG("server", "client", 0);
    const rng2 = new ProvablyFairRNG("server", "client", 0);

    for (let i = 0; i < 100; i++) {
      expect(rng1.nextFloat()).toBe(rng2.nextFloat());
    }
  });

  it("increments nonce correctly", () => {
    const rng = new ProvablyFairRNG(serverSeed, clientSeed, 0);
    expect(rng.getNonce()).toBe(0);
    rng.nextFloat();
    expect(rng.getNonce()).toBe(1);
    rng.nextInt(1, 10);
    expect(rng.getNonce()).toBe(2);
  });
});
