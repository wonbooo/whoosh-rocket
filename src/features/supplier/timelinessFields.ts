import type { CatalogField, FieldCatalog } from '@/features/analysis/catalog';

export interface PurchaseFields {
  billNo: string;
  supplier: string;
  materialName: string;
  materialNumber: string;
  qty: string;
  deliveryDate: string;
  entryId: string;
  closeStatus: string;
  mrpClose: string;
  mrpFreeze: string;
  mrpTerminate: string;
  cancelStatus: string;
  amount?: string;
  orderDate?: string;
}

export interface ArrivalBillFields {
  date: string;
  qty: string;
  billNo: string;
  entryId: string;
  materialNumber: string;
  amount?: string;
}

function isLookup(field: CatalogField): boolean {
  return field.kind === 'lookup' || Boolean(field.lookupFormId);
}

function findByName(
  catalog: FieldCatalog,
  name: string,
): CatalogField | undefined {
  return catalog.fields.find((field) => field.name === name);
}

function findByKey(
  catalog: FieldCatalog,
  key: string,
): CatalogField | undefined {
  return catalog.fields.find((field) => field.key === key);
}

function firstCaption(
  catalog: FieldCatalog,
  names: string[],
): CatalogField | undefined {
  return names
    .map((name) => findByName(catalog, name))
    .find((field) => field != null);
}

function findSupplier(catalog: FieldCatalog): CatalogField | undefined {
  const matches = catalog.fields.filter(
    (field) => isLookup(field) && field.name.includes('供应商'),
  );
  return matches.find((field) => field.name === '供应商') ?? matches[0];
}

function materialKeys(catalog: FieldCatalog): {
  materialName?: string;
  materialNumber?: string;
} {
  const numberField =
    findByName(catalog, '物料编码') ??
    findByName(catalog, '商品编码') ??
    findByName(catalog, '物料') ??
    findByName(catalog, '商品');
  if (numberField && isLookup(numberField)) {
    return {
      materialName: `${numberField.key}.FName`,
      materialNumber: `${numberField.key}.FNumber`,
    };
  }
  return {};
}

function entryQueryKey(field: CatalogField | undefined): string {
  if (!field) {
    return '';
  }
  return field.entity ? `${field.entity}_${field.key}` : field.key;
}

function lineEntity(catalog: FieldCatalog): string {
  const anchor =
    findByName(catalog, '交货日期') ??
    findByName(catalog, '采购数量') ??
    findByKey(catalog, 'FDeliveryDate') ??
    findByKey(catalog, 'FQty');
  if (anchor?.entity && anchor.entity !== 'FBillHead') {
    return anchor.entity;
  }
  const entry = catalog.fields.find(
    (field) => field.entity && field.entity !== 'FBillHead',
  );
  return entry?.entity || 'FPOOrderEntry';
}

function findEntryAmount(catalog: FieldCatalog, lineEntity: string): string {
  if (!lineEntity || lineEntity === 'FBillHead') {
    return '';
  }
  for (const name of ['价税合计', '含税金额', '金额']) {
    const field = catalog.fields.find(
      (item) => item.name === name && item.entity === lineEntity,
    );
    if (field) {
      return field.key;
    }
  }
  return '';
}

function statusKey(
  catalog: FieldCatalog,
  caption: string,
  key: string,
): string {
  return (findByName(catalog, caption) ?? findByKey(catalog, key))?.key ?? '';
}

