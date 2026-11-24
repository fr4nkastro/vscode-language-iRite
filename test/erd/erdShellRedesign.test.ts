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

it('keeps populated read-only markup and navigation free of inline styles', () => {
 const html = renderErdHtml({tables:[
  {name:'Orders',alias:'Orders',origin:'source',source:{file:'main.iri',line:7},fields:[{name:'Customer',type:'integer'}]},
  {name:'Customers',alias:'Customers',origin:'rev',fields:[{name:'Id',type:'integer'}]},
 ],relations:[{from:{table:'Orders',field:'Customer'},to:{table:'Customers',field:'Id'},kind:'inferred'}],diagnostics:[]}, {cspSource:'vscode:',nonce:'abc',title:'DB'});
 expect(html).toContain('class="rel"');
 expect(html).toContain('data-file="main.iri" data-line="7"');
 expect(html).toContain("closest('.hdr[data-line]')");
 expect(html).toContain("type: 'open'");
 expect(html).not.toMatch(/\sstyle\s*=/i);
 const script = html.match(/<script nonce="abc">([\s\S]*?)<\/script>/)![1];
 expect(script).not.toMatch(/\.style\b|setAttribute\s*\(\s*['"]style['"]|cssText/i);
 expect(html).toContain("style-src 'nonce-abc'");
 expect(html).not.toContain("'unsafe-inline'");
});
