import 'dotenv/config';
import { runMigrations, seedInitialData, pool } from '../db.js';

async function main() {
  console.log('Running PostgreSQL migrations...');
  try {
    await runMigrations();
    await seedInitialData();
    console.log('Migrations and seed completed successfully.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
