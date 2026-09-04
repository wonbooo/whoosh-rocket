import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function About() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>关于咻咻小火箭</CardTitle>
          <CardDescription>技术栈一览</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Bun · Vite · React 19 · TypeScript</p>
          <p>Tailwind CSS v3 · shadcn/ui New York</p>
          <p>React Router DOM v7 · TanStack Query v5 · Zustand</p>
          <p>React Hook Form · Zod · Vitest</p>
        </CardContent>
      </Card>
    </div>
  );
}
