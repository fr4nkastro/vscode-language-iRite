// Designer limits, not verified firmware limits. [IL] rev1280.v308.dll:
// Database.DatabaseConfigForm.addButton_Click, Database.Database.AddTable,
// Database.DatabaseConfigForm.InitializeComponent and Database.EditFieldForm.ValidateUi.
export const MAX_TABLES = 128;
export const MAX_FIELDS = 100;
export const MAX_RECORDS = 2_000_000;
export const MAX_STRING_SIZE = 255;
// [REA] Database.Database.MAX_DATABASE_MEMORY_BYTES; [IL] DatabaseSchemaControl.LoadData
// uses it for row coloring, not a proven save rejection or device limit.
export const DESIGNER_BYTES_THRESHOLD = 460_000_000;

// Designer table/field name length. [IL] Revolution Support.VerifyIriteAliasString (shared validator uses this).
export const MAX_NAME_LENGTH = 8;
