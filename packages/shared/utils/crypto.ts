// packages/shared/utils/crypto.ts

/**
 * UTF-8文字列をバイナリ文字列（charCodeAtで0-255に収まる形式）に変換するヘルパー
 */
const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function toUtf8BinaryString(str: string): string {
    if (encoder) {
        return String.fromCharCode(...encoder.encode(str));
    }
    // TextEncoderがない環境向けのフォールバック
    return unescape(encodeURIComponent(str));
}

/**
 * 同期的かつ環境（Node/Browser）に依存しないSHA-256の実装
 * @param message ハッシュ化する文字列
 * @param isRawBinary 既にバイナリ文字列化されている場合はtrue（内部計算用）
 */
export function sha256(message: string, isRawBinary: boolean = false): string {
    let ascii = isRawBinary ? message : toUtf8BinaryString(message);

    function rightRotate(value: number, amount: number) {
        return (value >>> amount) | (value << (32 - amount));
    }

    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    const lengthProperty = 'length';
    let i, j;
    let result = '';

    const words: any[] = [];
    const asciiLength = ascii[lengthProperty];
    // 初期ハッシュ定数を保持する専用のキャッシュを作成（副作用防止）
    const h0 = (sha256 as any).h0 = (sha256 as any).h0 || [];
    const k = (sha256 as any).k = (sha256 as any).k || [];
    let primeCounter = k[lengthProperty];

    const isPrime = (n: number) => {
        for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
        return true;
    };

    if (!primeCounter) {
        for (let n = 2; primeCounter < 64; n++) {
            if (isPrime(n)) {
                if (primeCounter < 8) h0[primeCounter] = (mathPow(n, 1 / 2) * maxWord) | 0;
                k[primeCounter] = (mathPow(n, 1 / 3) * maxWord) | 0;
                primeCounter++;
            }
        }
    }

    // 計算用配列には毎回コピーを渡す
    const hash = h0.slice(0);

    ascii += '\x80'; // Append 1000...nd bit
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00'; // Append zeros

    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return ''; // ASCII check: isRawBinaryがfalseならここは通らないはず
        words[i >> 2] |= j << ((3 - i % 4) * 8);
    }
    words[words[lengthProperty]] = ((asciiLength / 8) / maxWord) | 0;
    words[words[lengthProperty]] = (asciiLength * 8) | 0;

    for (j = 0; j < words[lengthProperty]; j += 16) {
        const w = words.slice(j, j + 16);
        const oldHash = hash.slice(0);

        const h = hash;
        for (i = 0; i < 64; i++) {
            const w15 = w[i - 15], w2 = w[i - 2];
            const a = h[0], e = h[4];
            const temp1 = h[7]
                + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) // S1
                + ((e & h[5]) ^ (~e & h[6])) // ch
                + k[i]
                + (w[i] = (i < 16) ? w[i] : (
                    w[i - 16]
                    + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) // s0
                    + w[i - 7]
                    + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)) // s1
                    | 0
                ));
            const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) // S0
                + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2])); // maj

            h[7] = h[6]; h[6] = h[5]; h[5] = h[4];
            h[4] = (h[3] + temp1) | 0;
            h[3] = h[2]; h[2] = h[1]; h[1] = h[0];
            h[0] = (temp1 + temp2) | 0;
        }

        for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }

    for (i = 0; i < 8; i++) {
        for (j = 3; j + 1; j--) {
            const b = (hash[i] >> (j * 8)) & 255;
            result += ((b < 16) ? '0' : '') + b.toString(16);
        }
    }
    return result;
}

function hexToAscii(hex: string): string {
    let ascii = '';
    for (let i = 0; i < hex.length; i += 2) {
        ascii += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
    }
    return ascii;
}

/**
 * HMAC-SHA256の実装
 */
export function hmacSha256(key: string, message: string): string {
    const blockSize = 64;

    let keyStr = toUtf8BinaryString(key);
    const msgStr = toUtf8BinaryString(message);

    if (keyStr.length > blockSize) {
        keyStr = hexToAscii(sha256(keyStr, true)); // 内部計算なのでtrueを渡す
    }
    while (keyStr.length < blockSize) {
        keyStr += '\x00';
    }

    let oKeyPad = '';
    let iKeyPad = '';
    for (let i = 0; i < blockSize; i++) {
        const charCode = keyStr.charCodeAt(i);
        oKeyPad += String.fromCharCode(charCode ^ 0x5c);
        iKeyPad += String.fromCharCode(charCode ^ 0x36);
    }

    // 内部計算用（すでにバイナリ文字列化されている）のでフラグにtrueを渡す
    const innerHashHex = sha256(iKeyPad + msgStr, true);
    const innerHashAscii = hexToAscii(innerHashHex);

    return sha256(oKeyPad + innerHashAscii, true);
}

/**
 * サーバーシードなどの安全なランダム文字列を生成する
 */
export function generateRandomSeed(length: number = 32): string {
    const array = new Uint8Array(length);
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
        globalThis.crypto.getRandomValues(array);
    } else {
        // 非推奨のフォールバック (実行環境にWebCryptoもない場合)
        try {
            // Node.js環境でWebCryptoがない場合の最終手段を試みる
            // ただしViteの静的解析を避けるために型安全な方法でアクセス
            const nodeCrypto = typeof require !== 'undefined' ? require('crypto') : null;
            if (nodeCrypto && nodeCrypto.randomBytes) {
                const buffer = nodeCrypto.randomBytes(length);
                return buffer.toString('hex');
            }
        } catch (e) {
            // ignore
        }
        for (let i = 0; i < length; i++) {
            array[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
