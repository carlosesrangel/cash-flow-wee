import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env vars
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value && !key.startsWith('#')) {
    env[key] = value;
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

async function runMigration(filePath) {
  const fileName = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf-8');

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ sql }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ ${fileName}: ${error}`);
      return false;
    }

    console.log(`✅ ${fileName}`);
    return true;
  } catch (err) {
    console.error(`❌ ${fileName}: ${err.message}`);
    return false;
  }
}

async function main() {
  const migrationsDir = path.join(__dirname, 'supabase', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`\n📦 Executando ${files.length} migrations...\n`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    await runMigration(filePath);
  }

  console.log('\n✨ Migrations completas!\n');
}

main().catch(console.error);
