import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/apis/authApi';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/useAuthStore';
import type { LoginPayload } from '@/types/user';

export function useAuth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { token, userInfo, setToken, setUserInfo, logout } = useAuthStore();

  const loginMutation = useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: (data) => {
      setToken(data.token);
      setUserInfo(data.user);
      toast({ title: '登录成功' });
      navigate('/');
    },
    onError: () => {
      toast({
        title: '登录失败',
        description: '请检查邮箱和密码后重试',
        variant: 'destructive',
      });
    },
  });

  return {
    token,
    userInfo,
    isAuthenticated: Boolean(token),
    login: loginMutation.mutate,
    loginMutation,
    logout: () => {
      logout();
      navigate('/login');
    },
  };
}
