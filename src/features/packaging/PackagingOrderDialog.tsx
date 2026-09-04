import { useRef, useState } from 'react';
import { ChevronRight, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CreatedBill } from '@/features/aftersale/types';
import {
  flattenCreatedBills,
  operatePackagingBills,
  placePackagingOrders,
} from '@/features/packaging/order';
import { parsePackagingWorkbook } from '@/features/packaging/parseExcel';
import type {
  PackagingDetail,
  PackagingGroup,
} from '@/features/packaging/types';
import { useToast } from '@/hooks/use-toast';
import { useKingdeeStore } from '@/store/useKingdeeStore';
import { cn } from '@/lib/utils';

function readExcelBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer().then((buffer) => {
    if (buffer.byteLength > 0) {
      return buffer;
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
          return;
        }
        reject(new Error('读取文件失败'));
      };
      reader.onerror = () => {
        reject(new Error('读取文件失败'));
      };
      reader.readAsArrayBuffer(file);
    });
  });
}

function GroupCheckbox({
  checked,
  indeterminate,
  onCheckedChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  indeterminate: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label': string;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 accent-zinc-900"
      checked={checked}
      ref={(element) => {
        if (element) {
          element.indeterminate = indeterminate && !checked;
        }
      }}
      onChange={(event) => onCheckedChange(event.target.checked)}
      aria-label={ariaLabel}
    />
  );
}

