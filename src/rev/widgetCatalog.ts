/**
 * Widget catalog of the Rice Lake 1280 `.rev` format (pure module: no `vscode` import).
 *
 * Own, clean-room description of the `WDGT#<id>=<type>,<token>,...` lines written by Revolution: every
 * widget type, its ordered fields (name, kind, enum values, default, range, editable flag), alias rules and the
 * values a new widget gets from the palette. Facts only; evidence per fact is in `docs/rev-format.md`.
 *
 * Tokens are always strings in the file. Booleans are 1/2 enumerations (1 visible, 2 hidden). The `screen`
 * token is not a designer property; screens have no names or records.
 */

export type FieldKind = "int" | "enum" | "color" | "text" | "alias" | "screen" | "image";

export interface EnumValue {
	value: number;
	label: string;
}

export interface WidgetField {
	/** Token index in the line; 0 is the type code. */
	index: number;
	name: string;
	kind: FieldKind;
	/** Generic role (`x`, `y`, `width`, `height`, `screen`, `alias`, `color`, ...) shared across types. */
	role?: string;
	/** Palette default as it is written in the line (undefined: depends on position, screen or id). */
	default?: string | number;
	min?: number;
	max?: number;
	maxLength?: number;
	/** Exposed as a designer property (false: constant, derived or set by the screen selector). */
	editable: boolean;
	values?: EnumValue[];
}

export interface WidgetTypeDef {
	type: number;
	name: string;
	tokenCount: number;
	/** First assembly version that knows the type (`base` = every build). */
	introduced: string;
	observedInSamples: boolean;
	/** Width and height are tokens the user can change (false: fixed or derived size). */
	resizable: boolean;
	/** The widget has an alias in `main.iri` (types 9 and 10 regenerate it from the id). */
	hasAlias: boolean;
	/** The alias is a token of the line (false for types 1, 5, 9 and 10). */
	aliasPersisted: boolean;
	/** Default alias is `<prefix><id>`. */
	aliasPrefix?: string;
	/** Legacy type: kept as raw tokens, never offered by a palette. */
	legacy: boolean;
	defaultSize?: { width: number; height: number };
	versionNote: string;
	fields: WidgetField[];
}

