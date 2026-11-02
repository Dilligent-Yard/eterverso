'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const postgres = require('postgres');
const { bootstrapAdmin } = require('../server/admin');

function parseArguments(args) {
  const allowed = new Set(['user-id', 'operator', 'reason', 'database-name', 'env-file']);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    const key = typeof flag === 'string' && flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed.has(key) || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw new Error('Argumentos inválidos para bootstrap.');
    values[key] = value;
  }
  if (['user-id', 'operator', 'reason', 'database-name'].some((key) => !values[key])) {
    throw new Error('Uso: node scripts/bootstrap-admin.js --user-id UUID --operator NOME --reason MOTIVO --database-name BANCO [--env-file CAMINHO]');
  }
  return values;
}

async function main(args = process.argv.slice(2), environment = process.env) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24: nvm use.');
  const values = parseArguments(args);
  // An env file is read only when explicitly selected. Never create or change it.
  const fileEnv = values['env-file'] ? dotenv.parse(fs.readFileSync(path.resolve(values['env-file']))) : {};
  const databaseUrl = environment.DATABASE_URL || fileEnv.DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina DATABASE_URL ou selecione explicitamente um arquivo de ambiente.');
  let target;
  try { target = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL inválida.'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || decodeURIComponent(target.pathname.slice(1)) !== values['database-name']) {
    throw new Error('O banco configurado não corresponde ao banco explicitamente selecionado.');
  }
  const sql = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 5 });
  try {
    const current = await sql`SELECT current_database() AS database`;
    if (current[0].database !== values['database-name']) throw new Error('O banco conectado não corresponde ao alvo confirmado.');
    const { verifySchemaReadiness } = require('../server');
    await verifySchemaReadiness(sql);
    const account = await bootstrapAdmin({ sql, userId: values['user-id'], operator: values.operator, reason: values.reason });
    console.log(`Administrador inicial configurado: ${account.id}. Entre novamente para renovar a sessão.`);
    return account;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

module.exports = { main, parseArguments };
if (require.main === module) {
  main().catch((error) => {
    // Never echo PostgreSQL/connection messages or the environment/DSN.
    console.error(error.publicMessage || (error.name === 'ValidationError' ? 'Argumentos de bootstrap inválidos.' : 'Não foi possível concluir ou confirmar o bootstrap. Verifique argumentos, alvo e auditoria antes de repetir.'));
    process.exitCode = 1;
  });
}
