import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuthStore } from '@/store/useAuthStore';

export default function Home() {
  const userInfo = useAuthStore((state) => state.userInfo);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>欢迎回来</CardTitle>
          <CardDescription>
            {userInfo
              ? `当前用户：${userInfo.name}（${userInfo.email}）`
              : '欢迎使用咻咻小火箭'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link to="/login">前往登录</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/about">了解更多</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
