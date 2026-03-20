// packages/shared/utils/ProvablyFairRNG.ts
import { IGameRNG } from "./IGameRNG";
import { sha256 } from "./crypto";

/**
 * Provably Fair（証明可能な公正さ）に基づく乱数生成器
 * HMAC-SHA256 的なハッシュチェーンを使用して、検証可能な乱数列を生成する。
 */
export class ProvablyFairRNG implements IGameRNG {
    private serverSeed: string;
    private clientSeed: string;
    private nonce: number;

    constructor(serverSeed: string, clientSeed: string, nonce: number = 0) {
        this.serverSeed = serverSeed;
        this.clientSeed = clientSeed;
        this.nonce = nonce;
    }

    /**
     * 0以上1未満の浮動小数点を取得
     */
    public nextFloat(): number {
        // serverSeed:clientSeed:nonce の形式でハッシュを計算
        const combined = `${this.serverSeed}:${this.clientSeed}:${this.nonce}`;
        const hash = sha256(combined);
        this.nonce++;

        // ハッシュの最初の8文字（32ビット）を整数値として使用
        const intValue = parseInt(hash.substring(0, 8), 16);
        // 0x0から0xFFFFFFFFの範囲を 0.0から1.0にスケール
        return intValue / 0xFFFFFFFF;
    }

    /**
     * 指定範囲の整数を取得
     */
    public nextInt(min: number, max: number): number {
        const floatValue = this.nextFloat();
        return Math.floor(floatValue * (max - min + 1)) + min;
    }

    /**
     * 現在のnonceを取得（状態保存用）
     */
    public getNonce(): number {
        return this.nonce;
    }

    /**
     * 結果を再検証するための静的メソッド
     */
    public static verify(serverSeed: string, clientSeed: string, nonce: number): number {
        const combined = `${serverSeed}:${clientSeed}:${nonce}`;
        const hash = sha256(combined);
        const intValue = parseInt(hash.substring(0, 8), 16);
        return intValue / 0xFFFFFFFF;
    }
}