export function resolvePurchaseFields(catalog: FieldCatalog): {
  fields: Partial<PurchaseFields>;
  missing: string[];
} {
  const billField =
    findByName(catalog, '单据编号') ?? findByKey(catalog, 'FBillNo');
  const supplierField = findSupplier(catalog);
  const material = materialKeys(catalog);
  const qtyField =
    firstCaption(catalog, ['采购数量', '订单数量']) ??
    catalog.fields.find(
      (field) => field.name === '数量' && field.kind === 'number',
    );
  const deliveryField =
    findByName(catalog, '交货日期') ?? findByKey(catalog, 'FDeliveryDate');
  const entryField =
    catalog.fields.find(
      (field) =>
        field.key === 'FEntryID' &&
        field.entity.length > 0 &&
        field.entity !== 'FBillHead',
    ) ?? findByKey(catalog, 'FEntryID');
  const entryId = entryField
    ? entryQueryKey(entryField)
    : `${lineEntity(catalog)}_FEntryID`;
  const amount = findEntryAmount(catalog, qtyField?.entity ?? '');
  const orderDate =
    findByName(catalog, '单据日期') ?? findByName(catalog, '采购日期');
  const fields: Partial<PurchaseFields> = {
    ...(billField ? { billNo: billField.key } : {}),
    ...(supplierField ? { supplier: `${supplierField.key}.FName` } : {}),
    ...(material.materialName ? { materialName: material.materialName } : {}),
    ...(material.materialNumber
      ? { materialNumber: material.materialNumber }
      : {}),
    ...(qtyField ? { qty: qtyField.key } : {}),
    ...(deliveryField ? { deliveryDate: deliveryField.key } : {}),
    ...(entryId ? { entryId } : {}),
    ...(amount ? { amount } : {}),
    ...(orderDate ? { orderDate: orderDate.key } : {}),
    closeStatus: statusKey(catalog, '关闭状态', 'FCloseStatus'),
    mrpClose: statusKey(catalog, '业务关闭', 'FMRPCloseStatus'),
    mrpFreeze: statusKey(catalog, '业务冻结', 'FMRPFreezeStatus'),
    mrpTerminate: statusKey(catalog, '业务终止', 'FMRPTerminateStatus'),
    cancelStatus: statusKey(catalog, '作废状态', 'FCancelStatus'),
  };
  if (!fields.closeStatus) {
    delete fields.closeStatus;
  }
  if (!fields.mrpClose) {
    delete fields.mrpClose;
  }
  if (!fields.mrpFreeze) {
    delete fields.mrpFreeze;
  }
  if (!fields.mrpTerminate) {
    delete fields.mrpTerminate;
  }
  if (!fields.cancelStatus) {
    delete fields.cancelStatus;
  }

  const missing = [
    fields.billNo ? '' : '单据编号',
    fields.supplier ? '' : '供应商',
    fields.materialName && fields.materialNumber ? '' : '物料',
    fields.qty ? '' : '采购数量',
    fields.deliveryDate ? '' : '交货日期',
    fields.entryId ? '' : '分录内码',
    fields.closeStatus ? '' : '关闭状态',
    fields.mrpClose ? '' : '业务关闭',
    fields.mrpFreeze ? '' : '业务冻结',
    fields.mrpTerminate ? '' : '业务终止',
  ].filter((label) => label.length > 0);

  return { fields, missing };
}

function resolveArrivalFields(
  catalog: FieldCatalog,
  dates: string[],
  quantities: string[],
  bills: string[],
): { fields: Partial<ArrivalBillFields>; missing: string[] } {
  const dateField = firstCaption(catalog, dates) ?? findByKey(catalog, 'FDate');
  const qtyField = firstCaption(catalog, quantities);
  const billField =
    firstCaption(catalog, bills) ??
    findByKey(catalog, 'FOrderBillNo') ??
    findByKey(catalog, 'FPOOrderNo');
  const entryField =
    findByName(catalog, '采购订单分录内码') ??
    findByKey(catalog, 'FPOOrderEntryId') ??
    findByKey(catalog, 'FSrcEntryId');
  const material = materialKeys(catalog);
  const amount = findEntryAmount(catalog, qtyField?.entity ?? '');
  const fields: Partial<ArrivalBillFields> = {
    ...(dateField ? { date: dateField.key } : {}),
    ...(qtyField ? { qty: qtyField.key } : {}),
    ...(billField ? { billNo: billField.key } : {}),
    ...(entryField ? { entryId: entryField.key } : {}),
    ...(material.materialNumber
      ? { materialNumber: material.materialNumber }
      : {}),
    ...(amount ? { amount } : {}),
  };
  const missing = [
    fields.date ? '' : '日期',
    fields.qty ? '' : '实收数量',
    fields.billNo ? '' : '订单单号',
    fields.entryId ? '' : '采购订单分录内码',
    fields.materialNumber ? '' : '物料',
  ].filter((label) => label.length > 0);
  return { fields, missing };
}

export function resolveReceiveFields(catalog: FieldCatalog): {
  fields: Partial<ArrivalBillFields>;
  missing: string[];
} {
  return resolveArrivalFields(
    catalog,
    ['收料日期', '单据日期'],
    ['实收数量', '交货数量', '实到数量'],
    ['订单单号', '采购订单号', '源单编号'],
  );
}

export function resolveInstockFields(catalog: FieldCatalog): {
  fields: Partial<ArrivalBillFields>;
  missing: string[];
} {
  return resolveArrivalFields(
    catalog,
    ['入库日期', '单据日期'],
    ['实收数量', '实收数'],
    ['订单单号', '采购订单号'],
  );
}
