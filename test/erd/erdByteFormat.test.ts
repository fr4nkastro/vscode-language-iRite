import { expect, it } from 'vitest';
import { formatBytes } from '../../src/erd/erdByteFormat';

it('formats decimal byte units with B, KB and MB', () => {
 expect(formatBytes(0)).toBe('0 B');
 expect(formatBytes(39)).toBe('39 B');
 expect(formatBytes(999)).toBe('999 B');
 expect(formatBytes(1000)).toBe('1.0 KB');
 expect(formatBytes(3000)).toBe('3.0 KB');
 expect(formatBytes(39000)).toBe('39.0 KB');
 expect(formatBytes(4_600_000)).toBe('4.60 MB');
 expect(formatBytes(4_670_000)).toBe('4.67 MB');
 expect(formatBytes(460_000_000)).toBe('460 MB');
});
it('promotes a unit when rounding would reach 1000 and handles invalid input', () => {
 expect(formatBytes(999_960)).toBe('1.00 MB');
 expect(formatBytes(1_500_000_000)).toBe('1.50 GB');
 for (const bad of [undefined, NaN, Infinity, -1, 1.5]) expect(formatBytes(bad as number | undefined)).toBe('Unknown');
});
