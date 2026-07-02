require('dotenv').config();
const { pool, query } = require('./db');
const { sanitizeRichText } = require('./sanitizeContent');

async function main() {
  let alterados = 0;

  const posts = await query('SELECT id, content FROM posts');
  for (const post of posts.rows) {
    const limpo = sanitizeRichText(post.content);
    if (limpo !== post.content) {
      await query('UPDATE posts SET content = $1 WHERE id = $2', [limpo, post.id]);
      alterados++;
    }
  }
  console.log(posts.rows.length + ' posts verificados, ' + alterados + ' corrigidos.');

  alterados = 0;
  const personagens = await query('SELECT id, descricao FROM personagens');
  for (const p of personagens.rows) {
    const limpo = sanitizeRichText(p.descricao);
    if (limpo !== p.descricao) {
      await query('UPDATE personagens SET descricao = $1 WHERE id = $2', [limpo, p.id]);
      alterados++;
    }
  }
  console.log(personagens.rows.length + ' personagens verificados, ' + alterados + ' corrigidos.');

  await pool.end();
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
