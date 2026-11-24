/** Revolution designer metadata; device acceptance remains unverified. */
export interface FieldType { code: number; name: string; iriteType: 'integer' | 'real' | 'string' | 'DateTime' | undefined; defaultSize: number; variable: boolean }
export const fieldTypes: readonly FieldType[] = [
 {code:0,name:'None',iriteType:undefined,defaultSize:0,variable:false},
 {code:1,name:'Byte',iriteType:'integer',defaultSize:1,variable:false},
 {code:2,name:'Short Integer',iriteType:'integer',defaultSize:2,variable:false},
 {code:3,name:'Long Integer',iriteType:'integer',defaultSize:4,variable:false},
 {code:4,name:'Single Precision Real',iriteType:'real',defaultSize:4,variable:false},
 {code:5,name:'Double Precision Real',iriteType:'real',defaultSize:8,variable:false},
 {code:6,name:'Fixed Length String',iriteType:'string',defaultSize:20,variable:true},
 {code:7,name:'Variable Length String',iriteType:'string',defaultSize:20,variable:true},
 {code:8,name:'DateTime',iriteType:'DateTime',defaultSize:8,variable:false},
];
export const fieldType = (code: number): FieldType | undefined => fieldTypes.find(t => t.code === code);
export const editableFieldType = (code: number): FieldType | undefined => code === 0 ? undefined : fieldType(code);
export const iriteFieldType = (code: number, size: number): string | undefined => {
 const type = editableFieldType(code)?.iriteType;
 return type === 'string' ? `string[${size}]` : type;
};
