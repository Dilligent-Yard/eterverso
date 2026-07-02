var DB = {
  users: [],
  categories: [],
  threads: [],
  posts: [],
  personagens: [],
  comments: [],
  session: null
};

var equipe = [
  { nome: 'Rick', cargo: 'Dono e Moderador', foto: 'https://i.pinimg.com/736x/02/bc/1d/02bc1ddfb478c7069ac1db5017955648.jpg' },
  { nome: 'Mand Eden', cargo: 'Criador, Escritor e Dono da Obra', foto: '' },
  { nome: 'Rigel', cargo: 'Fundador e Dono do Éterverso', foto: '' },
  { nome: 'Ghostmaker', cargo: 'Criador, Escritor e Vice-Dono da Obra', foto: '' },
  { nome: 'Scautz', cargo: 'Criador e Escritor', foto: 'https://i.pinimg.com/736x/55/86/5a/55865a10f994f2379e4a4ac484def034.jpg' },
  { nome: 'Lucas Kabii', cargo: 'Criador e Colaborador', foto: 'https://i.pinimg.com/control1/736x/94/b1/6b/94b16b73301e10ea0b4f5a63500cc619.jpg' }
];

async function api(method, url, body) {
  var opts = { method: method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  var res = await fetch(url, opts);
  var data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || 'Erro na requisição.');
  return data;
}

async function refreshBootstrap() {
  var data = await api('GET', '/api/bootstrap');
  DB.session = data.session;
  DB.categories = data.categories;
  DB.threads = data.threads;
  DB.posts = data.posts;
  DB.personagens = data.personagens;
  DB.comments = data.comments;
  DB.users = data.users;
}

