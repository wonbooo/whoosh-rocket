export interface CatalogOption {
  value: string;
  label: string;
}

export interface CatalogField {
  key: string;
  name: string;
  entity: string;
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
      fields.push({
        key,
        name: text(field.Name) || key,
        entity,
        lookupFormId:
          text(field.LookUpObjectFormId) || text(field.LookUpObjectID) || null,
        options: readOptions(field, 0),
      });
    }
    for (const child of [...asNodes(node.Entrys), ...asNodes(node.Entry)]) {
      visit(child, text(child.Key) || text(child.EntityName) || entity);
    }
  };

  visit(root, '');
  return { formId, formName: text(root.Name) || formId, fields };
}
