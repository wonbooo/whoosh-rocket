import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const KINGDEE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

function kingdeeDevProxy(): Plugin {
  return {
    name: 'kingdee-dev-proxy',
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const pathname = (req.url ?? '').split('?')[0];
          if (pathname !== '/__kingdee') {
            next();
            return;
          }
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          if (req.method !== 'POST') {
            next();
            return;
          }
          void proxyKingdee(req, res);
        },
      );
    },
  };
}

function resolveKingdeeTarget(req: IncomingMessage): string | null {
  const rawUrl = req.url ?? '/';
  const pathWithQuery = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
  const query = new URL(pathWithQuery, 'http://127.0.0.1').searchParams.get(
    'target',
  );
  const header = req.headers['x-kingdee-url'];
  const target = query || (typeof header === 'string' ? header : null);
  if (!target || !/^https?:\/\//i.test(target)) {
    return null;
  }
  return target;
}

function postToKingdee(
  target: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<{ status: number; contentType: string; text: string }> {
  const url = new URL(target);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          Host: url.host,
          'Content-Length': String(body.length),
        },
        timeout: 120_000,
      },
      (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        upstream.on('end', () => {
          resolve({
            status: upstream.statusCode ?? 502,
            contentType:
              String(upstream.headers['content-type'] ?? '') ||
              'application/json; charset=utf-8',
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('连接金蝶超时'));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function proxyKingdee(req: IncomingMessage, res: ServerResponse) {
  try {
    const target = resolveKingdeeTarget(req);
    if (!target) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: '缺少有效的金蝶地址' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      'User-Agent': KINGDEE_UA,
      Referer: `${new URL(target).origin}/`,
    };
    const sessionId = req.headers['kdservice-sessionid'];
    if (typeof sessionId === 'string' && sessionId) {
      headers['kdservice-sessionid'] = sessionId;
    }

    const upstream = await postToKingdee(
      target,
      headers,
      Buffer.concat(chunks),
    );

    if (upstream.status === 403 && !upstream.text.trim()) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message:
            '金蝶服务器拒绝了代理请求（HTTP 403）。请确认金蝶 URL 可从本机访问，或使用桌面端连接。',
        }),
      );
      return;
    }

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.contentType);
    res.end(upstream.text);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        message: error instanceof Error ? error.message : '金蝶代理失败',
      }),
    );
  }
}

export default defineConfig(({ command }) => {
  const host = process.env.TAURI_DEV_HOST;
  const productionBuild = command === 'build';

  return {
    plugins: [react(), kingdeeDevProxy()],
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    esbuild: productionBuild
      ? { drop: ['debugger'], legalComments: 'none' }
      : undefined,
    build: {
      sourcemap: false,
      minify: true,
      cssMinify: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: host || false,
      allowedHosts: true as const,
      cors: true,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 5174,
          }
        : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: {
        provider: 'v8' as const,
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/components/ui/**'],
      },
    },
  };
});
