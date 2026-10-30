import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../../../../.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

const command = process.argv[2];

async function main() {
    console.log('Database Migration Tool');
    console.log('==========================\n');

    // Dynamic import AFTER dotenv.config to ensure env vars are loaded
    const { migrateToLatest, migrateDown } = await import('../database/migrator.js');

    if (command === 'down') {
        console.log('Rolling back last migration...\n');
        await migrateDown();
    } else {
        console.log('Running migrations...\n');
        await migrateToLatest();
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});