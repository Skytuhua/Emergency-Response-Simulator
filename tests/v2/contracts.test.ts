import { describe, expect, it } from 'vitest';
import { canonical, sha256, hashValue, seededRank } from '../../src/v2/hash';
import { parseRunFile } from '../../src/run-file';
import { createHash } from 'node:crypto';

describe('v2 cross-language identity contract', () => {
  it('matches SHA-256 vectors and UTF-8 without relying on browser or network', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    for (const text of ['\u00e9\ud83e\udd16', 'x'.repeat(100_000)]) expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
  });
  it('sorts object keys and retains array order and exact text', () => {
    expect(canonical({ z: 2, a: [1, 'x'] })).toBe('{"a":[1,"x"],"z":2}');
    expect(hashValue({ z: 2, a: 1 })).toBe(hashValue({ a: 1, z: 2 }));
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
    expect(canonical({ '\u{10000}': 2, '\ue000': 1 })).toBe('{"\ue000":1,"\u{10000}":2}');
    expect(() => canonical({ n: Infinity })).toThrow();
    expect(() => canonical({ n: undefined })).toThrow();
    expect(seededRank(42, 'r', 'field', 'H1')).toBe(sha256('42|r|field|H1'));
  });
  it('does not widen the v1 parser to accept new scenario data', () => {
    expect(() => parseRunFile(JSON.stringify({ kind: 'catastrophe-response-run', version: 2 }))).toThrow();
    expect(() => parseRunFile(' '.repeat(1_048_577))).toThrow(/1 MiB/);
  });
});
