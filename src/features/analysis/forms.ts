export interface FormOption {
  id: string;
  name: string;
}

export const FORM_OPTIONS: FormOption[] = [
  { id: 'SAL_SaleOrder', name: '销售订单' },
  { id: 'SAL_OUTSTOCK', name: '销售出库单' },
  { id: 'SAL_RETURNSTOCK', name: '销售退货单' },
  { id: 'PUR_PurchaseOrder', name: '采购订单' },
  { id: 'PUR_Requisition', name: '采购申请单' },
  { id: 'PUR_ReceiveBill', name: '收料通知单' },
  { id: 'STK_InStock', name: '采购入库单' },
  { id: 'PUR_MRB', name: '采购退料单' },
  { id: 'STK_Inventory', name: '即时库存' },
  { id: 'STK_MisDelivery', name: '其他出库单' },
  { id: 'STK_MISCELLANEOUS', name: '其他入库单' },
  { id: 'PRD_MO', name: '生产订单' },
  { id: 'SUB_SUBREQORDER', name: '委外订单' },
  { id: 'AR_receivable', name: '应收单' },
  { id: 'AR_RECEIVEBILL', name: '收款单' },
  { id: 'AP_Payable', name: '应付单' },
  { id: 'AP_PAYBILL', name: '付款单' },
  { id: 'GL_VOUCHER', name: '凭证' },
  { id: 'BD_MATERIAL', name: '物料' },
  { id: 'BD_Customer', name: '客户' },
  { id: 'BD_Supplier', name: '供应商' },
  { id: 'BD_STOCK', name: '仓库' },
  { id: 'BD_Department', name: '部门' },
  { id: 'BD_Empinfo', name: '员工' },
];

export function formLabel(option: FormOption): string {
  return `${option.name}（${option.id}）`;
}

export function filterFormOptions(
  options: FormOption[],
  query: string,
): FormOption[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return options;
  }
  return options.filter(
    (option) =>
      option.name.toLowerCase().includes(keyword) ||
      option.id.toLowerCase().includes(keyword),
  );
}
