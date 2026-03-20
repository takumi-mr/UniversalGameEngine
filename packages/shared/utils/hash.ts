// packages/shared/utils/hash.ts

/**
 * 送信・受信される状態オブジェクトのハッシュ値を計算する
 * 注意: 完全に厳密である必要はないが、クライアントとサーバで同じ結果になる必要がある。
 * キーの順序が異なるとハッシュが変わるため、JSON.stringify + シンプルなハッシュ関数を使用する。
 */
export function calculateStateHash(state: any): string {
    // 循環参照や関数などは基本的には state に含まれない前提 (BaseGameState)
    const str = JSON.stringify(state, (key, value) => {
        // hash フィールド自体は計算から除外する
        if (key === 'hash') return undefined;
        return value;
    });
    
    // シンプルな 32-bit FNV-1a 風ハッシュ
    let hval = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hval ^= str.charCodeAt(i);
        hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
    }
    return (hval >>> 0).toString(16);
}
