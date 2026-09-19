// apps/backend/rateLimiter.test.ts
import { describe, it, expect } from "bun:test";
import { SlidingWindowRateLimiter, isCreateOptionsWithinLimit } from "@engine/backend/rateLimiter";
import { CREATE_GAME_OPTIONS_MAX_BYTES } from "@engine/backend/config";

describe("SlidingWindowRateLimiter", () => {
  it("ウィンドウ内は limit 回まで通し、超えたら拒否すること", () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);
    expect(limiter.tryAcquire("u1", 0)).toBe(true);
    expect(limiter.tryAcquire("u1", 10)).toBe(true);
    expect(limiter.tryAcquire("u1", 20)).toBe(true);
    expect(limiter.tryAcquire("u1", 30)).toBe(false);
    // 別のキーは独立
    expect(limiter.tryAcquire("u2", 30)).toBe(true);
  });

  it("古い記録がウィンドウから外れれば再び通ること", () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    expect(limiter.tryAcquire("u1", 0)).toBe(true);
    expect(limiter.tryAcquire("u1", 500)).toBe(true);
    expect(limiter.tryAcquire("u1", 900)).toBe(false);
    // t=0 の記録が外れる
    expect(limiter.tryAcquire("u1", 1001)).toBe(true);
    // t=500 はまだ窓の中
    expect(limiter.tryAcquire("u1", 1002)).toBe(false);
  });

  it("拒否された要求は計上せず、窓が延び続けないこと", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    expect(limiter.tryAcquire("u1", 0)).toBe(true);
    for (let t = 100; t < 1000; t += 100) expect(limiter.tryAcquire("u1", t)).toBe(false);
    expect(limiter.tryAcquire("u1", 1001)).toBe(true);
  });

  it("sweep / clear で記録を捨てること", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    expect(limiter.tryAcquire("u1", 0)).toBe(true);
    limiter.sweep(500);
    expect(limiter.tryAcquire("u1", 500)).toBe(false);
    limiter.sweep(2000);
    expect(limiter.tryAcquire("u1", 2000)).toBe(true);
    limiter.clear();
    expect(limiter.tryAcquire("u1", 2000)).toBe(true);
  });
});

describe("isCreateOptionsWithinLimit", () => {
  it("未指定・上限以下は通し、上限超えは拒否すること", () => {
    expect(isCreateOptionsWithinLimit(undefined)).toBe(true);
    expect(isCreateOptionsWithinLimit("{}")).toBe(true);
    expect(isCreateOptionsWithinLimit("x".repeat(CREATE_GAME_OPTIONS_MAX_BYTES))).toBe(true);
    expect(isCreateOptionsWithinLimit("x".repeat(CREATE_GAME_OPTIONS_MAX_BYTES + 1))).toBe(false);
    // マルチバイト文字はバイト数で数える
    expect(isCreateOptionsWithinLimit("あ".repeat(CREATE_GAME_OPTIONS_MAX_BYTES / 3 + 1))).toBe(
      false,
    );
  });
});
