// packages/shared/rules/mahjong/MahjongHandEvaluator.ts
import type { MahjongState, Tile } from './MahjongRuleset';
import Riichi from 'riichi';

export interface EvaluatedHand {
    isAgari: boolean;
    yaku: Record<string, string>; // e.g. { "立直": "1飜", "平和": "1飜" }
    han: number;
    fu: number;
    ten: number; // 合計点数
    text: string;
}

/**
 * npm `riichi` パッケージを使って点数計算を行うラッパー
 */
export class MahjongHandEvaluator {

    /**
     * 手牌配列から riichi パッケージが解釈可能な文字列 (例: "123m456p789s1122z") に変換する
     */
    private static formatTilesToRiichiString(tiles: Tile[]): string {
        // "1m" "2m" のような配列を、"12m" のようにスーツごとにまとめる
        const m: string[] = [];
        const p: string[] = [];
        const s: string[] = [];
        const z: string[] = [];

        for (const tile of tiles) {
            const num = tile.charAt(0);
            const suit = tile.charAt(1);
            if (suit === 'm') m.push(num);
            if (suit === 'p') p.push(num);
            if (suit === 's') s.push(num);
            if (suit === 'z') z.push(num);
        }

        let result = '';
        if (m.length > 0) result += m.sort().join('') + 'm';
        if (p.length > 0) result += p.sort().join('') + 'p';
        if (s.length > 0) result += s.sort().join('') + 's';
        if (z.length > 0) result += z.sort().join('') + 'z';

        return result;
    }

    /**
     * 副露を riichi 形式の文字列に変換する
     * 鳴き（ポン等）は riichi に追加の文字として渡すルールがある（例: チーは "123m", ポンは "111p" など）
     * 仕様上、単純結合で "+111p" のように連結させる（riichi仕様次第だが簡易実装）
     */
    private static formatMeldsToRiichiString(melds: any[]): string {
        if (!melds || melds.length === 0) return '';

        let meldStr = '';
        for (const meld of melds) {
            // ※簡易化: 本来はチーやカンの細かい表現が必要
            // 鳴きを意味する "+" やポン等の文字をriichiの仕様に従ってつなぐ必要があるが、
            // 今回は便宜上、単純に手牌の延長として扱うか（メンゼンが崩れるのみ）、
            // `riichi`の機能 "123m+111p" を使用する。
            if (meld.type === 'PON') {
                const num = meld.tile.charAt(0);
                const suit = meld.tile.charAt(1);
                meldStr += `+${num}${num}${num}${suit}`;
            } else if (meld.type === 'CHI') {
                // 本来は正確な構成情報が必要（例 "2m" を鳴いて "123m" を作った）
                // 簡略化のため、ここでは仮実装
                const num = parseInt(meld.tile.charAt(0));
                const suit = meld.tile.charAt(1);
                meldStr += `+${num - 1}${num}${num + 1}${suit}`; // 雑な仮定（実用では不十分）
            } else if (meld.type === 'KAN') {
                const num = meld.tile.charAt(0);
                const suit = meld.tile.charAt(1);
                meldStr += `+${num}${num}${num}${num}${suit}`;
            }
        }
        return meldStr;
    }

    /**
     * 役と点数を計算するメイン関数
     * @param hand アガリ者の現在のメンゼン手牌（アガリ牌を含む14枚、鳴きがある場合は少ない）
     * @param melds アガリ者の鳴き情報
     * @param winTile ロンまたはツモしたアガリ牌
     * @param isTsumo ツモアガリかどうか
     * @param wind 現在の場風などの状態 (オプション・簡略化のため現状は固定値等を利用想定)
     */
    public static evaluate(
        hand: Tile[],
        melds: any[],
        winTile: Tile,
        isTsumo: boolean,
        state?: MahjongState // 将来的に場風やドラの計算に使用
    ): EvaluatedHand {

        // 1. 手牌を riichi が読める形にまとめる (アガリ牌は一旦除外してフォーマット)
        // 判定のため、引数の hand には既に winTile が含まれている前提なので、それを1つコピーから抜く
        const handCopy = [...hand];
        const winIdx = handCopy.indexOf(winTile);
        if (winIdx !== -1) {
            handCopy.splice(winIdx, 1);
        }

        const handStr = this.formatTilesToRiichiString(handCopy);

        // 2. 鳴きがあればくっつける
        const meldStr = this.formatMeldsToRiichiString(melds);

        // 3. アガリ牌の指定
        // riichiライブラリの仕様: ロンの場合は最後に "+1m" などをくっつける。
        // ツモの場合はアガリ牌を手牌の最後に含める (例: 12m3m) だが、
        // 独立して評価するために "+1m" と同等に扱うか、明示的にツモのコンテクストを与える
        const winTileStr = winTile.charAt(0) + winTile.charAt(1);
        let query = handStr + meldStr;

        if (isTsumo) {
            query += winTileStr; // ツモの場合は手牌として連結
        } else {
            query += "+" + winTileStr; // ロンの場合は + をつける
        }
        console.log(`[MahjongHandEvaluator] Evaluating: ${query}`);

        try {
            // riichiライブラリで計算
            const result = new Riichi(query).calc();

            return {
                isAgari: Boolean(result.isAgari),
                yaku: result.yaku || {},
                han: result.han || 0,
                fu: result.fu || 0,
                ten: result.ten || 0,
                text: result.text || ''
            };
        } catch (e) {
            console.error("[MahjongHandEvaluator] Error evaluating hand", e);
            return {
                isAgari: false,
                yaku: {},
                han: 0,
                fu: 0,
                ten: 0,
                text: "Error"
            };
        }
    }
}
