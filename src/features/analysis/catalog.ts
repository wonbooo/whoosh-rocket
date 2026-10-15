import { knownOptions } from '@/features/analysis/enums';

export interface CatalogOption {
  value: string;
  label: string;
}

export type FieldKind = 'date' | 'lookup' | 'enum' | 'number' | 'text';

export interface CatalogField {
  key: string;
  name: string;
  entity: string;
  kind: FieldKind;
  /** 基础资料字段引用的表单，有值时字段本身存的是内码，需要带出名称或编码。 */
  lookupFormId: string | null;
  /** 下拉、枚举字段的可选项，来自元数据；查询时按 value 比较。 */
  options: CatalogOption[];
}

export interface FieldCatalog {
  formId: string;
  formName: string;
  fields: CatalogField[];
}

interface RawNode {
  Key?: unknown;
  Name?: unknown;
  Caption?: unknown;
  Value?: unknown;
  Seq?: unknown;
  EntityName?: unknown;
  ElementType?: unknown;
  FieldType?: unknown;
  LookUpObjectFormId?: unknown;
  LookUpObjectID?: unknown;
  EnumObject?: unknown;
  Extends?: unknown;
  Items?: unknown;
  Item?: unknown;
  Entrys?: unknown;
  Entry?: unknown;
  Fields?: unknown;
  [key: string]: unknown;
}

function asNodes(value: unknown): RawNode[] {
  return Array.isArray(value) ? (value as RawNode[]) : [];
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const localized = value.find(
      (item) => item && typeof item === 'object' && 'Value' in item,
    ) as { Value?: unknown } | undefined;
    return typeof localized?.Value === 'string' ? localized.Value.trim() : '';
  }
  return '';
}

function unwrap(payload: unknown): RawNode {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const result = record.Result;
  if (result && typeof result === 'object') {
    const inner = result as Record<string, unknown>;
    const returned = inner.NeedReturnData ?? inner.Result;
    if (returned && typeof returned === 'object') {
      return returned as RawNode;
    }
    return inner as RawNode;
  }
  return record as RawNode;
}

function asRecord(value: unknown): RawNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawNode)
    : null;
}

const OPTION_KEYS = [
  'EnumObject',
  'Extends',
  'Items',
  'Item',
  'EnumItems',
  'ComboItems',
  'Options',
  'DropDownItems',
];

function readOptions(node: unknown, depth: number): CatalogOption[] {
  if (depth > 4 || node == null) {
    return [];
  }
  if (Array.isArray(node)) {
    const direct = node
      .map((item) => asRecord(item))
      .filter((item): item is RawNode => item != null)
      .map(optionOf)
      .filter((item): item is CatalogOption => item != null);
    if (direct.length >= 2) {
      return direct;
    }
    return node.flatMap((item) => readOptions(item, depth + 1));
  }
  const record = asRecord(node);
  if (!record) {
    return [];
  }
  return OPTION_KEYS.flatMap((key) => readOptions(record[key], depth + 1));
}

const DATE_FIELD_TYPES = new Set([40, 58, 61]);
const NUMBER_FIELD_TYPES = new Set([56, 127, 52, 48, 106, 60, 62, 104, 108]);

function mentionsDate(value: string): boolean {
  return value.includes('日期') || value.toLowerCase().includes('date');
}

/** 元数据没有 FieldType 时返回 undefined；有值但无法解析时返回 NaN。 */
function numericFieldType(value: unknown): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

export function fieldKind(input: {
  key: string;
  name: string;
  lookupFormId: string | null;
  options: CatalogOption[];
  fieldType: number | undefined;
}): FieldKind {
  if (input.lookupFormId) {
    return 'lookup';
  }
  if (input.options.length > 0) {
    return 'enum';
  }
  if (input.fieldType == null || Number.isNaN(input.fieldType)) {
    if (
      input.fieldType == null &&
      (mentionsDate(input.key) || mentionsDate(input.name))
    ) {
      return 'date';
    }
    return 'text';
  }
  if (DATE_FIELD_TYPES.has(input.fieldType)) {
    return 'date';
  }
  if (NUMBER_FIELD_TYPES.has(input.fieldType)) {
    return 'number';
  }
  return 'text';
}

/** 界面上的类型：元数据选项或已知状态枚举都视为枚举。 */
export function controlKind(
  catalog: FieldCatalog | null,
  field: string,
): FieldKind {
  const key = field.trim();
  const match = catalog?.fields.find((item) => item.key === key);
  if (match?.lookupFormId) {
    return 'lookup';
  }
  if ((match?.options.length ?? 0) > 0 || knownOptions(key).length > 0) {
    return 'enum';
  }
  if (match) {
    return match.kind;
  }
  if (mentionsDate(key)) {
    return 'date';
  }
  return 'text';
}

function optionOf(node: RawNode): CatalogOption | null {
  const value = text(node.Value) || text(node.Key);
  const label = text(node.Caption) || text(node.Name);
  if (!value || !label || value === label) {
    return null;
  }
  return { value, label };
}

export function parseCatalog(formId: string, payload: unknown): FieldCatalog {
  const root = unwrap(payload);
  const fields: CatalogField[] = [];
  const seen = new Set<string>();

  const visit = (node: RawNode, entity: string) => {
    for (const field of asNodes(node.Fields)) {
      const key = text(field.Key);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const name = text(field.Name) || key;
      const lookupFormId =
        text(field.LookUpObjectFormId) || text(field.LookUpObjectID) || null;
      const options = readOptions(field, 0);
      fields.push({
        key,
        name,
        entity,
        lookupFormId,
        options,
        kind: fieldKind({
          key,
          name,
          lookupFormId,
          options,
          fieldType: numericFieldType(field.FieldType),
        }),
      });
    }
    for (const child of [...asNodes(node.Entrys), ...asNodes(node.Entry)]) {
      visit(child, text(child.Key) || text(child.EntityName) || entity);
    }
  };

  visit(root, '');
  return { formId, formName: text(root.Name) || formId, fields };
}

const KIND_RANK: Record<FieldKind, number> = {
  text: 0,
  number: 1,
  date: 2,
  enum: 3,
  lookup: 4,
};

function mergedName(current: string, incoming: string, key: string): string {
  if (current && current !== key) {
    return current;
  }
  return incoming || current || key;
}

/** 按字段标识合并多张表单的目录。同名标识只留一项，类型取更具体的那种。 */
export function mergeCatalogs(catalogs: FieldCatalog[]): FieldCatalog {
  const fields = new Map<string, CatalogField>();
  for (const catalog of catalogs) {
    for (const field of catalog.fields) {
      const existing = fields.get(field.key);
      if (!existing) {
        fields.set(field.key, { ...field, options: [...field.options] });
        continue;
      }
      const options = [...existing.options];
      for (const option of field.options) {
        if (!options.some((item) => item.value === option.value)) {
          options.push(option);
        }
      }
      fields.set(field.key, {
        key: field.key,
        name: mergedName(existing.name, field.name, field.key),
        entity: existing.entity || field.entity,
        kind:
          KIND_RANK[field.kind] > KIND_RANK[existing.kind]
            ? field.kind
            : existing.kind,
        lookupFormId: existing.lookupFormId || field.lookupFormId,
        options,
      });
    }
  }
  return {
    formId: catalogs
      .map((catalog) => catalog.formId)
      .filter(Boolean)
      .join(','),
    formName: '',
    fields: [...fields.values()],
  };
}
