require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./db/db');
const queries = require('./db/queries');
const adminValidation = require('./db/adminValidation');
const { sanitizeRichText, sanitizeUrlField } = require('./db/sanitizeContent');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('AVISO DE SEGURANÇA: SESSION_SECRET não está definido em produção. Defina essa variável de ambiente — sem ela qualquer pessoa consegue forjar cookies de sessão.');
}

app.use(function(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src * data:; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'self'");
  next();
});

app.use(express.json({ limit: '300kb' }));
app.use(session({
  store: new pgSession({ pool: pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

var rateBuckets = new Map();
function rateLimit(maxAttempts, windowMs) {
  return function(req, res, next) {
    var now = Date.now();
    var key = req.ip + ':' + req.path;
    var bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > maxAttempts) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    next();
  };
}
setInterval(function() {
  var now = Date.now();
  rateBuckets.forEach(function(bucket, key) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  });
}, 10 * 60 * 1000).unref();

function asyncHandler(fn) {
  return function(req, res, next) {
    fn(req, res, next).catch(next);
  };
}

var requireAuth = asyncHandler(async function(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'É preciso estar logado.' });
  var user = await queries.findSessionUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Sessão inválida.' });
  req.user = user;
  next();
});

function requireModOrAdmin(req, res, next) {
  if (!queries.isModOrAdmin(req.user)) return res.status(403).json({ error: 'Acesso negado.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!queries.isAdmin(req.user)) return res.status(403).json({ error: 'Acesso negado.' });
  next();
}

function podeEditar(user, authorId) {
  if (user.role === 'admin') return true;
  return user.id === authorId;
}

app.get('/api/bootstrap', asyncHandler(async function(req, res) {
  var sessionUser = req.session.userId ? await queries.findSessionUserById(req.session.userId) : null;
  var categories = await queries.listCategories();
  var threads = await queries.listThreads();
  var posts = await queries.listPosts();
  var personagens = await queries.listPersonagens();
  var comments = await queries.listComments();
  var users = await queries.listUsersPublic();
  res.json({ session: sessionUser, categories: categories, threads: threads, posts: posts, personagens: personagens, comments: comments, users: users });
}));

app.post('/api/auth/register', rateLimit(10, 15 * 60 * 1000), asyncHandler(async function(req, res) {
  var username = String(req.body.username || '').trim();
  var email = String(req.body.email || '').trim();
  var password = String(req.body.password || '');
  var confirm = String(req.body.confirm || '');

  if (!username || !email || !password) return res.status(400).json({ error: 'Preencha todos os campos.' });
  if (username.length < 2 || username.length > 50) return res.status(400).json({ error: 'O nome de usuário precisa ter entre 2 e 50 caracteres.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return res.status(400).json({ error: 'Digite um e-mail válido.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (password.length > 100) return res.status(400).json({ error: 'A senha é longa demais.' });
  if (password !== confirm) return res.status(400).json({ error: 'As senhas não conferem.' });

  var existente = await queries.findUserByUsername(username);
  if (existente) return res.status(400).json({ error: 'Esse nome de usuário já existe.' });

  try {
    var user = await queries.createUser(username, email, password);
    req.session.userId = user.id;
    res.json({ user: user });
  } catch (err) {
    res.status(400).json({ error: 'Não foi possível criar a conta. Talvez o e-mail já esteja em uso.' });
  }
}));

app.post('/api/auth/login', rateLimit(20, 15 * 60 * 1000), asyncHandler(async function(req, res) {
  var username = String(req.body.username || '').trim();
  var password = String(req.body.password || '');
  var user = await queries.validateLogin(username, password);
  if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  req.session.userId = user.id;
  res.json({ user: user });
}));

app.post('/api/auth/logout', function(req, res) {
  req.session.destroy(function() { res.json({ ok: true }); });
});

app.post('/api/categories', requireAuth, requireAdmin, asyncHandler(async function(req, res) {
  var name = (req.body.name || '').trim();
  var desc = (req.body.desc || '').trim();
  if (!name) return res.status(400).json({ error: 'Digite um nome para a categoria.' });
  var cat = await queries.createCategory(name, desc);
  res.json({ category: cat });
}));

app.delete('/api/categories/:id', requireAuth, requireAdmin, asyncHandler(async function(req, res) {
  await queries.deleteCategory(req.params.id);
  res.json({ ok: true });
}));

var TAGS_VALIDAS = ['ooc', 'rp', 'wiki'];

app.post('/api/threads', requireAuth, asyncHandler(async function(req, res) {
  var catId = req.body.catId;
  var title = String(req.body.title || '').trim();
  var tag = TAGS_VALIDAS.indexOf(req.body.tag) !== -1 ? req.body.tag : 'ooc';
  var content = sanitizeRichText(req.body.content || '');
  if (!title || !content || content === '<br>') return res.status(400).json({ error: 'Preencha o título e o conteúdo!' });
  if (title.length > 200) return res.status(400).json({ error: 'O título pode ter no máximo 200 caracteres.' });

  var thread = await queries.createThread(catId, req.user.id, title, tag);
  await queries.createPost(thread.id, req.user.id, content);
  res.json({ thread: thread });
}));

app.put('/api/threads/:id', requireAuth, asyncHandler(async function(req, res) {
  var id = req.params.id;
  var thread = await queries.findThreadById(id);
  if (!thread) return res.status(404).json({ error: 'Tópico não encontrado.' });
  if (!podeEditar(req.user, thread.authorId)) return res.status(403).json({ error: 'Você não tem permissão para editar este tópico.' });

  var title = String(req.body.title || '').trim();
  var content = sanitizeRichText(req.body.content || '');
  if (!title) return res.status(400).json({ error: 'O título não pode ficar vazio.' });
  if (title.length > 200) return res.status(400).json({ error: 'O título pode ter no máximo 200 caracteres.' });

  await queries.updateThreadTitle(id, title);
  var firstPost = await queries.findFirstPostByThread(id);
  if (firstPost) await queries.updatePost(firstPost.id, content);
  res.json({ ok: true });
}));

app.delete('/api/threads/:id', requireAuth, asyncHandler(async function(req, res) {
  var id = req.params.id;
  var thread = await queries.findThreadById(id);
  if (!thread) return res.status(404).json({ error: 'Tópico não encontrado.' });
  if (!podeEditar(req.user, thread.authorId)) return res.status(403).json({ error: 'Você não tem permissão para deletar este tópico.' });
  await queries.deleteThread(id);
  res.json({ ok: true });
}));

app.post('/api/threads/:id/view', asyncHandler(async function(req, res) {
  await queries.incrementThreadViews(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/posts', requireAuth, asyncHandler(async function(req, res) {
  var threadId = req.body.threadId;
  var content = sanitizeRichText(req.body.content || '');
  if (!content || content === '<br>') return res.status(400).json({ error: 'Escreva algo antes de enviar!' });
  var post = await queries.createPost(threadId, req.user.id, content);
  res.json({ post: post });
}));

app.put('/api/posts/:id', requireAuth, asyncHandler(async function(req, res) {
  var id = req.params.id;
  var post = await queries.findPostById(id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
  if (!podeEditar(req.user, post.authorId)) return res.status(403).json({ error: 'Você não tem permissão para editar este post.' });
  var content = sanitizeRichText(req.body.content || '');
  if (!content) return res.status(400).json({ error: 'Conteúdo vazio.' });
  await queries.updatePost(id, content);
  res.json({ ok: true });
}));

app.delete('/api/posts/:id', requireAuth, asyncHandler(async function(req, res) {
  var id = req.params.id;
  var post = await queries.findPostById(id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado.' });
  if (!podeEditar(req.user, post.authorId)) return res.status(403).json({ error: 'Você não tem permissão para deletar este post.' });

  var total = await queries.countPostsByThread(post.threadId);
  if (total <= 1) {
    await queries.deleteThread(post.threadId);
    return res.json({ ok: true, threadDeleted: true, catId: null });
  }
  await queries.deletePost(id);
  res.json({ ok: true, threadDeleted: false });
}));

function campoTexto(valor, maxLen) {
  return String(valor || '').trim().substring(0, maxLen);
}

function limparDadosPersonagem(body) {
  var statsRecebidos = (body.stats && typeof body.stats === 'object') ? body.stats : {};
  var stats = {};
  ['ifc', 'ccm', 'lrb', 'acg', 'tpc', 'ceo', 'fdv', 'icf'].forEach(function(key) {
    var n = parseInt(statsRecebidos[key], 10);
    if (isNaN(n)) n = 0;
    stats[key] = Math.max(0, Math.min(100, n));
  });

  var skills = [];
  if (Array.isArray(body.skills)) {
    body.skills.slice(0, 40).forEach(function(sk) {
      if (!sk || typeof sk !== 'object') return;
      var nome = campoTexto(sk.nome, 120);
      var descricao = campoTexto(sk.descricao, 2000);
      if (nome || descricao) skills.push({ nome: nome, descricao: descricao });
    });
  }

  return {
    nome: campoTexto(body.nome, 100),
    categoria: campoTexto(body.categoria, 50),
    titulo: campoTexto(body.titulo, 100),
    raca: campoTexto(body.raca, 80),
    faccao: campoTexto(body.faccao, 120),
    status: campoTexto(body.status, 80),
    imagem: sanitizeUrlField(body.imagem),
    descricao: sanitizeRichText(body.descricao || ''),
    stats: stats,
    skills: skills,
    apexTier: campoTexto(body.apexTier, 60),
    mascaraTier: campoTexto(body.mascaraTier, 60)
  };
}

app.post('/api/personagens', requireAuth, requireModOrAdmin, asyncHandler(async function(req, res) {
  var dados = limparDadosPersonagem(req.body);
  if (!dados.nome || !dados.descricao || dados.descricao === '<br>') return res.status(400).json({ error: 'Preencha ao menos o nome e a descrição.' });
  var personagem = await queries.createPersonagem(req.user.id, dados);
  res.json({ personagem: personagem });
}));

app.put('/api/personagens/:id', requireAuth, requireModOrAdmin, asyncHandler(async function(req, res) {
  var dados = limparDadosPersonagem(req.body);
  if (!dados.nome || !dados.descricao || dados.descricao === '<br>') return res.status(400).json({ error: 'Preencha ao menos o nome e a descrição.' });
  await queries.updatePersonagem(req.params.id, dados);
  res.json({ ok: true });
}));

app.delete('/api/personagens/:id', requireAuth, requireModOrAdmin, asyncHandler(async function(req, res) {
  await queries.deletePersonagem(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/personagens/:id/comments', requireAuth, asyncHandler(async function(req, res) {
  var content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Escreva algo antes de comentar.' });
  if (content.length > 3000) return res.status(400).json({ error: 'O comentário pode ter no máximo 3000 caracteres.' });
  var comment = await queries.createComment(req.params.id, req.user.id, content);
  res.json({ comment: comment });
}));

app.delete('/api/comments/:id', requireAuth, asyncHandler(async function(req, res) {
  var id = req.params.id;
  var comment = await queries.findCommentById(id);
  if (!comment) return res.status(404).json({ error: 'Comentário não encontrado.' });
  if (!podeEditar(req.user, comment.authorId)) return res.status(403).json({ error: 'Você não tem permissão para apagar este comentário.' });
  await queries.deleteComment(id);
  res.json({ ok: true });
}));

app.put('/api/users/:id/role', requireAuth, requireAdmin, asyncHandler(async function(req, res) {
  var id = req.params.id;
  var role = req.body.role;
  if (['member', 'moderador', 'admin'].indexOf(role) === -1) {
    return res.status(400).json({ error: 'Cargo inválido.' });
  }
  if (req.user.id === id && role !== 'admin') {
    return res.status(400).json({ error: 'Você não pode remover seu próprio cargo de admin por aqui.' });
  }
  var title = role === 'admin' ? 'Administrador' : (role === 'moderador' ? 'Moderador' : 'Membro');
  await queries.setUserRole(id, role, title);
  res.json({ ok: true });
}));

app.delete('/api/users/:id', requireAuth, requireAdmin, asyncHandler(async function(req, res) {
  var id = req.params.id;
  if (req.user.id === id) return res.status(400).json({ error: 'Você não pode excluir sua própria conta por aqui.' });
  await queries.deleteUser(id);
  res.json({ ok: true });
}));

app.put('/api/profile', requireAuth, asyncHandler(async function(req, res) {
  var avatar = sanitizeUrlField(req.body.avatar);
  var bio = String(req.body.bio || '').trim().substring(0, 2000);
  await queries.updateProfileInfo(req.user.id, avatar, bio);

  var novaSenha = String(req.body.newPassword || '');
  if (novaSenha) {
    var senhaAtual = String(req.body.currentPassword || '');
    if (novaSenha !== (req.body.newPasswordConfirm || '')) {
      return res.status(400).json({ error: 'As senhas novas não conferem.' });
    }
    if (novaSenha.length < 6) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' });
    if (novaSenha.length > 100) return res.status(400).json({ error: 'A nova senha é longa demais.' });
    var resultado = await queries.changePassword(req.user.id, senhaAtual, novaSenha);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
  }

  res.json({ ok: true });
}));

app.post('/api/admin/validar', requireAuth, rateLimit(5, 15 * 60 * 1000), asyncHandler(async function(req, res) {
  if (req.user.admTentativaUsada) return res.json({ alreadyUsed: true, granted: false });

  var nome = (req.body.nome || '').trim();
  var cargo = (req.body.cargo || '').trim().toLowerCase();
  var nivel = req.body.nivel || '';
  var granted = adminValidation.decidirSeEhAdmin(nome, cargo, nivel);

  await queries.markAdmTentativaUsada(req.user.id);
  if (granted) await queries.grantAdmin(req.user.id);

  res.json({ alreadyUsed: false, granted: granted });
}));

app.use(function(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Requisição inválida.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'O conteúdo enviado é grande demais.' });
  }
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Identificador inválido.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

var port = process.env.PORT || 3000;
app.listen(port, function() {
  console.log('Éterverso rodando em http://localhost:' + port);
});
