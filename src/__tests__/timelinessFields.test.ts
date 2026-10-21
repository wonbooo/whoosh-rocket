import type { CatalogField, FieldCatalog } from '@/features/analysis/catalog';
import {
  resolveInstockFields,
  resolvePurchaseFields,
  resolveReceiveFields,
} from '@/features/supplier/timelinessFields';

function field(
  key: string,
  name: string,
  kind: CatalogField['kind'] = 'text',
  lookupFormId: string | null = null,
  entity = '',
): CatalogField {
  return { key, name, entity, kind, lookupFormId, options: [] };
}

function catalog(formId: string, fields: CatalogField[]): FieldCatalog {
  return { formId, formName: formId, fields };
}

describe('resolvePurchaseFields', () => {
  it('reads the delivery date, entry id, and close statuses from the order line', () => {
    const resolved = resolvePurchaseFields(
      catalog('PUR_PurchaseOrder', [
        field('FBillNo', '单据编号', 'text', null, 'FBillHead'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier', 'FBillHead'),
        field(
          'FMaterialId',
          '物料编码',
          'lookup',
          'BD_MATERIAL',
          'FPOOrderEntry',
        ),
        field('FQty', '采购数量', 'number', null, 'FPOOrderEntry'),
        field('FDeliveryDate', '交货日期', 'date', null, 'FPOOrderEntry'),
        field('FEntryID', '分录内码', 'text', null, 'FPOOrderEntry'),
        field('FCloseStatus', '关闭状态', 'enum', null, 'FBillHead'),
        field('FMRPCloseStatus', '业务关闭', 'enum', null, 'FPOOrderEntry'),
        field('FMRPFreezeStatus', '业务冻结', 'enum', null, 'FPOOrderEntry'),
        field('FMRPTerminateStatus', '业务终止', 'enum', null, 'FPOOrderEntry'),
        field('FCancelStatus', '作废状态', 'enum', null, 'FBillHead'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields).toMatchObject({
      billNo: 'FBillNo',
      supplier: 'FSupplierId.FName',
      materialName: 'FMaterialId.FName',
      materialNumber: 'FMaterialId.FNumber',
      qty: 'FQty',
      deliveryDate: 'FDeliveryDate',
      entryId: 'FPOOrderEntry_FEntryID',
      closeStatus: 'FCloseStatus',
      mrpClose: 'FMRPCloseStatus',
      mrpFreeze: 'FMRPFreezeStatus',
      mrpTerminate: 'FMRPTerminateStatus',
      cancelStatus: 'FCancelStatus',
    });
  });

  it('uses the order line entity when metadata omits the entry id', () => {
    const resolved = resolvePurchaseFields(
      catalog('PUR_PurchaseOrder', [
        field('FBillNo', '单据编号', 'text', null, 'FBillHead'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier', 'FBillHead'),
        field(
          'FMaterialId',
          '物料编码',
          'lookup',
          'BD_MATERIAL',
          'FPOOrderEntry',
        ),
        field('FQty', '采购数量', 'number', null, 'FPOOrderEntry'),
        field('FDeliveryDate', '交货日期', 'date', null, 'FPOOrderEntry'),
        field('FCloseStatus', '关闭状态', 'enum', null, 'FBillHead'),
        field('FMRPCloseStatus', '业务关闭', 'enum', null, 'FPOOrderEntry'),
        field('FMRPFreezeStatus', '业务冻结', 'enum', null, 'FPOOrderEntry'),
        field('FMRPTerminateStatus', '业务终止', 'enum', null, 'FPOOrderEntry'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields.entryId).toBe('FPOOrderEntry_FEntryID');
  });

  it('reads the line amount and document date without using the bill total', () => {
    const resolved = resolvePurchaseFields(
      catalog('PUR_PurchaseOrder', [
        field('FBillNo', '单据编号', 'text', null, 'FBillHead'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier', 'FBillHead'),
        field(
          'FMaterialId',
          '物料编码',
          'lookup',
          'BD_MATERIAL',
          'FPOOrderEntry',
        ),
        field('FQty', '采购数量', 'number', null, 'FPOOrderEntry'),
        field('FDeliveryDate', '交货日期', 'date', null, 'FPOOrderEntry'),
        field('FDate', '单据日期', 'date', null, 'FBillHead'),
        field('FBillAllAmount', '价税合计', 'number', null, 'FBillHead'),
        field('FAllAmount', '价税合计', 'number', null, 'FPOOrderEntry'),
        field('FCloseStatus', '关闭状态', 'enum', null, 'FBillHead'),
        field('FMRPCloseStatus', '业务关闭', 'enum', null, 'FPOOrderEntry'),
        field('FMRPFreezeStatus', '业务冻结', 'enum', null, 'FPOOrderEntry'),
        field('FMRPTerminateStatus', '业务终止', 'enum', null, 'FPOOrderEntry'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields.amount).toBe('FAllAmount');
    expect(resolved.fields.orderDate).toBe('FDate');
    expect(resolved.fields.receivedQty).toBe('FReceiveQty');
  });
});

describe('resolveReceiveFields', () => {
  it('links a receive bill to the purchase order entry', () => {
    const resolved = resolveReceiveFields(
      catalog('PUR_ReceiveBill', [
        field('FDate', '收料日期', 'date'),
        field('FActReceiveQty', '实收数量', 'number'),
        field('FOrderBillNo', '订单单号'),
        field('FPOOrderEntryId', '采购订单分录内码'),
        field('FMaterialId', '物料编码', 'lookup', 'BD_MATERIAL'),
        field('FSrcBillNo', '源单编号'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields).toMatchObject({
      date: 'FDate',
      qty: 'FActReceiveQty',
      billNo: 'FOrderBillNo',
      entryId: 'FPOOrderEntryId',
      materialNumber: 'FMaterialId.FNumber',
      orderEntryId: 'FPOORDERENTRYID',
    });
  });
});

describe('resolveInstockFields', () => {
  it('links a stock-in bill to the purchase order entry', () => {
    const resolved = resolveInstockFields(
      catalog('STK_InStock', [
        field('FDate', '入库日期', 'date'),
        field('FRealQty', '实收数量', 'number', null, 'FInStockEntry'),
        field('FPOOrderNo', '订单单号'),
        field('FPOOrderEntryId', '采购订单分录内码'),
        field(
          'FMaterialId',
          '物料编码',
          'lookup',
          'BD_MATERIAL',
          'FInStockEntry',
        ),
        field('FAllAmount', '价税合计', 'number', null, 'FInStockEntry'),
        field('FAmount', '金额', 'number', null, 'FBillHead'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields.amount).toBe('FAllAmount');
    expect(resolved.fields).toMatchObject({
      date: 'FDate',
      qty: 'FRealQty',
      billNo: 'FPOOrderNo',
      entryId: 'FPOOrderEntryId',
      materialNumber: 'FMaterialId.FNumber',
      orderEntryId: 'FPOORDERENTRYID',
    });
  });
});
