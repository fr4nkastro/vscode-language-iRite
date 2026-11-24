/**
 * "1 error", "2 errors". Self-contained on purpose: the webview script embeds
 * this function's source (`PLURAL_SOURCE`), so server render and browser share one definition.
 */
export function plural(count: number, word: string): string {
 return count + ' ' + word + (count === 1 ? '' : 's');
}
export const PLURAL_SOURCE = plural.toString();
