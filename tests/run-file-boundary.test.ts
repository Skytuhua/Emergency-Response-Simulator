import { expect, it } from 'vitest';
import { parseRunFile } from '../src/run-file';
it('bounds UTF-8 input before decoding JSON', () => {
  expect(() => parseRunFile('x'.repeat(1_048_577))).toThrow('1 MiB');
  expect(() => parseRunFile('é'.repeat(524_289))).toThrow('1 MiB');
});
it('explains malformed JSON', () => {
  expect(() => parseRunFile('{')).toThrow(/valid JSON/);
});
