import type { DbSchema } from './model';
/** Unknown codes are deliberately left as comments, never inferred. */
export function dbIriHint(model: DbSchema): string {
 return model.tables.map(t => {
  const fields = t.fields.map(f => {
   const type = [1,2,3].includes(f.typeCode) ? 'integer' : f.typeCode === 4 ? 'real' : [6,7].includes(f.typeCode) ? `string[${f.size}]` : undefined;
   return type ? `    ${f.name}: ${type};` : `    -- ${f.name}: unknown type code ${f.typeCode}, size ${f.size}; regenerate in Revolution`;
  });
  return [`type ${t.name}Database is database ("${t.name}")`, ...fields, 'end database;', '', ...t.fields.map((f,i) => `${t.name}_${f.name} : constant integer := ${i+1};`)].join('\n');
 }).join('\n\n');
}
