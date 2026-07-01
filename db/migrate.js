const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema criado com sucesso.');
  await pool.end();
}

migrate().catch(function(err) {
  console.error(err);
  process.exit(1);
});
