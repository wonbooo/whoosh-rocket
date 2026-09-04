export interface SubcontractRow {
  id: string;
  materialName: string;
  materialNumber: string;
  qty: number;
  planFinishDate: string;
  supplier: string;
  purchaser: string;
  warehouse: string;
}

export interface SubcontractSupplierGroup {
  supplier: string;
  rows: SubcontractRow[];
}
