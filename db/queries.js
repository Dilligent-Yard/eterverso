const bcrypt = require('bcrypt');
const { query } = require('./db');

const userPublicFields = 'id, username, avatar, title, role, posts_count AS "posts", to_char(join_date, \'DD/MM/YYYY\') AS "joinDate"';
const userSessionFields = userPublicFields + ', email, bio, adm_tentativa_usada AS "admTentativaUsada"';

async function createUser(username, email, password) {
  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING ${userSessionFields}`,
    [username, email, hash]
  );
  return result.rows[0];
}

async function findUserByUsername(username) {
  const result = await query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  return result.rows[0] || null;
}

async function findSessionUserById(id) {
  const result = await query(`SELECT ${userSessionFields} FROM users WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function validateLogin(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return findSessionUserById(user.id);
}

function isAdmin(user) {
  return !!user && user.role === 'admin';
}

function isModOrAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'moderador');
}

async function listUsersPublic() {
  const result = await query(`SELECT ${userPublicFields} FROM users ORDER BY id ASC`);
  return result.rows;
}

async function setUserRole(userId, role, title) {
  await query('UPDATE users SET role = $1, title = $2 WHERE id = $3', [role, title, userId]);
}

async function deleteUser(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
}

async function markAdmTentativaUsada(userId) {
  await query('UPDATE users SET adm_tentativa_usada = TRUE WHERE id = $1', [userId]);
}

async function grantAdmin(userId) {
  await query("UPDATE users SET role = 'admin', title = 'Administrador' WHERE id = $1", [userId]);
}

async function bumpUserPosts(userId) {
  await query('UPDATE users SET posts_count = posts_count + 1 WHERE id = $1', [userId]);
}

async function findRawUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function updateProfileInfo(userId, avatar, bio) {
  await query('UPDATE users SET avatar = $1, bio = $2 WHERE id = $3', [avatar, bio, userId]);
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await findRawUserById(userId);
  if (!user) return { ok: false, error: 'Usuário não encontrado.' };
  const senhaCorreta = await bcrypt.compare(currentPassword, user.password_hash);
  if (!senhaCorreta) return { ok: false, error: 'Senha atual incorreta.' };
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  return { ok: true };
}

async function listCategories() {
  const result = await query('SELECT id, name, description AS "desc" FROM categories ORDER BY id ASC');
  return result.rows;
}

async function createCategory(name, desc) {
  const result = await query(
    'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING id, name, description AS "desc"',
    [name, desc]
  );
  return result.rows[0];
}

async function deleteCategory(id) {
  await query('DELETE FROM categories WHERE id = $1', [id]);
}

const threadFields = 'id, category_id AS "catId", author_id AS "authorId", title, tag, pinned, views, to_char(created_at, \'DD/MM/YYYY HH24:MI\') AS date';

async function listThreads() {
  const result = await query(`SELECT ${threadFields} FROM threads ORDER BY id ASC`);
  return result.rows;
}

