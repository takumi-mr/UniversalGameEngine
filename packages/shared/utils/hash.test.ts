// packages/shared/utils/hash.test.ts
import { describe, it, expect } from "bun:test";
import { calculateStateHash } from './hash';

describe('calculateStateHash', () => {
  it('同一のオブジェクトに対して常に同じハッシュ値を返すこと', () => {
    const state = { id: 1, name: 'test', isActive: true };
    const hash1 = calculateStateHash(state);
    const hash2 = calculateStateHash(state);

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
  });

  it('オブジェクトのキーの順序が異なっても同じハッシュ値を返すこと', () => {
    const state1 = { a: 1, b: 2, c: 3 };
    const state2 = { c: 3, a: 1, b: 2 };

    expect(calculateStateHash(state1)).toBe(calculateStateHash(state2));
  });

  it('ネストされたオブジェクトのキーの順序が異なっても同じハッシュ値を返すこと', () => {
    const state1 = { a: 1, nested: { x: 10, y: 20 } };
    const state2 = { nested: { y: 20, x: 10 }, a: 1 };

    expect(calculateStateHash(state1)).toBe(calculateStateHash(state2));
  });

  it('オブジェクト内の "hash" フィールドが計算から除外されること', () => {
    const stateWithoutHash = { id: 1, value: 'data' };
    const stateWithHash = { id: 1, value: 'data', hash: 'dummy-hash-value' };

    expect(calculateStateHash(stateWithoutHash)).toBe(calculateStateHash(stateWithHash));
  });

  it('ネストされたオブジェクト内の "hash" フィールドも除外されること', () => {
    const stateWithoutHash = { id: 1, data: { status: 'ok' } };
    const stateWithNestedHash = { id: 1, data: { status: 'ok', hash: 'ignore-me' } };

    expect(calculateStateHash(stateWithoutHash)).toBe(calculateStateHash(stateWithNestedHash));
  });

  it('配列要素内のオブジェクトのキー順序が異なっても同じハッシュ値を返すこと', () => {
    const state1 = { list: [{ a: 1, b: 2 }, { c: 3, d: 4 }] };
    const state2 = { list: [{ b: 2, a: 1 }, { d: 4, c: 3 }] };

    expect(calculateStateHash(state1)).toBe(calculateStateHash(state2));
  });

  it('配列要素の順序が異なる場合は「異なる」ハッシュ値を返すこと', () => {
    // オブジェクトのキーはソートされるべきだが、配列の要素順序は意味を持つためソートされない
    const state1 = { items: [1, 2, 3] };
    const state2 = { items: [3, 2, 1] };

    expect(calculateStateHash(state1)).not.toBe(calculateStateHash(state2));
  });

  it('nullやプリミティブ値が渡されてもエラーにならずハッシュを計算できること', () => {
    expect(() => calculateStateHash(null)).not.toThrow();
    expect(() => calculateStateHash('string')).not.toThrow();
    expect(() => calculateStateHash(123)).not.toThrow();

    // 値が異なればハッシュも異なることを確認
    expect(calculateStateHash(null)).not.toBe(calculateStateHash('null'));
  });

  it('値の変更が正しくハッシュ値の変更として反映されること', () => {
    const state1 = { count: 1 };
    const state2 = { count: 2 };

    expect(calculateStateHash(state1)).not.toBe(calculateStateHash(state2));
  });
});