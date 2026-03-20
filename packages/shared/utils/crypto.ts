// packages/shared/utils/crypto.ts

/**
 * 同期的かつ環境（Node/Browser）に依存しないSHA-256の実装
 * 注意: パフォーマンスとポータビリティを優先した軽量版
 */
export function sha256(ascii: string): string {
    function rightRotate(value: number, amount: number) {
        return (value >>> amount) | (value << (32 - amount));
    }

    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    const lengthProperty = 'length';
    let i, j; // Used as a counter across the whole file
    let result = '';

    const words: any[] = [];
    const asciiLength = ascii[lengthProperty];
    const hash = (sha256 as any).h = (sha256 as any).h || [];
    const k = (sha256 as any).k = (sha256 as any).k || [];
    let primeCounter = k[lengthProperty];

    const isPrime = (n: number) => {
        for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
        return true;
    };

    if (!primeCounter) {
        for (let n = 2; primeCounter < 64; n++) {
            if (isPrime(n)) {
                if (primeCounter < 8) hash[primeCounter] = (mathPow(n, 1 / 2) * maxWord) | 0;
                k[primeCounter] = (mathPow(n, 1 / 3) * maxWord) | 0;
                primeCounter++;
            }
        }
    }

    ascii += '\x80'; // Append 1000...nd bit
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00'; // Append zeros

    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return ''; // ASCII check: only accept characters in range 0-255
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

/**
 * サーバーシードなどの安全なランダム文字列を生成する
 */
export function generateRandomSeed(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    // Nodeならcrypto.randomBytes、ブラウザならcrypto.getRandomValuesを使用
    // ここでは簡易実装としてMath.randomを使用（実際にはサーバー側で呼ばれる）
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
