export interface AftersaleRow {
  id: string;
  materialNumber: string;
  qty: number;
  arrivalDate: string;
  supplier: string;
  purchaser: string;
  warehouse: string;
}

export interface AftersaleSupplierGroup {
  supplier: string;
  rows: AftersaleRow[];
}

export interface CreatedBill {
  key: string;
  billNo: string;
  billId: string;
  supplier: string;
}
