import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app';
import { DemoRepository, IRepository, PostgresRepository } from './server/repositories/repository';

dotenv.config();

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  const demoModeEnv = (process.env.DEMO_MODE || '').trim().toLowerCase();
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'storage/uploads');
  const sessionSecret =
    (process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
  if (isProd && (!process.env.SESSION_SECRET || sessionSecret.length < 32 || sessionSecret === 'replace_before_production')) {
    console.error('[FATAL] A strong SESSION_SECRET is required in production.');
    process.exit(1);
  }

  let repo: IRepository;

  if (databaseUrl) {
    const pgRepo = new PostgresRepository(databaseUrl);
    await pgRepo.runMigrations();
    repo = pgRepo;
    const hc = await repo.healthCheck();
    if (!hc.dbReady) {
      console.error('[FATAL] Configured PostgreSQL is unavailable. Refusing to switch storage mode.');
      process.exit(1);
    }
  } else {
    if (isProd) {
      console.error(
        '[FATAL] DATABASE_URL is required in production. Demo in-memory storage is strictly disabled in production.'
      );
      process.exit(1);
    }
    if (demoModeEnv === 'false') {
      console.error('[FATAL] DATABASE_URL is missing and DEMO_MODE=false.');
      process.exit(1);
    }
    repo = new DemoRepository();
  }

  const allowDemoPreviewAccounts =
    !isProd && (repo.mode === 'demo-in-memory' || demoModeEnv === 'true');

  const app = createApp(repo, {
    uploadDir,
    sessionSecret,
    allowDemoPreviewAccounts,
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
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
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
