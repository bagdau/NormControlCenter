import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app';
import { productionPageAssets, renderPage } from './server/htmlShell';
import { PostgresRepository } from './server/repositories/repository';

dotenv.config();

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'storage/uploads');
  const sessionSecret = (process.env.SESSION_SECRET || '').trim();
  if (sessionSecret.length < 32 || sessionSecret === 'replace_before_production') {
    console.error('[FATAL] A strong SESSION_SECRET is required.');
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error('[FATAL] DATABASE_URL is required.');
    process.exit(1);
  }
  const repo = new PostgresRepository(databaseUrl);
  await repo.runMigrations();
  const hc = await repo.healthCheck();
  if (!hc.dbReady) throw new Error('Configured PostgreSQL is unavailable.');

  const app = createApp(repo, {
    uploadDir,
    sessionSecret,
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) return next();
      try {
        const html = await vite.transformIndexHtml(
          req.originalUrl,
          renderPage({ script: '/src/main.tsx', stylesheets: [] })
        );
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const html = renderPage(productionPageAssets(distDir));
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) return next();
      res.status(200).type('html').send(html);
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(
      `[NormControlCenter] Listening on http://0.0.0.0:${port} | storage=${repo.mode} | persistsAcrossRestart=${repo.persistsAcrossRestart}`
    );
  });
}

bootstrap().catch((err) => {
  console.error('[FATAL] Server bootstrap failed:', err);
  process.exit(1);
});
