import { describe, it, expect } from "bun:test";
import { MersenneTwisterRNG } from "./MersenneTwisterRNG";

describe("MersenneTwisterRNG", () => {
  it("should generate deterministic float values with the same seed", () => {
    const seed = 12345;
    const rng1 = new MersenneTwisterRNG(seed);
    const rng2 = new MersenneTwisterRNG(seed);

    for (let i = 0; i < 100; i++) {
      expect(rng1.nextFloat()).toBe(rng2.nextFloat());
    }
  });

  it("should generate deterministic int values with the same seed", () => {
    const seed = 54321;
    const rng1 = new MersenneTwisterRNG(seed);
    const rng2 = new MersenneTwisterRNG(seed);

    for (let i = 0; i < 100; i++) {
      expect(rng1.nextInt(0, 100)).toBe(rng2.nextInt(0, 100));
    }
  });

  it("should generate different sequences with different seeds", () => {
    const rng1 = new MersenneTwisterRNG(111);
    const rng2 = new MersenneTwisterRNG(222);

    let identical = true;
    for (let i = 0; i < 10; i++) {
      if (rng1.nextFloat() !== rng2.nextFloat()) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(false);
  });

  it("nextFloat should return values in range [0, 1)", () => {
    const rng = new MersenneTwisterRNG();
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextFloat();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it("nextInt should return values in range [min, max]", () => {
    const rng = new MersenneTwisterRNG();
    const min = 5;
    const max = 15;
    for (let i = 0; i < 1000; i++) {
      const val = rng.nextInt(min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it("nextInt should handle min > max by returning min", () => {
    const rng = new MersenneTwisterRNG();
    expect(rng.nextInt(10, 5)).toBe(10);
  });

  it("nextInt should handle min === max", () => {
    const rng = new MersenneTwisterRNG();
    expect(rng.nextInt(10, 10)).toBe(10);
  });

  it("nextInt should have uniform distribution (anti-modulo bias test)", () => {
    const rng = new MersenneTwisterRNG(42);
    const min = 0;
    const max = 4;
    const iterations = 100000;
    const counts = [0, 0, 0, 0, 0];

    for (let i = 0; i < iterations; i++) {
      counts[rng.nextInt(min, max)]++;
    }

    const expected = iterations / 5;
    const tolerance = expected * 0.05; // 5% tolerance

    for (let i = 0; i < counts.length; i++) {
      expect(Math.abs(counts[i] - expected)).toBeLessThan(tolerance);
    }
  });

  it("should be able to handle a large number of requests without period issues", () => {
    const rng = new MersenneTwisterRNG();
    // MT19937 has a very long period, this is just to ensure no crash
    for (let i = 0; i < 10000; i++) {
      rng.nextFloat();
    }
    expect(rng.nextFloat()).toBeGreaterThanOrEqual(0);
  });
});