export const WIDGET_TYPES: readonly WidgetTypeDef[] = [
	{
		type: 1,
		name: "Scale widget",
		tokenCount: 8,
		introduced: "base",
		observedInSamples: true,
		resizable: false,
		hasAlias: false,
		aliasPersisted: false,
		aliasPrefix: undefined,
		legacy: false,
		defaultSize: {"width": 400, "height": 98},
		versionNote: "Identical in base rev1280.dll, v301..v310.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 1, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "size", kind: "enum", role: "size", default: 4, editable: true, values: [{ value: 1, label: "Size 1: 260x65" }, { value: 2, label: "Size 2: 270x73" }, { value: 3, label: "Size 3: 340x84" }, { value: 4, label: "Size 4: 400x98" }, { value: 5, label: "Size 5: 470x105" }, { value: 6, label: "Size 6: 560x119" }, { value: 7, label: "Size 7: 700x143" }] },
			{ index: 4, name: "displayed", kind: "int", default: 1, editable: false },
			{ index: 5, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
			{ index: 6, name: "foregroundColor", kind: "color", role: "color", default: "#393939", editable: true },
			{ index: 7, name: "backgroundColor", kind: "color", role: "color", default: "#F0EEEE", editable: true },
		],
	},
	{
		type: 2,
		name: "Bitmap widget",
		tokenCount: 10,
		introduced: "base",
		observedInSamples: false,
		resizable: true,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "bit",
		legacy: false,
		defaultSize: {"width": 80, "height": 80},
		versionNote: "Present since base. Alias is token 7 (a base build ignores it when loading; v308+ reads it). Never observed in the 60 sample .rev files.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 2, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 80, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 80, min: 1, editable: true },
			{ index: 5, name: "border", kind: "enum", role: "border", default: 1, editable: true, values: [{ value: 1, label: "None" }, { value: 2, label: "Fixed single" }] },
			{ index: 6, name: "style", kind: "enum", role: "style", default: 1, editable: true, values: [{ value: 1, label: "Hopper" }, { value: 2, label: "Horizontal tank" }, { value: 3, label: "Vertical tank" }] },
			{ index: 7, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
			{ index: 8, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 9, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
	{
		type: 3,
		name: "Bargraph widget",
		tokenCount: 16,
		introduced: "base",
		observedInSamples: true,
		resizable: true,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "bar",
		legacy: false,
		defaultSize: {"width": 76, "height": 16},
		versionNote: "16-token layout identical in base and v308/v310. The 4-value orientation converter (Dial, Hopper) is absent from base rev1280.dll; the exact version that introduced it was not checked.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 3, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 76, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 16, min: 1, editable: true },
			{ index: 5, name: "border", kind: "enum", role: "border", default: 2, editable: true, values: [{ value: 1, label: "None" }, { value: 2, label: "Fixed single" }] },
			{ index: 6, name: "style", kind: "enum", default: 1, editable: false, values: [{ value: 1, label: "Basic" }] },
			{ index: 7, name: "graduations", kind: "int", default: 2, editable: false },
			{ index: 8, name: "orientation", kind: "enum", role: "orientation", default: 1, editable: true, values: [{ value: 1, label: "Horizontal" }, { value: 2, label: "Vertical" }, { value: 3, label: "Dial" }, { value: 4, label: "Hopper" }] },
			{ index: 9, name: "color", kind: "color", role: "color", default: "Black", editable: true },
			{ index: 10, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
			{ index: 11, name: "dataSource", kind: "enum", role: "source", default: 1, editable: true, values: [{ value: 1, label: "Scale" }, { value: 2, label: "Programmability (program sets the value)" }, { value: 3, label: "Setpoint" }] },
			{ index: 12, name: "dataField", kind: "int", role: "field", default: 1, min: 0, editable: true },
			{ index: 13, name: "dataSubField", kind: "int", role: "subfield", default: 1, min: 0, editable: true },
			{ index: 14, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 15, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
	{
		type: 4,
		name: "Label widget",
		tokenCount: 16,
		introduced: "base",
		observedInSamples: true,
		resizable: true,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "lbl",
		legacy: false,
		defaultSize: {"width": 76, "height": 20},
		versionNote: "Same 16-token layout in base, v301..v310. Firmware < 2.05.01 receives only the first 16 tokens (a font-family token index 16 is mentioned in code but never written by v308).",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 4, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 76, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 20, min: 1, editable: true },
			{ index: 5, name: "caption", kind: "text", role: "caption", default: "Caption", maxLength: 64, editable: true },
			{ index: 6, name: "border", kind: "enum", role: "border", default: 2, editable: true, values: [{ value: 1, label: "None" }, { value: 2, label: "Fixed single" }] },
			{ index: 7, name: "justification", kind: "enum", role: "justification", default: 1, editable: true, values: [{ value: 1, label: "Left" }, { value: 2, label: "Right" }, { value: 3, label: "Center" }] },
			{ index: 8, name: "fontSize", kind: "int", role: "font", default: 12, min: 1, editable: true },
			{ index: 9, name: "color", kind: "color", role: "color", default: "Black", editable: true },
			{ index: 10, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
			{ index: 11, name: "dataSource", kind: "enum", role: "source", default: 1, editable: true, values: [{ value: 1, label: "Scale" }, { value: 2, label: "Programmability (program sets text)" }, { value: 3, label: "Setpoint" }, { value: 4, label: "Self (static caption)" }] },
			{ index: 12, name: "dataField", kind: "int", role: "field", default: 1, min: 0, editable: true },
			{ index: 13, name: "dataSubField", kind: "int", role: "subfield", default: 1, min: 0, editable: true },
			{ index: 14, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 15, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
	{
		type: 5,
		name: "Numeric widget (legacy 920i)",
		tokenCount: 13,
		introduced: "legacy",
		observedInSamples: false,
		resizable: false,
		hasAlias: false,
		aliasPersisted: false,
		aliasPrefix: undefined,
		legacy: true,
		defaultSize: undefined,
		versionNote: "Never created by the 1280 designer; the loader converts it into a Label widget (type 4) and rewrites it on save. Keep as raw tokens; do not offer in a palette.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 5, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", min: 1, editable: false },
			{ index: 4, name: "height", kind: "int", role: "height", min: 1, editable: false },
			{ index: 5, name: "justification", kind: "enum", editable: false, values: [{ value: 1, label: "Left" }, { value: 2, label: "Right" }, { value: 3, label: "Center" }] },
			{ index: 6, name: "fontCode", kind: "enum", editable: false, values: [{ value: 1, label: "12" }, { value: 2, label: "16" }, { value: 3, label: "24" }, { value: 4, label: "51" }, { value: 5, label: "72" }, { value: 6, label: "85" }, { value: 7, label: "96" }] },
			{ index: 7, name: "alias", kind: "alias", editable: false },
			{ index: 8, name: "dataSource", kind: "int", editable: false },
			{ index: 9, name: "dataField", kind: "int", editable: false },
			{ index: 10, name: "dataSubField", kind: "int", editable: false },
			{ index: 11, name: "visible", kind: "enum", editable: false, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 12, name: "screen", kind: "screen", editable: false },
		],
	},
	{
		type: 6,
		name: "Symbol widget",
		tokenCount: 12,
		introduced: "base",
		observedInSamples: true,
		resizable: false,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "sym",
		legacy: false,
		defaultSize: {"width": 32, "height": 32},
		versionNote: "Base layout identical to v308 (12 tokens). Symbol-colour palette and 4-state value present in base.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 6, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "style", kind: "enum", role: "style", default: 1, editable: true, values: [{ value: 1, label: "Tare" }, { value: 2, label: "Standstill" }, { value: 3, label: "Center of zero" }, { value: 4, label: "Round indicator" }, { value: 5, label: "Square indicator" }, { value: 6, label: "Bell" }, { value: 7, label: "Exclamation" }, { value: 8, label: "Light bulb" }, { value: 9, label: "Divert product" }, { value: 10, label: "Over/under/in range" }, { value: 11, label: "Stoplight" }, { value: 12, label: "Left arrow" }, { value: 13, label: "Right arrow" }, { value: 14, label: "Up arrow" }, { value: 15, label: "Down arrow" }, { value: 16, label: "Speaker" }, { value: 17, label: "Serial status" }, { value: 18, label: "Truck on scale 1" }, { value: 19, label: "Truck on scale 2" }, { value: 20, label: "Weight on scale" }, { value: 21, label: "Overload" }, { value: 22, label: "Underload" }, { value: 23, label: "Stop sign" }, { value: 24, label: "Yield sign" }, { value: 25, label: "Skull and crossbones" }, { value: 26, label: "Unbalanced" }, { value: 27, label: "Runner" }, { value: 28, label: "Walker" }, { value: 29, label: "Printer" }, { value: 30, label: "Hourglass" }, { value: 31, label: "Gas pump" }, { value: 32, label: "Conveyor" }, { value: 33, label: "Batch auto/manual" }, { value: 34, label: "Valve" }, { value: 35, label: "Motor" }, { value: 36, label: "Checkmark" }, { value: 37, label: "Faucet" }, { value: 38, label: "Padlock" }, { value: 39, label: "Key" }, { value: 40, label: "Pipe" }, { value: 41, label: "Not" }, { value: 42, label: "Conveyor full" }, { value: 43, label: "Info" }, { value: 44, label: "Power" }, { value: 45, label: "Folder" }, { value: 46, label: "Recipe" }, { value: 47, label: "Report" }, { value: 48, label: "Manual mode" }] },
			{ index: 4, name: "value", kind: "enum", role: "state", default: 1, editable: true, values: [{ value: 1, label: "State 1" }, { value: 2, label: "State 2" }, { value: 3, label: "State 3" }, { value: 4, label: "State 4" }] },
			{ index: 5, name: "symbolColor", kind: "enum", role: "symbolColor", default: 13, editable: true, values: [{ value: 1, label: "Black" }, { value: 2, label: "Dark red" }, { value: 3, label: "Red" }, { value: 4, label: "Pink" }, { value: 5, label: "Teal" }, { value: 6, label: "Green" }, { value: 7, label: "Bright green" }, { value: 8, label: "Turquoise" }, { value: 9, label: "Dark blue" }, { value: 10, label: "Violet" }, { value: 11, label: "Blue" }, { value: 12, label: "Light grey" }, { value: 13, label: "Dark grey" }, { value: 14, label: "Dark yellow" }, { value: 15, label: "Yellow" }, { value: 16, label: "White" }] },
			{ index: 6, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
			{ index: 7, name: "dataSource", kind: "enum", role: "source", default: 1, editable: true, values: [{ value: 1, label: "Scale" }, { value: 2, label: "Programmability" }, { value: 3, label: "Setpoint" }, { value: 4, label: "Digital I/O" }] },
			{ index: 8, name: "dataField", kind: "int", role: "field", default: 1, min: 0, editable: true },
			{ index: 9, name: "dataSubField", kind: "int", role: "subfield", default: 1, min: 0, editable: true },
			{ index: 10, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 11, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
	{
		type: 7,
		name: "Image widget",
		tokenCount: 11,
		introduced: "base",
		observedInSamples: true,
		resizable: true,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "img",
		legacy: false,
		defaultSize: {"width": 100, "height": 100},
		versionNote: "Alias (token 10) is read by v308 and written; base build wrote no alias token.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 7, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 100, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 100, min: 1, editable: true },
			{ index: 5, name: "border", kind: "enum", role: "border", default: 1, editable: true, values: [{ value: 1, label: "None" }, { value: 2, label: "Fixed single" }] },
			{ index: 6, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 7, name: "refreshTime", kind: "int", role: "refresh", default: 0, min: 0, max: 300, editable: true },
			{ index: 8, name: "path", kind: "image", role: "path", default: "", maxLength: 255, editable: true },
			{ index: 9, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
			{ index: 10, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
		],
	},
	{
		type: 8,
		name: "Chart widget",
		tokenCount: 9,
		introduced: "v302",
		observedInSamples: false,
		resizable: true,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "cht",
		legacy: false,
		defaultSize: {"width": 100, "height": 100},
		versionNote: "Added in rev1280.v302; absent from base/v301. Screen is token 7 and alias token 8 (order differs from other types).",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 8, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 100, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 100, min: 1, editable: true },
			{ index: 5, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 6, name: "chartStyle", kind: "enum", role: "style", default: 1, min: 1, max: 2, editable: true, values: [{ value: 1, label: "Line chart" }, { value: 2, label: "Bar chart" }] },
			{ index: 7, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
			{ index: 8, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
		],
	},
	{
		type: 9,
		name: "Softkey widget",
		tokenCount: 8,
		introduced: "v303",
		observedInSamples: false,
		resizable: false,
		hasAlias: true,
		aliasPersisted: false,
		aliasPrefix: "sk",
		legacy: false,
		defaultSize: {"width": 800, "height": 70},
		versionNote: "Added in rev1280.v303. At most one softkey widget per screen (editor-enforced). Alias sk{id} is read-only in the designer and NOT persisted (regenerated on load).",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 9, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "orientation", kind: "enum", role: "orientation", default: 1, editable: true, values: [{ value: 1, label: "Horizontal" }, { value: 2, label: "Vertical" }] },
			{ index: 4, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 5, name: "color", kind: "color", role: "color", default: "#393939", editable: true },
			{ index: 6, name: "backgroundColor", kind: "color", role: "color", default: "#F0EEEE", editable: true },
			{ index: 7, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
	{
		type: 10,
		name: "Line widget",
		tokenCount: 9,
		introduced: "v303",
		observedInSamples: true,
		resizable: true,
		hasAlias: true,
		aliasPersisted: false,
		aliasPrefix: "line",
		legacy: false,
		defaultSize: {"width": 80, "height": 1},
		versionNote: "Added in rev1280.v303. Alias line{id} is read-only and NOT persisted (regenerated from the id on load), but it still appears in the generated main.iri.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 10, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 80, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 1, min: 1, editable: true },
			{ index: 5, name: "orientation", kind: "enum", role: "orientation", default: 1, editable: true, values: [{ value: 1, label: "Horizontal" }, { value: 2, label: "Vertical" }] },
			{ index: 6, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 7, name: "color", kind: "color", role: "color", default: "Black", editable: true },
			{ index: 8, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
	{
		type: 11,
		name: "Monospace label widget",
		tokenCount: 16,
		introduced: "v307",
		observedInSamples: true,
		resizable: true,
		hasAlias: true,
		aliasPersisted: true,
		aliasPrefix: "mlbl",
		legacy: false,
		defaultSize: {"width": 76, "height": 20},
		versionNote: "Added in rev1280.v307. Layout identical to type 4; default alias mlbl{id}.",
		fields: [
			{ index: 0, name: "type", kind: "int", role: "type", default: 11, editable: false },
			{ index: 1, name: "x", kind: "int", role: "x", min: 0, editable: true },
			{ index: 2, name: "y", kind: "int", role: "y", min: 0, editable: true },
			{ index: 3, name: "width", kind: "int", role: "width", default: 76, min: 1, editable: true },
			{ index: 4, name: "height", kind: "int", role: "height", default: 20, min: 1, editable: true },
			{ index: 5, name: "caption", kind: "text", role: "caption", default: "Caption", maxLength: 64, editable: true },
			{ index: 6, name: "border", kind: "enum", role: "border", default: 2, editable: true, values: [{ value: 1, label: "None" }, { value: 2, label: "Fixed single" }] },
			{ index: 7, name: "justification", kind: "enum", role: "justification", default: 1, editable: true, values: [{ value: 1, label: "Left" }, { value: 2, label: "Right" }, { value: 3, label: "Center" }] },
			{ index: 8, name: "fontSize", kind: "int", role: "font", default: 12, min: 1, editable: true },
			{ index: 9, name: "color", kind: "color", role: "color", default: "Black", editable: true },
			{ index: 10, name: "alias", kind: "alias", role: "alias", maxLength: 8, editable: true },
			{ index: 11, name: "dataSource", kind: "enum", role: "source", default: 1, editable: true, values: [{ value: 1, label: "Scale" }, { value: 2, label: "Programmability (program sets text)" }, { value: 3, label: "Setpoint" }, { value: 4, label: "Self (static caption)" }] },
			{ index: 12, name: "dataField", kind: "int", role: "field", default: 1, min: 0, editable: true },
			{ index: 13, name: "dataSubField", kind: "int", role: "subfield", default: 1, min: 0, editable: true },
			{ index: 14, name: "visible", kind: "enum", role: "visible", default: 1, editable: true, values: [{ value: 1, label: "True (visible)" }, { value: 2, label: "False (hidden)" }] },
			{ index: 15, name: "screen", kind: "screen", role: "screen", min: 1, max: 99, editable: false },
		],
	},
];

const BY_TYPE = new Map<number, WidgetTypeDef>(WIDGET_TYPES.map((t) => [t.type, t]));

/** Highest id Revolution loads (ids 1..999). */
export const WIDGET_ID_MIN = 1;
export const WIDGET_ID_MAX = 999;
/** Longest `WDGT` value (everything after `=`), in characters. */
export const WIDGET_VALUE_MAX = 255;
/** Revolution cuts aliases to 8 characters and captions to 64. */
export const ALIAS_MAX = 8;
export const CAPTION_MAX = 64;

export function widgetTypeDef(type: number): WidgetTypeDef | undefined {
	return BY_TYPE.get(type);
}

export function widgetFieldByName(type: number, name: string): WidgetField | undefined {
	return BY_TYPE.get(type)?.fields.find((f) => f.name === name);
}

export function widgetFieldAt(type: number, index: number): WidgetField | undefined {
	return BY_TYPE.get(type)?.fields.find((f) => f.index === index);
}

/** First field with the given role (`alias`, `screen`, `caption`, `path`, ...). */
export function widgetFieldByRole(type: number, role: string): WidgetField | undefined {
	return BY_TYPE.get(type)?.fields.find((f) => f.role === role);
}

/** Token indexes of the geometry. Types 1, 6 and 9 have no width/height; type 10 `height` is the thickness. */
export interface GeometryFields {
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export function geometryFields(type: number): GeometryFields | undefined {
	const t = BY_TYPE.get(type);
	if (!t) {
		return undefined;
	}
	const idx = (role: string): number | undefined => t.fields.find((f) => f.role === role)?.index;
	const g: GeometryFields = { x: 1, y: 2 };
	const w = idx("width");
	const h = idx("height");
	if (w !== undefined && h !== undefined) {
		g.width = w;
		g.height = h;
	}
	return g;
}

/** Token index of the screen number (type 8 stores it before the alias). */
export function screenIndex(type: number): number | undefined {
	return widgetFieldByRole(type, "screen")?.index;
}

/** Token index of the alias, or undefined when the line stores none. */
export function aliasIndex(type: number): number | undefined {
	const t = BY_TYPE.get(type);
	return t?.aliasPersisted ? widgetFieldByRole(type, "alias")?.index : undefined;
}

/** Revolution's default alias for a new widget (`lbl3`); undefined for types without alias. */
export function defaultAlias(type: number, id: number): string | undefined {
	const t = BY_TYPE.get(type);
	return t?.hasAlias && t.aliasPrefix ? `${t.aliasPrefix}${id}` : undefined;
}

/** Types a palette may offer: every known type except the legacy numeric widget. */
export function paletteTypes(): WidgetTypeDef[] {
	return WIDGET_TYPES.filter((t) => !t.legacy);
}

export interface NewWidgetOptions {
	id: number;
	screen: number;
	x: number;
	y: number;
}

/**
 * Tokens (strings, type code first) of a new widget with the catalog defaults, the given position and screen,
 * and the default alias. Undefined for unknown and legacy types.
 */
export function newWidgetTokens(type: number, o: NewWidgetOptions): string[] | undefined {
	const t = BY_TYPE.get(type);
	if (!t || t.legacy) {
		return undefined;
	}
	return t.fields.map((f) => {
		switch (f.role) {
			case "type":
				return String(type);
			case "x":
				return String(Math.max(0, Math.round(o.x)));
			case "y":
				return String(Math.max(0, Math.round(o.y)));
			case "screen":
				return String(o.screen);
			case "alias":
				return defaultAlias(type, o.id) ?? "";
			default:
				return f.default === undefined ? "" : String(f.default);
		}
	});
}

/**
 * Real token index of `field` (name or catalog index) in a line with the given tokens. A label caption
 * (types 4 and 11) written by another tool may contain commas, which spreads it over several tokens: the
 * caption then spans the extra ones and every later field shifts, as the reader assumes.
 */
export function tokenIndexOf(type: number, tokenCount: number, field: string | number): number | undefined {
	const t = BY_TYPE.get(type);
	if (!t) {
		return typeof field === "number" ? field : undefined;
	}
	const f = typeof field === "number" ? t.fields.find((x) => x.index === field) : t.fields.find((x) => x.name === field);
	if (!f) {
		return typeof field === "number" ? field : undefined;
	}
	const extra = (type === 4 || type === 11) && tokenCount > t.tokenCount ? tokenCount - t.tokenCount : 0;
	return f.index > 5 ? f.index + extra : f.index;
}

/** Named properties of a line: name to raw string token, by the catalog (extra tokens stay out of `props`). */
export function propsOf(type: number, tokens: readonly string[]): Record<string, string> {
	const t = BY_TYPE.get(type);
	const props: Record<string, string> = {};
	if (!t) {
		return props;
	}
	const extra = (type === 4 || type === 11) && tokens.length > t.tokenCount ? tokens.length - t.tokenCount : 0;
	for (const f of t.fields) {
		if (extra && f.index === 5) {
			props[f.name] = tokens.slice(5, 6 + extra).join(",");
			continue;
		}
		const i = f.index > 5 ? f.index + extra : f.index;
		if (i < tokens.length) {
			props[f.name] = tokens[i];
		}
	}
	return props;
}
