import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { useKingdeeStore } from '@/store/useKingdeeStore';

const settingsSchema = z.object({
  serverUrl: z.string().min(1, '请填写金蝶 URL'),
  acctName: z.string().min(1, '请填写账套 ID'),
  username: z.string().min(1, '请填写用户名'),
  password: z.string().min(1, '请填写密码'),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const fieldClass =
  'h-10 rounded-lg border-zinc-200 bg-white shadow-none focus-visible:ring-zinc-400';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { toast } = useToast();
  const serverUrl = useKingdeeStore((state) => state.serverUrl);
  const acctName = useKingdeeStore((state) => state.acctName);
  const username = useKingdeeStore((state) => state.username);
  const password = useKingdeeStore((state) => state.password);
  const setSettings = useKingdeeStore((state) => state.setSettings);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { serverUrl, acctName, username, password },
  });

  useEffect(() => {
    if (open) {
      reset({ serverUrl, acctName, username, password });
    }
  }, [open, reset, serverUrl, acctName, username, password]);

  const onSubmit = (values: SettingsFormValues) => {
    setSettings(values);
    toast({ title: '已保存', description: '请点击「连接金蝶」登录' });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] gap-5 p-6">
        <DialogHeader>
          <DialogTitle className="text-[22px]">设置</DialogTitle>
          <DialogDescription>
            配置金蝶连接信息，保存后点击「连接金蝶」登录
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Field
            id="serverUrl"
            label="金蝶URL"
            error={errors.serverUrl?.message}
          >
            <Input
              id="serverUrl"
              autoFocus
              className={fieldClass}
              {...register('serverUrl')}
            />
          </Field>
          <Field id="acctName" label="账套ID" error={errors.acctName?.message}>
            <Input
              id="acctName"
              className={fieldClass}
              {...register('acctName')}
            />
          </Field>
          <Field id="username" label="用户名" error={errors.username?.message}>
            <Input
              id="username"
              autoComplete="username"
              className={fieldClass}
              {...register('username')}
            />
          </Field>
          <Field id="password" label="密码" error={errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className={fieldClass}
              {...register('password')}
            />
          </Field>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
            >
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        <span className="ml-0.5 text-red-500">*</span>
      </label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
