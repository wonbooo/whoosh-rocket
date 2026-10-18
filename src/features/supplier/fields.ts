import type { CatalogField, FieldCatalog } from '@/features/analysis/catalog';

export interface InspectFields {
  date: string;
  supplier: string;
  materialName: string;
  materialNumber: string;
  qualified: string;
  arrival: string;
  remark: string;
}

const ARRIVAL_CAPTIONS = ['到货数量', '实收数量', '收料数量', '检验数量'];
const QUALIFIED_CAPTIONS = ['合格数量', '合格数'];

function isLookup(field: CatalogField): boolean {
  return field.kind === 'lookup' || Boolean(field.lookupFormId);
}

function findByName(
  catalog: FieldCatalog,
  name: string,
): CatalogField | undefined {
  return catalog.fields.find((field) => field.name === name);
}

function findSupplier(
  catalog: FieldCatalog,
  anchor: CatalogField | undefined,
): CatalogField | undefined {
  const matches = catalog.fields.filter(
    (field) => isLookup(field) && field.name.includes('供应商'),
  );
  if (anchor?.entity) {
    const sameEntity = matches.find((field) => field.entity === anchor.entity);
    if (sameEntity) {
      return sameEntity;
    }
  }
  return matches.find((field) => field.name === '供应商') ?? matches[0];
}

function withSuffix(field: CatalogField, suffix: 'FName' | 'FNumber'): string {
  return isLookup(field) ? `${field.key}.${suffix}` : field.key;
}

function resolveMaterial(catalog: FieldCatalog): {
  materialName?: string;
  materialNumber?: string;
} {
  const nameField =
    findByName(catalog, '物料名称') ?? findByName(catalog, '商品名称');
  const numberField =
    findByName(catalog, '物料编码') ??
    findByName(catalog, '商品编码') ??
    findByName(catalog, '商品');
  if (
    numberField &&
    isLookup(numberField) &&
    (!nameField || nameField.key === numberField.key)
  ) {
    return {
      materialName: `${numberField.key}.FName`,
      materialNumber: `${numberField.key}.FNumber`,
    };
  }
  if (nameField && numberField && nameField.key !== numberField.key) {
    return {
      materialName: withSuffix(nameField, 'FName'),
      materialNumber: withSuffix(numberField, 'FNumber'),
    };
  }

  const lookups = catalog.fields.filter(
    (field) =>
      isLookup(field) &&
      (field.name.includes('物料') || field.name.includes('商品')),
  );
  const preferred =
    lookups.find(
      (field) => field.name === '物料编码' || field.name === '物料',
    ) ?? (lookups.length === 1 ? lookups[0] : undefined);
  if (preferred) {
    return {
      materialName: `${preferred.key}.FName`,
      materialNumber: `${preferred.key}.FNumber`,
    };
  }

  return {
    ...(nameField ? { materialName: withSuffix(nameField, 'FName') } : {}),
    ...(numberField
      ? { materialNumber: withSuffix(numberField, 'FNumber') }
      : {}),
  };
}

export function resolveInspectFields(catalog: FieldCatalog): {
  fields: Partial<InspectFields>;
  missing: string[];
} {
  const dateField =
    findByName(catalog, '检验日期') ??
    findByName(catalog, '单据日期') ??
    catalog.fields.find((field) => field.key === 'FDate');
  const qualifiedField = QUALIFIED_CAPTIONS.map((name) =>
    findByName(catalog, name),
  ).find((field) => field != null);
  const arrivalField = ARRIVAL_CAPTIONS.map((name) =>
    findByName(catalog, name),
  ).find((field) => field != null);
  const supplierField = findSupplier(catalog, qualifiedField ?? arrivalField);
  const remarkField = findByName(catalog, '备注');
  const material = resolveMaterial(catalog);

  const fields: Partial<InspectFields> = {
    ...(dateField ? { date: dateField.key } : {}),
    ...(supplierField ? { supplier: `${supplierField.key}.FName` } : {}),
    ...(material.materialName ? { materialName: material.materialName } : {}),
    ...(material.materialNumber
      ? { materialNumber: material.materialNumber }
      : {}),
    ...(qualifiedField ? { qualified: qualifiedField.key } : {}),
    ...(arrivalField ? { arrival: arrivalField.key } : {}),
    ...(remarkField ? { remark: remarkField.key } : {}),
  };

  const missing = [
    fields.date ? '' : '日期',
    fields.supplier ? '' : '供应商',
    fields.materialName && fields.materialNumber ? '' : '商品',
    fields.qualified ? '' : '合格数量',
    fields.arrival ? '' : '到货数量',
    fields.remark ? '' : '备注',
  ].filter((label) => label.length > 0);

  return { fields, missing };
}
