export interface MxDataEntityTag {
  fullName: string | null;
  secuCode: string | null;
  marketChar: string | null;
  entityTypeName: string | null;
  className: string | null;
}

export interface MxDataTable {
  title: string;
  code: string | null;
  entityName: string | null;
  rows: Array<Record<string, string>>;
  fieldnames: string[];
}

export interface MxDataResult {
  status: number | null;
  message: string | null;
  questionId: string | null;
  entityTags: MxDataEntityTag[];
  conditionParts: string[];
  tables: MxDataTable[];
  totalRows: number;
}
