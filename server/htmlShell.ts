import fs from 'node:fs';
import path from 'node:path';

interface EntryManifest {
  file: string;
  css?: string[];
  imports?: string[];
}

type Manifest = Record<string, EntryManifest>;

export interface PageAssets {
  script: string;
  stylesheets: string[];
}

function assetPath(file: string): string {
  return `/${file.replace(/^\/+/, '')}`;
}

export function productionPageAssets(distDir: string): PageAssets {
  const manifestPath = path.join(distDir, '.vite', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
  const entry = manifest['src/main.tsx'];
  if (!entry?.file) throw new Error('Application entry is missing from the build manifest.');

  const stylesheets = new Set<string>();
  const visit = (key: string) => {
    const asset = manifest[key];
    if (!asset) throw new Error(`Build manifest references missing asset: ${key}`);
    asset.css?.forEach((file) => stylesheets.add(assetPath(file)));
    asset.imports?.forEach(visit);
  };
  visit('src/main.tsx');
  return { script: assetPath(entry.file), stylesheets: [...stylesheets] };
}

export function renderPage(assets: PageAssets): string {
  const styles = assets.stylesheets.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n    ');
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="description" content="Сдача и проверка учебных работ, версии документов, замечания и квитанции." />
    <meta property="og:title" content="НормКонтрольЦентр" />
    <meta property="og:type" content="website" />
    <title>НормКонтрольЦентр</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;family=Plus+Jakarta+Sans:wght@600;700&amp;display=swap" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
    ${styles}
  </head>
  <body class="bg-background text-on-surface antialiased">
    <div id="root"></div>
    <script type="module" src="${assets.script}"></script>
  </body>
</html>`;
}
