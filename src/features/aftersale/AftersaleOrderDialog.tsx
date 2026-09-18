import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  groupAftersaleBySupplier,
  parseAftersaleWorkbook,
} from '@/features/aftersale/parseExcel';
import {
  flattenCreatedBills,
  operateAftersaleBills,
  placeAftersaleOrders,
} from '@/features/aftersale/requisition';
import type { AftersaleRow, CreatedBill } from '@/features/aftersale/types';
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

interface AftersaleOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AftersaleOrderDialog({
  open,
  onOpenChange,
}: AftersaleOrderDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const orgId = useKingdeeStore((state) => state.orgId);
  const [rows, setRows] = useState<AftersaleRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [createdBills, setCreatedBills] = useState<CreatedBill[]>([]);
  const [selectedBillKeys, setSelectedBillKeys] = useState<Set<string>>(
    new Set(),
  );
  const [operating, setOperating] = useState<'submit' | 'audit' | null>(null);

  const groups = groupAftersaleBySupplier(rows);
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const selectedBills = createdBills.filter((bill) =>
    selectedBillKeys.has(bill.key),
  );

  const reset = () => {
    setRows([]);
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
      const parsed = parseAftersaleWorkbook(buffer);
      setRows(parsed);
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

  const toggleGroup = (groupRows: AftersaleRow[], checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of groupRows) {
        if (checked) {
          next.add(row.id);
        } else {
          next.delete(row.id);
        }
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
      const result = await placeAftersaleOrders(selectedRows, orgId);
      const created = flattenCreatedBills(result.succeeded);
      if (created.length > 0) {
        setCreatedBills((current) => [...current, ...created]);
        toast({
          title: `已生成 ${created.length} 张采购申请单`,
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

  const handleBillAction = async (action: 'submit' | 'audit') => {
    if (selectedBills.length === 0) {
      toast({ title: '请先勾选订单号' });
      return;
    }
    const labels = { submit: '提交', audit: '审核' };
    setOperating(action);
    try {
      const outcome = await operateAftersaleBills(action, selectedBills);
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
          'flex max-h-[90vh] flex-col gap-5 overflow-hidden p-6',
          rows.length > 0 || createdBills.length > 0
            ? 'max-w-3xl'
            : 'max-w-[520px]',
        )}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-[22px]">售后包材下单</DialogTitle>
          <DialogDescription>在系统中新增采购申请单</DialogDescription>
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
          className="h-10 shrink-0 rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          上传 Excel
        </Button>

        {groups.length > 0 ? (
          <div className="min-h-0 max-h-[420px] space-y-4 overflow-y-auto pr-1">
            {groups.map((group) => {
              const allChecked = group.rows.every((row) =>
                selectedIds.has(row.id),
              );
              return (
                <section key={group.supplier} className="rounded-lg border">
                  <label className="flex cursor-pointer items-center gap-2 border-b bg-zinc-50 px-3 py-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-zinc-900"
                      checked={allChecked}
                      onChange={(event) =>
                        toggleGroup(group.rows, event.target.checked)
                      }
                      aria-label={`选择供应商 ${group.supplier}`}
                    />
                    供应商 {group.supplier}
                    <span className="font-normal text-zinc-500">
                      {group.rows.length} 行
                    </span>
                  </label>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="w-10 px-3 py-2 font-medium" />
                        <th className="px-3 py-2 font-medium">物料编码</th>
                        <th className="px-3 py-2 font-medium">申请数量</th>
                        <th className="px-3 py-2 font-medium">到货日期</th>
                        <th className="px-3 py-2 font-medium">采购员</th>
                        <th className="px-3 py-2 font-medium">仓库</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={row.id} className="border-t">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-zinc-900"
                              checked={selectedIds.has(row.id)}
                              onChange={(event) =>
                                toggleRow(row.id, event.target.checked)
                              }
                              aria-label={`选择 ${row.materialNumber}`}
                            />
                          </td>
                          <td className="px-3 py-2">{row.materialNumber}</td>
                          <td className="px-3 py-2">{row.qty}</td>
                          <td className="px-3 py-2">{row.arrivalDate}</td>
                          <td className="px-3 py-2">{row.purchaser}</td>
                          <td className="px-3 py-2">{row.warehouse}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <DialogFooter className="shrink-0">
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
          <div className="flex min-h-0 flex-col space-y-3">
            <div className="min-h-0 max-h-[240px] overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="sticky top-0 z-10 border-b bg-zinc-50 text-left text-zinc-500">
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
            <DialogFooter className="shrink-0 sm:justify-end">
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
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
