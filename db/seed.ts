import 'dotenv/config';
import { PostgresRepository } from '../server/repositories/repository';

async function main() {
  if (process.env.ALLOW_SYNTHETIC_SEED !== 'true') {
    console.error('Synthetic seed requires ALLOW_SYNTHETIC_SEED=true and must never be used for real accounts.');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required to seed PostgreSQL.');
    process.exit(1);
  }
  const repo = new PostgresRepository(url);
  await repo.runMigrations();
  await repo.seedIfEmpty();
  console.log('Idempotent synthetic seed completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
