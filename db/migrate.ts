import 'dotenv/config';
import { PostgresRepository } from '../server/repositories/repository';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required to run PostgreSQL migrations.');
    process.exit(1);
  }
  const repo = new PostgresRepository(url);
  await repo.runMigrations();
  console.log('PostgreSQL migration 001_init.sql applied successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
