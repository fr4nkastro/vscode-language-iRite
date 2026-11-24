/** Pure human-readable byte sizes (decimal units, as the designer's 460,000,000 threshold). */
const UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const decimals = (unit: number, value: number): number => unit === 0 ? 0 : unit === 1 ? 1 : value >= 100 ? 0 : 2;

/** B: integer; KB: 1 decimal; MB/GB: 2 decimals (none from 100). Invalid input is 'Unknown'. */
export function formatBytes(bytes: number | undefined): string {
 if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) return 'Unknown';
 let unit = 0, value = bytes;
 while (unit < UNITS.length - 1 && value >= 1000) { value /= 1000; unit++; }
 // Rounding may reach 1000 of the current unit: promote once more.
 if (unit > 0 && unit < UNITS.length - 1 && Number(value.toFixed(decimals(unit, value))) >= 1000) { value /= 1000; unit++; }
 return `${value.toFixed(decimals(unit, value))} ${UNITS[unit]}`;
}
