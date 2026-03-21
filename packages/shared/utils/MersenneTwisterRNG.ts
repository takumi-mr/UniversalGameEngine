import type { IGameRNG } from "./IGameRNG";

/**
 * メルセンヌ・ツイスタ (MT19937) による乱数生成器
 */
export class MersenneTwisterRNG implements IGameRNG {
  private static readonly N = 624;
  private static readonly M = 397;
  private static readonly MATRIX_A = 0x9908b0df;
  private static readonly UPPER_MASK = 0x80000000;
  private static readonly LOWER_MASK = 0x7fffffff;

  private mt = new Uint32Array(MersenneTwisterRNG.N);
  private mti = MersenneTwisterRNG.N + 1;

  constructor(seed: number = Date.now()) {
    this.initGenrand(seed);
  }

  /**
   * シード値による初期化
   */
  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (this.mti = 1; this.mti < MersenneTwisterRNG.N; this.mti++) {
      const s = this.mt[this.mti - 1] ^ (this.mt[this.mti - 1] >>> 30);
      // 1812433253 * s + mti を 32bit 整数として計算
      this.mt[this.mti] =
        (((((s & 0xffff0000) >>> 16) * 1812433253) << 16) +
          (s & 0x0000ffff) * 1812433253 +
          this.mti) >>>
        0;
    }
  }

  /**
   * 32ビット符号なし整数の生成
   */
  private nextUint32(): number {
    let y: number;
    const mag01 = [0, MersenneTwisterRNG.MATRIX_A];

    if (this.mti >= MersenneTwisterRNG.N) {
      let kk: number;

      for (kk = 0; kk < MersenneTwisterRNG.N - MersenneTwisterRNG.M; kk++) {
        y =
          (this.mt[kk] & MersenneTwisterRNG.UPPER_MASK) |
          (this.mt[kk + 1] & MersenneTwisterRNG.LOWER_MASK);
        this.mt[kk] = this.mt[kk + MersenneTwisterRNG.M] ^ (y >>> 1) ^ mag01[y & 0x1];
      }
      for (; kk < MersenneTwisterRNG.N - 1; kk++) {
        y =
          (this.mt[kk] & MersenneTwisterRNG.UPPER_MASK) |
          (this.mt[kk + 1] & MersenneTwisterRNG.LOWER_MASK);
        this.mt[kk] =
          this.mt[kk + (MersenneTwisterRNG.M - MersenneTwisterRNG.N)] ^ (y >>> 1) ^ mag01[y & 0x1];
      }
      y =
        (this.mt[MersenneTwisterRNG.N - 1] & MersenneTwisterRNG.UPPER_MASK) |
        (this.mt[0] & MersenneTwisterRNG.LOWER_MASK);
      this.mt[MersenneTwisterRNG.N - 1] =
        this.mt[MersenneTwisterRNG.M - 1] ^ (y >>> 1) ^ mag01[y & 0x1];

      this.mti = 0;
    }

    y = this.mt[this.mti++];

    // テンパリング (抽出用変換)
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;

    return y >>> 0;
  }

  /**
   * 0以上1未満の浮動小数点を返す (53ビット精度)
   */
  public nextFloat(): number {
    const a = this.nextUint32() >>> 5;
    const b = this.nextUint32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  /**
   * min以上max以下の整数を返す (Modulo Bias対策付き)
   */
  public nextInt(min: number, max: number): number {
    const range = max - min + 1;
    if (range <= 0) return min;

    const limit = 4294967296; // 2^32
    const maxVal = limit - (limit % range);

    while (true) {
      const val = this.nextUint32();
      if (val < maxVal) {
        return min + (val % range);
      }
    }
  }
}
