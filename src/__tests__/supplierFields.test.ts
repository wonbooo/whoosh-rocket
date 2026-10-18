import type { CatalogField, FieldCatalog } from '@/features/analysis/catalog';
import { resolveInspectFields } from '@/features/supplier/fields';

function field(
  key: string,
  name: string,
  kind: CatalogField['kind'] = 'text',
  lookupFormId: string | null = null,
  entity = '',
): CatalogField {
  return {
    key,
    name,
    entity,
    kind,
    lookupFormId,
    options: [],
  };
}

function catalog(fields: CatalogField[]): FieldCatalog {
  return { formId: 'QM_InspectBill', formName: '检验单', fields };
}

describe('resolveInspectFields', () => {
  it('prefers the specified captions and lookup suffixes', () => {
    const resolved = resolveInspectFields(
      catalog([
        field('FDate', '单据日期', 'date'),
        field('FInspectDate', '检验日期', 'date'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier'),
        field('FNote', '备注'),
        field('FReceiveQty', '实收数量', 'number'),
        field('FQualifiedQty', '合格数量', 'number'),
        field('FArrivalQty', '到货数量', 'number'),
        field('FMaterialName', '物料名称', 'lookup', 'BD_MATERIAL'),
        field('FMaterialId', '物料编码', 'lookup', 'BD_MATERIAL'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields).toEqual({
      date: 'FInspectDate',
      supplier: 'FSupplierId.FName',
      materialName: 'FMaterialName.FName',
      materialNumber: 'FMaterialId.FNumber',
      qualified: 'FQualifiedQty',
      arrival: 'FArrivalQty',
      remark: 'FNote',
    });
  });

  it('falls back through date and arrival captions, and uses one material lookup for both name and number', () => {
    const resolved = resolveInspectFields(
      catalog([
        field('FBillDate', '单据日期', 'date'),
        field('FVendorId', '结算供应商', 'lookup', 'BD_Supplier'),
        field('FVendorName', '供应商', 'text'),
        field('FMaterialId', '物料', 'lookup', 'BD_MATERIAL'),
        field('FPassQty', '合格数量', 'number'),
        field('FRealQty', '实收数量', 'number'),
        field('FReceiveQty', '收料数量', 'number'),
        field('FInspectQty', '检验数量', 'number'),
        field('FDescription', '备注'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields).toEqual({
      date: 'FBillDate',
      supplier: 'FVendorId.FName',
      materialName: 'FMaterialId.FName',
      materialNumber: 'FMaterialId.FNumber',
      qualified: 'FPassQty',
      arrival: 'FRealQty',
      remark: 'FDescription',
    });
  });

  it('uses FDate, then 收料数量, then 检验数量 when earlier captions are absent', () => {
    const byReceive = resolveInspectFields(
      catalog([
        field('FDate', '日期', 'date'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier'),
        field('FMaterialId', '物料编码', 'lookup', 'BD_MATERIAL'),
        field('FQualifiedQty', '合格数量', 'number'),
        field('FReceiveQty', '收料数量', 'number'),
        field('FInspectQty', '检验数量', 'number'),
        field('FNote', '备注'),
      ]),
    );
    expect(byReceive.fields.date).toBe('FDate');
    expect(byReceive.fields.arrival).toBe('FReceiveQty');
    expect(byReceive.fields.materialName).toBe('FMaterialId.FName');
    expect(byReceive.fields.materialNumber).toBe('FMaterialId.FNumber');

    const byInspect = resolveInspectFields(
      catalog([
        field('FDate', '业务日期', 'date'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier'),
        field('FMaterialId', '物料', 'lookup', 'BD_MATERIAL'),
        field('FQualifiedQty', '合格数量', 'number'),
        field('FInspectQty', '检验数量', 'number'),
        field('FNote', '备注'),
      ]),
    );
    expect(byInspect.fields.date).toBe('FDate');
    expect(byInspect.fields.arrival).toBe('FInspectQty');
  });

  it('reads the standard inspect bill captions 合格数 and 物料编码', () => {
    const resolved = resolveInspectFields(
      catalog([
        field('FDate', '单据日期', 'date'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier'),
        field('FMaterialId', '物料编码', 'lookup', 'BD_MATERIAL'),
        field('FPolicyMaterialId', '物料', 'lookup', 'BD_MATERIAL'),
        field('FInspectQty', '检验数量', 'number'),
        field('FQualifiedQty', '合格数', 'number'),
        field('FBaseQualifiedQty', '基本单位合格数', 'number'),
        field('FUnqualifiedQty', '不合格数', 'number'),
        field('FNote', '备注'),
      ]),
    );

    expect(resolved.missing).toEqual([]);
    expect(resolved.fields).toEqual({
      date: 'FDate',
      supplier: 'FSupplierId.FName',
      materialName: 'FMaterialId.FName',
      materialNumber: 'FMaterialId.FNumber',
      qualified: 'FQualifiedQty',
      arrival: 'FInspectQty',
      remark: 'FNote',
    });
  });

  it('uses the supplier on the same entry as the qualified quantity', () => {
    const resolved = resolveInspectFields(
      catalog([
        field('FDate', '单据日期', 'date'),
        field('FHeadSupplier', '供应商', 'lookup', 'BD_Supplier', 'FBillHead'),
        field('FQualifiedQty', '合格数', 'number', null, 'FEntity'),
        field('FSupplierId', '供应商', 'lookup', 'BD_Supplier', 'FEntity'),
        field('FMaterialId', '物料编码', 'lookup', 'BD_MATERIAL', 'FEntity'),
        field('FInspectQty', '检验数量', 'number', null, 'FEntity'),
        field('FNote', '备注', 'text', null, 'FEntity'),
      ]),
    );

    expect(resolved.fields.supplier).toBe('FSupplierId.FName');
  });

  it('lists every Chinese label it could not resolve and does not guess other keys', () => {
    const resolved = resolveInspectFields(
      catalog([
        field('F_QAQY_Date', '检验日期说明', 'date'),
        field('FSupplierName', '供应商', 'text'),
        field('F_QAQY_Qty', '合格数量合计', 'number'),
        field('F_QAQY_Note', '备注说明'),
      ]),
    );

    expect(resolved.missing).toEqual([
      '日期',
      '供应商',
      '商品',
      '合格数量',
      '到货数量',
      '备注',
    ]);
    expect(resolved.fields).toEqual({});
  });
});
