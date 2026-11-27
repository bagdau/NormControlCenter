import 'dotenv/config';
import { PostgresRepository } from '../server/repositories/repository';

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const url = process.env.DATABASE_URL;
  if (!url || !email || process.env.ALLOW_PASSWORD_RESET !== 'true') throw new Error('Set ALLOW_PASSWORD_RESET=true and pass an account email with DATABASE_URL configured.');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const password = Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
  if (password.length < 16 || password.length > 256) throw new Error('Password must contain 16–256 characters.');
  const repo = new PostgresRepository(url);
  const user = await repo.findUserByEmail(email);
  if (!user) throw new Error('Account not found.');
  await repo.changeUserPassword(user.id, password);
  console.log(`Password reset for ${email}; all existing sessions revoked.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Reset failed'); process.exitCode = 1; });
