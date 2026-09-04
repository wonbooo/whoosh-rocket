import { useState } from 'react';
import { issueLicense } from '@/features/license/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

export function IssueLicenseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [machineId, setMachineId] = useState('');
  const [licenseText, setLicenseText] = useState('');
  const [issuing, setIssuing] = useState(false);

  const reset = () => {
    setPassword('');
    setMachineId('');
    setLicenseText('');
    setIssuing(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const handleIssue = async () => {
    setIssuing(true);
    try {
      const text = await issueLicense(password, machineId);
      setLicenseText(text);
      toast({
        title: '已生成授权',
        description: '有效期 3 个月，请发给对应机器导入',
      });
    } catch (error) {
      toast({
        title: '签发失败',
        description: error instanceof Error ? error.message : '签发口令不正确',
        variant: 'destructive',
      });
    } finally {
      setIssuing(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(licenseText);
    toast({ title: '已复制授权文本' });
  };

  const handleDownload = () => {
    const blob = new Blob([licenseText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'whoosh.lic';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>签发授权</DialogTitle>
          <DialogDescription>
            填写对方机器码，生成绑定该机器、自签发日起 3 个月有效的 license。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            签发口令
            <Input
              className="mt-1"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            对方机器码
            <Input
              className="mt-1"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              placeholder="由使用方在授权页复制"
            />
          </label>
          {licenseText ? (
            <label className="block text-sm font-medium">
              License
              <textarea
                className="mt-1 h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                readOnly
                value={licenseText}
              />
            </label>
          ) : null}
        </div>
        <DialogFooter>
          {licenseText ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCopy()}
              >
                复制
              </Button>
              <Button type="button" variant="outline" onClick={handleDownload}>
                另存为 .lic
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled={issuing || !password || !machineId.trim()}
              onClick={() => {
                void handleIssue();
              }}
            >
              {issuing ? '生成中...' : '生成'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
