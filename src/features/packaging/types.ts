export interface PackagingDetail {
  id: string;
  materialNumber: string;
  warehouse: string;
  qty: number;
  owner: string;
  expectInDate: string;
  keeper: string;
  supplier: string;
  purchaser: string;
}

export interface PackagingBasic {
  id: string;
  supplier: string;
  purchaser: string;
  owner: string;
}

export interface PackagingGroup {
  basic: PackagingBasic;
  details: PackagingDetail[];
}