interface PackagingOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PackagingOrderDialog({
  open,
  onOpenChange,
}: PackagingOrderDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const orgId = useKingdeeStore((state) => state.orgId);
  const [groups, setGroups] = useState<PackagingGroup[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [createdBills, setCreatedBills] = useState<CreatedBill[]>([]);
  const [selectedBillKeys, setSelectedBillKeys] = useState<Set<string>>(
    new Set(),
  );
  const [operating, setOperating] = useState<
    'submit' | 'audit' | 'push' | null
  >(null);

  const details = groups.flatMap((group) => group.details);
  const selectedRows = details.filter((row) => selectedIds.has(row.id));
  const selectedBills = createdBills.filter((bill) =>
    selectedBillKeys.has(bill.key),
  );

  const reset = () => {
    setGroups([]);
    setExpandedIds(new Set());
    setSelectedIds(new Set());
    setSubmitting(false);
    setCreatedBills([]);
    setSelectedBillKeys(new Set());
    setOperating(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const buffer = await readExcelBuffer(file);
      const parsed = parsePackagingWorkbook(buffer);
      setGroups(parsed);
      setExpandedIds(new Set(parsed.map((group) => group.basic.id)));
      setSelectedIds(new Set());
    } catch (error) {
      toast({
        title: 'Excel 解析失败',
        description: error instanceof Error ? error.message : '请检查文件格式',
        variant: 'destructive',
      });
    }
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleGroup = (groupDetails: PackagingDetail[], checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of groupDetails) {
        if (checked) {
          next.add(row.id);
        } else {
          next.delete(row.id);
        }
      }
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleOrder = async () => {
    if (selectedRows.length === 0) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await placePackagingOrders(selectedRows, orgId);
      const created = flattenCreatedBills(result.succeeded);
      if (created.length > 0) {
        setCreatedBills((current) => [...current, ...created]);
        toast({
          title: `已生成 ${created.length} 张入库申请单`,
          description: created
            .map((item) => item.billNo)
            .filter(Boolean)
            .join('、'),
        });
      } else if (result.succeeded.length > 0) {
        toast({
          title: '下单成功',
          description: '金蝶未返回订单号，请到系统中查看',
        });
      }
      if (result.failed.length > 0) {
        toast({
          title: '部分供应商下单失败',
          description: result.failed
            .map((item) => `${item.supplier}：${item.message}`)
            .join('；'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: '下单失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBill = (key: string, checked: boolean) => {
    setSelectedBillKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const toggleAllBills = (checked: boolean) => {
    setSelectedBillKeys(
      checked ? new Set(createdBills.map((bill) => bill.key)) : new Set(),
    );
  };

  const handleBillAction = async (action: 'submit' | 'audit' | 'push') => {
    if (selectedBills.length === 0) {
      toast({ title: '请先勾选订单号' });
      return;
    }
    const labels = { submit: '提交', audit: '审核', push: '下推' };
    setOperating(action);
    try {
      const outcome = await operatePackagingBills(action, selectedBills);
      if (outcome.success) {
        toast({
          title: `${labels[action]}成功`,
          description: selectedBills
            .map((item) => item.billNo)
            .filter(Boolean)
            .join('、'),
        });
      } else {
        toast({
          title: `${labels[action]}失败`,
          description: outcome.message,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: `${labels[action]}失败`,
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setOperating(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'gap-5 p-6',
          groups.length > 0 || createdBills.length > 0
            ? 'max-w-5xl'
            : 'max-w-[520px]',
        )}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-[22px]">包材下单</DialogTitle>
          <DialogDescription>在系统中新增入库申请单</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          aria-label="上传 Excel 文件"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            void handleFile(file);
          }}
        />

        <Button
          type="button"
          className="h-10 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          上传 Excel
        </Button>

        {groups.length > 0 ? (
          <div className="max-h-[420px] overflow-y-auto pr-1">
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50 text-left text-zinc-500">
                    <th className="w-10 px-3 py-2 font-medium" />
                    <th className="w-10 px-3 py-2 font-medium" />
                    <th className="px-3 py-2 font-medium">供应商</th>
                    <th className="px-3 py-2 font-medium">采购员</th>
                    <th className="px-3 py-2 font-medium">货主</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => {
                    const expanded = expandedIds.has(group.basic.id);
                    const allChecked =
                      group.details.length > 0 &&
                      group.details.every((row) => selectedIds.has(row.id));
                    const someChecked = group.details.some((row) =>
                      selectedIds.has(row.id),
                    );
                    return (
                      <GroupRows
                        key={group.basic.id}
                        group={group}
                        expanded={expanded}
                        allChecked={allChecked}
                        someChecked={someChecked}
                        selectedIds={selectedIds}
                        onToggleExpanded={() => toggleExpanded(group.basic.id)}
                        onToggleGroup={(checked) =>
                          toggleGroup(group.details, checked)
                        }
                        onToggleRow={toggleRow}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {groups.length > 0 ? (
          <DialogFooter>
            <Button
              type="button"
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
              disabled={selectedRows.length === 0 || submitting}
              onClick={() => {
                void handleOrder();
              }}
            >
              {submitting ? '下单中...' : '下单'}
            </Button>
          </DialogFooter>
        ) : null}

        {createdBills.length > 0 ? (
          <div className="space-y-3">
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50 text-left text-zinc-500">
                    <th className="w-10 px-3 py-2 font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-zinc-900"
                        checked={
                          createdBills.length > 0 &&
                          createdBills.every((bill) =>
                            selectedBillKeys.has(bill.key),
                          )
                        }
                        onChange={(event) =>
                          toggleAllBills(event.target.checked)
                        }
                        aria-label="全选订单号"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">订单号</th>
                    <th className="px-3 py-2 font-medium">供应商</th>
                  </tr>
                </thead>
                <tbody>
                  {createdBills.map((bill) => (
                    <tr key={bill.key} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-zinc-900"
                          checked={selectedBillKeys.has(bill.key)}
                          onChange={(event) =>
                            toggleBill(bill.key, event.target.checked)
                          }
                          aria-label={`选择订单 ${bill.billNo || bill.billId}`}
                        />
                      </td>
                      <td className="px-3 py-2">{bill.billNo || '—'}</td>
                      <td className="px-3 py-2">{bill.supplier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter className="sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                disabled={selectedBills.length === 0 || operating !== null}
                onClick={() => {
                  void handleBillAction('submit');
                }}
              >
                {operating === 'submit' ? '提交中...' : '提交'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                disabled={selectedBills.length === 0 || operating !== null}
                onClick={() => {
                  void handleBillAction('audit');
                }}
              >
                {operating === 'audit' ? '审核中...' : '审核'}
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
                disabled={selectedBills.length === 0 || operating !== null}
                onClick={() => {
                  void handleBillAction('push');
                }}
              >
                {operating === 'push' ? '下推中...' : '下推'}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GroupRows({
  group,
  expanded,
  allChecked,
  someChecked,
  selectedIds,
  onToggleExpanded,
  onToggleGroup,
  onToggleRow,
}: {
  group: PackagingGroup;
  expanded: boolean;
  allChecked: boolean;
  someChecked: boolean;
  selectedIds: Set<string>;
  onToggleExpanded: () => void;
  onToggleGroup: (checked: boolean) => void;
  onToggleRow: (id: string, checked: boolean) => void;
}) {
  return (
    <>
      <tr className="border-t">
        <td className="px-2 py-2">
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? `收起货主 ${group.basic.owner} 的明细`
                : `展开货主 ${group.basic.owner} 的明细`
            }
            onClick={onToggleExpanded}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                expanded && 'rotate-90',
              )}
            />
          </button>
        </td>
        <td className="px-3 py-2">
          <GroupCheckbox
            checked={allChecked}
            indeterminate={someChecked && !allChecked}
            onCheckedChange={onToggleGroup}
            aria-label={`选择货主 ${group.basic.owner} 的全部明细`}
          />
        </td>
        <td className="px-3 py-2">{group.basic.supplier}</td>
        <td className="px-3 py-2">{group.basic.purchaser}</td>
        <td className="px-3 py-2">{group.basic.owner}</td>
      </tr>
      {expanded ? (
        <tr className="border-t bg-zinc-50/70">
          <td colSpan={5} className="p-0 pl-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="w-10 px-3 py-2 font-medium" />
                  <th className="px-3 py-2 font-medium">物料编码</th>
                  <th className="px-3 py-2 font-medium">收货仓库</th>
                  <th className="px-3 py-2 font-medium">申请数量</th>
                  <th className="px-3 py-2 font-medium">货主</th>
                  <th className="px-3 py-2 font-medium">预计入库时间</th>
                  <th className="px-3 py-2 font-medium">保管者</th>
                </tr>
              </thead>
              <tbody>
                {group.details.map((row) => (
                  <tr key={row.id} className="border-t bg-white">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-zinc-900"
                        checked={selectedIds.has(row.id)}
                        onChange={(event) =>
                          onToggleRow(row.id, event.target.checked)
                        }
                        aria-label={`选择 ${row.materialNumber}`}
                      />
                    </td>
                    <td className="px-3 py-2">{row.materialNumber}</td>
                    <td className="px-3 py-2">{row.warehouse}</td>
                    <td className="px-3 py-2">{row.qty}</td>
                    <td className="px-3 py-2">{row.owner}</td>
                    <td className="px-3 py-2">{row.expectInDate}</td>
                    <td className="px-3 py-2">{row.keeper}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
    </>
  );
}
