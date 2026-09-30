export interface CatalogField {
  key: string;
  name: string;
  entity: string;
  /** 基础资料字段引用的表单，有值时字段本身存的是内码，需要带出名称或编码。 */
  lookupFormId: string | null;
}

export interface FieldCatalog {
  formId: string;
  formName: string;
  fields: CatalogField[];
}

interface RawNode {
  Key?: unknown;
  Name?: unknown;
  EntityName?: unknown;
  ElementType?: unknown;
  FieldType?: unknown;
  LookUpObjectFormId?: unknown;
  LookUpObjectID?: unknown;
  Entrys?: unknown;
  Entry?: unknown;
  Fields?: unknown;
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
      });
    }
    for (const child of [...asNodes(node.Entrys), ...asNodes(node.Entry)]) {
      visit(child, text(child.Key) || text(child.EntityName) || entity);
    }
  };

  visit(root, '');
  return { formId, formName: text(root.Name) || formId, fields };
}
