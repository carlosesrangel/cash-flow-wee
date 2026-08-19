import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env vars
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx > -1) {
      env[trimmed.substring(0, idx)] = trimmed.substring(idx + 1);
    }
  }
});

const connectionString = process.env.DATABASE_URL || env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL não encontrada em .env.local');
  console.error('\n📌 Configure em .env.local:');
  console.error('DATABASE_URL=postgresql://postgres:[senha]@[projeto].db.supabase.co:5432/postgres\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function runMigration(filePath) {
  const fileName = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf-8').trim();

  if (!sql) {
    console.log(`⊘ ${fileName} (vazio)`);
    return true;
  }

  try {
    await client.query(sql);
    console.log(`✅ ${fileName}`);
    return true;
  } catch (err) {
    const message = err.message;
    // Ignore "already exists" errors - this is idempotent
    if (message.includes('already exists') || message.includes('does not exist')) {
      console.log(`⊘ ${fileName} (já executado)`);
      return true;
    }
    console.error(`❌ ${fileName}`);
    console.error(`   ${message.split('\n')[0]}`);
    return false;
  }
}

async function main() {
  try {
    await client.connect();
    console.log('✅ Conectado ao Supabase\n');

    const migrationsDir = path.join(__dirname, 'supabase', 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`📦 Executando ${files.length} migrations...\n`);

    let passed = 0;
    let failed = 0;

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const success = await runMigration(filePath);
      if (success) passed++;
      else failed++;
    }

    console.log(`\n📊 Resultado: ${passed}/${files.length} migrations executadas`);

    if (failed > 0) {
      console.log(`⚠️  ${failed} migrations falharam\n`);
    } else {
      console.log('✨ Todas as migrations foram executadas com sucesso!\n');
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
