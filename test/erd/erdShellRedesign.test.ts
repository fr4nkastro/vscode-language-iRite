import { expect, it } from 'vitest';
import { renderErdHtml } from '../../src/erd/erdHtml';

it('hosts the draft outside SVG under a nonce-only themed CSP', () => {
 const html = renderErdHtml({tables:[],relations:[],diagnostics:[]}, {cspSource:'vscode:', nonce:'abc', title:'DB', editor:{schema:{reservedIndexes:[],tables:[{index:1,name:'Orders',maxRecords:1,fields:[]}]},startEditing:true}});
 expect(html).toContain("style-src 'nonce-abc'");
 expect(html).not.toContain("'unsafe-inline'");
 expect(html).not.toMatch(/\sstyle=/);
 expect(html).toContain('Filter tables');
 expect(html).toContain('data-action="selectTable"');
 expect(html.indexOf('</svg>')).toBeLessThan(html.indexOf('class="erd-draft"'));
 expect(html).not.toContain('Apply table');
 expect(html).toContain('Discard');
});
