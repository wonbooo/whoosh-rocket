import { useState } from 'react';
import { Briefcase, FileText, Plus } from 'lucide-react';
import { AftersaleOrderDialog } from '@/features/aftersale/AftersaleOrderDialog';
import { PackagingOrderDialog } from '@/features/packaging/PackagingOrderDialog';
import { SubcontractOrderDialog } from '@/features/subcontract/SubcontractOrderDialog';
import { useToast } from '@/hooks/use-toast';
import { useKingdeeStore } from '@/store/useKingdeeStore';
import { cn } from '@/lib/utils';

const orderTypes = [
  {
    id: 'subcontract',
    title: '委外下单',
    formLabel: '委外订单',
    icon: FileText,
    iconClass: 'bg-blue-50 text-blue-600',
  },
  {
    id: 'packaging',
    title: '包材下单',
    formLabel: '入库申请单',
    icon: Briefcase,
    iconClass: 'bg-emerald-50 text-emerald-600',
  },
  {
    id: 'aftersale',
    title: '售后包材下单',
    formLabel: '采购申请单',
    icon: Plus,
    iconClass: 'bg-orange-50 text-orange-500',
  },
] as const;

export default function Home() {
  const sessionId = useKingdeeStore((state) => state.sessionId);
  const { toast } = useToast();
  const [aftersaleOpen, setAftersaleOpen] = useState(false);
  const [packagingOpen, setPackagingOpen] = useState(false);
  const [subcontractOpen, setSubcontractOpen] = useState(false);

  const handleSelect = (item: (typeof orderTypes)[number]) => {
    if (!sessionId) {
      toast({
        title: '请先连接金蝶',
        description: '点击右上角「连接金蝶」完成登录后再下单',
      });
      return;
    }
    if (item.id === 'aftersale') {
      setAftersaleOpen(true);
      return;
    }
    if (item.id === 'subcontract') {
      setSubcontractOpen(true);
      return;
    }
    if (item.id === 'packaging') {
      setPackagingOpen(true);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-6 flex items-center gap-2 text-lg font-medium">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          1
        </span>
        选择下单类型
      </h1>
      <div className="grid gap-4 md:grid-cols-3">
        {orderTypes.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className={cn(
                'rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md',
              )}
            >
              <div
                className={cn(
                  'mb-4 flex h-10 w-10 items-center justify-center rounded-lg',
                  item.iconClass,
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="text-base font-semibold">{item.title}</div>
              <p className="mt-1 text-sm text-zinc-500">
                在系统中新增
                <span className="text-blue-600">{item.formLabel}</span>
              </p>
            </button>
          );
        })}
      </div>
      <AftersaleOrderDialog
        open={aftersaleOpen}
        onOpenChange={setAftersaleOpen}
      />
      <PackagingOrderDialog
        open={packagingOpen}
        onOpenChange={setPackagingOpen}
      />
      <SubcontractOrderDialog
        open={subcontractOpen}
        onOpenChange={setSubcontractOpen}
      />
    </div>
  );
}
