import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env vars
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length > 0) {
      env[key] = rest.join('=');
    }
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function runMigration(filePath) {
  const fileName = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf-8').trim();

  if (!sql) {
    console.log(`⊘ ${fileName} (vazio)`);
    return true;
  }

  try {
    // Dividir em statements individuais por `;`
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      if (error) throw error;
    }

    console.log(`✅ ${fileName}`);
    return true;
  } catch (err) {
    console.error(`❌ ${fileName}`);
    console.error(`   Erro: ${err.message}`);
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
    process.exit(1);
  } else {
    console.log('✨ Todas as migrations foram executadas com sucesso!\n');
  }
}

main().catch(console.error);
