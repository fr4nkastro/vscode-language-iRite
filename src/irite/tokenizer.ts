export interface Token {
	kind: 'id' | 'num' | 'str' | 'op';
	text: string;
	lower: string;
	line: number;
	start: number;
	end: number;
}

export interface TokenizeResult {
	tokens: Token[];
	/** Problems found while tokenizing (line, message). */
	errors: { line: number; message: string }[];
}

const TWO_CHAR_OPS = new Set([':=', '<=', '>=', '<>', '..']);

/**
 * Lightweight tokenizer. Skips `--` and `(* *)` comments and `#directive` lines;
 * double-quoted strings may contain `--`. Never throws.
 */
export function tokenize(text: string): TokenizeResult {
	const tokens: Token[] = [];
	const errors: { line: number; message: string }[] = [];
	let i = 0;
	let line = 1;
	const n = text.length;
	const push = (kind: Token['kind'], start: number, end: number, tokLine: number): void => {
		const t = text.slice(start, end);
		tokens.push({ kind, text: t, lower: t.toLowerCase(), line: tokLine, start, end });
	};
	while (i < n) {
		const c = text[i];
		if (c === '\n') {
			line++;
			i++;
		} else if (c === ' ' || c === '\t' || c === '\r' || c === '\uFEFF') {
			i++;
		} else if (c === '-' && text[i + 1] === '-') {
			while (i < n && text[i] !== '\n') {
				i++;
			}
		} else if (c === '#') {
			while (i < n && text[i] !== '\n') {
				i++;
			}
		} else if (c === '(' && text[i + 1] === '*') {
			const startLine = line;
			i += 2;
			let closed = false;
			while (i < n) {
				if (text[i] === '*' && text[i + 1] === ')') {
					i += 2;
					closed = true;
					break;
				}
				if (text[i] === '\n') {
					line++;
				}
				i++;
			}
			if (!closed) {
				errors.push({ line: startLine, message: 'Unterminated block comment' });
			}
		} else if (c === '"') {
			const start = i;
			i++;
			while (i < n && text[i] !== '"' && text[i] !== '\n') {
				i++;
			}
			if (text[i] === '"') {
				i++;
			} else {
				errors.push({ line, message: 'Unterminated string literal' });
			}
			push('str', start, i, line);
		} else if (/[A-Za-z_]/.test(c)) {
			const start = i;
			while (i < n && /[A-Za-z0-9_]/.test(text[i])) {
				i++;
			}
			push('id', start, i, line);
		} else if (/[0-9]/.test(c)) {
			const start = i;
			while (i < n && /[A-Za-z0-9_]/.test(text[i])) {
				i++;
			}
			if (text[i] === '.' && /[0-9]/.test(text[i + 1] ?? '')) {
				i++;
				while (i < n && /[0-9]/.test(text[i])) {
					i++;
				}
			}
			push('num', start, i, line);
		} else {
			const two = text.slice(i, i + 2);
			const len = TWO_CHAR_OPS.has(two) ? 2 : 1;
			push('op', i, i + len, line);
			i += len;
		}
	}
	return { tokens, errors };
}

/** Joins tokens into normalized text: single space where the source had a gap (whitespace/comment). */
export function joinTokens(tokens: Token[]): string {
	let out = '';
	for (let k = 0; k < tokens.length; k++) {
		if (k > 0 && tokens[k].start > tokens[k - 1].end) {
			out += ' ';
		}
		out += tokens[k].text;
	}
	return out;
}
