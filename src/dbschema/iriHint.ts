import type { DbSchema } from './model';
import { iriteFieldType } from './fieldTypes';
/** Unknown codes are deliberately left as comments, never inferred. */
export function dbIriHint(model: DbSchema): string {
 return model.tables.map(t => {
  const fields = t.fields.map(f => {
   const type = iriteFieldType(f.typeCode, f.size);
   return type ? `    ${f.name}: ${type};` : `    -- ${f.name}: unknown type code ${f.typeCode}, size ${f.size}; regenerate in Revolution`;
  });
  return [`type ${t.name}Database is database ("${t.name}")`, ...fields, 'end database;', '', ...t.fields.map((f,i) => `${t.name}_${f.name} : constant integer := ${i+1};`)].join('\n');
 }).join('\n\n');
}