function h(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ha(text) {
  return h(text);
}

function formatPost(content) {
  return content;
}

function getUserById(id) {
  return DB.users.find(function(u) { return u.id === id; });
}

function isAdmin() {
  return !!(DB.session && DB.session.role === 'admin');
}

function isModOrAdmin() {
  return !!(DB.session && (DB.session.role === 'admin' || DB.session.role === 'moderador'));
}

function badgeHtml(user) {
  if (!user) return '';
  if (user.role === 'admin') return '<span class="admin-badge">ADMIN</span>';
  if (user.role === 'moderador') return '<span class="mod-badge">MODERADOR</span>';
  return '<span class="member-badge">MEMBRO</span>';
}

function podeEditarThread(authorId) {
  if (!DB.session) return false;
  if (DB.session.role === 'admin') return true;
  if (DB.session.id === authorId) return true;
  return false;
}

function podeEditarPost(authorId) {
  return podeEditarThread(authorId);
}

function tipoInfo(tag) {
  if (tag === 'rp') return { art: 'Nova', artDef: 'a', prep: 'à', dem: 'esta', nome: 'Cena', nomePlural: 'Cenas' };
  if (tag === 'wiki') return { art: 'Novo', artDef: 'o', prep: 'ao', dem: 'este', nome: 'Tópico', nomePlural: 'Tópicos' };
  return { art: 'Novo', artDef: 'o', prep: 'ao', dem: 'este', nome: 'Post', nomePlural: 'Posts' };
}

function tipoPadraoCategoria(catId) {
  var cat = DB.categories.find(function(c) { return c.id === catId; });
  if (cat && /cena|roleplay/i.test(cat.name)) return 'rp';
  return 'ooc';
}

var currentPage = 'forum';
var currentThread = null;
var currentCat = null;
var currentPersonagem = null;
var editandoThread = null;

function navigate(page, extra) {
  currentPage = page;
  if (extra !== undefined) {
    if (page === 'thread') currentThread = extra;
    if (page === 'cat') currentCat = extra;
    if (page === 'personagemView') currentPersonagem = extra;
  }
  if (page === 'thread' && extra !== undefined) {
    api('POST', '/api/threads/' + extra + '/view').catch(function() {});
  }
  document.querySelectorAll('#nav-bar button').forEach(function(b) { b.classList.remove('active'); });
  var navMap = {
    forum: 'nav-forum', cat: 'nav-forum', thread: 'nav-forum', novaThread: 'nav-forum',
    wiki: 'nav-wiki', personagemView: 'nav-wiki', novoPersonagem: 'nav-wiki',
    perfil: null, registro: null, sobre: null, admin: null
  };
  var navId = navMap[page];
  if (navId) { var el = document.getElementById(navId); if (el) el.classList.add('active'); }
  updateTopBar();
  render();
  window.scrollTo(0, 0);
}

function updateTopBar() {
  var info = document.getElementById('top-user-info');
  var actions = document.getElementById('top-btn-area');
  var adminBtn = document.getElementById('nav-admin-btn');
  if (DB.session) {
    info.innerHTML = '<span class="online-dot"></span>Logado como: <a onclick="navigate(\'perfil\')" style="color:#cce;font-weight:bold;">' + h(DB.session.username) + '</a> — ' + h(DB.session.title);
    actions.innerHTML = '<a onclick="doLogout()" style="color:#faa;">Sair</a>';
    if (isAdmin()) {
      adminBtn.innerHTML = '<button onclick="navigate(\'admin\')" style="background:#7a1a1a;border:1px solid #aa3333;color:#ffcccc;padding:4px 10px;font-size:11px;cursor:pointer;border-radius:2px;font-family:Verdana,sans-serif;">Painel Admin</button>';
    } else {
      adminBtn.innerHTML = '';
    }
  } else {
    info.innerHTML = 'Bem-vindo, visitante!';
    actions.innerHTML = '<a onclick="showLoginModal()" style="color:#cce;margin-right:10px;">Entrar</a><a onclick="navigate(\'registro\')" style="color:#cce;">Registrar</a>';
    adminBtn.innerHTML = '';
  }
}

function render() {
  var el = document.getElementById('main');
  var map = {
    forum: renderForum,
    cat: renderCat,
    thread: renderThread,
    novaThread: renderNovaThread,
    wiki: renderWiki,
    personagemView: renderPersonagemView,
    novoPersonagem: renderNovoPersonagem,
    perfil: renderPerfil,
    registro: renderRegistro,
    sobre: renderSobre,
    admin: renderAdmin
  };
  if (map[currentPage]) {
    el.innerHTML = map[currentPage]();
  } else {
    el.innerHTML = '<p>Página não encontrada.</p>';
  }
}

function renderForum() {
  var html = '<div class="breadcrumb">Início &raquo; Fórum</div>';
  DB.categories.forEach(function(cat) {
    var catThreads = DB.threads.filter(function(t) { return t.catId === cat.id; });
    var catPosts = 0;
    catThreads.forEach(function(t) { catPosts += DB.posts.filter(function(p) { return p.threadId === t.id; }).length; });
    var lastThread = catThreads.length ? catThreads[catThreads.length - 1] : null;
    var lastInfo = lastThread ? ('<a onclick="navigate(\'thread\',\'' + lastThread.id + '\')">' + h(lastThread.title.substring(0, 35)) + '...</a><br><small style="color:#888;">' + lastThread.date + '</small>') : '<span style="color:#888;">Nenhum</span>';

    var infoCat = tipoInfo(tipoPadraoCategoria(cat.id));
    html += '<div class="cat-header"><span>' + h(cat.name) + '</span>';
    if (DB.session) html += '<button class="btn btn-small btn-success" onclick="startNewThread(\'' + cat.id + '\')">+ ' + infoCat.art + ' ' + infoCat.nome + '</button>';
    html += '</div>';
    html += '<table class="forum-table"><thead><tr><th style="width:45%">Categoria</th><th>Tópicos</th><th>Posts</th><th>Último Post</th></tr></thead><tbody>';
    html += '<tr><td><a onclick="navigate(\'cat\',\'' + cat.id + '\')">' + h(cat.name) + '</a><br><small style="color:#666;">' + h(cat.desc) + '</small></td>';
    html += '<td>' + catThreads.length + '</td><td>' + catPosts + '</td><td style="font-size:11px;">' + lastInfo + '</td></tr>';
    html += '</tbody></table>';
  });

  var totalPosts = DB.posts.length;
  var totalThreads = DB.threads.length;
  var totalUsers = DB.users.length;
  html += '<div class="stats-bar"><span><b>' + totalPosts + '</b> posts</span><span><b>' + totalThreads + '</b> tópicos</span><span><b>' + totalUsers + '</b> usuários</span>';
  if (DB.session) html += '<span><span class="online-dot"></span><b>' + h(DB.session.username) + '</b> online</span>';
  html += '</div>';
  return html;
}

function renderCat() {
  var cat = DB.categories.find(function(c) { return c.id === currentCat; });
  if (!cat) return '<p>Categoria não encontrada.</p>';
  var threads = DB.threads.filter(function(t) { return t.catId === currentCat; });
  threads = threads.slice().reverse();
  threads.sort(function(a, b) { return b.pinned - a.pinned; });

  var infoCat = tipoInfo(tipoPadraoCategoria(cat.id));
  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> &raquo; ' + h(cat.name) + '</div>';
  html += '<div class="cat-header"><span>' + h(cat.name) + '</span>';
  if (DB.session) html += '<button class="btn btn-small btn-success" onclick="startNewThread(\'' + cat.id + '\')">+ ' + infoCat.art + ' ' + infoCat.nome + '</button>';
  html += '</div>';
  html += '<table class="forum-table"><thead><tr><th>Tópico</th><th>Autor</th><th>Respostas</th><th>Views</th><th>Último Post</th></tr></thead><tbody>';

  if (!threads.length) {
    html += '<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;">Nenhum' + (infoCat.artDef === 'a' ? 'a' : '') + ' ' + infoCat.nome.toLowerCase() + ' ainda. <a onclick="startNewThread(\'' + cat.id + '\')">Criar ' + infoCat.artDef + ' primeir' + infoCat.artDef + '!</a></td></tr>';
  }

  threads.forEach(function(t) {
    var author = getUserById(t.authorId);
    var replies = Math.max(0, DB.posts.filter(function(p) { return p.threadId === t.id; }).length - 1);
    var tagClass = 'tag-' + (t.tag || 'ooc');
    var lastPost = DB.posts.filter(function(p) { return p.threadId === t.id; });
    var lastPostDate = lastPost.length ? lastPost[lastPost.length - 1].date : t.date;
    html += '<tr><td>';
    if (t.pinned) html += '<span class="pin">FIXO</span>';
    html += '<span class="tag ' + tagClass + '">' + (t.tag || 'ooc').toUpperCase() + '</span> ';
    html += '<a onclick="navigate(\'thread\',\'' + t.id + '\')">' + h(t.title) + '</a>';
    html += '</td><td>' + (author ? h(author.username) : '?') + '</td>';
    html += '<td>' + replies + '</td><td>' + (t.views || 0) + '</td>';
    html += '<td style="font-size:11px;">' + lastPostDate + '</td></tr>';
  });

  html += '</tbody></table>';
  return html;
}

function renderThread() {
  var thread = DB.threads.find(function(t) { return t.id === currentThread; });
  if (!thread) return '<p>Tópico não encontrado.</p>';
  var cat = DB.categories.find(function(c) { return c.id === thread.catId; });

  var posts = DB.posts.filter(function(p) { return p.threadId === currentThread; });
  var tagClass = 'tag-' + (thread.tag || 'ooc');
  var infoThread = tipoInfo(thread.tag);

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> &raquo; <a onclick="navigate(\'cat\',\'' + thread.catId + '\')">' + h(cat ? cat.name : '') + '</a> &raquo; ' + h(thread.title) + '</div>';
  html += '<div class="thread-tools">';
  html += '<h2><span class="tag ' + tagClass + '">' + (thread.tag || 'ooc').toUpperCase() + '</span> ' + h(thread.title) + '</h2>';
  html += '<div style="display:flex;gap:5px;">';
  if (podeEditarThread(thread.authorId)) {
    html += '<button class="btn btn-warn btn-small" onclick="editarThread(\'' + thread.id + '\')">Editar</button>';
    html += '<button class="btn btn-danger btn-small" onclick="deleteThread(\'' + thread.id + '\')">Deletar ' + infoThread.nome + '</button>';
  }
  html += '</div></div>';

  posts.forEach(function(post, idx) {
    var author = getUserById(post.authorId);
    var initials = author ? author.username.substring(0, 2).toUpperCase() : '??';
    var avatarHtml = (author && author.avatar) ? '<img src="' + ha(author.avatar) + '">' : initials;
    var cargoHtml = '<div>' + badgeHtml(author) + '</div>';

    html += '<div class="post-box">';
    html += '<div class="post-header"><div class="post-meta"><span class="post-number">#' + (idx + 1) + '</span><strong>' + (author ? h(author.username) : '?') + '</strong></div><div class="post-meta"><span class="post-date">' + post.date + '</span>' + (post.edited ? '<span class="post-edited">editado</span>' : '') + '</div></div>';
    html += '<div class="post-body">';
    html += '<div class="post-user-panel"><div class="avatar">' + avatarHtml + '</div><div class="username">' + (author ? h(author.username) : '?') + '</div><div class="user-title">' + (author ? h(author.title) : '') + '</div><div class="user-posts">Posts: ' + (author ? author.posts : 0) + '</div>' + cargoHtml + '</div>';
    html += '<div class="post-content">' + formatPost(post.content) + '</div>';
    html += '</div>';
    html += '<div class="post-footer"><div class="post-actions">';
    if (DB.session) {
      html += '<a onclick="quotePost(\'' + post.id + '\')">Citar</a>';
      if (podeEditarPost(post.authorId)) {
        html += '<a onclick="editPost(\'' + post.id + '\')">Editar</a>';
        html += '<a class="danger-link" onclick="deletePost(\'' + post.id + '\')">Deletar</a>';
      }
    }
    html += '</div></div></div>';
  });

  if (DB.session) {
    html += '<div class="reply-box">';
    html += '<div class="reply-title"><span>Responder ' + infoThread.prep + ' ' + infoThread.nome + '</span><span>' + h(DB.session.username) + '</span></div>';
    html += '<div class="reply-inner">';
    html += buildEditor('reply-editor', '');
    html += '<div style="margin-top:8px;"><button class="btn btn-primary" onclick="submitReply()">Enviar Resposta</button></div>';
    html += '</div></div>';
  } else {
    html += '<div class="alert alert-info" style="margin-top:10px;"><a onclick="showLoginModal()">Faça login</a> para responder n' + (infoThread.artDef === 'a' ? 'esta' : 'este') + ' ' + infoThread.nome.toLowerCase() + '.</div>';
  }

  return html;
}

function renderNovaThread() {
  if (!DB.session) return '<div class="alert alert-error">Você precisa estar logado.</div>';
  var selCat = currentCat || (DB.categories[0] && DB.categories[0].id);
  var isEdit = editandoThread !== null;
  var thr = isEdit ? DB.threads.find(function(t) { return t.id === editandoThread; }) : null;
  var priPost = isEdit ? DB.posts.find(function(p) { return p.threadId === editandoThread; }) : null;
  var tagPadrao = isEdit ? (thr ? thr.tag : 'ooc') : tipoPadraoCategoria(selCat);
  var infoNova = tipoInfo(tagPadrao);

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> &raquo; ' + (isEdit ? ('Editar ' + infoNova.nome) : (infoNova.art + ' ' + infoNova.nome)) + '</div>';
  html += '<div class="cat-header"><span>' + (isEdit ? ('Editar ' + infoNova.nome) : ('Criar ' + infoNova.nome)) + '</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';

  if (!isEdit) {
    html += '<div class="form-row"><label>Categoria</label><select id="thread-cat" onchange="atualizarTipoThreadPadrao(this.value)">';
    DB.categories.forEach(function(c) {
      html += '<option value="' + c.id + '"' + (c.id === selCat ? ' selected' : '') + '>' + h(c.name) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-row"><label>Tipo</label><select id="thread-tag">';
    html += '<option value="ooc"' + (tagPadrao === 'ooc' ? ' selected' : '') + '>OOC / Post (Discussão fora do personagem)</option>';
    html += '<option value="rp"' + (tagPadrao === 'rp' ? ' selected' : '') + '>RP / Cena (Cena de Roleplay)</option>';
    html += '<option value="wiki"' + (tagPadrao === 'wiki' ? ' selected' : '') + '>Wiki / Lore</option>';
    html += '</select></div>';
  }

  html += '<div class="form-row"><label>Título</label><input type="text" id="thread-title" value="' + (thr ? ha(thr.title) : '') + '" placeholder="Título d' + infoNova.artDef + ' ' + infoNova.nome.toLowerCase() + '"></div>';
  html += '<div class="form-row"><label>Conteúdo</label>';
  html += buildEditor('thread-editor', priPost ? priPost.content : '');
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px;">';
  if (isEdit) {
    html += '<button class="btn btn-primary" onclick="salvarEdicaoThread()">Salvar Alterações</button>';
  } else {
    html += '<button class="btn btn-primary" onclick="submitThread()">Publicar ' + infoNova.nome + '</button>';
  }
  html += '<button class="btn btn-small" onclick="navigate(\'forum\')">Cancelar</button></div>';
  html += '</div>';
  return html;
}

function renderCharCard(p) {
  var statusColor = p.status === 'Vivo' || p.status === 'Viva' ? '#007700' : (p.status === 'Afastada' || p.status === 'Afastado' ? '#774400' : '#770000');
  var html = '<div class="char-card" onclick="navigate(\'personagemView\',\'' + p.id + '\')">';
  if (p.imagem) {
    html += '<img class="thumb" src="' + ha(p.imagem) + '" alt="' + ha(p.nome) + '">';
  } else {
    html += '<div class="thumb-ph">' + h(p.nome.substring(0, 1)) + '</div>';
  }
  html += '<div class="char-card-info"><h4>' + h(p.nome) + (p.titulo ? ' — <em>' + h(p.titulo) + '</em>' : '') + '</h4>';
  html += '<p><b>Raça:</b> ' + h(p.raca) + ' | <b>Facção:</b> ' + h(p.faccao) + ' | <b>Status:</b> <span style="color:' + statusColor + ';">' + h(p.status) + '</span></p>';
  var descTexto = p.descricao.replace(/<[^>]+>/g, '').substring(0, 130);
  html += '<p style="margin-top:4px;">' + h(descTexto) + '...</p>';
  html += '</div></div>';
  return html;
}

function renderWiki() {
  var html = '<div class="breadcrumb">Início &raquo; Personagens</div>';
  html += '<div class="cat-header"><span>Personagens Conhecidos</span>';
  if (isModOrAdmin()) {
    html += '<button class="btn btn-small btn-success" onclick="sessionStorage.removeItem(\'editPersonagemId\');navigate(\'novoPersonagem\')">+ Novo Personagem</button>';
  }
  html += '</div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:10px;margin-bottom:10px;font-size:12px;color:#555;">Clique em um personagem para ver o perfil completo.</div>';

  var principais = DB.personagens.filter(function(p) { return p.categoria !== 'Sub-Personagem'; });
  var subPersonagens = DB.personagens.filter(function(p) { return p.categoria === 'Sub-Personagem'; });

  if (principais.length) {
    html += '<div class="cat-header" style="margin-top:6px;"><span>Personagens Principais</span></div>';
    principais.forEach(function(p) { html += renderCharCard(p); });
  }

  if (subPersonagens.length) {
    html += '<div class="cat-header" style="margin-top:14px;"><span>Sub-Personagens</span></div>';
    subPersonagens.forEach(function(p) { html += renderCharCard(p); });
  }

  if (!DB.personagens.length) {
    html += '<div style="text-align:center;padding:30px;color:#888;">Nenhum personagem cadastrado ainda.</div>';
  }

  return html;
}

function renderPersonagemView() {
  var p = DB.personagens.find(function(x) { return x.id === currentPersonagem; });
  if (!p) return '<p>Personagem não encontrado.</p>';
  var statusColor = p.status === 'Vivo' || p.status === 'Viva' ? '#007700' : (p.status === 'Afastada' || p.status === 'Afastado' ? '#774400' : '#770000');

  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Personagens</a> &raquo; ' + h(p.nome) + '</div>';

  html += '<div class="char-sheet-head">';
  html += '<h2>' + h(p.nome) + (p.titulo ? ' <em>' + h(p.titulo) + '</em>' : '') + '</h2>';
  if (isModOrAdmin()) {
    html += '<div style="display:flex;gap:5px;"><button class="btn btn-warn btn-small" onclick="editarPersonagem(\'' + p.id + '\')">Editar</button><button class="btn btn-danger btn-small" onclick="deletarPersonagem(\'' + p.id + '\')">Deletar</button></div>';
  }
  html += '</div>';

  html += '<div class="char-sheet-grid">';
  html += '<div class="char-sheet-card">';
  html += '<div class="char-sheet-card-title">' + h(p.nome) + '</div>';
  if (p.imagem) html += '<div class="char-sheet-portrait"><img src="' + ha(p.imagem) + '"></div>';
  html += '<table style="width:100%;font-size:11px;text-align:left;">';
  if (p.titulo) html += '<tr><td><b>Título:</b></td><td>' + h(p.titulo) + '</td></tr>';
  html += '<tr><td><b>Raça:</b></td><td>' + h(p.raca) + '</td></tr>';
  html += '<tr><td><b>Facção:</b></td><td>' + h(p.faccao) + '</td></tr>';
  html += '<tr><td><b>Status:</b></td><td style="color:' + statusColor + ';font-weight:bold;">' + h(p.status) + '</td></tr>';
  html += '</table>';
  if (p.apexTier) html += '<div class="apex-tier-badge card-badge">Apex Scale: <b>' + h(p.apexTier) + '</b></div>';
  if (p.mascaraTier) html += '<div class="apex-tier-badge mascara card-badge">A Máscara: <b>' + h(p.mascaraTier) + '</b></div>';
  html += '</div>';
  html += '<div class="char-sheet-body">' + p.descricao + '</div>';
  html += '</div>';

  if (p.stats) {
    html += '<div class="cat-header" style="margin-top:15px;"><span>Apex Scale</span></div>';
    html += '<div class="apex-panel">';
    html += '<div class="radar-wrap">' + buildRadarChart(p.stats) + '</div>';
    html += '<div class="apex-readout">';
    var apexKanji = ['剛', '技', '体', '知', '心', '気', '速', '運'];
    var apexRomaji = ['Gō', 'Gi', 'Tai', 'Chi', 'Shin', 'Ki', 'Soku', 'Un'];
    var apexKeys = ['ifc', 'ccm', 'lrb', 'acg', 'tpc', 'ceo', 'fdv', 'icf'];
    for (var si = 0; si < apexKanji.length; si++) {
      var valorStat = p.stats[apexKeys[si]] !== undefined ? p.stats[apexKeys[si]] : 0;
      html += '<div class="apex-stat-row"><span class="apex-stat-label"><span class="kanji">' + apexKanji[si] + '</span>' + apexRomaji[si] + '</span><span class="apex-stat-bar"><span class="apex-stat-bar-fill" style="width:' + valorStat + '%;"></span></span><span class="apex-stat-value">' + valorStat + '</span></div>';
    }
    html += '</div></div>';
  }

  html += '<div class="cat-header" style="margin-top:15px;"><span>Comentários</span></div>';
  var comentarios = DB.comments.filter(function(c) { return c.personagemId === p.id; });
  if (!comentarios.length) {
    html += '<div style="padding:10px;color:#888;background:#f8f9ff;border:1px solid #8899aa;">Nenhum comentário ainda.</div>';
  } else {
    comentarios.forEach(function(c) {
      var autor = getUserById(c.authorId);
      html += '<div class="post-box"><div class="post-header"><div class="post-meta"><strong>' + (autor ? h(autor.username) : '?') + '</strong></div><span class="post-date">' + c.date + '</span></div><div class="post-content">' + h(c.content) + '</div>';
      if (podeEditarPost(c.authorId)) {
        html += '<div class="post-footer"><div class="post-actions"><a class="danger-link" onclick="deletarComentario(\'' + c.id + '\')">Apagar</a></div></div>';
      }
      html += '</div>';
    });
  }
  if (DB.session) {
    html += '<div class="reply-box"><div class="reply-inner">';
    html += '<textarea id="comentario-texto" rows="3" style="width:100%;font-family:Verdana,sans-serif;font-size:12px;padding:6px;border:1px solid #8899aa;box-sizing:border-box;" placeholder="Escreva um comentário..."></textarea>';
    html += '<div style="margin-top:6px;"><button class="btn btn-primary btn-small" onclick="submitComentario(\'' + p.id + '\')">Comentar</button></div>';
    html += '</div></div>';
  } else {
    html += '<div class="alert alert-info"><a onclick="showLoginModal()">Faça login</a> para comentar.</div>';
  }

  html += '<div style="clear:both;margin-top:15px;"><a onclick="navigate(\'wiki\')" class="btn btn-primary btn-small">Voltar</a></div>';
  return html;
}

function buildRadarChart(stats) {
  var kanji = ['剛', '技', '体', '知', '心', '気', '速', '運'];
  var romaji = ['Gō', 'Gi', 'Tai', 'Chi', 'Shin', 'Ki', 'Soku', 'Un'];
  var keys = ['ifc', 'ccm', 'lrb', 'acg', 'tpc', 'ceo', 'fdv', 'icf'];
  var n = kanji.length;
  var size = 300;
  var cx = size / 2;
  var cy = size / 2;
  var maxR = 82;
  var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
  svg += '<defs>';
  svg += '<radialGradient id="apexFillGrad" cx="50%" cy="50%" r="65%">';
  svg += '<stop offset="0%" stop-color="#4a7acc" stop-opacity="0.55"></stop>';
  svg += '<stop offset="100%" stop-color="#1a2860" stop-opacity="0.35"></stop>';
  svg += '</radialGradient>';
  svg += '</defs>';

  var aneis = [0.25, 0.5, 0.75, 1];
  for (var a = 0; a < aneis.length; a++) {
    var pontosAnel = '';
    for (var i = 0; i < n; i++) {
      var angAnel = (Math.PI * 2 / n) * i - Math.PI / 2;
      var rAnel = maxR * aneis[a];
      var xAnel = cx + rAnel * Math.cos(angAnel);
      var yAnel = cy + rAnel * Math.sin(angAnel);
      pontosAnel += xAnel.toFixed(1) + ',' + yAnel.toFixed(1) + ' ';
    }
    var ringOpacity = a === aneis.length - 1 ? 1 : 0.6;
    svg += '<polygon points="' + pontosAnel.trim() + '" fill="none" stroke="#b7c0dc" stroke-width="1" opacity="' + ringOpacity + '"></polygon>';
  }

  for (var i = 0; i < n; i++) {
    var ang = (Math.PI * 2 / n) * i - Math.PI / 2;
    var xEixo = cx + maxR * Math.cos(ang);
    var yEixo = cy + maxR * Math.sin(ang);
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + xEixo.toFixed(1) + '" y2="' + yEixo.toFixed(1) + '" stroke="#b7c0dc" stroke-width="1"></line>';
    var lx = cx + (maxR + 26) * Math.cos(ang);
    var ly = cy + (maxR + 26) * Math.sin(ang);
    var anchor = 'middle';
    if (lx < cx - 5) anchor = 'end';
    if (lx > cx + 5) anchor = 'start';
    svg += '<text x="' + lx.toFixed(1) + '" y="' + (ly - 4).toFixed(1) + '" font-size="10" font-weight="bold" fill="#1a2860" text-anchor="' + anchor + '" font-family="Verdana">' + h(kanji[i]) + '</text>';
    svg += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 8).toFixed(1) + '" font-size="9" fill="#3a5080" text-anchor="' + anchor + '" font-family="Verdana">' + h(romaji[i]) + '</text>';
  }

  var pontosDado = '';
  var dots = '';
  for (var i = 0; i < n; i++) {
    var valor = stats[keys[i]] || 0;
    if (valor > 100) valor = 100;
    if (valor < 0) valor = 0;
    var angDado = (Math.PI * 2 / n) * i - Math.PI / 2;
    var rDado = maxR * (valor / 100);
    var xDado = cx + rDado * Math.cos(angDado);
    var yDado = cy + rDado * Math.sin(angDado);
    pontosDado += xDado.toFixed(1) + ',' + yDado.toFixed(1) + ' ';
    dots += '<circle cx="' + xDado.toFixed(1) + '" cy="' + yDado.toFixed(1) + '" r="3" fill="#1a2860" stroke="#fff" stroke-width="1"></circle>';
  }
  svg += '<polygon points="' + pontosDado.trim() + '" fill="url(#apexFillGrad)" stroke="#1a2860" stroke-width="2" stroke-linejoin="round"></polygon>';
  svg += dots;
  svg += '</svg>';
  return svg;
}

function renderNovoPersonagem() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">Acesso negado.</div>';

  var editId = sessionStorage.getItem('editPersonagemId');
  var existing = editId ? DB.personagens.find(function(p) { return p.id === editId; }) : null;

  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Personagens</a> &raquo; ' + (existing ? 'Editar Personagem' : 'Novo Personagem') + '</div>';
  html += '<div class="cat-header"><span>' + (existing ? 'Editar Personagem' : 'Cadastrar Personagem') + '</span></div>';

  html += '<div class="char-sheet-grid">';

  html += '<div class="char-sheet-card">';
  html += '<div class="char-sheet-card-title" id="p-preview-titulo">' + (existing ? h(existing.nome) : 'Novo Personagem') + '</div>';
  html += '<div class="char-sheet-portrait" id="p-preview-img-wrap" style="' + (existing && existing.imagem ? '' : 'display:none;') + '"><img id="p-preview-img" src="' + (existing ? ha(existing.imagem) : '') + '" onerror="this.parentNode.style.display=\'none\'"></div>';
  html += '<div class="form-row"><label>Nome</label><input type="text" id="p-nome" value="' + (existing ? ha(existing.nome) : '') + '" oninput="atualizarPreviewFicha()"></div>';
  html += '<div class="form-row"><label>URL da Imagem</label><input type="text" id="p-imagem" value="' + (existing ? ha(existing.imagem) : '') + '" placeholder="https://..." oninput="atualizarPreviewFicha()"></div>';
  html += '<div class="form-row"><label>Categoria</label><select id="p-categoria"><option value="Personagem Principal"' + (!existing || existing.categoria !== 'Sub-Personagem' ? ' selected' : '') + '>Personagem Principal</option><option value="Sub-Personagem"' + (existing && existing.categoria === 'Sub-Personagem' ? ' selected' : '') + '>Sub-Personagem</option></select></div>';
  html += '<div class="form-row"><label>Título</label><input type="text" id="p-titulo" value="' + (existing ? ha(existing.titulo) : '') + '"></div>';
  html += '<div class="form-row"><label>Raça</label><input type="text" id="p-raca" value="' + (existing ? ha(existing.raca) : '') + '"></div>';
  html += '<div class="form-row"><label>Facção</label><input type="text" id="p-faccao" value="' + (existing ? ha(existing.faccao) : '') + '"></div>';
  html += '<div class="form-row"><label>Status</label><input type="text" id="p-status" value="' + (existing ? ha(existing.status) : '') + '" placeholder="Vivo, Falecido, Afastado..."></div>';
  html += '</div>';

  html += '<div>';
  html += '<div class="char-sheet-body">';
  html += '<div class="form-row"><label>Descrição / Lore (editor completo)</label>';
  html += buildEditor('p-editor', existing ? existing.descricao : '');
  html += '</div>';
  html += '</div>';

  var st = (existing && existing.stats) ? existing.stats : {};
  html += '<div class="cat-header" style="margin-top:10px;"><span>Apex Scale</span></div>';
  html += '<div style="border:1px solid #8899aa;background:#fff;padding:12px;margin-bottom:10px;">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>剛 Gō</label><input type="text" id="p-stat-ifc" value="' + (st.ifc !== undefined ? st.ifc : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>技 Gi</label><input type="text" id="p-stat-ccm" value="' + (st.ccm !== undefined ? st.ccm : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>体 Tai</label><input type="text" id="p-stat-lrb" value="' + (st.lrb !== undefined ? st.lrb : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>知 Chi</label><input type="text" id="p-stat-acg" value="' + (st.acg !== undefined ? st.acg : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>心 Shin</label><input type="text" id="p-stat-tpc" value="' + (st.tpc !== undefined ? st.tpc : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>気 Ki</label><input type="text" id="p-stat-ceo" value="' + (st.ceo !== undefined ? st.ceo : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>速 Soku</label><input type="text" id="p-stat-fdv" value="' + (st.fdv !== undefined ? st.fdv : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>運 Un</label><input type="text" id="p-stat-icf" value="' + (st.icf !== undefined ? st.icf : '') + '"></div>';
  html += '</div>';
  html += '<div class="field-desc">Cada eixo vai de 0 a 100.</div>';
  html += '<div class="form-row" style="margin-top:8px;"><label>Classificação Apex Scale</label><input type="text" id="p-apex-tier" value="' + (existing ? ha(existing.apexTier) : '') + '" placeholder="Iniciante, Intermediário, Expert..."></div>';
  html += '<div class="form-row"><label>Classificação segundo A Máscara (opcional)</label><input type="text" id="p-mascara-tier" value="' + (existing ? ha(existing.mascaraTier) : '') + '"></div>';
  html += '</div>';

  var btnLabel = existing ? 'Salvar Alterações' : 'Cadastrar Personagem';
  var onclick = existing ? 'salvarEdicaoPersonagem(\'' + existing.id + '\')' : 'submitPersonagem()';
  html += '<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-primary" onclick="' + onclick + '">' + btnLabel + '</button><button class="btn btn-small" onclick="navigate(\'wiki\')">Cancelar</button></div>';
  html += '</div>';

  html += '</div>';
  return html;
}

function atualizarPreviewFicha() {
  var nomeInput = document.getElementById('p-nome');
  var imagemInput = document.getElementById('p-imagem');
  var titulo = document.getElementById('p-preview-titulo');
  var imgWrap = document.getElementById('p-preview-img-wrap');
  var img = document.getElementById('p-preview-img');
  if (titulo) titulo.textContent = (nomeInput && nomeInput.value.trim()) || 'Novo Personagem';
  if (imagemInput && imagemInput.value.trim()) {
    if (img) img.src = imagemInput.value.trim();
    if (imgWrap) imgWrap.style.display = '';
  } else {
    if (imgWrap) imgWrap.style.display = 'none';
  }
}

function renderPerfil() {
  if (!DB.session) {
    return '<div class="alert alert-info">Você não está logado. <a onclick="showLoginModal()">Entrar</a> ou <a onclick="navigate(\'registro\')">cadastrar-se</a>.</div>';
  }
  var u = DB.session;
  var html = '<div class="breadcrumb">Início &raquo; Perfil</div>';
  html += '<div class="cat-header"><span>Perfil de ' + h(u.username) + '</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;display:flex;gap:16px;align-items:flex-start;">';
  html += '<div class="avatar" style="width:72px;height:72px;flex-shrink:0;">' + (u.avatar ? '<img src="' + ha(u.avatar) + '">' : h(u.username.substring(0, 2).toUpperCase())) + '</div>';
  html += '<table class="forum-table" style="flex:1;"><tbody>';
  html += '<tr><td><b>Usuário</b></td><td>' + h(u.username) + '</td></tr>';
  html += '<tr><td><b>Título</b></td><td>' + h(u.title) + ' ' + badgeHtml(u) + '</td></tr>';
  html += '<tr><td><b>Email</b></td><td>' + h(u.email) + '</td></tr>';
  html += '<tr><td><b>Bio</b></td><td>' + (u.bio ? h(u.bio) : '<span style="color:#888;">Nenhuma bio ainda.</span>') + '</td></tr>';
  html += '<tr><td><b>Posts</b></td><td>' + (u.posts || 0) + '</td></tr>';
  html += '<tr><td><b>Cadastrado em</b></td><td>' + h(u.joinDate) + '</td></tr>';
  html += '</tbody></table>';
  html += '</div>';

  html += '<div class="cat-header" style="margin-top:14px;"><span>Editar Perfil</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';
  html += '<div class="form-row"><label>Foto de perfil (URL)</label><input type="text" id="perfil-avatar" value="' + ha(u.avatar || '') + '" placeholder="https://..." oninput="atualizarPreviewAvatar()"></div>';
  html += '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">';
  html += '<div class="avatar" id="perfil-avatar-preview-wrap" style="width:56px;height:56px;">';
  html += (u.avatar ? '<img id="perfil-avatar-preview" src="' + ha(u.avatar) + '" onerror="this.style.display=\'none\'">' : '<img id="perfil-avatar-preview" style="display:none;">');
  html += '</div><div class="field-desc" style="margin-top:0;">Pré-visualização da foto</div>';
  html += '</div>';
  html += '<div class="form-row"><label>Bio</label><textarea id="perfil-bio" rows="3" style="width:100%;font-family:Verdana,sans-serif;font-size:12px;padding:6px;border:1px solid #8899aa;box-sizing:border-box;" placeholder="Fale um pouco sobre você...">' + h(u.bio || '') + '</textarea></div>';
  html += '<div class="divider"></div>';
  html += '<div class="form-row"><label>Senha atual</label><input type="password" id="perfil-senha-atual" placeholder="Só preencha se for trocar a senha"></div>';
  html += '<div class="form-row"><label>Nova senha</label><input type="password" id="perfil-senha-nova"></div>';
  html += '<div class="form-row"><label>Confirmar nova senha</label><input type="password" id="perfil-senha-confirmar"></div>';
  html += '<button class="btn btn-primary" onclick="salvarPerfil()">Salvar Perfil</button>';
  html += '</div>';

  if (u.role !== 'admin') {
    html += '<div class="cat-header" style="margin-top:14px;"><span>Validação de ADM (1 tentativa)</span></div>';
    html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';
    if (u.admTentativaUsada) {
      html += '<div class="alert alert-error">Você já usou sua única tentativa de validação.</div>';
    } else {
      html += '<div class="form-row"><label>Nome</label><input type="text" id="adm-nome" placeholder="Seu nome"></div>';
      html += '<div class="form-row"><label>Cargo</label><input type="text" id="adm-cargo" placeholder="adm, moderador, etc"></div>';
      html += '<div class="form-row"><label>Nível</label><input type="text" id="adm-nivel" placeholder="1, 5, 99..."></div>';
      html += '<button class="btn btn-warn" id="validar-adm" onclick="onClickValidarAdmin()">Validar agora</button>';
      html += '<div id="adm-message" style="margin-top:6px;font-size:11px;color:#774400;"></div>';
    }
    html += '</div>';
  }

  html += '<div style="margin-top:14px;"><button class="btn btn-danger btn-small" onclick="doLogout()">Sair da conta</button></div>';
  return html;
}

function renderRegistro() {
  if (DB.session) return '<div class="alert alert-info">Você já está logado.</div>';
  var html = '<div class="breadcrumb">Início &raquo; Registro</div>';
  html += '<div class="cat-header"><span>Criar Conta</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;max-width:400px;">';
  html += '<div class="form-row"><label>Usuário</label><input type="text" id="reg-username"></div>';
  html += '<div class="form-row"><label>Email</label><input type="email" id="reg-email"></div>';
  html += '<div class="form-row"><label>Senha</label><input type="password" id="reg-password"></div>';
  html += '<div class="form-row"><label>Confirmar Senha</label><input type="password" id="reg-confirm"></div>';
  html += '<button class="btn btn-primary" onclick="submitRegistro()">Cadastrar</button>';
  html += '</div>';
  return html;
}

function renderSobre() {
  var html = '<div class="breadcrumb">Início &raquo; Sobre</div>';
  html += '<div class="cat-header"><span>Sobre o Projeto</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;font-size:12px;line-height:1.7;">';
  html += '<p>Éterverso é um fórum para postar histórias, criar fichas de personagem e discutir roleplay. Tudo fica guardado em um banco de dados PostgreSQL próprio do projeto.</p>';
  html += '<p>O Éterverso constitui um universo ficcional de Roleplay (RPG) de autoria original, cujos personagens, enredos, ambientações e demais elementos narrativos são de criação e titularidade exclusiva de seus idealizadores e mantenedores. Eventuais imagens de referência utilizadas nas fichas de personagens — sejam elas extraídas de wikis, bancos de imagem ou outras fontes externas — são empregadas estritamente como recurso ilustrativo e de caráter não-comercial, sob amparo dos princípios de uso justo e de citação para fins de caracterização ficcional, não configurando, em nenhuma hipótese, apropriação de autoria sobre a obra literária em si, a qual permanece integralmente resguardada por direito autoral em favor de seus criadores.</p>' +
    '<p>Está nos planos do projeto, a médio e longo prazo, expandir o Éterverso para além deste fórum: a proposta é transformá-lo em uma plataforma aberta a todos os rpgistas textuais que desejem narrar histórias dentro deste universo, além de dar origem, futuramente, a uma série de livros baseada no material produzido pela comunidade e pelos criadores originais.</p>';
  html += '</div>';

  html += '<div class="cat-header" style="margin-top:14px;"><span>Equipe Atual</span></div>';
  equipe.forEach(function(m) {
    html += '<div class="char-card" style="cursor:default;">';
    if (m.foto) {
      html += '<img class="thumb" src="' + ha(m.foto) + '" alt="' + ha(m.nome) + '">';
    } else {
      html += '<div class="thumb-ph">' + h(m.nome.substring(0, 1)) + '</div>';
    }
    html += '<div class="char-card-info"><h4>' + h(m.nome) + '</h4><p>' + h(m.cargo) + '</p></div>';
    html += '</div>';
  });

  return html;
}

function renderAdmin() {
  if (!isAdmin()) return '<div class="alert alert-error">Acesso negado.</div>';

  var html = '<div class="breadcrumb">Início &raquo; Painel Admin</div>';
  html += '<div class="cat-header"><span>Usuários</span></div>';
  html += '<table class="forum-table"><thead><tr><th>Usuário</th><th>Cargo</th><th>Posts</th><th>Ações</th></tr></thead><tbody>';
  DB.users.forEach(function(u) {
    html += '<tr><td>' + h(u.username) + '</td><td>' + badgeHtml(u) + '</td><td>' + (u.posts || 0) + '</td><td>';
    html += '<select onchange="alterarCargoUsuario(\'' + u.id + '\', this.value)">';
    html += '<option value="member"' + (u.role === 'member' ? ' selected' : '') + '>Membro</option>';
    html += '<option value="moderador"' + (u.role === 'moderador' ? ' selected' : '') + '>Moderador</option>';
    html += '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>';
    html += '</select>';
    html += ' <button class="btn btn-small btn-danger" onclick="deletarUsuario(\'' + u.id + '\')">Excluir</button>';
    html += '</td></tr>';
  });
  html += '</tbody></table>';

  html += '<div class="cat-header"><span>Categorias</span></div>';
  html += '<table class="forum-table"><thead><tr><th>Nome</th><th>Descrição</th><th>Ações</th></tr></thead><tbody>';
  DB.categories.forEach(function(c) {
    html += '<tr><td>' + h(c.name) + '</td><td>' + h(c.desc) + '</td><td><button class="btn btn-small btn-danger" onclick="removerCategoria(\'' + c.id + '\')">Excluir</button></td></tr>';
  });
  html += '</tbody></table>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:12px;margin-bottom:14px;">';
  html += '<div class="form-row"><label>Nova categoria</label><input type="text" id="nova-cat-nome" placeholder="Nome da categoria"></div>';
  html += '<div class="form-row"><label>Descrição</label><input type="text" id="nova-cat-desc" placeholder="Descrição"></div>';
  html += '<button class="btn btn-primary btn-small" onclick="adicionarCategoria()">Adicionar Categoria</button>';
  html += '</div>';

  html += '<div class="stats-bar"><span><b>' + DB.users.length + '</b> usuários</span><span><b>' + DB.threads.length + '</b> tópicos</span><span><b>' + DB.posts.length + '</b> posts</span><span><b>' + DB.personagens.length + '</b> personagens</span></div>';
  return html;
}

function showModal(title, bodyHtml) {
  var c = document.getElementById('modal-container');
  c.innerHTML = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><span>' + h(title) + '</span><button onclick="closeModal()">&times;</button></div><div class="modal-body">' + bodyHtml + '</div></div></div>';
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

function showLoginModal() {
  var bodyHtml = '';
  bodyHtml += '<div class="form-row"><label>Usuário</label><input type="text" id="login-username"></div>';
  bodyHtml += '<div class="form-row"><label>Senha</label><input type="password" id="login-password"></div>';
  bodyHtml += '<button class="btn btn-primary" onclick="doLogin()">Entrar</button>';
  bodyHtml += '<div style="margin-top:10px;font-size:11px;">Não tem conta? <a onclick="closeModal();navigate(\'registro\')">Cadastre-se</a></div>';
  showModal('Entrar no Fórum', bodyHtml);
}

function showAlert(msg, type) {
  var main = document.getElementById('main');
  if (!main) return;
  var div = document.createElement('div');
  div.className = 'alert alert-' + type;
  div.textContent = msg;
  main.insertBefore(div, main.firstChild);
  setTimeout(function() {
    if (div.parentNode) div.parentNode.removeChild(div);
  }, 3500);
}

async function doLogin() {
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;
  try {
    await api('POST', '/api/auth/login', { username: username, password: password });
    await refreshBootstrap();
    closeModal();
    navigate('forum');
    showAlert('Login realizado com sucesso.', 'success');
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function doLogout() {
  await api('POST', '/api/auth/logout');
  await refreshBootstrap();
  navigate('forum');
}

async function submitRegistro() {
  var username = document.getElementById('reg-username').value.trim();
  var password = document.getElementById('reg-password').value;
  var confirm2 = document.getElementById('reg-confirm').value;
  var email = document.getElementById('reg-email').value.trim();

  try {
    await api('POST', '/api/auth/register', { username: username, email: email, password: password, confirm: confirm2 });
    await refreshBootstrap();
    navigate('forum');
    showAlert('Cadastro realizado. Bem-vindo(a)!', 'success');
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function atualizarPreviewAvatar() {
  var input = document.getElementById('perfil-avatar');
  var img = document.getElementById('perfil-avatar-preview');
  if (!input || !img) return;
  var url = input.value.trim();
  if (url) {
    img.src = url;
    img.style.display = '';
  } else {
    img.style.display = 'none';
  }
}

async function salvarPerfil() {
  var avatar = document.getElementById('perfil-avatar').value.trim();
  var bio = document.getElementById('perfil-bio').value.trim();
  var senhaAtual = document.getElementById('perfil-senha-atual').value;
  var senhaNova = document.getElementById('perfil-senha-nova').value;
  var senhaConfirmar = document.getElementById('perfil-senha-confirmar').value;

  if (senhaNova && senhaNova !== senhaConfirmar) {
    showAlert('As senhas novas não conferem.', 'error');
    return;
  }

  var dados = { avatar: avatar, bio: bio };
  if (senhaNova) {
    dados.currentPassword = senhaAtual;
    dados.newPassword = senhaNova;
    dados.newPasswordConfirm = senhaConfirmar;
  }

  try {
    await api('PUT', '/api/profile', dados);
    await refreshBootstrap();
    navigate('perfil');
    showAlert('Perfil atualizado.', 'success');
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function startNewThread(catId) {
  currentCat = catId;
  editandoThread = null;
  navigate('novaThread');
}

function atualizarTipoThreadPadrao(catId) {
  currentCat = catId;
  render();
}

async function submitThread() {
  var title = document.getElementById('thread-title').value.trim();
  var content = getEditorContent('thread-editor');
  var catId = document.getElementById('thread-cat').value;
  var tag = document.getElementById('thread-tag').value;
  try {
    var data = await api('POST', '/api/threads', { catId: catId, title: title, tag: tag, content: content });
    await refreshBootstrap();
    editandoThread = null;
    clearDraft('thread-editor');
    navigate('thread', data.thread.id);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function editarThread(threadId) {
  var thread = DB.threads.find(function(t) { return t.id === threadId; });
  if (!thread) return;
  if (!podeEditarThread(thread.authorId)) { var infoEdit = tipoInfo(thread.tag); showAlert('Você não tem permissão para editar ' + infoEdit.dem + ' ' + infoEdit.nome.toLowerCase() + '.', 'error'); return; }
  editandoThread = threadId;
  navigate('novaThread');
}

async function salvarEdicaoThread() {
  var title = document.getElementById('thread-title').value.trim();
  var content = getEditorContent('thread-editor');
  var tid = editandoThread;
  try {
    await api('PUT', '/api/threads/' + tid, { title: title, content: content });
    await refreshBootstrap();
    editandoThread = null;
    clearDraft('thread-editor');
    navigate('thread', tid);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function deleteThread(threadId) {
  var thread = DB.threads.find(function(t) { return t.id === threadId; });
  if (!thread) return;
  var infoDel = tipoInfo(thread.tag);
  if (!confirm('Deletar ' + infoDel.dem + ' ' + infoDel.nome.toLowerCase() + ' inteir' + infoDel.artDef + ' e todas as respostas?')) return;
  var catId = thread.catId;
  try {
    await api('DELETE', '/api/threads/' + threadId);
    await refreshBootstrap();
    navigate('cat', catId);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function submitReply() {
  var content = getEditorContent('reply-editor');
  try {
    await api('POST', '/api/posts', { threadId: currentThread, content: content });
    await refreshBootstrap();
    clearDraft('reply-editor');
    navigate('thread', currentThread);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function quotePost(postId) {
  var post = DB.posts.find(function(p) { return p.id === postId; });
  if (!post) return;
  var author = getUserById(post.authorId);
  var replyEditor = document.getElementById('reply-editor');
  if (replyEditor) {
    replyEditor.focus();
    var quoteHtml = '<blockquote><strong>' + h(author ? author.username : '?') + ' escreveu:</strong><br>' + post.content + '</blockquote><p></p>';
    document.execCommand('insertHTML', false, quoteHtml);
    replyEditor.scrollIntoView({ behavior: 'smooth' });
  }
}

function editPost(postId) {
  var post = DB.posts.find(function(p) { return p.id === postId; });
  if (!post) return;
  if (!podeEditarPost(post.authorId)) { showAlert('Você não tem permissão para editar este post.', 'error'); return; }
  showModal('Editar Post',
    '<div class="form-row"><label>Conteúdo:</label>' + buildEditor('edit-post-editor', post.content) + '</div>' +
    '<div style="margin-top:8px;"><button class="btn btn-primary" onclick="saveEditPost(\'' + postId + '\')">Salvar</button></div>'
  );
}

async function saveEditPost(postId) {
  var content = getEditorContent('edit-post-editor');
  if (!content) return;
  try {
    await api('PUT', '/api/posts/' + postId, { content: content });
    await refreshBootstrap();
    clearDraft('edit-post-editor');
    closeModal();
    navigate('thread', currentThread);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function deletePost(postId) {
  var postsInThread = DB.posts.filter(function(p) { return p.threadId === currentThread; });
  if (!confirm('Deletar este post?')) return;
  var thr = DB.threads.find(function(t) { return t.id === currentThread; });
  if (postsInThread.length <= 1) {
    var infoDelPost = tipoInfo(thr ? thr.tag : null);
    if (!confirm('Esse é o único post — deletar vai apagar ' + infoDelPost.dem + ' ' + infoDelPost.nome.toLowerCase() + ' inteir' + infoDelPost.artDef + '. Confirma?')) return;
  }
  var catId = thr ? thr.catId : null;
  try {
    var data = await api('DELETE', '/api/posts/' + postId);
    await refreshBootstrap();
    if (data.threadDeleted) {
      navigate('cat', catId);
    } else {
      render();
    }
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function editarPersonagem(id) {
  sessionStorage.setItem('editPersonagemId', id);
  navigate('novoPersonagem');
}

function lerStatsDoFormulario() {
  function lerNum(id) {
    var n = parseInt(document.getElementById(id).value);
    if (isNaN(n)) n = 0;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    return n;
  }
  return {
    ifc: lerNum('p-stat-ifc'),
    ccm: lerNum('p-stat-ccm'),
    lrb: lerNum('p-stat-lrb'),
    acg: lerNum('p-stat-acg'),
    tpc: lerNum('p-stat-tpc'),
    ceo: lerNum('p-stat-ceo'),
    fdv: lerNum('p-stat-fdv'),
    icf: lerNum('p-stat-icf')
  };
}

function lerPersonagemDoFormulario() {
  return {
    nome: document.getElementById('p-nome').value.trim(),
    categoria: document.getElementById('p-categoria').value,
    titulo: document.getElementById('p-titulo').value.trim(),
    raca: document.getElementById('p-raca').value.trim(),
    faccao: document.getElementById('p-faccao').value.trim(),
    status: document.getElementById('p-status').value.trim(),
    imagem: document.getElementById('p-imagem').value.trim(),
    descricao: getEditorContent('p-editor'),
    stats: lerStatsDoFormulario(),
    apexTier: document.getElementById('p-apex-tier').value.trim(),
    mascaraTier: document.getElementById('p-mascara-tier').value.trim()
  };
}

async function submitPersonagem() {
  var dados = lerPersonagemDoFormulario();
  try {
    await api('POST', '/api/personagens', dados);
    await refreshBootstrap();
    clearDraft('p-editor');
    navigate('wiki');
    showAlert('Personagem cadastrado.', 'success');
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function salvarEdicaoPersonagem(id) {
  var dados = lerPersonagemDoFormulario();
  try {
    await api('PUT', '/api/personagens/' + id, dados);
    await refreshBootstrap();
    sessionStorage.removeItem('editPersonagemId');
    clearDraft('p-editor');
    navigate('personagemView', id);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function deletarPersonagem(id) {
  if (!confirm('Excluir este personagem?')) return;
  try {
    await api('DELETE', '/api/personagens/' + id);
    await refreshBootstrap();
    navigate('wiki');
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function submitComentario(personagemId) {
  var textarea = document.getElementById('comentario-texto');
  var texto = textarea ? textarea.value.trim() : '';
  if (!texto) { showAlert('Escreva algo antes de comentar.', 'error'); return; }
  try {
    await api('POST', '/api/personagens/' + personagemId + '/comments', { content: texto });
    await refreshBootstrap();
    render();
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function deletarComentario(id) {
  if (!confirm('Apagar este comentário?')) return;
  try {
    await api('DELETE', '/api/comments/' + id);
    await refreshBootstrap();
    render();
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function alterarCargoUsuario(id, novoCargo) {
  try {
    await api('PUT', '/api/users/' + id + '/role', { role: novoCargo });
    await refreshBootstrap();
    render();
  } catch (e) {
    showAlert(e.message, 'error');
    render();
  }
}

async function deletarUsuario(id) {
  if (!confirm('Excluir este usuário?')) return;
  try {
    await api('DELETE', '/api/users/' + id);
    await refreshBootstrap();
    render();
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function adicionarCategoria() {
  var nome = document.getElementById('nova-cat-nome').value.trim();
  var desc = document.getElementById('nova-cat-desc').value.trim();
  try {
    await api('POST', '/api/categories', { name: nome, desc: desc });
    await refreshBootstrap();
    render();
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function removerCategoria(id) {
  if (!confirm('Excluir esta categoria? Os tópicos dentro dela também serão removidos.')) return;
  try {
    await api('DELETE', '/api/categories/' + id);
    await refreshBootstrap();
    render();
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

async function onClickValidarAdmin() {
  var msg = document.getElementById('adm-message');
  var botao = document.getElementById('validar-adm');
  var nome = document.getElementById('adm-nome').value.trim();
  var cargo = document.getElementById('adm-cargo').value.trim().toLowerCase();
  var nivel = document.getElementById('adm-nivel').value.trim();

  try {
    var data = await api('POST', '/api/admin/validar', { nome: nome, cargo: cargo, nivel: nivel });
    await refreshBootstrap();
    if (data.alreadyUsed) {
      if (msg) msg.textContent = 'Você já usou sua única tentativa.';
    } else if (data.granted) {
      if (msg) msg.textContent = 'Acesso de administrador concedido (talvez).';
    } else {
      if (msg) msg.textContent = 'Acesso negado. Essa foi sua única tentativa.';
    }
    updateTopBar();
    if (botao) botao.disabled = true;
    setTimeout(function() { navigate('perfil'); }, 900);
  } catch (e) {
    if (msg) msg.textContent = e.message;
  }
}

window.addEventListener('DOMContentLoaded', function() {
  refreshBootstrap().then(function() {
    navigate('forum');
  }).catch(function(e) {
    document.getElementById('main').innerHTML = '<div class="alert alert-error">Não foi possível conectar ao servidor: ' + h(e.message) + '</div>';
  });
});