async function findThreadById(id) {
  const result = await query(`SELECT ${threadFields} FROM threads WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function createThread(categoryId, authorId, title, tag) {
  const result = await query(
    `INSERT INTO threads (category_id, author_id, title, tag) VALUES ($1, $2, $3, $4) RETURNING ${threadFields}`,
    [categoryId, authorId, title, tag]
  );
  return result.rows[0];
}

async function updateThreadTitle(id, title) {
  await query('UPDATE threads SET title = $1 WHERE id = $2', [title, id]);
}

async function deleteThread(id) {
  await query('DELETE FROM threads WHERE id = $1', [id]);
}

async function incrementThreadViews(id) {
  await query('UPDATE threads SET views = views + 1 WHERE id = $1', [id]);
}

const postFields = 'id, thread_id AS "threadId", author_id AS "authorId", content, edited, to_char(created_at, \'DD/MM/YYYY HH24:MI\') AS date';

async function listPosts() {
  const result = await query(`SELECT ${postFields} FROM posts ORDER BY id ASC`);
  return result.rows;
}

async function findPostById(id) {
  const result = await query(`SELECT ${postFields} FROM posts WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function countPostsByThread(threadId) {
  const result = await query('SELECT COUNT(*)::int AS count FROM posts WHERE thread_id = $1', [threadId]);
  return result.rows[0].count;
}

async function findFirstPostByThread(threadId) {
  const result = await query(`SELECT ${postFields} FROM posts WHERE thread_id = $1 ORDER BY id ASC LIMIT 1`, [threadId]);
  return result.rows[0] || null;
}

async function createPost(threadId, authorId, content) {
  const result = await query(
    `INSERT INTO posts (thread_id, author_id, content) VALUES ($1, $2, $3) RETURNING ${postFields}`,
    [threadId, authorId, content]
  );
  await bumpUserPosts(authorId);
  return result.rows[0];
}

async function updatePost(id, content) {
  await query('UPDATE posts SET content = $1, edited = TRUE WHERE id = $2', [content, id]);
}

async function deletePost(id) {
  await query('DELETE FROM posts WHERE id = $1', [id]);
}

const personagemFields = 'id, author_id AS "authorId", nome, categoria, titulo, raca, faccao, status, imagem, descricao, stats, apex_tier AS "apexTier", mascara_tier AS "mascaraTier"';

async function listPersonagens() {
  const result = await query(`SELECT ${personagemFields} FROM personagens ORDER BY id ASC`);
  return result.rows;
}

async function findPersonagemById(id) {
  const result = await query(`SELECT ${personagemFields} FROM personagens WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function createPersonagem(authorId, data) {
  const result = await query(
    `INSERT INTO personagens
      (author_id, nome, categoria, titulo, raca, faccao, status, imagem, descricao, stats, apex_tier, mascara_tier)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${personagemFields}`,
    [
      authorId,
      data.nome,
      data.categoria,
      data.titulo,
      data.raca,
      data.faccao,
      data.status,
      data.imagem,
      data.descricao,
      JSON.stringify(data.stats || {}),
      data.apexTier,
      data.mascaraTier
    ]
  );
  return result.rows[0];
}

async function updatePersonagem(id, data) {
  await query(
    `UPDATE personagens SET
      nome = $1, categoria = $2, titulo = $3, raca = $4, faccao = $5,
      status = $6, imagem = $7, descricao = $8, stats = $9, apex_tier = $10, mascara_tier = $11
     WHERE id = $12`,
    [
      data.nome,
      data.categoria,
      data.titulo,
      data.raca,
      data.faccao,
      data.status,
      data.imagem,
      data.descricao,
      JSON.stringify(data.stats || {}),
      data.apexTier,
      data.mascaraTier,
      id
    ]
  );
}

async function deletePersonagem(id) {
  await query('DELETE FROM personagens WHERE id = $1', [id]);
}

const commentFields = 'id, personagem_id AS "personagemId", author_id AS "authorId", content, to_char(created_at, \'DD/MM/YYYY HH24:MI\') AS date';

async function listComments() {
  const result = await query(`SELECT ${commentFields} FROM comments ORDER BY id ASC`);
  return result.rows;
}

async function findCommentById(id) {
  const result = await query(`SELECT ${commentFields} FROM comments WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function createComment(personagemId, authorId, content) {
  const result = await query(
    `INSERT INTO comments (personagem_id, author_id, content) VALUES ($1, $2, $3) RETURNING ${commentFields}`,
    [personagemId, authorId, content]
  );
  return result.rows[0];
}

async function deleteComment(id) {
  await query('DELETE FROM comments WHERE id = $1', [id]);
}

module.exports = {
  createUser,
  findUserByUsername,
  findSessionUserById,
  validateLogin,
  isAdmin,
  isModOrAdmin,
  listUsersPublic,
  setUserRole,
  deleteUser,
  findRawUserById,
  updateProfileInfo,
  changePassword,
  markAdmTentativaUsada,
  grantAdmin,
  listCategories,
  createCategory,
  deleteCategory,
  listThreads,
  findThreadById,
  createThread,
  updateThreadTitle,
  deleteThread,
  incrementThreadViews,
  listPosts,
  findPostById,
  countPostsByThread,
  findFirstPostByThread,
  createPost,
  updatePost,
  deletePost,
  listPersonagens,
  findPersonagemById,
  createPersonagem,
  updatePersonagem,
  deletePersonagem,
  listComments,
  findCommentById,
  createComment,
  deleteComment
};
