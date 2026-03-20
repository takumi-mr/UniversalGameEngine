import { expect, it, describe, } from "bun:test";
import { sha256, hmacSha256 } from './crypto';

describe('crypto', () => {
    describe('sha256', () => {
        it('should generate correct sha256 hash for empty string', () => {
            expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        });

        it('should generate correct sha256 hash for standard string', () => {
            const hash = sha256('hello world');
            expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
        });
    });

    describe('hmacSha256', () => {
        it('should generate correct hmac-sha256 hash', () => {
            // Test vector from RFC 4231
            const key = 'key';
            const message = 'The quick brown fox jumps over the lazy dog';
            const hash = hmacSha256(key, message);
            expect(hash).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
        });

        it('should handle keys larger than block size', () => {
            // A long key > 64 chars
            const key = 'a'.repeat(100);
            const message = 'test message';
            const hash = hmacSha256(key, message);
            // This just checks it does not throw and produces a string
            expect(hash.length).toBe(64);
        });
    });
});
