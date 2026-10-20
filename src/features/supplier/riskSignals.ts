import type { SupplierPortrait } from '@/features/supplier/portrait';
import { PRICE_SPIKE, RATE_TARGET } from '@/features/supplier/supplierTargets';
import { formatWan } from '@/features/supplier/scorecard';

export type RiskKind = 'overdue' | 'delay' | 'quality' | 'price';
export type RiskSource = 'rule' | 'ai';

export interface RiskSignal {
  id: string;
  kind: RiskKind;
  title: string;
  detail: string;
  action: string;
  facts: string;
}

export interface RiskNarrative {
  id: string;
  title: string;
  detail: string;
  action: string;
}

export interface DisplayRisk extends RiskSignal {
  source: RiskSource;
}

export function trailingLowMonths(
  months: Array<{ month: string; rate: number | null }>,
  target = RATE_TARGET,
): number {
  const ordered = [...months].sort((left, right) =>
    left.month.localeCompare(right.month),
  );
  let streak = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const rate = ordered[index]?.rate;
    if (rate == null || rate >= target) {
      break;
    }
    streak += 1;
  }
  return streak;
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function joinNames(names: string[]): string {
  return [...names]
    .sort((left, right) => left.localeCompare(right, 'zh'))
    .join('、');
}

export function buildRiskSignals(
  portraits: SupplierPortrait[],
  target = RATE_TARGET,
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const overdue = portraits.filter((portrait) => portrait.overdueLines > 0);
  if (overdue.length > 0) {
    const lines = overdue.reduce((sum, row) => sum + row.overdueLines, 0);
    const qty = overdue.reduce((sum, row) => sum + row.overdueQty, 0);
    const amounts = overdue.map((row) => row.overdueAmount);
    const amount = amounts.every((value) => value != null)
      ? amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null;
    const money =
      amount == null ? '' : `、未到金额约 ${formatWan(amount)} 万元`;
    const facts = `逾期 ${lines} 行、未到数量 ${qty}${money}，涉及${joinNames(overdue.map((row) => row.supplier))}`;
    signals.push({
      id: 'overdue',
      kind: 'overdue',
      title: '逾期未到',
      detail: facts,
      action:
        '优先核对交期已过仍未收货的订单，确认是催货、关闭还是取消后未同步。',
      facts,
    });
  }

  const delayed = portraits.flatMap((portrait) => {
    const streak = trailingLowMonths(portrait.monthTimeliness, target);
    if (streak < 2) {
      return [];
    }
    const recent = [...portrait.monthTimeliness]
      .sort((left, right) => left.month.localeCompare(right.month))
      .slice(-streak)
      .map((item) => (item.rate == null ? '—' : percent(item.rate)));
    return [
      `${portrait.supplier}连续${streak}个月及时率低于${percent(target)}（最近 ${recent.join('、')}）`,
    ];
  });
  if (delayed.length > 0) {
    const facts = delayed.join('；');
    signals.push({
      id: 'delay',
      kind: 'delay',
      title: '连续延误',
      detail: facts,
      action: '建议按交货条款约谈，并暂停向持续延误的供应商追加订单。',
      facts,
    });
  }

  const weakQuality = portraits.filter(
    (portrait) => portrait.quality != null && portrait.quality < target,
  );
  if (weakQuality.length > 0) {
    const facts = weakQuality
      .map((portrait) => {
        const rate = portrait.quality ?? 0;
        const gap = (target - rate) * 100;
        return `${portrait.supplier}来料合格率${percent(rate)}，低于目标${gap.toFixed(1)}个百分点`;
      })
      .join('；');
    signals.push({
      id: 'quality',
      kind: 'quality',
      title: '合格率低于目标',
      detail: facts,
      action: '要求提交整改并复检，合格率回到目标前不再扩大采购份额。',
      facts,
    });
  }

  const spikes = portraits.filter(
    (portrait) =>
      portrait.priceChange != null && portrait.priceChange >= PRICE_SPIKE,
  );
  if (spikes.length > 0) {
    const facts = spikes
      .map(
        (portrait) =>
          `${portrait.supplier}最近一期采购均价较前期上涨${((portrait.priceChange ?? 0) * 100).toFixed(1)}%`,
      )
      .join('；');
    signals.push({
      id: 'price',
      kind: 'price',
      title: '价格上涨',
      detail: facts,
      action: '与供应商复核涨价原因，并评估安全库存和替代来源。',
      facts,
    });
  }
  return signals;
}

export function parseRiskNarratives(text: string): RiskNarrative[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] ?? text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(source.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || !('items' in parsed)) {
      return [];
    }
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const record = item as Partial<RiskNarrative>;
      if (
        typeof record.id !== 'string' ||
        typeof record.title !== 'string' ||
        typeof record.detail !== 'string'
      ) {
        return [];
      }
      return [
        {
          id: record.id,
          title: record.title,
          detail: record.detail,
          action: typeof record.action === 'string' ? record.action : '',
        },
      ];
    });
  } catch {
    return [];
  }
}

export function mergeRiskNarratives(
  signals: RiskSignal[],
  narratives: RiskNarrative[],
): DisplayRisk[] {
  return signals.map((signal) => {
    const narrative = narratives.find((item) => item.id === signal.id);
    if (!narrative?.title.trim() || !narrative.detail.trim()) {
      return { ...signal, source: 'rule' };
    }
    return {
      ...signal,
      title: narrative.title.trim(),
      detail: narrative.detail.trim(),
      action: narrative.action.trim() || signal.action,
      source: 'ai',
    };
  });
}

export function riskPrompt(signals: RiskSignal[]): string {
  return signals
    .map((signal) =>
      [
        `id=${signal.id}`,
        `类型=${signal.kind}`,
        `事实=${signal.facts}`,
        `规则标题=${signal.title}`,
        `规则说明=${signal.detail}`,
        `规则动作=${signal.action}`,
      ].join('\n'),
    )
    .join('\n\n');
}

export const FREELM_SYSTEM = [
  '你是采购供应商风险助手。只根据用户给出的规则信号改写简短中文预警。',
  '只输出一个 JSON 对象，不要使用 Markdown。格式：{"items":[{"id":"信号id","title":"不超过16字","detail":"不超过80字","action":"不超过40字"}]}',
  '只能使用输入里出现的供应商和数字，禁止新增供应商、金额、笔数或比例。',
  'id 必须与输入一致，不要新增或删除条目。做不到时输出 {"items":[]}。',
].join('');
