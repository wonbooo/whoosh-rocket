import { useEffect, useMemo, useState } from 'react';
import {
  completeWithFreelm,
  freelmErrorMessage,
} from '@/features/supplier/freelm';
import { isTauriRuntime } from '@/apis/kingdee/transport';
import type { SupplierPortrait } from '@/features/supplier/portrait';
import {
  buildRiskSignals,
  FREELM_SYSTEM,
  mergeRiskNarratives,
  parseRiskNarratives,
  riskPrompt,
  type DisplayRisk,
  type RiskKind,
} from '@/features/supplier/riskSignals';

const TONE: Record<RiskKind, string> = {
  overdue:
    'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40',
  delay:
    'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  quality:
    'border-pink-200 bg-pink-50 dark:border-pink-900 dark:bg-pink-950/40',
  price:
    'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40',
};

const STRIPE: Record<RiskKind, string> = {
  overdue: 'bg-rose-500',
  delay: 'bg-amber-400',
  quality: 'bg-pink-400',
  price: 'bg-orange-500',
};

type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'unavailable'; message: string };

function messageOf(error: unknown): string {
  return freelmErrorMessage(error);
}

export function RiskPanel({
  portraits,
  ready,
  loading,
}: {
  portraits: SupplierPortrait[];
  ready: boolean;
  loading: boolean;
}) {
  const signals = useMemo(() => buildRiskSignals(portraits), [portraits]);
  const signature = signals
    .map((signal) => `${signal.id}:${signal.facts}`)
    .join('\n');
  const [aiState, setAiState] = useState<AiState>({ status: 'idle' });
  const [cards, setCards] = useState<DisplayRisk[]>([]);

  useEffect(() => {
    if (signals.length === 0) {
      setCards([]);
      setAiState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setCards(signals.map((signal) => ({ ...signal, source: 'rule' })));
    if (!isTauriRuntime()) {
      setAiState({
        status: 'unavailable',
        message: '当前不是桌面端，无法启动应用附带的 FreeLM。',
      });
      return;
    }
    setAiState({ status: 'loading' });
    void completeWithFreelm({
      system: FREELM_SYSTEM,
      user: riskPrompt(signals),
    })
      .then((text) => {
        if (cancelled) {
          return;
        }
        setCards(mergeRiskNarratives(signals, parseRiskNarratives(text)));
        setAiState({ status: 'ready' });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setCards(signals.map((signal) => ({ ...signal, source: 'rule' })));
        setAiState({ status: 'unavailable', message: messageOf(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [signature, signals]);

  const aiCount = cards.filter((card) => card.source === 'ai').length;

  return (
    <section id="supplier-risk" className="mt-8 scroll-mt-24">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">供应商风险预警</h2>
        <p className="text-xs text-zinc-500">
          规则计算数字 · FreeLM 只改写文案
        </p>
      </div>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        逾期、连续低及时率、合格率低于 90%、采购均价较前期上涨超过 8%
        都由现有单据算出。FreeLM 不可用时仍显示这些规则预警。
      </p>
      {loading ? (
        <p className="text-sm text-zinc-500">正在汇总供应商指标…</p>
      ) : !ready ? (
        <p className="text-sm text-zinc-500">
          连接金蝶后，这里根据逾期、及时率、合格率和价格变动生成预警。
        </p>
      ) : signals.length === 0 ? (
        <p className="text-sm text-zinc-500">当前没有风险信号。</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            {aiState.status === 'loading'
              ? '正在请 FreeLM 生成预警文案…'
              : aiState.status === 'unavailable'
                ? `FreeLM 不可用：${aiState.message} 以下数字和文案都来自规则计算。`
                : aiCount > 0
                  ? '标成 AI 文案的标题和说明由 FreeLM 生成；规则数据来自业务聚合，不是模型编造的。'
                  : 'FreeLM 没有返回可用文案。以下为规则计算。'}
          </p>
          {cards.map((card) => (
            <article
              key={card.id}
              className={`overflow-hidden rounded-xl border ${TONE[card.kind]}`}
            >
              <div className="flex">
                <div className={`w-1.5 shrink-0 ${STRIPE[card.kind]}`} />
                <div className="min-w-0 flex-1 px-4 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{card.title}</h3>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-300">
                      {card.source === 'ai' ? 'AI 文案' : '规则计算'}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                    {card.detail}
                  </p>
                  {card.source === 'ai' ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      规则数据：{card.facts}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {card.action}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
