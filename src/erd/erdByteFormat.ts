/** Pure human-readable byte sizes (decimal units, as the designer's 460,000,000 threshold). */
const UNITS = ['B', 'KB', 'MB', 'GB'] as const;
/** Rounded text of a value in a unit; MB/GB drop decimals once the rounded value reaches 100. */
const text = (unit: number, value: number): string => unit === 0 ? String(value) : unit === 1 ? value.toFixed(1) : Number(value.toFixed(2)) >= 100 ? value.toFixed(0) : value.toFixed(2);

/** B: integer; KB: 1 decimal; MB/GB: 2 decimals (none once the rounded value is 100). Invalid input is 'Unknown'. */
export function formatBytes(bytes: number | undefined): string {
 if (bytes === undefined || !Number.isSafeInteger(bytes) || bytes < 0) return 'Unknown';
 let unit = 0, value = bytes;
 while (unit < UNITS.length - 1 && value >= 1000) { value /= 1000; unit++; }
 // Rounding may reach 1000 of the current unit: promote once more.
 if (unit > 0 && unit < UNITS.length - 1 && Number(text(unit, value)) >= 1000) { value /= 1000; unit++; }
 return `${text(unit, value)} ${UNITS[unit]}`;
}
