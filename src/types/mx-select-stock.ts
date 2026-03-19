export interface MxSelectStockColumn {
  title: string;
  key: string;
  dateMsg: string | null;
  sortable: boolean;
  sortWay: string | null;
  redGreenAble: boolean;
  unit: string | null;
  dataType: string | null;
}

export interface MxSelectStockCondition {
  describe: string;
  stockCount: number | null;
}

export interface MxSelectStockResult {
  status: number | null;
  message: string | null;
  code: string | null;
  msg: string | null;
  resultType: number | null;
  total: number;
  totalRecordCount: number;
  parserText: string | null;
  columns: MxSelectStockColumn[];
  dataList: Array<Record<string, unknown>>;
  responseConditionList: MxSelectStockCondition[];
  totalCondition: MxSelectStockCondition | null;
}
