import 'dotenv/config';
import { PostgresRepository } from '../server/repositories/repository';

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const fullName = String(process.argv[3] || '').trim();
  const url = process.env.DATABASE_URL;
  if (!url || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) {
    throw new Error('Usage: bun db/bootstrap-admin.ts <email> <full-name>, with password on stdin and DATABASE_URL set');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const password = Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
  if (password.length < 16 || password.length > 256) throw new Error('Admin password must contain 16–256 characters');
  const repo = new PostgresRepository(url);
  await repo.runMigrations();
  if ((await repo.listUsers()).length !== 0) throw new Error('Bootstrap refused: accounts already exist');
  await repo.createUser({ email, password, fullName, shortName: fullName, role: 'admin', groupId: null, departmentId: null });
  console.log('Bootstrap administrator created. Change and recovery procedures must be configured before real use.');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Bootstrap failed'); process.exitCode = 1; });
