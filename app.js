var DB = {
  users: [
    { id: 1, username: 'Admin', email: 'admin@forum.com', avatar: '', title: 'Administrador', posts: 0, role: 'admin', bio: '', joinDate: '01/01/2026', admTentativaUsada: false },
    { id: 2, username: 'MandRaiden', email: 'mandraiden@forum.com', avatar: '', title: 'Dono do aetherverse vault', posts: 0, role: 'admin', bio: 'Criador e dono do aetherverse vault.', joinDate: '01/01/2026', admTentativaUsada: true },
    { id: 3, username: 'Rick', email: 'rick@forum.com', avatar: 'https://i.pinimg.com/736x/02/bc/1d/02bc1ddfb478c7069ac1db5017955648.jpg', title: 'Moderador — Dono da Wikia', posts: 0, role: 'moderador', bio: 'Responsável pela wikia de personagens.', joinDate: '01/01/2026', admTentativaUsada: true }
  ],
  nextUserId: 4,

  categories: [
    { id: 1, name: 'Geral & Anúncios', desc: 'Notícias e avisos importantes do fórum.' },
    { id: 2, name: 'Roleplay — Cenas', desc: 'Poste e continue cenas de RPG aqui.' },
    { id: 4, name: 'Power Scaling', desc: 'O sistema oficial de avaliação de poder dos personagens do fórum.' }
  ],

  threads: [
    { id: 1, catId: 4, title: 'Como funciona o Power Scaling neste fórum', authorId: 2, date: '30/06/2026 12:00', views: 0, pinned: true, tag: 'wiki' },
    { id: 3, catId: 1, title: 'Alpha da Wikia está oficialmente aberta', authorId: 3, date: '30/06/2026 13:00', views: 0, pinned: true, tag: 'ooc' }
  ],
  nextThreadId: 4,

  posts: [
    {
      id: 1, threadId: 1, authorId: 2, date: '30/06/2026 12:00',
      content: '<p>O scaling dos personagens deste fórum é feito pela <b>moderação</b> — um cálculo conduzido sob o critério e a leitura própria dos administradores sobre os feitos e o contexto da história do personagem.</p>' +
        '<p>Além disso, cada ficha pode ter seus <b>atributos</b> preenchidos pelo próprio autor, gerando um gráfico de teia na página do personagem.</p>',
      edited: false
    },
    {
      id: 3, threadId: 3, authorId: 3, date: '30/06/2026 13:00',
      content: '<p>A alpha da Wikia do aetherverse vault foi oficialmente disponibilizada para uso público. O módulo de cadastro de fichas já está habilitado, contudo trata-se de uma build inicial, ainda em estágio preliminar de maturação técnica. Segue o levantamento das pendências estruturais do sistema:</p>' +
        '<ul>' +
        '<li><b>Camada de persistência</b>: o estado da aplicação é mantido inteiramente no localStorage do navegador cliente, sem um sistema de gerenciamento de banco de dados (SGBD) propriamente dito, sem replicação e sem rotina de backup.</li>' +
        '<li><b>Autenticação e gestão de credenciais</b>: usuário e senha ainda trafegam e são persistidos em texto plano, sem hashing criptográfico (bcrypt, argon2 ou equivalente) nem salting, o que expõe as contas a qualquer vazamento trivial de dados.</li>' +
        '<li><b>Armazenamento de mídia</b>: a inserção de imagens depende exclusivamente de URLs externas; não há pipeline de upload próprio, tampouco integração com CDN para servir os assets.</li>' +
        '<li><b>Controle de acesso</b>: falta granularidade fina entre os níveis de permissão (RBAC), mecanismos de rate limiting contra abuso e trilhas de auditoria para rastrear ações administrativas.</li>' +
        '<li><b>Indexação e busca</b>: inexiste qualquer motor de busca full-text ou indexação estruturada por personagem, tópico ou atributo.</li>' +
        '<li><b>Validação e sanitização</b>: diversos campos aceitam entrada arbitrária sem validação ou sanitização server-side, o que abre margem para vetores de injeção assim que houver, de fato, um back-end.</li>' +
        '</ul>' +
        '<p>Estou em busca de colaboradores para duas frentes técnicas específicas: desenvolvimento de <b>back-end</b> (arquitetura de API, modelagem e implementação de um banco de dados persistente) e <b>segurança da informação</b> (hashing e salting de credenciais, sanitização de entrada, gestão de sessão via tokens assinados). Quem tiver domínio técnico nessas áreas e interesse em contribuir, entre em contato.</p>',
      edited: false
    }
  ],
  nextPostId: 4,

  personagens: [],
  nextPersonagemId: 1,

  equipe: [
    { nome: 'Rick', cargo: 'Dono e Moderador' },
    { nome: 'Mand Raiden', cargo: 'Criador, Escritor e Dono da Obra' },
    { nome: 'Ghostmaker', cargo: 'Criador, Escritor e Vice-Dono da Obra' },
    { nome: 'Scautz', cargo: 'Criador e Escritor' },
    { nome: 'Lucas Kabii', cargo: 'Criador e Colaborador' }
  ],

  wikiPosts: [],
  nextWikiPostId: 1,

  notifications: [],
  unreadCount: 0,

  session: null
};

function loadDB() {
  // Do not replay old browser-local forum/account state into shared screens.
  // The legacy key remains byte-for-byte available to legacy-recovery.html.
  DB.session = null;
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

function jsArg(value) {
  var serialized = JSON.stringify(String(value)).replace(/[<>&\u2028\u2029]/g, function(character) {
    return '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');
  });
  return ha(serialized);
}

function formatPost(content) {
  return content;
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

function roleBadgeFromRole(role) {
  if (role === 'admin') return '<span class="admin-badge">ADMIN</span>';
  if (role === 'moderador') return '<span class="mod-badge">MODERADOR</span>';
  return '<span class="member-badge">MEMBRO</span>';
}

var USER_AVATAR_PATH_PATTERN = /^\/api\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/avatar(?:\?v=[1-9]\d{0,9})?$/i;
var DATA_AVATAR_PREVIEW_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
var pendingProfileAvatarUpload = null;
var pendingProfileAvatarCleared = false;
var profileAvatarPreparing = false;

function safeAvatarSrc(url) {
  if (typeof url !== 'string') return '';
  var trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048 || /[\u0000-\u001F\u007F\s]/.test(trimmed)) return '';
  if (USER_AVATAR_PATH_PATTERN.test(trimmed)) return trimmed;
  if (trimmed.slice(0, 8).toLowerCase() !== 'https://') return '';
  try {
    var parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function safeProfilePreviewSrc(url) {
  if (typeof url === 'string' && url.length <= 720000 && DATA_AVATAR_PREVIEW_PATTERN.test(url)) {
    return url;
  }
  return safeAvatarSrc(url);
}

function userInitials(name, maxChars) {
  var clean = String(name || '').trim();
  var count = maxChars || 1;
  if (!clean) return '?';
  return clean.substring(0, count).toUpperCase();
}

function renderMiniAvatar(name, avatarUrl, extraClass) {
  var cls = extraClass ? (' ' + ha(extraClass)) : '';
  var safeUrl = safeAvatarSrc(avatarUrl);
  if (safeUrl) {
    return '<img class="inline-user-avatar' + cls + '" src="' + ha(safeUrl) + '" alt="' + ha(name || 'Avatar') + '">';
  }
  return '<span class="inline-user-avatar-ph' + cls + '" aria-hidden="true">' + h(userInitials(name, 1)) + '</span>';
}

function renderAuthorChip(author, fallbackLabel, prefixText) {
  if (!author && !fallbackLabel) return '';
  var username = (author && author.username) ? author.username : (fallbackLabel || 'Membro');
  var avatar = author ? author.avatar : '';
  var prefix = prefixText ? '<span class="inline-user-prefix">' + h(prefixText) + '</span>' : '';
  return '<span class="inline-user-chip">' + prefix + renderMiniAvatar(username, avatar) + '<span class="inline-user-name">' + h(username) + '</span></span>';
}

function podeEditarThread(authorId) {
  if (!DB.session) return false;
  if (isModOrAdmin()) return true;
  if (DB.session.id === authorId) return true;
  return false;
}

function podeEditarPost(authorId) {
  return podeEditarThread(authorId);
}

function podeEditarTurno(turno) {
  if (!DB.session || !turno) return false;
  if (isModOrAdmin()) return true;
  if (String(turno.authorId) === String(DB.session.id)) return true;
  if (DB.session.serverId && String(turno.authorId) === String(DB.session.serverId)) return true;
  if (turno.authorName && DB.session.username && turno.authorName.toLowerCase() === DB.session.username.toLowerCase()) return true;
  return false;
}

function countWordsFromHtml(html) {
  var plain = String(html || '').replace(/<[^>]+>/g, ' ').trim();
  if (!plain) return 0;
  return plain.split(/\s+/).length;
}

function calcStatTotal(stats) {
  if (!stats) return 0;
  var sum = 0;
  for (var i = 0; i < STAT_KEYS.length; i++) {
    sum += (parseInt(stats[STAT_KEYS[i]], 10) || 0);
  }
  return sum;
}

var currentPage = 'forum';
var currentThread = null;
var currentCat = null;
var currentPersonagem = null;
var currentCena = null;
var editandoThread = null;
var serverForumCategories = null;
var serverForumThreads = Object.create(null);
var forumLandingLoaded = false;
var serverForumThread = null;
var serverForumPosts = null;
var serverForumPostsPage = { limit: 20, offset: 0, hasMore: false };
var forumLandingLoading = false;
var forumCategoryLoading = Object.create(null);
var forumThreadLoading = false;
var forumThreadLoadingId = null;
var forumThreadRequestSequence = 0;
var forumLoadError = null;
var pendingTopicKey = null;
var pendingTopicPayload = null;
var pendingReplyKey = null;
var pendingReplyPayload = null;
var forumDraftRestoreSequence = 0;
var FORUM_DRAFT_VERSION = 1;
var wikiArticleFileState = createWikiArticleFileState();
var wikiStaffState = { items: null, article: null, loading: false, error: null };
var serverWikiPages = null;
var serverWikiSections = null;
var wikiSectionsLoading = false;
var wikiSectionsError = null;
var wikiSectionsGeneration = 0;
var serverWikiCategories = null;
var wikiCategoriesLoading = false;
var wikiCategoriesError = null;
var wikiPagesLoadError = null;
var wikiPagesLoading = false;
var currentWikiSlug = null;
var currentWikiPageId = null;
var currentWikiArticle = null;
var wikiArticleLoading = false;
var wikiArticleLoadingSlug = null;
var wikiArticleLoadError = null;
var wikiArticleLoadErrorSlug = null;
var wikiArticleRequestSequence = 0;
var wikiBacklinksState = { pageId: null, items: [], loading: false, loaded: false, hasMore: false, error: null };
var wikiBacklinksRequestSequence = 0;
var wikiProposalState = { items: [], staffItems: [], loading: false, loaded: false, error: null };
var wikiProposalRequestSequence = 0;
var wikiEditorPage = null;
var wikiEditorLoading = false;
var wikiEditorLoadingId = null;
var wikiEditorError = null;
var wikiEditorErrorId = null;
var wikiEditorLoadedId = null;
var wikiEditorRequestSequence = 0;
var wikiEditorHistory = { items: [], loading: false, loaded: false, error: null };
var wikiEditorDiffState = { pageId: null, beforeRevisionId: '', afterRevisionId: '', loading: false, error: null, result: null };
var wikiEditorDiffRequestSequence = 0;
var wikiEditorDiscussionState = {
  pageId: null, categories: null, selectedCategoryId: '', threads: [], loadingCategories: false,
  loadingThreads: false, error: null, currentThread: null, currentThreadId: null,
  loadingCurrentThread: false, saving: false,
};
var wikiEditorDiscussionRequestSequence = 0;
var wikiEditorDraftRestoreKey = null;
var wikiEditorDraftRestorePending = false;
var wikiEditorDraftRestoreError = null;
var wikiEditorDraftRestoreCompleteKey = null;
var wikiProposalDraftRestorePending = false;
var wikiProposalDraftRestoreError = null;
var wikiProposalDraftSafeHtml = null;
var wikiProposalDraftSafeHtmlKey = null;
var wikiProposalDetail = null;
var wikiProposalDetailLoading = false;
var wikiProposalDetailLoadingId = null;
var wikiProposalDetailError = null;
var wikiProposalDetailErrorId = null;
var wikiProposalDetailRequestSequence = 0;
var wikiProposalPage = null;
var WIKI_DRAFT_VERSION = 1;

// Filtros de UI
var forumFilterSearch = '';
var forumFilterTag = 'all';
var wikiFilterSearch = '';
var wikiFilterCategory = 'all';
var wikiFilterCat = 'all';
var wikiFilterRaca = 'all';
var wikiSortBy = 'default';
var cenasFilterSearch = '';
var cenasFilterCat = 'all';
var cenasFilterStatus = 'all';
var turnSortOrder = 'asc';
var adminState = { users: [], categories: [], events: [], userPage: { limit: 50, offset: 0, hasMore: false }, loading: false, loaded: false, error: null };
var adminLoadSequence = 0;
var adminWikiTransferState = createAdminWikiTransferState();

function createAdminWikiTransferState() {
  return {
    pages: [], pagesLoading: false, pagesLoaded: false, pagesError: null,
    exportPageIds: [], exportPending: false, exportError: null, exportMessage: null,
    fileName: '', bundle: null, importPending: false, importError: null,
    importId: null, importVersion: null, importPlanHash: null, importPreview: null,
    importPageIds: [], importConfirmed: false, refreshPending: false,
    commitPending: false, commitError: null, commitMessage: null, commitReport: null,
  };
}

function routePath(page, extra) {
  if (page === 'forum') return '/forum';
  if (page === 'cat' && typeof extra === 'string') return '/forum/categorias/' + encodeURIComponent(extra);
  if (page === 'thread' && typeof extra === 'string') return '/forum/topicos/' + encodeURIComponent(extra);
  if (page === 'wiki') return '/wiki';
  if (page === 'wikiStaff') return '/wiki/equipe';
  if (page === 'wikiStaffArticle' && typeof extra === 'string') return '/wiki/rascunhos/' + encodeURIComponent(extra);
  if (page === 'wikiArticle' && typeof extra === 'string') return '/wiki/' + encodeURIComponent(extra);
  if (page === 'wikiCreate') return '/wiki/novo';
  if (page === 'wikiEditor' && typeof extra === 'string') return '/wiki/editor/' + encodeURIComponent(extra);
  if (page === 'wikiEditor') return '/wiki/editor';
  if (page === 'wikiProposals') return '/wiki/propostas';
  if (page === 'wikiProposal' && typeof extra === 'string') return '/wiki/propostas/' + encodeURIComponent(extra);
  if (page === 'personagens') return '/personagens';
  if (page === 'personagemView' && typeof extra === 'string') return '/personagens/' + encodeURIComponent(extra);
  if (page === 'cenas') return '/cenas';
  if (page === 'cenaView' && typeof extra === 'string') return '/cenas/' + encodeURIComponent(extra);
  if (page === 'timeline') return '/timeline';
  if (page === 'admin') return '/admin';
  return null;
}

function parseRouteFromLocation() {
  var path = window.location.pathname;
  var match;
  if (path === '/' || path === '/index.html' || path === '/forum') {
    currentPage = 'forum';
    currentCat = null;
    currentThread = null;
    if (path !== '/forum') window.history.replaceState({ page: 'forum' }, '', '/forum');
    return;
  }
  match = path.match(/^\/forum\/categorias\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'cat'; currentCat = decodeURIComponent(match[1]); return; }
  match = path.match(/^\/forum\/topicos\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'thread'; currentThread = decodeURIComponent(match[1]); return; }
  if (path === '/wiki') {
    currentPage = 'wiki';
    var category = new URL(window.location.href).searchParams.get('categoria');
    wikiFilterCategory = category && /^[a-z0-9][a-z0-9-]{0,99}$/.test(category) ? category : 'all';
    return;
  }
  if (path === '/wiki/equipe') { currentPage = 'wikiStaff'; return; }
  match = path.match(/^\/wiki\/rascunhos\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'wikiStaffArticle'; currentWikiPageId = match[1].toLowerCase(); return; }
  if (path === '/wiki/novo') { currentPage = 'wikiCreate'; currentWikiPageId = null; return; }
  if (path === '/wiki/editor') { currentPage = 'wikiEditor'; currentWikiPageId = null; return; }
  match = path.match(/^\/wiki\/editor\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'wikiEditor'; currentWikiPageId = decodeURIComponent(match[1]).toLowerCase(); return; }
  if (path === '/wiki/propostas') { currentPage = 'wikiProposals'; return; }
  match = path.match(/^\/wiki\/propostas\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'wikiProposal'; currentWikiPageId = decodeURIComponent(match[1]).toLowerCase(); return; }
  match = path.match(/^\/wiki\/([a-z0-9][a-z0-9_-]{0,119})$/i);
  if (match) { currentPage = 'wikiArticle'; currentWikiSlug = decodeURIComponent(match[1]); return; }
  if (path === '/personagens') { currentPage = 'personagens'; return; }
  if (path === '/admin') { currentPage = 'admin'; return; }
  match = path.match(/^\/personagens\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'personagemView'; currentPersonagem = decodeURIComponent(match[1]); return; }
  if (path === '/cenas') { currentPage = 'cenas'; return; }
  match = path.match(/^\/cenas\/([0-9a-f-]{36})$/i);
  if (match) { currentPage = 'cenaView'; currentCena = decodeURIComponent(match[1]); return; }
  if (path === '/timeline') { currentPage = 'timeline'; return; }
  currentPage = 'notFound';
}

function navigate(page, extra, options) {
  if (page === 'wiki') wikiFilterCategory = 'all';
  if (page === 'wikiStaff' || page === 'wikiStaffArticle') wikiStaffState = { items: null, article: null, loading: false, error: null };
  currentPage = page;
  if (extra !== undefined) {
    if (page === 'thread') currentThread = extra;
    if (page === 'cat') currentCat = extra;
    if (page === 'personagemView') currentPersonagem = extra;
    if (page === 'cenaView') currentCena = extra;
    if (page === 'wikiArticle') currentWikiSlug = extra;
    if (page === 'wikiEditor' || page === 'wikiStaffArticle') currentWikiPageId = extra;
    if (page === 'wikiProposal') currentWikiPageId = extra;
  }
  var destination = routePath(page, extra);
  if (destination && !(options && options.fromHistory) && window.location.pathname + (window.location.search || '') + (window.location.hash || '') !== destination) {
    if (options && options.replace) window.history.replaceState({ page: page, id: extra }, '', destination);
    else window.history.pushState({ page: page, id: extra }, '', destination);
  }
  document.querySelectorAll('#nav-bar button').forEach(function(b) { b.classList.remove('active'); });
  var navMap = {
    forum: 'nav-forum', cat: 'nav-forum', thread: 'nav-forum', novaThread: 'nav-forum',
    wiki: 'nav-wiki', wikiStaff: 'nav-wiki', wikiStaffArticle: 'nav-wiki', wikiArticle: 'nav-wiki', wikiEditor: 'nav-wiki', wikiCreate: 'nav-wiki', wikiProposals: 'nav-wiki', wikiProposal: 'nav-wiki',
    personagens: 'nav-personagens', personagemView: 'nav-personagens', novoPersonagem: 'nav-personagens',
    cenas: 'nav-cenas', cenaView: 'nav-cenas', novaCena: 'nav-cenas',
    timeline: 'nav-timeline',
    sobre: 'nav-sobre',
    perfil: null, registro: null, admin: null
  };
  var navId = navMap[page];
  if (navId) { var el = document.getElementById(navId); if (el) el.classList.add('active'); }
  updateTopBar();
  render();
  if (page === 'admin') loadAdminData(false);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', function() {
  parseRouteFromLocation();
  if (currentPage === 'wikiStaff' || currentPage === 'wikiStaffArticle') wikiStaffState = { items: null, article: null, loading: false, error: null };
  updateTopBar();
  render();
});

function updateTopBar() {
  var info = document.getElementById('top-user-info');
  var actions = document.getElementById('top-btn-area');
  var adminBtn = document.getElementById('nav-admin-btn');
  if (DB.session) {
    info.innerHTML = '<span class="online-dot"></span>' + renderMiniAvatar(DB.session.username, DB.session.avatar, 'top-user-avatar') + '<a onclick="navigate(\'perfil\')" style="font-weight:600;color:#fff;">' + h(DB.session.username) + '</a> ' + badgeHtml(DB.session);
    actions.innerHTML = '<a onclick="navigate(\'perfil\')">Perfil</a>' + renderSinoNotificacoes() + '<a onclick="doLogout()">Sair</a>';
    if (isAdmin()) {
      adminBtn.innerHTML = '<button onclick="navigate(\'admin\')" class="' + (currentPage === 'admin' ? 'active' : '') + '">Admin</button>';
    } else {
      adminBtn.innerHTML = '';
    }
  } else {
    info.innerHTML = '<span>Visitante</span>';
    actions.innerHTML = '<a onclick="showLoginModal()">Entrar</a><a onclick="navigate(\'registro\')">Criar Conta</a>';
    adminBtn.innerHTML = '';
  }
}

function openLightbox(url, caption) {
  if (!url) return;
  var c = document.getElementById('lightbox-container');
  if (!c) return;
  c.innerHTML = '<div class="lightbox-overlay" onclick="closeLightbox()">' +
    '<img src="' + ha(url) + '" alt="Imagem ampliada">' +
    (caption ? '<div class="lightbox-caption">' + h(caption) + '</div>' : '') +
    '</div>';
}

function closeLightbox() {
  var c = document.getElementById('lightbox-container');
  if (c) c.innerHTML = '';
}

function switchModTab(btnEl, paneId) {
  var nav = btnEl.parentNode;
  var block = nav.parentNode;
  nav.querySelectorAll('.mod-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  block.querySelectorAll('.mod-tab-pane').forEach(function(p) { p.classList.remove('active'); });
  btnEl.classList.add('active');
  var target = document.getElementById(paneId);
  if (target) target.classList.add('active');
}

function render() {
  var el = document.getElementById('main');
  var map = {
    forum: renderForum,
    cat: renderCat,
    thread: renderThread,
    novaThread: renderNovaThread,
    wiki: renderWiki,
    wikiStaff: renderWikiStaff,
    wikiStaffArticle: renderWikiStaffArticle,
    wikiArticle: renderWikiArticle,
    wikiCreate: renderWikiEditor,
    wikiEditor: renderWikiEditor,
    wikiProposals: renderWikiProposals,
    wikiProposal: renderWikiProposal,
    personagens: renderPersonagens,
    personagemView: renderPersonagemView,
    novoPersonagem: renderNovoPersonagem,
    cenas: renderCenas,
    cenaView: renderCenaView,
    novaCena: renderNovaCena,
    timeline: renderTimeline,
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
  restoreResourceFormDraft();
  addResourceDraftNotice();
  restoreForumDraftForCurrentRoute();
  if (currentPage === 'wikiEditor' || currentPage === 'wikiCreate') restoreWikiEditorDraftContent();
  if (currentPage === 'wikiArticle') restoreWikiProposalDraftContent();
  if ((currentPage === 'wikiArticle' || currentPage === 'wikiStaffArticle') && window.location.hash) {
    setTimeout(function() {
      try { var target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
        if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView();
      } catch (_error) {}
    }, 0);
  }

  // Carregar contagens de curtidas após o DOM ser atualizado
  setTimeout(function () {
    if (currentPage === 'personagemView' && currentPersonagem && DB.session) {
      carregarLikesPersonagem(currentPersonagem, function (err, data) {
        if (!err && data) aplicarLikeBtn('like-char-', currentPersonagem, data);
      });
    }
    if (currentPage === 'cenaView' && currentCena && DB.session) {
      var w = listaWikiPosts().find(function (x) { return String(x.id) === String(currentCena); });
      if (w) {
        carregarLikesCena(currentCena, function (err, data) {
          if (!err && data) aplicarLikeBtn('like-cena-', currentCena, data);
        });
        (Array.isArray(w.turns) ? w.turns : []).forEach(function (t) {
          carregarLikesTurno(currentCena, t.id, function (err, data) {
            if (!err && data) aplicarLikeBtn('like-turn-', t.id, data);
          });
        });
      }
    }
  }, 0);
}

// ==================== NOTIFICAÇÕES ====================

function carregarNotificacoesServidor() {
  if (!DB.session) return;
  fetch('/api/notifications?limit=50')
    .then(function(res) { return res.ok ? res.json() : null; })
    .then(function(data) {
      if (!data) return;
      DB.notifications = Array.isArray(data.notifications) ? data.notifications : [];
      DB.unreadCount = typeof data.unread === 'number' ? data.unread : DB.notifications.filter(function(n) { return !n.read; }).length;
      updateTopBar();
    })
    .catch(function() {});
}

function sincronizarNotificacoes(data) {
  if (!data) return;
  DB.notifications = Array.isArray(data.notifications) ? data.notifications : [];
  DB.unreadCount = typeof data.unread === 'number' ? data.unread : DB.notifications.filter(function(n) { return !n.read; }).length;
  render();
  updateTopBar();
}

function marcarNotificacaoLida(id) {
  apiPost('/api/notifications/' + id + '/read', {}, function(err) {
    if (err) { showAlert(err, 'error'); return; }
    var n = DB.notifications.find(function(x) { return String(x.id) === String(id); });
    if (n && !n.read) {
      n.read = true;
      DB.unreadCount = Math.max(0, DB.unreadCount - 1);
      updateTopBar();
      var itemEl = document.getElementById('notif-item-' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_'));
      if (itemEl) {
        itemEl.classList.remove('unread');
        itemEl.classList.add('read');
      }
    }
  });
}

function marcarTodasNotificacoesLidas() {
  apiPost('/api/notifications/read-all', {}, function(err) {
    if (err) { showAlert(err, 'error'); return; }
    DB.notifications.forEach(function(n) { n.read = true; });
    DB.unreadCount = 0;
    updateTopBar();
    showModal('Notificações', renderNotificacoesDropdown());
  });
}

function excluirNotificacao(id) {
  apiRequest('DELETE', '/api/notifications/' + id, undefined, function(err) {
    if (err) { showAlert(err, 'error'); return; }
    var idx = DB.notifications.findIndex(function(x) { return String(x.id) === String(id); });
    if (idx !== -1) {
      var wasUnread = !DB.notifications[idx].read;
      DB.notifications.splice(idx, 1);
      if (wasUnread) DB.unreadCount = Math.max(0, DB.unreadCount - 1);
      updateTopBar();
      showModal('Notificações', renderNotificacoesDropdown());
    }
  });
}

function tipoNotificacaoLabel(type) {
  if (type === 'turn_replied') return 'Novo turno na sua cena';
  if (type === 'like_personagem') return 'Sua ficha foi curtida';
  if (type === 'like_turn') return 'Seu turno foi curtido';
  if (type === 'like_wiki_post') return 'Sua cena foi curtida';
  return 'Notificação';
}

function renderNotificacoesDropdown() {
  if (!DB.session) return '';
  var lista = DB.notifications.slice().sort(function(a, b) {
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  var html = '<div class="notifications-panel">';
  html += '<div class="notifications-header">';
  html += '<h3 style="font-size:13px;font-weight:600;margin:0;color:#fff;">Notificações</h3>';
  html += '<button class="btn btn-small" onclick="marcarTodasNotificacoesLidas()" style="padding:3px 8px;font-size:11px;">Marcar todas como lidas</button>';
  html += '</div>';
  if (!lista.length) {
    html += '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;">Nenhuma notificação por enquanto.</div>';
  } else {
    lista.forEach(function(n) {
      var cssId = String(n.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      html += '<div id="notif-item-' + cssId + '" class="notification-item' + (n.read ? ' read' : ' unread') + '">';
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-weight:600;font-size:12px;color:#fff;">' + h(tipoNotificacaoLabel(n.type)) + '</div>';
      html += '<div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px;">' + h(n.message || '') + '</div>';
      html += '<div style="font-size:10px;color:var(--text-muted);margin-top:3px;">' + h(n.createdAt ? new Date(n.createdAt).toLocaleString('pt-BR') : '') + '</div>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px;align-items:center;font-size:11px;flex-shrink:0;">';
      if (!n.read) {
        html += '<button class="btn btn-small" onclick="marcarNotificacaoLida(' + jsArg(n.id) + ')" style="padding:2px 7px;font-size:10.5px;">Ler</button>';
      }
      html += '<button class="btn btn-small btn-danger" onclick="excluirNotificacao(' + jsArg(n.id) + ')" style="padding:2px 7px;font-size:10.5px;">Excluir</button>';
      html += '</div>';
      html += '</div>';
    });
  }
  html += '</div>';
  return html;
}

function renderSinoNotificacoes() {
  if (!DB.session) return '';
  var badge = DB.unreadCount > 0 ? ' <span class="notification-badge">' + (DB.unreadCount > 99 ? '99+' : DB.unreadCount) + '</span>' : '';
  return '<a class="notifications-bell-wrap" onclick="abrirNotificacoes()">Notificações' + badge + '</a>';
}

function abrirNotificacoes() {
  if (!DB.session) { showLoginModal(); return; }
  carregarNotificacoesServidor();
  showModal('Notificações', renderNotificacoesDropdown());
}

// ==================== CURTIDAS (LIKES) ====================

function carregarLikesPersonagem(id, cb) {
  apiRequest('GET', '/api/personagens/' + id + '/likes', undefined, function(err, data) {
    if (cb) cb(err, data);
  });
}

function carregarLikesCena(id, cb) {
  apiRequest('GET', '/api/wiki-posts/' + id + '/likes', undefined, function(err, data) {
    if (cb) cb(err, data);
  });
}

function carregarLikesTurno(wikiPostId, turnId, cb) {
  apiRequest('GET', '/api/wiki-posts/' + wikiPostId + '/turns/' + turnId + '/likes', undefined, function(err, data) {
    if (cb) cb(err, data);
  });
}

function formatarLikeTexto(liked, count) {
  var c = typeof count === 'number' ? count : 0;
  return (liked ? 'Curtido' : 'Curtir') + ' <span class="like-count">(' + c + ')</span>';
}

function toggleLikePersonagem(id, btnEl) {
  if (!DB.session) { showAlert('Faça login para curtir.', 'error'); return; }
  apiPost('/api/personagens/' + id + '/like', {}, function(err, data) {
    if (err) { showAlert(err, 'error'); return; }
    if (btnEl) {
      btnEl.classList.toggle('liked', !!data.liked);
      btnEl.innerHTML = formatarLikeTexto(!!data.liked, data.likeCount);
    }
    showAlert(data.liked ? 'Ficha curtida.' : 'Curtida removida.', data.liked ? 'success' : 'info');
  });
}

function toggleLikeCena(id, btnEl) {
  if (!DB.session) { showAlert('Faça login para curtir.', 'error'); return; }
  apiPost('/api/wiki-posts/' + id + '/like', {}, function(err, data) {
    if (err) { showAlert(err, 'error'); return; }
    if (btnEl) {
      btnEl.classList.toggle('liked', !!data.liked);
      btnEl.innerHTML = formatarLikeTexto(!!data.liked, data.likeCount);
    }
    showAlert(data.liked ? 'Cena curtida.' : 'Curtida removida.', data.liked ? 'success' : 'info');
  });
}

function toggleLikeTurno(wikiPostId, turnId, btnEl) {
  if (!DB.session) { showAlert('Faça login para curtir.', 'error'); return; }
  apiPost('/api/wiki-posts/' + wikiPostId + '/turns/' + turnId + '/like', {}, function(err, data) {
    if (err) { showAlert(err, 'error'); return; }
    if (btnEl) {
      btnEl.classList.toggle('liked', !!data.liked);
      btnEl.innerHTML = formatarLikeTexto(!!data.liked, data.likeCount);
    }
    showAlert(data.liked ? 'Turno curtido.' : 'Curtida removida.', data.liked ? 'success' : 'info');
  });
}

function aplicarLikeBtn(prefix, targetId, data) {
  var cssId = String(targetId).replace(/[^a-zA-Z0-9_-]/g, '_');
  var btn = document.getElementById(prefix + cssId);
  if (!btn) return;
  btn.classList.toggle('liked', !!data.userLiked);
  btn.innerHTML = formatarLikeTexto(!!data.userLiked, data.likeCount);
  btn.onclick = function () {
    if (prefix === 'like-char-') toggleLikePersonagem(targetId, this);
    if (prefix === 'like-cena-') toggleLikeCena(targetId, this);
    if (prefix === 'like-turn-') toggleLikeTurno(String(currentCena), targetId, this);
  };
}

// ==================== FÓRUM ====================

function onForumFilterChange() {
  var sEl = document.getElementById('forum-search-input');
  var tEl = document.getElementById('forum-tag-select');
  if (sEl) forumFilterSearch = sEl.value;
  if (tEl) forumFilterTag = tEl.value;
  if (currentPage === 'forum') {
    forumLandingLoaded = false;
    serverForumThreads = Object.create(null);
    loadForumLanding(true);
  } else if (currentPage === 'cat') {
    delete serverForumThreads[String(currentCat)];
    loadForumCategory(currentCat, true);
  }
  render();
  var sAfter = document.getElementById('forum-search-input');
  if (sAfter) {
    sAfter.focus();
    sAfter.setSelectionRange(sAfter.value.length, sAfter.value.length);
  }
}

function forumApi() {
  return window.Aetherverse;
}

function loadForumLanding(force) {
  if (forumLandingLoading || (!force && forumLandingLoaded)) return;
  forumLandingLoading = true;
  forumLoadError = null;
  forumApi().apiRequest('GET', '/api/forum/categories').then(function(categoryResponse) {
    serverForumCategories = Array.isArray(categoryResponse.data) ? categoryResponse.data : [];
    return Promise.all(serverForumCategories.map(function(category) {
      var params = { limit: '100', offset: '0' };
      if (forumFilterSearch.trim()) params.search = forumFilterSearch.trim();
      if (forumFilterTag !== 'all') params.tag = forumFilterTag;
      var query = new URLSearchParams(params);
      return forumApi().apiRequest('GET', '/api/forum/categories/' + encodeURIComponent(category.id) + '/threads?' + query.toString())
        .then(function(response) { serverForumThreads[category.id] = Array.isArray(response.data) ? response.data : []; });
    }));
  }).then(function() {
    forumLandingLoaded = true;
  }).catch(function(error) {
    forumLoadError = error && error.message ? error.message : 'Não foi possível carregar o fórum.';
  }).finally(function() {
    forumLandingLoading = false;
    if (currentPage === 'forum') render();
  });
}

function loadForumCategory(categoryId, force) {
  var key = String(categoryId);
  if (forumCategoryLoading[key] || (!force && serverForumCategories && serverForumCategories.some(function(category) { return String(category.id) === key; }) && Object.hasOwn(serverForumThreads, key))) return;
  forumCategoryLoading[key] = true;
  forumLoadError = null;
  if (!serverForumCategories) {
    forumApi().apiRequest('GET', '/api/forum/categories').then(function(response) {
      serverForumCategories = Array.isArray(response.data) ? response.data : [];
    }).catch(function(error) {
      forumLoadError = error && error.message ? error.message : 'Não foi possível carregar as categorias.';
      throw error;
    }).then(function() {
      return forumApi().apiRequest('GET', forumCategoryThreadsUrl(key));
    }).then(function(response) {
      serverForumThreads[key] = Array.isArray(response.data) ? response.data : [];
    }).catch(function(error) {
      forumLoadError = forumLoadError || (error && error.message ? error.message : 'Não foi possível carregar esta categoria.');
    }).finally(function() {
      delete forumCategoryLoading[key];
      if (currentPage === 'cat' && String(currentCat) === key) render();
    });
    return;
  }
  forumApi().apiRequest('GET', forumCategoryThreadsUrl(key))
    .then(function(response) { serverForumThreads[key] = Array.isArray(response.data) ? response.data : []; })
    .catch(function(error) { forumLoadError = error && error.message ? error.message : 'Não foi possível carregar esta categoria.'; })
    .finally(function() {
      delete forumCategoryLoading[key];
      if (currentPage === 'cat' && String(currentCat) === key) render();
    });
}

function forumCategoryThreadsUrl(categoryId) {
  var params = { limit: '100', offset: '0' };
  if (forumFilterSearch.trim()) params.search = forumFilterSearch.trim();
  if (forumFilterTag !== 'all') params.tag = forumFilterTag;
  return '/api/forum/categories/' + encodeURIComponent(categoryId) + '/threads?' + new URLSearchParams(params).toString();
}

function loadForumThread(threadId, options) {
  var key = String(threadId);
  if ((forumThreadLoading && String(forumThreadLoadingId) === key)
      || (!(options && options.force) && serverForumThread && String(serverForumThread.id) === key && Array.isArray(serverForumPosts))) return;
  forumThreadLoading = true;
  forumThreadLoadingId = key;
  var requestSequence = ++forumThreadRequestSequence;
  forumLoadError = null;
  var offset = options && options.offset ? options.offset : 0;
  if (offset === 0) {
    serverForumThread = null;
    serverForumPosts = null;
    serverForumPostsPage = { limit: 20, offset: 0, hasMore: false };
  }
  Promise.all([
    forumApi().apiRequest('GET', '/api/forum/threads/' + encodeURIComponent(key)),
    forumApi().apiRequest('GET', '/api/forum/threads/' + encodeURIComponent(key) + '/posts?limit=20&offset=' + offset),
  ]).then(function(responses) {
    if (requestSequence !== forumThreadRequestSequence) return;
    serverForumThread = responses[0].data;
    var postsResponse = responses[1];
    var nextPosts = Array.isArray(postsResponse.data) ? postsResponse.data : [];
    serverForumPosts = offset ? (serverForumPosts || []).concat(nextPosts) : nextPosts;
    serverForumPostsPage = postsResponse.page || { limit: 20, offset: offset, hasMore: false };
  }).catch(function(error) {
    if (requestSequence !== forumThreadRequestSequence) return;
    forumLoadError = error && error.message ? error.message : 'Não foi possível carregar esta conversa.';
  }).finally(function() {
    if (requestSequence === forumThreadRequestSequence) {
      forumThreadLoading = false;
      forumThreadLoadingId = null;
      if (currentPage === 'thread' && String(currentThread) === key) render();
    }
  });
}

function loadMoreForumPosts() {
  if (!serverForumThread || forumThreadLoading || !serverForumPostsPage.hasMore) return;
  loadForumThread(serverForumThread.id, { force: true, offset: serverForumPosts.length });
}

function newForumIdempotencyKey() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(character) {
    var random = Math.random() * 16 | 0;
    return (character === 'x' ? random : (random & 3 | 8)).toString(16);
  });
}

var RESOURCE_DRAFT_VERSION = 1;
var resourceDraftRestored = Object.create(null);
var resourceDraftRestorePending = Object.create(null);
var resourceDraftSubmissionPending = Object.create(null);
var localDraftWriteFailureNotices = Object.create(null);
var editingTurnId = null;
var editingForumPostId = null;

function reportLocalDraftWrite(key, saved) {
  if (!key) return saved;
  if (saved) {
    delete localDraftWriteFailureNotices[key];
  } else if (!localDraftWriteFailureNotices[key]) {
    localDraftWriteFailureNotices[key] = true;
    showAlert('Não foi possível salvar o rascunho local neste navegador. Mantenha esta página aberta se a solicitação falhar.', 'error');
  }
  return saved;
}

function resourceFormDraftDescriptor() {
  if (!DB.session) return null;
  if (document.getElementById('edit-turn-editor') && editingTurnId !== null) {
    return { kind: 'turn-edit', resourceId: String(currentCena) + ':' + String(editingTurnId), turnId: String(editingTurnId), sceneId: String(currentCena) };
  }
  if (document.getElementById('edit-post-editor') && editingForumPostId !== null) {
    return { kind: 'forum-post-edit', resourceId: String(editingForumPostId), postId: String(editingForumPostId) };
  }
  if (currentPage === 'perfil' && document.getElementById('prof-title')) {
    return { kind: 'profile', resourceId: 'profile' };
  }
  if (currentPage === 'novoPersonagem' && document.getElementById('p-nome')) {
    return { kind: 'character', resourceId: sessionStorage.getItem('editPersonagemId') || 'new' };
  }
  if (currentPage === 'novaCena' && document.getElementById('c-titulo')) {
    return { kind: 'scene', resourceId: sessionStorage.getItem('editCenaId') || 'new' };
  }
  if (currentPage === 'cenaView' && document.getElementById('turn-editor')) {
    return { kind: 'turn', resourceId: String(currentCena) };
  }
  return null;
}

function resourceFormDraftKey(descriptor, accountId) {
  if (!descriptor || !descriptor.kind) return null;
  accountId = accountId || forumDraftAccountId();
  if (!accountId || accountId === 'anonymous' || !/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  return 'aetherverse:form-draft:v' + RESOURCE_DRAFT_VERSION + ':' + encodeURIComponent(accountId) + ':'
    + descriptor.kind + ':' + encodeURIComponent(String(descriptor.resourceId));
}

function captureResourceFormDraft(descriptor) {
  try {
    if (descriptor.kind === 'profile') {
      var profileValues = {
        title: (document.getElementById('prof-title') || {}).value || '',
        avatar: (document.getElementById('prof-avatar') || {}).value || '',
        bio: (document.getElementById('prof-bio') || {}).value || ''
      };
      if (typeof pendingProfileAvatarUpload === 'string' && safeProfilePreviewSrc(pendingProfileAvatarUpload)) {
        profileValues.avatarUpload = pendingProfileAvatarUpload;
      } else if (pendingProfileAvatarCleared === true) {
        profileValues.avatarCleared = true;
      }
      return profileValues;
    }
    if (descriptor.kind === 'character') return lerFormPersonagem();
    if (descriptor.kind === 'scene') return lerFormularioCena();
    if (descriptor.kind === 'turn') return readTurnFormValues(false);
    if (descriptor.kind === 'turn-edit') return readTurnFormValues(true);
    if (descriptor.kind === 'forum-post-edit') {
      return {
        content: getEditorContent('edit-post-editor'),
        summary: (document.getElementById('edit-post-summary') || {}).value || ''
      };
    }
  } catch (_) { return null; }
  return null;
}

function writeResourceFormDraft(descriptor, values) {
  var accountId = forumDraftAccountId();
  var key = resourceFormDraftKey(descriptor, accountId);
  if (!key) return false;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return reportLocalDraftWrite(key, false);
  var record = { version: RESOURCE_DRAFT_VERSION, accountId: accountId, kind: descriptor.kind,
    resourceId: String(descriptor.resourceId), updatedAt: new Date().toISOString(), values: values };
  var serialized;
  try {
    serialized = JSON.stringify(record);
    if (serialized.length > 1000000) return reportLocalDraftWrite(key, false);
    window.localStorage.setItem(key, serialized);
    return reportLocalDraftWrite(key, true);
  } catch (_) { return reportLocalDraftWrite(key, false); }
}

function readResourceFormDraftRecord(descriptor, accountId) {
  var currentAccountId = accountId || forumDraftAccountId();
  var key = resourceFormDraftKey(descriptor, currentAccountId);
  if (!key) return null;
  try {
    var serialized = window.localStorage.getItem(key);
    if (!serialized || serialized.length > 1000000) return null;
    var record = JSON.parse(serialized);
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || record.version !== RESOURCE_DRAFT_VERSION || record.accountId !== currentAccountId
      || record.kind !== descriptor.kind || record.resourceId !== String(descriptor.resourceId)
      || !record.values || typeof record.values !== 'object' || Array.isArray(record.values)) return null;
    return record;
  } catch (_) { return null; }
}

function readResourceFormDraft(descriptor, accountId) {
  var record = readResourceFormDraftRecord(descriptor, accountId);
  return record ? record.values : null;
}

function clearResourceFormDraft(descriptor, accountId) {
  var key = resourceFormDraftKey(descriptor, accountId);
  if (!key) return;
  try { window.localStorage.removeItem(key); } catch (_) { /* Draft cleanup is best-effort. */ }
  delete resourceDraftRestored[key];
}

function saveActiveResourceFormDraft() {
  var descriptor = resourceFormDraftDescriptor();
  if (!descriptor) return null;
  var values = captureResourceFormDraft(descriptor);
  if (!values) return reportLocalDraftWrite(resourceFormDraftKey(descriptor), false);
  var saved = writeResourceFormDraft(descriptor, values);
  return saved ? { descriptor: descriptor, values: values } : false;
}

function initializeResourceFormDraftPersistence() {
  ['main', 'modal-container'].forEach(function(id) {
    var root = document.getElementById(id);
    if (!root || root.__resourceDraftPersistence) return;
    root.__resourceDraftPersistence = true;
    ['input', 'change', 'click'].forEach(function(eventName) {
      root.addEventListener(eventName, function(event) {
        var descriptor = resourceFormDraftDescriptor();
        if (!descriptor) return;
        var formRootId = descriptor.kind === 'turn-edit' || descriptor.kind === 'forum-post-edit'
          ? 'modal-container' : 'main';
        // A click in the page can open an edit modal. Do not let that click
        // overwrite the modal's existing draft with the server version used
        // to initialize the editor.
        if (root.id !== formRootId) return;
        if (eventName === 'click' && event.target && event.target.closest
          && event.target.closest('button') && (event.target.closest('button').type === 'submit'
            || event.target.closest('button').hasAttribute('data-resource-draft-discard'))) return;
        saveActiveResourceFormDraft();
      });
    });
  });
}

function readTurnFormValues(editing) {
  var prefix = editing ? 'edit-turn' : 'turn';
  var containerId = editing ? 'edit-turn-extra-imgs' : 'turn-extra-images-list';
  var values = {
    characterName: ((document.getElementById(prefix + '-char-name') || {}).value || '').trim(),
    characterTitle: ((document.getElementById(prefix + '-char-title') || {}).value || '').trim(),
    characterAvatar: ((document.getElementById(prefix + '-char-avatar') || {}).value || '').trim(),
    turnTitle: ((document.getElementById(prefix + '-title') || {}).value || '').trim(),
    location: ((document.getElementById(prefix + '-location') || {}).value || '').trim(),
    accentColor: (document.getElementById(prefix + '-accent') || {}).value || '#ffffff',
    banner: ((document.getElementById(prefix + (editing ? '-banner' : '-banner-url')) || {}).value || '').trim(),
    bannerStyle: (document.getElementById(prefix + '-banner-style') || {}).value || 'panoramic',
    images: lerImagensExtrasTurno(containerId),
    content: getEditorContent(prefix + '-editor'),
    oocNotes: ((document.getElementById(prefix + '-ooc') || {}).value || '').trim()
  };
  if (!editing) values.fontFamily = (document.getElementById('turn-font') || {}).value || 'serif';
  return values;
}

function restoreResourceFields(values, fields) {
  Object.keys(fields).forEach(function(name) {
    var target = document.getElementById(fields[name]);
    var value = values && values[name];
    if (!target || value === undefined || value === null) return;
    if (target.type === 'checkbox') target.checked = value === true;
    else if (typeof value === 'string' || typeof value === 'number') target.value = String(value);
  });
}

function applyResourceFormDraft(descriptor, values, safe) {
  if (descriptor.kind === 'profile') {
    restoreResourceFields(values, { title: 'prof-title', avatar: 'prof-avatar', bio: 'prof-bio' });
    if (typeof values.avatarUpload === 'string' && DATA_AVATAR_PREVIEW_PATTERN.test(values.avatarUpload)) {
      pendingProfileAvatarUpload = values.avatarUpload;
      pendingProfileAvatarCleared = false;
    } else if (values.avatarCleared === true) {
      pendingProfileAvatarUpload = null;
      pendingProfileAvatarCleared = true;
    }
    refreshProfileAvatarPreview();
  } else if (descriptor.kind === 'character') {
    restoreResourceFields(values, {
      nome: 'p-nome', categoria: 'p-categoria', titulo: 'p-titulo', raca: 'p-raca',
      faccao: 'p-faccao', status: 'p-status', imagem: 'p-imagem', mascaraTier: 'p-mascara-tier'
    });
    if (values.stats && typeof values.stats === 'object' && !Array.isArray(values.stats)) {
      STAT_KEYS.forEach(function(key) {
        var target = document.getElementById('p-stat-' + key);
        if (target && Object.hasOwn(values.stats, key)) target.value = String(values.stats[key]);
      });
    }
    if (values.theme && typeof values.theme.accentColor === 'string') {
      restoreResourceFields({ accentColor: values.theme.accentColor }, { accentColor: 'p-accent-color' });
    }
    var skillsRoot = document.getElementById('p-skills-list');
    if (skillsRoot && Array.isArray(values.skills)) {
      skillsRoot.innerHTML = '';
      values.skills.slice(0, 500).forEach(function(skill) {
        if (skill && typeof skill === 'object') skillsRoot.insertAdjacentHTML('beforeend', skillFormRowHtml(skill.nome || '', skill.descricao || '', skill.tipo || 'skill'));
      });
    }
    applySafeResourceBlocks(safe && safe.blocks);
    if (typeof values.descricao === 'string') setEditorContent('p-editor', safe ? safe.html : '');
  } else if (descriptor.kind === 'scene') {
    restoreResourceFields(values, {
      titulo: 'c-titulo', subtitulo: 'c-subtitulo', categoria: 'c-categoria', status: 'c-status',
      resumo: 'c-resumo', banner: 'c-banner'
    });
    var theme = values.theme || {};
    restoreResourceFields(theme, {
      accentColor: 'c-accent', bannerStyle: 'c-banner-style', layout: 'c-layout',
      fontFamily: 'c-font', bgEffect: 'c-bg-effect', bgm: 'c-bgm'
    });
    var infobox = values.infobox || {};
    restoreResourceFields({ show: infobox.show, title: infobox.title, image: infobox.image, caption: infobox.caption, participants: Array.isArray(infobox.participants) ? infobox.participants.join(', ') : '' }, {
      show: 'c-ib-show', title: 'c-ib-title', image: 'c-ib-image', caption: 'c-ib-caption', participants: 'c-ib-participants'
    });
    var fieldsRoot = document.getElementById('c-infobox-fields');
    if (fieldsRoot && Array.isArray(infobox.fields)) {
      fieldsRoot.innerHTML = '';
      infobox.fields.slice(0, 500).forEach(function(field) {
        if (field && typeof field === 'object') fieldsRoot.insertAdjacentHTML('beforeend', infoboxFieldRowHtml(field.label || '', field.value || ''));
      });
    }
    applySafeResourceBlocks(safe && safe.blocks);
    if (typeof values.descricao === 'string') setEditorContent('c-editor', safe ? safe.html : '');
  } else if (descriptor.kind === 'turn' || descriptor.kind === 'turn-edit') {
    var editing = descriptor.kind === 'turn-edit';
    var p = editing ? 'edit-turn-' : 'turn-';
    restoreResourceFields(values, {
      characterName: p + 'char-name', characterTitle: p + 'char-title', characterAvatar: p + 'char-avatar',
      turnTitle: p + 'title', location: p + 'location', accentColor: p + 'accent',
      banner: p + (editing ? 'banner' : 'banner-url'), bannerStyle: p + 'banner-style',
      oocNotes: p + 'ooc'
    });
    if (!editing) restoreResourceFields(values, { fontFamily: 'turn-font' });
    var imageRoot = document.getElementById(editing ? 'edit-turn-extra-imgs' : 'turn-extra-images-list');
    if (imageRoot && Array.isArray(values.images)) {
      imageRoot.innerHTML = '';
      values.images.slice(0, 500).forEach(function(image) {
        if (image && typeof image === 'object') adicionarCampoImagemTurno(editing ? 'edit-turn-extra-imgs' : 'turn-extra-images-list', image.url || '', image.caption || '');
      });
    }
    if (typeof values.content === 'string') setEditorContent(editing ? 'edit-turn-editor' : 'turn-editor', safe ? safe.html : '');
  } else if (descriptor.kind === 'forum-post-edit') {
    restoreResourceFields(values, { summary: 'edit-post-summary' });
    if (typeof values.content === 'string') setEditorContent('edit-post-editor', safe ? safe.html : '');
  }
}

function applySafeResourceBlocks(blocks) {
  if (!Array.isArray(blocks)) return;
  activeBuilderBlocks = JSON.parse(JSON.stringify(blocks));
  var container = document.getElementById('modular-blocks-container');
  if (container) container.innerHTML = renderBuilderBlocksList();
}

function restoreResourceFormDraft() {
  var descriptor = resourceFormDraftDescriptor();
  if (!descriptor) return;
  var accountId = forumDraftAccountId();
  var key = resourceFormDraftKey(descriptor, accountId);
  if (!key || resourceDraftRestored[key] || resourceDraftRestorePending[key]) return;
  var record = readResourceFormDraftRecord(descriptor, accountId);
  if (!record) return;
  var values = record.values;
  var htmlField = descriptor.kind === 'character' || descriptor.kind === 'scene' ? 'descricao'
    : descriptor.kind === 'turn' || descriptor.kind === 'turn-edit' || descriptor.kind === 'forum-post-edit' ? 'content' : null;
  var hasBlocks = (descriptor.kind === 'character' || descriptor.kind === 'scene') && Array.isArray(values.blocks);
  var needsPreview = !!htmlField && typeof values[htmlField] === 'string' || hasBlocks;
  var restore = function(safe) {
    var current = resourceFormDraftDescriptor();
    delete resourceDraftRestorePending[key];
    if (accountId !== forumDraftAccountId() || !current
      || current.kind !== descriptor.kind || String(current.resourceId) !== String(descriptor.resourceId)) return;
    var currentRecord = readResourceFormDraftRecord(descriptor, accountId);
    if (!currentRecord) return;
    if (JSON.stringify(currentRecord.values) !== JSON.stringify(values)) {
      resourceDraftRestored[key] = true;
      return;
    }
    applyResourceFormDraft(descriptor, values, safe);
    resourceDraftRestored[key] = true;
  };
  if (!needsPreview) {
    restore(null);
    return;
  }
  var preview = {};
  if (htmlField) preview.html = values[htmlField] || '';
  if (hasBlocks) preview.blocks = values.blocks;
  resourceDraftRestorePending[key] = true;
  requestSafeContentPreview(preview).then(restore).catch(function() {
    delete resourceDraftRestorePending[key];
    var current = resourceFormDraftDescriptor();
    if (accountId === forumDraftAccountId() && current && current.kind === descriptor.kind
      && String(current.resourceId) === String(descriptor.resourceId)) {
      showAlert('O rascunho local foi mantido, mas não pôde ser restaurado antes da validação segura do conteúdo.', 'error');
    }
  });
}

function addResourceDraftNotice() {
  var descriptor = resourceFormDraftDescriptor();
  if (!descriptor) return;
  var accountId = forumDraftAccountId();
  var key = resourceFormDraftKey(descriptor, accountId);
  if (!key || !readResourceFormDraft(descriptor, accountId)) return;
  var root = descriptor.kind === 'turn-edit' || descriptor.kind === 'forum-post-edit'
    ? document.querySelector('#modal-container .modal-body') : document.getElementById('main');
  if (!root || Array.from(root.querySelectorAll('[data-resource-draft-notice]')).some(function(item) {
    return item.getAttribute('data-resource-draft-notice') === key;
  })) return;
  var notice = document.createElement('div');
  notice.className = 'alert alert-info';
  notice.setAttribute('data-resource-draft-notice', key);
  var label = document.createElement('span');
  label.textContent = 'Rascunho local da sua conta restaurado. Ele não substitui a versão compartilhada.';
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-small';
  button.setAttribute('data-resource-draft-discard', 'true');
  button.textContent = 'Descartar rascunho';
  button.addEventListener('click', discardActiveResourceFormDraft);
  notice.append(label, button);
  root.insertBefore(notice, root.firstChild);
}

function discardActiveResourceFormDraft() {
  var descriptor = resourceFormDraftDescriptor();
  if (!descriptor) return;
  var kind = descriptor.kind;
  var resourceId = descriptor.resourceId;
  clearResourceFormDraft(descriptor);
  if (kind === 'profile') {
    pendingProfileAvatarUpload = null;
    pendingProfileAvatarCleared = false;
  }
  if (kind === 'turn-edit') {
    closeModal();
    abrirModalEditarTurno(resourceId.slice(resourceId.indexOf(':') + 1));
  } else if (kind === 'forum-post-edit') {
    closeModal();
    editPost(resourceId);
  } else render();
  showAlert('Rascunho local descartado.', 'success');
}

function beginResourceFormSubmission(key) {
  if (resourceDraftSubmissionPending[key]) return null;
  resourceDraftSubmissionPending[key] = true;
  var button = document.activeElement && document.activeElement.closest
    ? document.activeElement.closest('button') : null;
  if (!button) button = document.querySelector('#main button.btn-primary:not(:disabled), #modal-container button.btn-primary:not(:disabled)');
  if (button) button.disabled = true;
  var finished = false;
  return function() {
    if (finished) return;
    finished = true;
    delete resourceDraftSubmissionPending[key];
    if (button) button.disabled = false;
  };
}

function forumDraftAccountId() {
  if (!DB.session) return 'anonymous';
  var id = DB.session.serverId || DB.session.id;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
}

function forumDraftStorageKey(kind, resourceId, accountId) {
  var validKinds = ['topic', 'topic-edit', 'reply'];
  if (validKinds.indexOf(kind) === -1) return null;
  accountId = accountId || forumDraftAccountId();
  if (!accountId || (accountId !== 'anonymous' && !/^[0-9a-f-]{36}$/i.test(accountId))) return null;
  return 'aetherverse:forum-draft:v' + FORUM_DRAFT_VERSION + ':' + encodeURIComponent(accountId) + ':'
    + kind + ':' + encodeURIComponent(resourceId === null || resourceId === undefined ? 'new' : String(resourceId));
}

function forumDraftFields(kind) {
  if (kind === 'topic') return { categoryId: 64, title: 200, tag: 8, content: 250000 };
  if (kind === 'topic-edit') return { title: 200, tag: 8 };
  if (kind === 'reply') return { content: 250000 };
  return null;
}

function normalizeForumDraftValues(kind, values) {
  var fields = forumDraftFields(kind);
  if (!fields || !values || typeof values !== 'object' || Array.isArray(values)) return null;
  var normalized = {};
  var invalid = false;
  Object.keys(fields).forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(values, field)) return;
    var value = values[field];
    if (typeof value !== 'string' || value.length > fields[field]) invalid = true;
    else normalized[field] = value;
  });
  return invalid ? null : normalized;
}

function writeForumDraft(kind, resourceId, values, idempotencyKey) {
  var accountId = forumDraftAccountId();
  var key = forumDraftStorageKey(kind, resourceId, accountId);
  var normalized = normalizeForumDraftValues(kind, values);
  if (!key) return false;
  if (!normalized) return reportLocalDraftWrite(key, false);
  var record = { version: FORUM_DRAFT_VERSION, accountId: accountId, kind: kind,
    resourceId: resourceId === null || resourceId === undefined ? 'new' : String(resourceId),
    updatedAt: new Date().toISOString(), values: normalized };
  if (typeof idempotencyKey === 'string' && /^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    record.idempotencyKey = idempotencyKey.toLowerCase();
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(record));
    return reportLocalDraftWrite(key, true);
  } catch (_) {
    return reportLocalDraftWrite(key, false);
  }
}

function readForumDraft(kind, resourceId) {
  var accountId = forumDraftAccountId();
  var key = forumDraftStorageKey(kind, resourceId, accountId);
  if (!key) return null;
  try {
    var raw = window.localStorage.getItem(key);
    if (!raw) return null;
    var record = JSON.parse(raw);
    var expectedResourceId = resourceId === null || resourceId === undefined ? 'new' : String(resourceId);
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || record.version !== FORUM_DRAFT_VERSION || record.accountId !== accountId
      || record.kind !== kind || record.resourceId !== expectedResourceId) return null;
    var values = normalizeForumDraftValues(kind, record.values);
    if (!values) return null;
    return { values: values, idempotencyKey: typeof record.idempotencyKey === 'string'
      && /^[0-9a-f-]{36}$/i.test(record.idempotencyKey) ? record.idempotencyKey.toLowerCase() : null };
  } catch (_) {
    return null;
  }
}

function clearForumDraft(kind, resourceId, accountId) {
  var key = forumDraftStorageKey(kind, resourceId, accountId);
  if (!key) return;
  try { window.localStorage.removeItem(key); } catch (_) { /* Draft cleanup is best-effort. */ }
}

function activeForumDraftDescriptor() {
  if (currentPage === 'novaThread') {
    return editandoThread === null
      ? { kind: 'topic', resourceId: 'new' }
      : { kind: 'topic-edit', resourceId: String(editandoThread) };
  }
  if (currentPage === 'thread' && document.getElementById('reply-editor')) {
    return { kind: 'reply', resourceId: String(currentThread) };
  }
  return null;
}

function forumDraftValuesFromForm(descriptor) {
  if (!descriptor) return null;
  if (descriptor.kind === 'topic') {
    return {
      categoryId: (document.getElementById('thread-cat') || {}).value || '',
      title: (document.getElementById('thread-title') || {}).value || '',
      tag: (document.getElementById('thread-tag') || {}).value || '',
      content: typeof getEditorContent === 'function' ? getEditorContent('thread-editor') : ''
    };
  }
  if (descriptor.kind === 'topic-edit') {
    return { title: (document.getElementById('thread-title') || {}).value || '',
      tag: (document.getElementById('thread-tag') || {}).value || '' };
  }
  return { content: typeof getEditorContent === 'function' ? getEditorContent('reply-editor') : '' };
}

function saveActiveForumDraft() {
  var descriptor = activeForumDraftDescriptor();
  if (!descriptor || !forumDraftAccountId() || forumDraftAccountId() === 'anonymous') return null;
  var values = forumDraftValuesFromForm(descriptor);
  var idempotencyKey = null;
  if (descriptor.kind === 'topic') {
    var topicPayload = { categoryId: values.categoryId, title: values.title, tag: values.tag, content: values.content };
    var topicSerialized = JSON.stringify(topicPayload);
    if (pendingTopicPayload && pendingTopicPayload !== topicSerialized) {
      pendingTopicKey = null;
      pendingTopicPayload = null;
    }
    if (pendingTopicKey && pendingTopicPayload === topicSerialized) idempotencyKey = pendingTopicKey;
  } else if (descriptor.kind === 'reply') {
    var replyPayload = { content: values.content };
    var replySerialized = JSON.stringify(replyPayload);
    if (pendingReplyPayload && pendingReplyPayload !== replySerialized) {
      pendingReplyKey = null;
      pendingReplyPayload = null;
    }
    if (pendingReplyKey && pendingReplyPayload === replySerialized) idempotencyKey = pendingReplyKey;
  }
  writeForumDraft(descriptor.kind, descriptor.resourceId, values, idempotencyKey);
  return { descriptor: descriptor, values: values };
}

function forumDraftInputChanged(event) {
  if (!event || !event.target || !document.getElementById('main')
    || !document.getElementById('main').contains(event.target)) return;
  saveActiveForumDraft();
}

function restoreForumDraftForCurrentRoute() {
  var descriptor = activeForumDraftDescriptor();
  if (!descriptor) return;
  var draft = readForumDraft(descriptor.kind, descriptor.resourceId);
  if (!draft) return;
  var values = draft.values;
  if (descriptor.kind === 'topic' || descriptor.kind === 'topic-edit') {
    ['categoryId', 'title', 'tag'].forEach(function(field) {
      if (typeof values[field] !== 'string') return;
      var target = document.getElementById(field === 'categoryId' ? 'thread-cat' : 'thread-' + field);
      if (target) target.value = values[field];
    });
    if (descriptor.kind === 'topic' && typeof values.content === 'string' && values.content) {
      restoreForumEditorDraft('thread-editor', values.content, draft.idempotencyKey, descriptor);
    } else if (descriptor.kind === 'topic' && draft.idempotencyKey) {
      pendingTopicKey = draft.idempotencyKey;
      pendingTopicPayload = JSON.stringify({ categoryId: values.categoryId || '', title: values.title || '',
        tag: values.tag || '', content: values.content || '' });
    }
  } else if (typeof values.content === 'string' && values.content) {
    restoreForumEditorDraft('reply-editor', values.content, draft.idempotencyKey, descriptor);
  }
}

function restoreForumEditorDraft(editorId, html, idempotencyKey, descriptor) {
  if (!window.Aetherverse || typeof window.Aetherverse.apiRequest !== 'function') return;
  var accountId = forumDraftAccountId();
  var editor = document.getElementById(editorId);
  if (!editor || editor.innerHTML || !html) return;
  var sequence = ++forumDraftRestoreSequence;
  window.Aetherverse.apiRequest('POST', '/api/content/preview', { html: html }).then(function(response) {
    var result = response && response.data && typeof response.data === 'object' ? response.data : response;
    var active = activeForumDraftDescriptor();
    if (sequence !== forumDraftRestoreSequence || accountId !== forumDraftAccountId()
      || !descriptor || !active || active.kind !== descriptor.kind
      || String(active.resourceId) !== String(descriptor.resourceId)) return;
    editor = document.getElementById(editorId);
    if (!editor || editor.innerHTML || !result || typeof result.html !== 'string') return;
    if (typeof setEditorContent !== 'function' || !setEditorContent(editorId, result.html)) return;
    if (descriptor.kind === 'topic' && idempotencyKey) {
      var topicValues = forumDraftValuesFromForm(descriptor);
      pendingTopicKey = idempotencyKey;
      pendingTopicPayload = JSON.stringify({ categoryId: topicValues.categoryId, title: topicValues.title,
        tag: topicValues.tag, content: topicValues.content });
      writeForumDraft('topic', descriptor.resourceId, topicValues, idempotencyKey);
    } else if (descriptor.kind === 'reply' && idempotencyKey) {
      pendingReplyKey = idempotencyKey;
      pendingReplyPayload = JSON.stringify({ content: getEditorContent(editorId) });
      writeForumDraft('reply', descriptor.resourceId, { content: getEditorContent(editorId) }, idempotencyKey);
    } else if (descriptor.kind === 'topic') {
      writeForumDraft('topic', descriptor.resourceId, forumDraftValuesFromForm(descriptor));
    } else if (descriptor.kind === 'reply') {
      writeForumDraft('reply', descriptor.resourceId, { content: getEditorContent(editorId) });
    }
  }).catch(function() {
    // Keep the account-scoped stored draft; it is never inserted unless the server validates it.
  });
}

function clearForumDraftEditors() {
  forumDraftRestoreSequence += 1;
  ['thread-title', 'thread-cat', 'thread-tag'].forEach(function(id) {
    var field = document.getElementById(id);
    if (field) field.value = '';
  });
  ['thread-editor', 'reply-editor'].forEach(function(id) {
    if (typeof setEditorContent === 'function') setEditorContent(id, '');
    else {
      var editor = document.getElementById(id);
      if (editor) editor.textContent = '';
    }
  });
  pendingTopicKey = null;
  pendingTopicPayload = null;
  pendingReplyKey = null;
  pendingReplyPayload = null;
}

function initializeForumDraftPersistence() {
  var main = document.getElementById('main');
  if (!main || main.getAttribute('data-forum-drafts') === 'ready') return;
  main.setAttribute('data-forum-drafts', 'ready');
  main.addEventListener('input', forumDraftInputChanged);
  main.addEventListener('change', forumDraftInputChanged);
}

function formatForumTimestamp(value) {
  if (!value) return '';
  var date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function authorName(author) {
  return author && author.username ? author.username : 'Membro sem identificação';
}

function forumThreadTag(tag) {
  return ['ooc', 'rp', 'wiki'].includes(tag) ? tag : 'ooc';
}

function renderForum() {
  if (!forumLandingLoaded) {
    loadForumLanding(false);
    if (forumLoadError) return '<div class="alert alert-error">' + h(forumLoadError) + ' <button class="btn btn-small" onclick="loadForumLanding(true)">Tentar novamente</button></div>';
    return '<div class="alert alert-info">Carregando categorias e tópicos compartilhados…</div>';
  }
  var html = '<div class="breadcrumb">Início / Fórum</div>';

  html += '<div class="filter-bar">';
  html += '<input type="text" id="forum-search-input" maxlength="100" value="' + ha(forumFilterSearch) + '" placeholder="Pesquisar tópicos por título..." oninput="onForumFilterChange()">';
  html += '<select id="forum-tag-select" onchange="onForumFilterChange()">';
  html += '<option value="all"' + (forumFilterTag === 'all' ? ' selected' : '') + '>Todas as Tags</option>';
  html += '<option value="ooc"' + (forumFilterTag === 'ooc' ? ' selected' : '') + '>OOC</option>';
  html += '<option value="rp"' + (forumFilterTag === 'rp' ? ' selected' : '') + '>RP</option>';
  html += '<option value="wiki"' + (forumFilterTag === 'wiki' ? ' selected' : '') + '>Wiki</option>';
  html += '</select>';
  if (DB.session) {
    html += '<button class="btn btn-primary" onclick="startNewThread(' + idJs(serverForumCategories[0] ? serverForumCategories[0].id : '') + ')">+ Novo Tópico</button>';
  }
  html += '</div>';

  if (forumFilterSearch.trim() || forumFilterTag !== 'all') {
    var q = forumFilterSearch.toLowerCase().trim();
    var allThreads = Object.keys(serverForumThreads).reduce(function(result, key) {
      return result.concat(serverForumThreads[key] || []);
    }, []);
    var matched = allThreads.filter(function(t) {
      if (forumFilterTag !== 'all' && (t.tag || 'ooc') !== forumFilterTag) return false;
      if (q && (t.title || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    html += '<div class="cat-header"><span>Resultados da Busca (' + matched.length + ')</span><a class="btn btn-small" onclick="forumFilterSearch=\'\';forumFilterTag=\'all\';render()">Limpar Filtro</a></div>';
    html += '<table class="forum-table"><thead><tr><th>Tópico</th><th>Autor</th><th>Publicações</th><th>Última atividade</th></tr></thead><tbody>';
    if (!matched.length) {
      html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Nenhum tópico encontrado.</td></tr>';
    }
    matched.forEach(function(t) {
      var author = t.author;
      html += '<tr><td>';
      if (t.pinned) html += '<span class="pin">FIXADO</span> ';
      if (t.locked) html += '<span class="tag">TRANCADO</span> ';
      html += '<span class="tag">' + h(forumThreadTag(t.tag).toUpperCase()) + '</span> ';
      html += '<a onclick="navigate(\'thread\',' + idJs(t.id) + ')" style="font-weight:600;color:#fff;">' + h(t.title) + '</a></td>';
      html += '<td>' + h(authorName(author)) + '</td>';
      html += '<td>' + (Number(t.postsCount) || 0) + '</td><td>' + h(formatForumTimestamp(t.lastActivityAt)) + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  var totalTopics = 0;
  var totalPosts = 0;
  serverForumCategories.forEach(function(cat) {
    var catThreads = serverForumThreads[cat.id] || [];
    totalTopics += Number(cat.topicsCount) || 0;
    totalPosts += Number(cat.postsCount) || 0;
    var lastThread = catThreads.length ? catThreads[0] : null;
    var lastInfo = lastThread ? ('<a onclick="navigate(\'thread\',' + idJs(lastThread.id) + ')" style="font-weight:500;">' + h(lastThread.title.substring(0, 38)) + (lastThread.title.length > 38 ? '…' : '') + '</a><br><small style="color:var(--text-muted);">' + h(formatForumTimestamp(lastThread.lastActivityAt)) + '</small>') : '<span style="color:var(--text-muted);">Nenhum tópico</span>';

    html += '<div class="cat-header"><span>' + h(cat.name) + '</span>';
    if (DB.session) html += '<button class="btn btn-small" onclick="startNewThread(' + idJs(cat.id) + ')">+ Novo Tópico</button>';
    html += '</div>';
    html += '<table class="forum-table"><thead><tr><th style="width:48%">Categoria</th><th>Tópicos</th><th>Posts</th><th>Última Atividade</th></tr></thead><tbody>';
    html += '<tr><td><a onclick="navigate(\'cat\',' + idJs(cat.id) + ')" style="font-weight:600;font-size:14px;color:#fff;">' + h(cat.name) + '</a><br><small style="color:var(--text-secondary);">' + h(cat.description || '') + '</small></td>';
    html += '<td><b>' + (Number(cat.topicsCount) || 0) + '</b></td><td>' + (Number(cat.postsCount) || 0) + '</td><td style="font-size:12px;">' + lastInfo + '</td></tr>';
    html += '</tbody></table>';
  });

  html += '<div class="stats-bar"><span><b>' + totalPosts + '</b> publicações visíveis</span><span><b>' + totalTopics + '</b> tópicos</span><span><b>' + serverForumCategories.length + '</b> categorias</span></div>';
  return html;
}

function renderCat() {
  var key = String(currentCat || '');
  if (!serverForumCategories || !Object.hasOwn(serverForumThreads, key)) {
    loadForumCategory(key, false);
    if (forumLoadError) return '<div class="alert alert-error">' + h(forumLoadError) + ' <button class="btn btn-small" onclick="loadForumCategory(currentCat,true)">Tentar novamente</button></div>';
    return '<div class="alert alert-info">Carregando a categoria…</div>';
  }
  var cat = serverForumCategories.find(function(category) { return String(category.id) === key; });
  if (!cat) return '<div class="alert alert-error">Categoria não encontrada.</div>';
  var threads = (serverForumThreads[key] || []).slice();
  var search = forumFilterSearch.toLowerCase().trim();
  threads = threads.filter(function(thread) {
    if (forumFilterTag !== 'all' && forumThreadTag(thread.tag) !== forumFilterTag) return false;
    return !search || (thread.title || '').toLowerCase().includes(search);
  });

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> / ' + h(cat.name) + '</div>';
  html += '<div class="cat-header"><span>' + h(cat.name) + '</span>';
  if (DB.session) html += '<button class="btn btn-small btn-primary" onclick="startNewThread(' + idJs(cat.id) + ')">+ Novo Tópico</button>';
  html += '</div>';
  html += '<p style="color:var(--text-secondary);">' + h(cat.description || '') + '</p>';
  html += '<table class="forum-table"><thead><tr><th>Tópico</th><th>Autor</th><th>Publicações</th><th>Última atividade</th></tr></thead><tbody>';

  if (!threads.length) {
    html += '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:28px;">Nenhum tópico ainda.';
    if (DB.session) html += ' <a onclick="startNewThread(' + idJs(cat.id) + ')">Criar o primeiro</a>';
    html += '</td></tr>';
  }

  threads.forEach(function(t) {
    var author = t.author;
    var tag = forumThreadTag(t.tag);
    html += '<tr><td>';
    if (t.pinned) html += '<span class="pin">FIXADO</span> ';
    if (t.locked) html += '<span class="tag">TRANCADO</span> ';
    html += '<span class="tag tag-' + tag + '">' + h(tag.toUpperCase()) + '</span> ';
    html += '<a onclick="navigate(\'thread\',' + idJs(t.id) + ')" style="font-weight:600;color:#fff;">' + h(t.title) + '</a>';
    html += '</td><td>' + h(authorName(author)) + '</td>';
    html += '<td>' + (Number(t.postsCount) || 0) + '</td>';
    html += '<td style="font-size:12px;color:var(--text-muted);">' + h(formatForumTimestamp(t.lastActivityAt)) + '</td></tr>';
  });

  html += '</tbody></table>';
  return html;
}

function canEditForumAuthor(author) {
  return !!(DB.session && author && (isModOrAdmin() || String(DB.session.id) === String(author.id)));
}

function updateCachedForumThread(thread) {
  if (!thread) return;
  if (serverForumThread && String(serverForumThread.id) === String(thread.id)) serverForumThread = thread;
  Object.keys(serverForumThreads).forEach(function(categoryId) {
    var threads = serverForumThreads[categoryId] || [];
    var index = threads.findIndex(function(item) { return String(item.id) === String(thread.id); });
    if (index !== -1) {
      if (String(thread.categoryId) === String(categoryId) && !thread.archivedAt) threads[index] = thread;
      else threads.splice(index, 1);
    } else if (String(thread.categoryId) === String(categoryId) && !thread.archivedAt) {
      threads.unshift(thread);
    }
  });
}

function moderateForumThread(threadId, action, targetCategoryId) {
  var thread = serverForumThread && String(serverForumThread.id) === String(threadId) ? serverForumThread : null;
  if (!thread) Object.keys(serverForumThreads).some(function(categoryId) {
    thread = (serverForumThreads[categoryId] || []).find(function(item) { return String(item.id) === String(threadId); }) || null;
    return !!thread;
  });
  if (!thread) { showAlert('Atualize o tópico antes de moderá-lo.', 'error'); return; }
  var labels = { pin: 'fixar', unpin: 'desafixar', lock: 'trancar', unlock: 'destrancar', archive: 'arquivar', unarchive: 'restaurar', move: 'mover' };
  var reason = window.prompt('Informe o motivo para ' + (labels[action] || action) + ' este tópico:');
  if (!reason || !reason.trim()) return;
  var payload = { action: action, reason: reason.trim(), expectedVersion: thread.version };
  if (targetCategoryId) payload.targetCategoryId = targetCategoryId;
  forumApi().apiRequest('POST', '/api/forum/threads/' + encodeURIComponent(thread.id) + '/moderate', payload)
    .then(function(response) {
      updateCachedForumThread(response.data);
      forumLandingLoaded = false;
      if (action === 'archive' || action === 'move') navigate('cat', response.data.categoryId);
      else { loadForumLanding(true); render(); }
      showAlert('Moderação registrada.', 'success');
    })
    .catch(function(error) { showAlert(error.message || 'Não foi possível moderar o tópico.', 'error'); });
}

function togglePinThread(threadId) {
  if (!serverForumThread || String(serverForumThread.id) !== String(threadId)) return;
  moderateForumThread(threadId, serverForumThread.pinned ? 'unpin' : 'pin');
}

function toggleLockThread(threadId) {
  if (!serverForumThread || String(serverForumThread.id) !== String(threadId)) return;
  moderateForumThread(threadId, serverForumThread.locked ? 'unlock' : 'lock');
}

function renderThread() {
  var threadId = String(currentThread || '');
  if (!serverForumThread || String(serverForumThread.id) !== threadId || !Array.isArray(serverForumPosts)) {
    loadForumThread(threadId);
    if (forumLoadError) return '<div class="alert alert-error">' + h(forumLoadError) + ' <button class="btn btn-small" onclick="loadForumThread(currentThread,{force:true})">Tentar novamente</button></div>';
    return '<div class="alert alert-info">Carregando a conversa compartilhada…</div>';
  }
  var thread = serverForumThread;
  var tagClass = 'tag-' + forumThreadTag(thread.tag);
  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> / <a onclick="navigate(\'cat\',' + idJs(thread.categoryId) + ')">' + h(thread.categoryName || 'Categoria') + '</a> / ' + h(thread.title) + '</div>';
  html += '<div class="thread-tools"><h2>';
  if (thread.pinned) html += '<span class="pin">FIXADO</span> ';
  if (thread.locked) html += '<span class="tag">TRANCADO</span> ';
  if (thread.archivedAt) html += '<span class="tag">ARQUIVADO</span> ';
  html += '<span class="tag ' + tagClass + '">' + h(forumThreadTag(thread.tag).toUpperCase()) + '</span> ' + h(thread.title) + '</h2><div style="display:flex;gap:8px;flex-wrap:wrap;">';
  if (isModOrAdmin()) {
    html += '<button class="btn btn-small" onclick="togglePinThread(' + idJs(thread.id) + ')">' + (thread.pinned ? 'Desafixar' : 'Fixar') + '</button>';
    html += '<button class="btn btn-small" onclick="toggleLockThread(' + idJs(thread.id) + ')">' + (thread.locked ? 'Destrancar' : 'Trancar') + '</button>';
    html += '<button class="btn btn-small btn-warn" onclick="moderateForumThread(' + idJs(thread.id) + ',\'' + (thread.archivedAt ? 'unarchive' : 'archive') + '\')">' + (thread.archivedAt ? 'Restaurar tópico' : 'Arquivar tópico') + '</button>';
  }
  if (canEditForumAuthor(thread.author) && !thread.locked && !thread.archivedAt) html += '<button class="btn btn-warn btn-small" onclick="editarThread(' + idJs(thread.id) + ')">Editar</button>';
  html += '</div></div>';

  serverForumPosts.forEach(function(post) {
    var author = post.author;
    var name = author ? author.username : (post.authorLabel || 'Autoria não identificada');
    var avatarHtml = author && author.avatar ? '<img src="' + ha(author.avatar) + '" alt="">' : h(name.substring(0, 2).toUpperCase());
    html += '<div class="post-box"><div class="post-header"><div class="post-meta"><span class="post-number">#' + Number(post.postNo) + '</span><strong style="color:#fff;">' + h(name) + '</strong></div><div class="post-meta"><span class="post-date">' + h(formatForumTimestamp(post.createdAt)) + '</span>' + (post.edited ? '<span class="tag">editado</span>' : '') + '</div></div>';
    html += '<div class="post-body"><div class="post-user-panel"><div class="avatar">' + avatarHtml + '</div><div class="username">' + h(name) + '</div><div class="user-title">' + h(author ? author.title : 'Registro legado') + '</div>' + (author ? roleBadgeFromRole(author.role) : '') + '</div>';
    html += '<div class="post-content">' + (post.deleted ? '<p class="alert alert-info">Esta publicação foi ocultada.</p>' : formatPost(post.content)) + '</div></div>';
    if (!post.deleted) {
      html += '<div class="post-footer"><div class="post-actions">';
      if (DB.session && !thread.locked && !thread.archivedAt) html += '<a onclick="quotePost(' + idJs(post.id) + ')">Citar</a>';
      if (canEditForumAuthor(author) && !thread.locked && !thread.archivedAt) html += '<a onclick="editPost(' + idJs(post.id) + ')">Editar</a>';
      if (DB.session && ((canEditForumAuthor(author) && Number(post.postNo) !== 1) || isModOrAdmin())) html += '<a class="danger-link" onclick="deletePost(' + idJs(post.id) + ')">Ocultar</a>';
      html += '</div></div>';
    } else if (isModOrAdmin()) {
      html += '<div class="post-footer"><div class="post-actions"><a onclick="restoreForumPost(' + idJs(post.id) + ')">Restaurar publicação</a></div></div>';
    }
    html += '</div>';
  });

  if (serverForumPostsPage.hasMore) html += '<div style="text-align:center;margin:16px;"><button class="btn" onclick="loadMoreForumPosts()"' + (forumThreadLoading ? ' disabled' : '') + '>Carregar publicações anteriores</button></div>';
  if (thread.locked || thread.archivedAt) {
    html += '<div class="alert alert-info" style="margin-top:14px;">Este tópico está ' + (thread.archivedAt ? 'arquivado' : 'trancado') + ' e não recebe novas respostas.</div>';
  } else if (DB.session) {
    html += '<div class="reply-box"><div class="reply-title"><span>Responder ao Tópico</span><span style="color:var(--accent-light);">' + h(DB.session.username) + '</span></div><div class="reply-inner">' + buildEditor('reply-editor', '') + '<div style="margin-top:12px;"><button class="btn btn-primary" onclick="submitReply()">Enviar Resposta</button></div></div></div>';
  } else {
    html += '<div class="alert alert-info" style="margin-top:14px;"><span>Faça login para participar e responder neste tópico.</span><a class="btn btn-small btn-primary" onclick="showLoginModal()">Entrar</a></div>';
  }
  return html;
}

function renderNovaThread() {
  if (!DB.session) return '<div class="alert alert-error">Você precisa estar logado.</div>';
  var isEdit = editandoThread !== null;
  var thr = isEdit && serverForumThread && String(serverForumThread.id) === String(editandoThread) ? serverForumThread : null;
  if (!isEdit && !serverForumCategories) {
    loadForumLanding(false);
    return '<div class="alert alert-info">Carregando categorias…</div>';
  }
  if (isEdit && !thr) return '<div class="alert alert-error">Atualize o tópico antes de editá-lo.</div>';
  var selCat = currentCat || (serverForumCategories && serverForumCategories[0] && serverForumCategories[0].id);

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> / ' + (isEdit ? 'Editar Tópico' : 'Novo Tópico') + '</div>';
  html += '<div class="cat-header"><span>' + (isEdit ? 'Editar Tópico' : 'Criar Novo Tópico') + '</span></div>';
  html += '<div class="builder-panel">';

  if (!isEdit) {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';
    html += '<div class="form-row"><label>Categoria</label><select id="thread-cat">';
    serverForumCategories.forEach(function(c) {
      html += '<option value="' + ha(c.id) + '"' + (String(c.id) === String(selCat) ? ' selected' : '') + '>' + h(c.name) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-row"><label>Tipo</label><select id="thread-tag"><option value="ooc">OOC (Discussão fora do personagem)</option><option value="rp">RP (Cena de Roleplay)</option><option value="wiki">Wiki / Lore</option></select></div>';
    html += '</div>';
  }

  html += '<div class="form-row"><label>Título</label><input type="text" id="thread-title" value="' + (thr ? ha(thr.title) : '') + '" placeholder="Título do tópico"></div>';
  if (isEdit) {
    html += '<div class="form-row"><label>Tipo</label><select id="thread-tag"><option value="ooc"' + (thr.tag === 'ooc' ? ' selected' : '') + '>OOC</option><option value="rp"' + (thr.tag === 'rp' ? ' selected' : '') + '>RP</option><option value="wiki"' + (thr.tag === 'wiki' ? ' selected' : '') + '>Wiki / Lore</option></select></div>';
  } else {
    html += '<div class="form-row"><label>Conteúdo</label>' + buildEditor('thread-editor', '') + '</div>';
  }
  html += '<div style="display:flex;gap:10px;margin-top:12px;">';
  if (isEdit) {
    html += '<button class="btn btn-primary" onclick="salvarEdicaoThread()">Salvar Alterações</button>';
  } else {
    html += '<button class="btn btn-primary" onclick="submitThread()">Publicar Tópico</button>';
  }
  html += '<button class="btn" onclick="navigate(\'forum\')">Cancelar</button></div>';
  html += '</div>';
  return html;
}

// ==================== PERSONAGENS (WIKI) ====================

var serverPersonagens = null;
var personagensLoadError = null;
var personagensLoading = false;

function carregarPersonagensServidor() {
  if (personagensLoading) return;
  personagensLoading = true;
  personagensLoadError = null;
  fetch('/api/personagens')
    .then(function(res) {
      if (!res.ok) throw new Error('Não foi possível carregar personagens do servidor.');
      return res.json();
    })
    .then(function(data) {
      if (!data || !Array.isArray(data.personagens)) throw new Error('A resposta de personagens é inválida.');
      serverPersonagens = data.personagens;
      if (currentPage === 'personagens' || currentPage === 'personagemView' || currentPage === 'novaCena') render();
    })
    .catch(function(error) {
      personagensLoadError = error.message || 'Não foi possível carregar personagens do servidor.';
      if (currentPage === 'personagens' || currentPage === 'personagemView') render();
    })
    .finally(function() { personagensLoading = false; });
}

function listaPersonagens() {
  return Array.isArray(serverPersonagens) ? serverPersonagens : [];
}

function idJs(id) {
  return typeof id === 'number' ? id : jsArg(id);
}

function renderCharCard(p) {
  var accent = (p.theme && p.theme.accentColor) ? p.theme.accentColor : '';
  var cardStyle = accent ? ' style="border-top: 2px solid ' + ha(accent) + ';"' : '';
  var totalAttr = calcStatTotal(p.stats);

  var html = '<div class="char-card"' + cardStyle + ' onclick="navigate(\'personagemView\',' + idJs(p.id) + ')">';
  if (p.imagem) {
    html += '<img class="thumb" src="' + ha(p.imagem) + '" alt="' + ha(p.nome) + '">';
  } else {
    html += '<div class="thumb-ph">' + h(p.nome.substring(0, 1)) + '</div>';
  }
  html += '<div class="char-card-info"><h4>' + h(p.nome) + (p.titulo ? ' <em>&middot; ' + h(p.titulo) + '</em>' : '') + '</h4>';
  html += '<p style="margin-bottom:6px;display:flex;gap:5px;flex-wrap:wrap;"><span class="tag">' + h(p.raca || 'Desconhecido') + '</span>';
  if (p.faccao) html += '<span class="tag">' + h(p.faccao) + '</span>';
  if (p.status) html += '<span class="tag">' + h(p.status) + '</span>';
  if (totalAttr > 0) html += '<span class="tag">' + totalAttr + ' PTS</span>';
  html += '</p>';
  var descTexto = (p.descricao || '').replace(/<[^>]+>/g, '').substring(0, 125);
  html += '<p>' + h(descTexto) + '...</p>';
  if (p.author) {
    html += '<div class="card-author-row">' + renderAuthorChip(p.author, '', 'Ficha por') + '</div>';
  }
  html += '</div></div>';
  return html;
}

function onWikiFilterChange() {
  var sEl = document.getElementById('wiki-search-input');
  var cEl = document.getElementById('wiki-cat-select');
  var rEl = document.getElementById('wiki-raca-select');
  var sortEl = document.getElementById('wiki-sort-select');
  if (sEl) wikiFilterSearch = sEl.value;
  if (cEl) wikiFilterCat = cEl.value;
  if (rEl) wikiFilterRaca = rEl.value;
  if (sortEl) wikiSortBy = sortEl.value;
  render();
  var sElAfter = document.getElementById('wiki-search-input');
  if (sElAfter) {
    sElAfter.focus();
    sElAfter.setSelectionRange(sElAfter.value.length, sElAfter.value.length);
  }
}

function renderPersonagens() {
  if (serverPersonagens === null) {
    if (personagensLoadError) return '<div class="alert alert-error">' + h(personagensLoadError) + ' <button class="btn btn-small" onclick="carregarPersonagensServidor()">Tentar novamente</button></div>';
    carregarPersonagensServidor();
    return '<div class="alert alert-info">Carregando personagens compartilhados…</div>';
  }
  var allChars = listaPersonagens();
  var racas = [];
  allChars.forEach(function(p) {
    if (p.raca && racas.indexOf(p.raca) === -1) racas.push(p.raca);
  });

  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Wiki</a> / Personagens</div>';
  html += '<div class="cat-header"><span>Personagens (' + allChars.length + ')</span>';
  if (isModOrAdmin()) {
    html += '<button class="btn btn-small btn-primary" onclick="sessionStorage.removeItem(\'editPersonagemId\');navigate(\'novoPersonagem\')">+ Novo Personagem</button>';
  }
  html += '</div>';

  html += '<div class="filter-bar">';
  html += '<input type="text" id="wiki-search-input" value="' + ha(wikiFilterSearch) + '" placeholder="Buscar por nome, título, raça ou facção..." oninput="onWikiFilterChange()">';
  html += '<select id="wiki-cat-select" onchange="onWikiFilterChange()">';
  html += '<option value="all"' + (wikiFilterCat === 'all' ? ' selected' : '') + '>Todas as Categorias</option>';
  html += '<option value="Personagem Principal"' + (wikiFilterCat === 'Personagem Principal' ? ' selected' : '') + '>Principais</option>';
  html += '<option value="Sub-Personagem"' + (wikiFilterCat === 'Sub-Personagem' ? ' selected' : '') + '>Sub-Personagens</option>';
  html += '</select>';
  html += '<select id="wiki-raca-select" onchange="onWikiFilterChange()">';
  html += '<option value="all"' + (wikiFilterRaca === 'all' ? ' selected' : '') + '>Todas as Raças</option>';
  racas.forEach(function(r) {
    html += '<option value="' + ha(r) + '"' + (wikiFilterRaca === r ? ' selected' : '') + '>' + h(r) + '</option>';
  });
  html += '</select>';
  html += '<select id="wiki-sort-select" onchange="onWikiFilterChange()">';
  html += '<option value="default"' + (wikiSortBy === 'default' ? ' selected' : '') + '>Ordem Padrão</option>';
  html += '<option value="az"' + (wikiSortBy === 'az' ? ' selected' : '') + '>Ordem Alfabética (A-Z)</option>';
  html += '<option value="stats"' + (wikiSortBy === 'stats' ? ' selected' : '') + '>Maior Total de Atributos</option>';
  html += '</select>';
  html += '</div>';

  var lista = allChars.filter(function(p) {
    if (wikiFilterCat !== 'all' && p.categoria !== wikiFilterCat) return false;
    if (wikiFilterRaca !== 'all' && p.raca !== wikiFilterRaca) return false;
    if (wikiFilterSearch.trim()) {
      var q = wikiFilterSearch.toLowerCase();
      var hay = ((p.nome || '') + ' ' + (p.titulo || '') + ' ' + (p.raca || '') + ' ' + (p.faccao || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  if (wikiSortBy === 'az') {
    lista.sort(function(a, b) { return (a.nome || '').localeCompare(b.nome || ''); });
  } else if (wikiSortBy === 'stats') {
    lista.sort(function(a, b) { return calcStatTotal(b.stats) - calcStatTotal(a.stats); });
  }

  var principais = lista.filter(function(p) { return p.categoria !== 'Sub-Personagem'; });
  var subPersonagens = lista.filter(function(p) { return p.categoria === 'Sub-Personagem'; });

  if (principais.length) {
    html += '<div class="cat-header" style="margin-top:8px;"><span>Personagens Principais (' + principais.length + ')</span></div>';
    html += '<div class="char-grid">';
    principais.forEach(function(p) { html += renderCharCard(p); });
    html += '</div>';
  }

  if (subPersonagens.length) {
    html += '<div class="cat-header" style="margin-top:18px;"><span>Sub-Personagens (' + subPersonagens.length + ')</span></div>';
    html += '<div class="char-grid">';
    subPersonagens.forEach(function(p) { html += renderCharCard(p); });
    html += '</div>';
  }

  if (!lista.length) {
    html += '<div style="text-align:center;padding:40px;color:var(--text-muted);background:var(--bg-surface);border-radius:var(--radius-lg);border:1px solid var(--border-subtle);">Nenhum personagem encontrado com esses filtros.</div>';
  }

  return html;
}

function renderWiki() {
  if (serverWikiSections === null && !wikiSectionsLoading && !wikiSectionsError) loadWikiSections(false);
  if (serverWikiCategories === null && !wikiCategoriesLoading && !wikiCategoriesError) loadWikiCategories(false);
  if (serverWikiPages === null && !wikiPagesLoading && !wikiPagesLoadError) loadWikiPages(false);

  var pages = (serverWikiPages || []).filter(function(page) {
    if (wikiFilterCategory !== 'all' && !(page.categories || []).some(function(category) {
      return wikiSectionCategoryKeys(wikiFilterCategory).has(wikiCategoryKey(category));
    })) return false;
    if (!wikiFilterSearch.trim()) return true;
    var query = wikiFilterSearch.trim().toLocaleLowerCase('pt-BR');
    return [page.title, page.summary, ...(page.aliases || []), ...(page.categories || [])]
      .join('\n').toLocaleLowerCase('pt-BR').includes(query);
  });
  var html = '<div class="breadcrumb">Início / Wiki</div>'
    + '<div class="cat-header"><span>Wiki de Referência</span>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  if (isModOrAdmin()) html += '<button class="btn btn-small" onclick="navigate(\'wikiStaff\')">Rascunhos da equipe</button><button class="btn btn-small btn-primary" onclick="navigate(\'wikiCreate\')">+ Novo artigo</button>';
  if (DB.session) html += '<button class="btn btn-small" onclick="navigate(\'wikiProposals\')">Propostas</button>';
  html += '</div></div>';
  html += '<div class="filter-bar"><input type="search" id="wiki-page-search" value="' + ha(wikiFilterSearch)
    + '" placeholder="Buscar artigos, resumos e categorias" oninput="filterWikiPages(this.value)">'
    + '</div>';
  html += renderWikiSections();
  if (wikiFilterCategory !== 'all') {
    var selected = (serverWikiSections || []).concat(serverWikiCategories || []).find(function(item) { return item.key === wikiFilterCategory; });
    html += '<div class="cat-header"><span>' + h(selected ? selected.name : wikiFilterCategory) + '</span><button class="btn btn-small" onclick="selectWikiCategory(\'all\')">Todas as seções</button></div>';
  } else html += '<h2 class="wiki-articles-heading">Artigos publicados</h2>';
  if (wikiPagesLoadError) return html + '<div class="alert alert-error">' + h(wikiPagesLoadError) + ' <button class="btn" onclick="loadWikiPages(true)">Tentar carregar artigos novamente</button></div>';
  if (serverWikiPages === null) return html + '<p>Carregando artigos…</p>';
  if (wikiCategoriesError) html += '<p class="field-desc">' + h(wikiCategoriesError)
    + ' <button class="btn btn-small" onclick="loadWikiCategories(true)">Tentar carregar categorias novamente</button></p>';
  else if (wikiCategoriesLoading && !serverWikiCategories) html += '<p class="field-desc">Carregando categorias…</p>';
  if (!serverWikiPages.length) {
    html += '<div class="builder-panel"><p>Ainda não há artigos publicados na wiki.</p>';
    if (isModOrAdmin()) html += '<p style="margin-top:12px;"><button class="btn btn-small btn-primary" onclick="navigate(\'wikiCreate\')">Criar o primeiro artigo</button></p>';
    html += '</div>';
  } else if (!pages.length) {
    html += '<div class="builder-panel">Ainda não há artigos nesta seção com os filtros atuais.'
      + (wikiFilterCategory !== 'all' ? ' <button class="btn btn-small" onclick="selectWikiCategory(\'all\')">Limpar categoria</button>' : '')
      + '</div>';
  } else {
    html += '<div class="char-grid">';
    pages.forEach(function(page) {
      html += '<article class="char-card" style="cursor:default;"><div class="char-card-info">'
        + '<h3><a onclick="navigate(\'wikiArticle\',' + jsArg(page.slug) + ')">' + h(page.title) + '</a></h3>'
        + '<p>' + h(page.summary || '') + '</p>';
      if (Array.isArray(page.categories) && page.categories.length) {
        html += '<p style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;">'
          + page.categories.map(function(category) {
            var key = wikiCategoryKey(category);
            return '<button type="button" class="tag" onclick="selectWikiCategory(' + jsArg(key) + ')">' + h(category) + '</button>';
          }).join('') + '</p>';
      }
      if (page.author) {
        html += '<div class="card-author-row">' + renderAuthorChip(page.author, '', 'Por') + '</div>';
      }
      html += '</div></article>';
    });
    html += '</div>';
  }
  return html;
}

function wikiSectionCategoryKeys(key) {
  var keys = new Set([key]);
  var changed = true;
  while (changed) {
    changed = false;
    (serverWikiSections || []).forEach(function(section) {
      if (keys.has(section.parentKey) && !keys.has(section.key)) { keys.add(section.key); changed = true; }
    });
  }
  return keys;
}

function loadWikiSections(force) {
  if (wikiSectionsLoading || (serverWikiSections !== null && !force)) return;
  wikiSectionsLoading = true;
  wikiSectionsError = null;
  var generation = ++wikiSectionsGeneration;
  wikiApi()('GET', '/api/wiki/sections').then(function(response) {
    if (generation !== wikiSectionsGeneration) return;
    if (!response || !Array.isArray(response.data)) throw new Error('Estrutura da Wiki inválida.');
    serverWikiSections = response.data;
  }).catch(function(error) {
    if (generation !== wikiSectionsGeneration) return;
    wikiSectionsError = error && error.message || 'Não foi possível carregar as seções da Wiki.';
  }).finally(function() {
    if (generation !== wikiSectionsGeneration) return;
    wikiSectionsLoading = false;
    if (currentPage === 'wiki') render();
  });
}

function renderWikiSections() {
  if (wikiSectionsError) return '<div class="alert alert-error">' + h(wikiSectionsError) + ' <button class="btn" onclick="loadWikiSections(true)">Tentar carregar seções novamente</button></div>';
  if (serverWikiSections === null) return '<p>Carregando seções da Wiki…</p>';
  function row(section) {
    var selected = wikiFilterCategory === section.key;
    var count = Number(section.pagesCount || 0);
    return '<li class="wiki-section-row' + (selected ? ' selected' : '') + '"><div><h3><a href="/wiki?categoria=' + ha(section.key) + '"' + (selected ? ' aria-current="page"' : '') + ' onclick="selectWikiCategory(' + jsArg(section.key) + ');return false;">' + h(section.name) + '</a></h3><p>' + h(section.description || '') + '</p></div><div class="wiki-section-count">' + count + (count === 1 ? ' artigo publicado' : ' artigos publicados') + (count === 0 ? '<span>Ainda não há artigos nesta seção.</span>' : '') + '</div></li>';
  }
  var html = '<nav class="wiki-sections" aria-label="Seções da Wiki">';
  serverWikiSections.filter(function(section) {
    return !section.parentKey && (wikiFilterCategory === 'all' || wikiSectionCategoryKeys(section.key).has(wikiFilterCategory));
  }).forEach(function(root) {
    var children = serverWikiSections.filter(function(section) {
      return section.parentKey === root.key && (wikiFilterCategory === 'all' || wikiFilterCategory === root.key || wikiFilterCategory === section.key);
    });
    html += '<section class="wiki-section-group"><header><h2><a href="/wiki?categoria=' + ha(root.key) + '" onclick="selectWikiCategory(' + jsArg(root.key) + ');return false;">' + h(root.name) + '</a></h2><p>' + Number(root.pagesCount || 0) + (Number(root.pagesCount || 0) === 1 ? ' artigo publicado nesta área' : ' artigos publicados nesta área') + '</p>' + (root.description ? '<p>' + h(root.description) + '</p>' : '') + '</header><ul>' + (children.length ? children.map(row).join('') : row(root)) + '</ul></section>';
  });
  var known = new Set(serverWikiSections.map(function(section) { return section.key; }));
  var extra = (serverWikiCategories || []).filter(function(category) { return !known.has(category.key) && (wikiFilterCategory === 'all' || wikiFilterCategory === category.key); });
  if (extra.length) html += '<section class="wiki-section-group"><header><h2>Outras categorias</h2></header><ul>' + extra.map(row).join('') + '</ul></section>';
  return html + '</nav>';
}

function wikiApi() {
  return window.Aetherverse && typeof window.Aetherverse.apiRequest === 'function'
    ? window.Aetherverse.apiRequest.bind(window.Aetherverse)
    : apiRequest;
}

function wikiUnwrap(response) {
  return response && response.data && typeof response.data === 'object' ? response.data : response;
}

function wikiCategoryKey(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[\s\p{P}]+/gu, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function loadWikiCategories(force) {
  if (wikiCategoriesLoading || (serverWikiCategories !== null && !force)) return;
  wikiCategoriesLoading = true;
  wikiCategoriesError = null;
  function nextPage(offset, items) {
    return wikiApi()('GET', '/api/wiki/categories?limit=100&offset=' + offset).then(function(response) {
      if (!response || !Array.isArray(response.data)) throw new Error('A resposta das categorias da wiki é inválida.');
      var all = items.concat(response.data);
      if (response.page && response.page.hasMore) {
        if (!response.data.length) throw new Error('Paginação das categorias inválida.');
        return nextPage(offset + response.data.length, all);
      }
      return all;
    });
  }
  nextPage(0, []).then(function(data) {
    serverWikiCategories = data;
  }).catch(function(error) {
    wikiCategoriesError = error && error.message ? error.message : 'Não foi possível carregar as categorias da wiki.';
  }).finally(function() {
    wikiCategoriesLoading = false;
    if (currentPage === 'wiki') render();
  });
}

function selectWikiCategory(key) {
  var next = String(key || 'all');
  if (next !== 'all' && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(next)) return;
  if (currentPage !== 'wiki') navigate('wiki');
  wikiFilterCategory = next;
  var destination = next === 'all' ? '/wiki' : '/wiki?categoria=' + encodeURIComponent(next);
  window.history.pushState({ page: 'wiki' }, '', destination);
  render();
}

function loadWikiPages(force) {
  if (wikiPagesLoading || (serverWikiPages !== null && !force)) return;
  wikiPagesLoading = true;
  wikiPagesLoadError = null;
  function nextPage(offset, items) {
    return wikiApi()('GET', '/api/wiki/pages?limit=100&offset=' + offset).then(function(response) {
      if (!response || !Array.isArray(response.data)) throw new Error('A resposta da wiki é inválida.');
      var all = items.concat(response.data);
      if (response.page && response.page.hasMore) {
        if (!response.data.length) throw new Error('Paginação da wiki inválida.');
        return nextPage(offset + response.data.length, all);
      }
      return all;
    });
  }
  nextPage(0, []).then(function(data) {
    serverWikiPages = data;
  }).catch(function(error) {
    wikiPagesLoadError = error && error.message ? error.message : 'Não foi possível carregar os artigos da wiki.';
  }).finally(function() {
    wikiPagesLoading = false;
    if (currentPage === 'wiki') render();
  });
}

function filterWikiPages(value) {
  wikiFilterSearch = String(value || '');
  render();
  var input = document.getElementById('wiki-page-search');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function loadWikiArticle(slug, force) {
  var key = String(slug || '');
  if (!key || (wikiArticleLoading && wikiArticleLoadingSlug === key)
      || (!force && currentWikiArticle && currentWikiArticle.slug === key)) return;
  wikiArticleLoading = true;
  wikiArticleLoadingSlug = key;
  wikiArticleLoadError = null;
  wikiArticleLoadErrorSlug = null;
  currentWikiArticle = null;
  var sequence = ++wikiArticleRequestSequence;
  wikiApi()('GET', '/api/wiki/resolve/' + encodeURIComponent(key)).then(function(response) {
    var resolved = wikiUnwrap(response);
    if (!resolved || typeof resolved.id !== 'string' || typeof resolved.slug !== 'string') {
      throw new Error('Não foi possível localizar este artigo.');
    }
    if (resolved.redirect && currentPage === 'wikiArticle' && currentWikiSlug === key) {
      currentWikiSlug = resolved.slug;
      window.history.replaceState({ page: 'wikiArticle', id: resolved.slug }, '', '/wiki/' + encodeURIComponent(resolved.slug));
    }
    return wikiApi()('GET', '/api/wiki/pages/' + encodeURIComponent(resolved.id));
  }).then(function(response) {
    if (sequence !== wikiArticleRequestSequence) return;
    var article = wikiUnwrap(response);
    if (!article || !article.id || !article.body || !Array.isArray(article.body.sections)) {
      throw new Error('A resposta do artigo é inválida.');
    }
    currentWikiArticle = article;
    wikiArticleLoadError = null;
    if (!wikiBacklinksState || wikiBacklinksState.pageId !== article.id) {
      wikiBacklinksState = { pageId: article.id, items: [], loading: false, loaded: false, hasMore: false, error: null };
    }
    loadWikiBacklinks(article.id, false);
  }).catch(function(error) {
    if (sequence !== wikiArticleRequestSequence) return;
    wikiArticleLoadError = error && error.message ? error.message : 'Não foi possível carregar este artigo.';
    wikiArticleLoadErrorSlug = key;
  }).finally(function() {
    if (sequence !== wikiArticleRequestSequence) return;
    wikiArticleLoading = false;
    wikiArticleLoadingSlug = null;
    if (currentPage === 'wikiArticle') render();
  });
}

function renderWikiSnapshot(snapshot, options) {
  if (!snapshot || !snapshot.body || !Array.isArray(snapshot.body.sections)) return '<p>O artigo não contém seções disponíveis.</p>';
  var html = '', entries = [];
  snapshot.body.sections.forEach(function(section) {
    var id = 'wiki-section-' + section.id;
    var content = typeof section.html === 'string' ? section.html : '';
    var subentries = [];
    if (options && options.toc && typeof document.createElement === 'function') {
      var container = document.createElement('div');
      container.innerHTML = content;
      container.querySelectorAll('h3').forEach(function(heading, index) {
        var anchor = id + '-heading-' + index;
        heading.id = anchor;
        heading.tabIndex = -1;
        subentries.push('<li><a href="#' + ha(anchor) + '">' + h(heading.textContent) + '</a></li>');
      });
      content = container.innerHTML;
    }
    entries.push('<li><a href="#' + ha(id) + '">' + h(section.heading || '') + '</a>'
      + (subentries.length ? '<ul>' + subentries.join('') + '</ul>' : '') + '</li>');
    html += '<section class="builder-panel"><h2' + (options && options.toc ? ' id="' + ha(id) + '" tabindex="-1"' : '') + '>' + h(section.heading || '') + '</h2>'
      + '<div class="wiki-content-area">' + content + '</div></section>';
  });
  if (!snapshot.body.sections.length) return '<div class="builder-panel"><p>Este artigo ainda não tem seções.</p></div>';
  return (options && options.toc ? '<nav class="wiki-toc" aria-label="Índice do artigo"><details open><summary>Índice</summary><ul>' + entries.join('') + '</ul></details></nav>' : '') + html;
}

function loadWikiStaff(articleId) {
  var state = wikiStaffState;
  if (state.loading || !isModOrAdmin()) return;
  state.loading = true;
  state.error = null;
  var accountId = DB.session && (DB.session.serverId || DB.session.id);
  function valid() { return wikiStaffState === state && isModOrAdmin() && String(DB.session.serverId || DB.session.id) === String(accountId); }
  function list(offset, items) {
    return wikiApi()('GET', '/api/staff/wiki/pages?limit=100&offset=' + offset).then(function(response) {
      if (!valid()) return null;
      if (!response || !Array.isArray(response.data)) throw new Error('Lista editorial inválida.');
      var all = items.concat(response.data);
      if (response.page && response.page.hasMore) {
        if (!response.data.length) throw new Error('Paginação editorial inválida.');
        return list(offset + response.data.length, all);
      }
      return all;
    });
  }
  var promise = articleId ? wikiApi()('GET', '/api/staff/wiki/pages/' + encodeURIComponent(articleId)) : list(0, []);
  promise.then(function(response) {
    if (!valid()) return;
    if (articleId) {
      var page = wikiUnwrap(response);
      if (!page || page.id !== articleId || !page.head || !page.head.snapshot) throw new Error('Artigo editorial inválido.');
      state.article = page;
    } else state.items = response;
  }).catch(function(error) {
    if (!valid()) return;
    state.items = null; state.article = null;
    state.error = error && error.message || 'Não foi possível carregar a Wiki da equipe.';
  }).finally(function() {
    if (!valid()) return;
    state.loading = false;
    if (currentPage === 'wikiStaff' || currentPage === 'wikiStaffArticle') render();
  });
}

function renderWikiStaff() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">A Wiki da equipe é restrita à staff.</div>';
  var state = wikiStaffState;
  if (state.items === null && !state.loading && !state.error) loadWikiStaff(null);
  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Wiki pública</a> / Equipe</div><div class="cat-header"><span>Wiki da equipe</span><button class="btn" onclick="navigate(\'wikiCreate\')">+ Novo artigo</button></div><p>Rascunhos compartilhados: toda a equipe pode ler e editar. Publicar para todos é uma ação separada.</p>';
  if (state.error) return html + '<div class="alert alert-error">' + h(state.error) + ' <button class="btn" onclick="navigate(\'wikiStaff\')">Tentar novamente</button></div>';
  if (state.items === null) return html + '<p>Carregando rascunhos…</p>';
  if (!state.items.length) return html + '<p>Ainda não há artigos de trabalho.</p>';
  state.items.forEach(function(page) {
    if (!page.head) return;
    var snapshot = page.head.snapshot;
    var published = page.accessLevel === 'public' && !!page.publishedRevisionId;
    var actorChip = page.head.actor ? renderAuthorChip(page.head.actor, '', 'Revisão por') : '';
    html += '<article class="builder-panel"><h2><a href="/wiki/rascunhos/' + ha(page.id) + '" onclick="navigate(\'wikiStaffArticle\',' + jsArg(page.id) + ');return false;">' + h(snapshot.title) + '</a></h2><p>' + h(snapshot.summary || '') + '</p><div class="card-author-row" style="gap:10px;"><span class="field-desc" style="margin:0;">' + (published ? 'Publicado para todos' + (page.headRevisionId !== page.publishedRevisionId ? ' · Com alterações de trabalho' : '') : 'Rascunho · Somente equipe') + '</span>' + actorChip + '</div></article>';
  });
  return html;
}

function renderWikiStaffArticle() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">A leitura deste rascunho é restrita à staff.</div>';
  var state = wikiStaffState;
  if ((!state.article || state.article.id !== currentWikiPageId) && !state.loading && !state.error) loadWikiStaff(currentWikiPageId);
  if (state.error) return '<div class="alert alert-error">' + h(state.error) + ' <button class="btn" onclick="navigate(\'wikiStaffArticle\',' + jsArg(currentWikiPageId) + ')">Tentar novamente</button></div>';
  if (!state.article || state.article.id !== currentWikiPageId) return '<p>Carregando artigo da equipe…</p>';
  var page = state.article, snapshot = page.head.snapshot;
  var actorRow = page.head && page.head.actor ? '<div class="card-author-row" style="margin-bottom:12px;">' + renderAuthorChip(page.head.actor, '', 'Última revisão por') + '</div>' : '';
  return '<div class="breadcrumb"><a onclick="navigate(\'wikiStaff\')">Wiki da equipe</a> / ' + h(snapshot.title) + '</div><div class="cat-header"><span>' + h(snapshot.title) + '</span><button class="btn" onclick="navigate(\'wikiEditor\',' + jsArg(page.id) + ')">Editar artigo</button><button class="btn btn-small" onclick="exportWikiArticleFile(' + jsArg(page.id) + ')">Exportar JSON da equipe</button></div><p class="alert alert-info">Versão de trabalho compartilhada com a equipe. Esta tela não altera a publicação pública.</p>' + actorRow + '<p>' + h(snapshot.summary || '') + '</p>' + renderWikiSnapshot(snapshot, { toc: true });
}

function renderWikiArticle() {
  if (!currentWikiSlug) return '<div class="alert alert-error">O endereço deste artigo é inválido. <a onclick="navigate(\'wiki\')">Voltar à wiki</a></div>';
  if (!currentWikiArticle || currentWikiArticle.slug !== currentWikiSlug) {
    if (wikiArticleLoadError && wikiArticleLoadErrorSlug === currentWikiSlug) return '<div class="alert alert-error">' + h(wikiArticleLoadError)
      + ' <button class="btn btn-small" onclick="loadWikiArticle(' + jsArg(currentWikiSlug) + ',true)">Tentar novamente</button>'
      + ' <button class="btn btn-small" onclick="navigate(\'wiki\')">Voltar à wiki</button></div>';
    if (!wikiArticleLoading || wikiArticleLoadingSlug !== currentWikiSlug) loadWikiArticle(currentWikiSlug, false);
    return '<div class="alert alert-info">Carregando artigo…</div>';
  }
  var article = currentWikiArticle;
  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Wiki</a> / ' + h(article.title) + '</div>'
    + '<div class="cat-header"><span>' + h(article.title) + '</span><div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<a class="btn btn-small" onclick="navigate(\'wiki\')">Todos os artigos</a>';
  if (isModOrAdmin()) html += '<button class="btn btn-small" onclick="navigate(\'wikiEditor\',' + jsArg(article.id) + ')">Editar artigo</button><button class="btn btn-small" title="Exportar a versão de trabalho mais recente" onclick="exportWikiArticleFile(' + jsArg(article.id) + ')">Exportar JSON da equipe</button>';
  if (DB.session) html += '<button class="btn btn-small" onclick="navigate(\'wikiProposals\')">Minhas propostas</button>';
  html += '</div></div>';
  html += '<div class="builder-panel">';
  if (article.summary) html += '<p>' + h(article.summary) + '</p>';
  if (Array.isArray(article.categories) && article.categories.length) {
    html += '<p style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;">'
      + article.categories.map(function(category) {
        return '<button type="button" class="tag" onclick="selectWikiCategory(' + jsArg(wikiCategoryKey(category)) + ')">' + h(category) + '</button>';
      }).join('') + '</p>';
  }
  if (article.aliases && article.aliases.length) {
    html += '<p class="field-desc" style="margin-top:8px;">Também conhecido como: ' + article.aliases.map(h).join(', ') + '</p>';
  }
  if (article.author || article.publishedAt) {
    html += '<div class="card-author-row" style="margin-top:10px;">';
    if (article.author) html += renderAuthorChip(article.author, '', 'Publicado por') + ' ' + roleBadgeFromRole(article.author.role);
    if (article.publishedAt) html += '<span class="field-desc" style="margin:0;">' + (article.author ? '&middot; ' : 'Publicado em ') + h(formatJoinDate(article.publishedAt)) + '</span>';
    html += '</div>';
  }
  html += '</div>';
  html += renderWikiSnapshot(article, { public: true, toc: true });
  if (article.discussionThreadId) {
    html += '<div class="builder-panel"><h3>Discussão pública</h3>'
      + '<p>Converse sobre este artigo no fórum.</p>'
      + '<button class="btn btn-small" onclick="navigate(\'thread\',' + jsArg(article.discussionThreadId) + ')">Abrir discussão</button></div>';
  }
  html += renderWikiBacklinks(article.id);
  if (!DB.session) {
    html += '<div class="builder-panel"><p>Entre na sua conta para propor uma edição deste artigo.</p>'
      + '<button class="btn btn-small" onclick="showLoginModal()">Entrar</button></div>';
  } else if (!isModOrAdmin()) {
    html += renderWikiProposalForm(article);
  }
  return html;
}

function loadWikiBacklinks(pageId, force, append) {
  var id = String(pageId || '');
  append = !!append;
  if (!id || (wikiBacklinksState.pageId === id && wikiBacklinksState.loading)
      || (wikiBacklinksState.pageId === id && wikiBacklinksState.loaded && !force && !append)) return;
  if (append && (!wikiBacklinksState.hasMore || wikiBacklinksState.pageId !== id)) return;
  var previousItems = append ? wikiBacklinksState.items.slice() : [];
  var offset = append ? previousItems.length : 0;
  wikiBacklinksState = {
    pageId: id, items: previousItems, loading: true, loaded: append ? wikiBacklinksState.loaded : false,
    hasMore: append ? wikiBacklinksState.hasMore : false, error: null,
  };
  var sequence = ++wikiBacklinksRequestSequence;
  if (currentPage === 'wikiArticle' && currentWikiArticle && currentWikiArticle.id === id) render();
  wikiApi()('GET', '/api/wiki/pages/' + encodeURIComponent(id) + '/backlinks?limit=50&offset=' + offset).then(function(response) {
    if (!response || !Array.isArray(response.data)) throw new Error('A resposta dos backlinks é inválida.');
    if (sequence === wikiBacklinksRequestSequence) {
      wikiBacklinksState.items = previousItems.concat(response.data);
      wikiBacklinksState.loaded = true;
      wikiBacklinksState.hasMore = !!(response.page && response.page.hasMore);
    }
  }).catch(function(error) {
    if (sequence === wikiBacklinksRequestSequence) {
      wikiBacklinksState.error = error && error.message ? error.message : 'Não foi possível carregar as referências a este artigo.';
    }
  }).finally(function() {
    if (sequence !== wikiBacklinksRequestSequence) return;
    wikiBacklinksState.loading = false;
    if (currentPage === 'wikiArticle' && currentWikiArticle && currentWikiArticle.id === id) render();
  });
}

function renderWikiBacklinks(pageId) {
  if (!wikiBacklinksState || wikiBacklinksState.pageId !== pageId) loadWikiBacklinks(pageId, false);
  var state = wikiBacklinksState;
  var html = '<div class="builder-panel"><h3>Artigos que fazem referência</h3>';
  if (state.loading && !state.items.length) return html + '<p>Carregando referências…</p></div>';
  if (state.error && !state.items.length) return html + '<p class="alert alert-error">' + h(state.error)
    + ' <button class="btn btn-small" onclick="loadWikiBacklinks(' + jsArg(pageId) + ',true,false)">Tentar novamente</button></p></div>';
  if (!state.items.length) return html + '<p>Nenhum artigo publicado faz referência a este artigo.</p></div>';
  html += '<ul>';
  state.items.forEach(function(page) {
    html += '<li><a onclick="navigate(\'wikiArticle\',' + jsArg(page.slug) + ')">' + h(page.title) + '</a>';
    if (page.summary) html += ' <span class="field-desc">— ' + h(page.summary) + '</span>';
    html += '</li>';
  });
  html += '</ul>';
  if (state.error) html += '<p class="alert alert-error">' + h(state.error) + '</p>';
  if (state.loading) html += '<p>Carregando mais referências…</p>';
  else if (state.hasMore) html += '<button class="btn btn-small" onclick="loadMoreWikiBacklinks(' + jsArg(pageId) + ')">Carregar mais referências</button>';
  return html + '</div>';
}

function loadMoreWikiBacklinks(pageId) {
  loadWikiBacklinks(pageId, false, true);
}

function wikiDraftAccountId() {
  if (!DB.session) return null;
  var id = DB.session.serverId || DB.session.id;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
}

function wikiDraftStorageKey(kind, resourceId, accountId) {
  if (['editor', 'proposal'].indexOf(kind) === -1) return null;
  accountId = accountId || wikiDraftAccountId();
  if (!accountId || !/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  return 'aetherverse:wiki-draft:v' + WIKI_DRAFT_VERSION + ':' + accountId + ':' + kind + ':'
    + encodeURIComponent(resourceId === null || resourceId === undefined ? 'new' : String(resourceId));
}

function readWikiDraft(kind, resourceId, accountId) {
  var key = wikiDraftStorageKey(kind, resourceId, accountId);
  if (!key) return null;
  try {
    var value = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!value || value.version !== WIKI_DRAFT_VERSION || value.accountId !== (accountId || wikiDraftAccountId())
        || !value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot)
        || !value.snapshot.body || typeof value.snapshot.body !== 'object'
        || !Array.isArray(value.snapshot.body.sections)) return null;
    return value;
  } catch (_error) { return null; }
}

function writeWikiDraft(kind, resourceId, snapshot, metadata) {
  var accountId = wikiDraftAccountId();
  var key = wikiDraftStorageKey(kind, resourceId, accountId);
  if (!key) return false;
  if (!snapshot || typeof snapshot !== 'object') return reportLocalDraftWrite(key, false);
  var existing = readWikiDraft(kind, resourceId, accountId) || {};
  var next = {
    version: WIKI_DRAFT_VERSION,
    accountId: accountId,
    updatedAt: new Date().toISOString(),
    snapshot: snapshot,
    summary: metadata && typeof metadata.summary === 'string' ? metadata.summary.slice(0, 1000) : '',
    baseWorkVersion: metadata && Number.isInteger(metadata.baseWorkVersion) ? metadata.baseWorkVersion : existing.baseWorkVersion,
    basePublishedRevisionId: metadata && typeof metadata.basePublishedRevisionId === 'string'
      ? metadata.basePublishedRevisionId : existing.basePublishedRevisionId,
    idempotencyKey: metadata && typeof metadata.idempotencyKey === 'string' ? metadata.idempotencyKey : existing.idempotencyKey,
    idempotencyPayload: metadata && typeof metadata.idempotencyPayload === 'string'
      ? metadata.idempotencyPayload : existing.idempotencyPayload,
  };
  var payload = wikiDraftRequestPayload({
    snapshot: next.snapshot,
    summary: next.summary,
    basePublishedRevisionId: next.basePublishedRevisionId || null,
  });
  if (next.idempotencyPayload && next.idempotencyPayload !== payload) {
    next.idempotencyKey = null;
    next.idempotencyPayload = null;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
    return reportLocalDraftWrite(key, true);
  } catch (_error) { return reportLocalDraftWrite(key, false); }
}

function clearWikiDraft(kind, resourceId, accountId) {
  var key = wikiDraftStorageKey(kind, resourceId, accountId);
  if (!key) return false;
  try { window.localStorage.removeItem(key); return true; } catch (_error) { return false; }
}

function clearWikiTransientState() {
  wikiArticleFileState = createWikiArticleFileState();
  adminWikiTransferState = createAdminWikiTransferState();
  wikiStaffState = { items: null, article: null, loading: false, error: null };
  serverWikiPages = null;
  serverWikiSections = null; wikiSectionsError = null; wikiSectionsLoading = false; wikiSectionsGeneration += 1;
  serverWikiCategories = null;
  wikiCategoriesLoading = false;
  wikiCategoriesError = null;
  wikiPagesLoadError = null;
  wikiPagesLoading = false;
  currentWikiArticle = null;
  wikiArticleLoading = false;
  wikiArticleLoadingSlug = null;
  wikiArticleLoadError = null;
  wikiArticleLoadErrorSlug = null;
  wikiBacklinksState = { pageId: null, items: [], loading: false, loaded: false, hasMore: false, error: null };
  wikiBacklinksRequestSequence += 1;
  wikiProposalState = { items: [], staffItems: [], loading: false, loaded: false, error: null };
  wikiEditorPage = null;
  wikiEditorLoading = false;
  wikiEditorLoadingId = null;
  wikiEditorError = null;
  wikiEditorErrorId = null;
  wikiEditorLoadedId = null;
  wikiEditorHistory = { items: [], loading: false, loaded: false, error: null };
  wikiEditorDiffState = { pageId: null, beforeRevisionId: '', afterRevisionId: '', loading: false, error: null, result: null };
  wikiEditorDiffRequestSequence += 1;
  wikiEditorDiscussionState = {
    pageId: null, categories: null, selectedCategoryId: '', threads: [], loadingCategories: false,
    loadingThreads: false, error: null, currentThread: null, currentThreadId: null,
    loadingCurrentThread: false, saving: false,
  };
  wikiEditorDiscussionRequestSequence += 1;
  wikiEditorSections = [];
  wikiEditorSectionsKey = null;
  wikiEditorDraftRestoreKey = null;
  wikiEditorDraftRestorePending = false;
  wikiEditorDraftRestoreError = null;
  wikiEditorDraftRestoreCompleteKey = null;
  wikiProposalDraftRestorePending = false;
  wikiProposalDraftRestoreError = null;
  wikiProposalDraftSafeHtml = null;
  wikiProposalDraftSafeHtmlKey = null;
  wikiProposalDetail = null;
  wikiProposalDetailLoading = false;
  wikiProposalDetailLoadingId = null;
  wikiProposalDetailError = null;
  wikiProposalDetailErrorId = null;
  wikiProposalPage = null;
  wikiProposalRequestSequence += 1;
  wikiEditorRequestSequence += 1;
  wikiArticleRequestSequence += 1;
  wikiProposalDetailRequestSequence += 1;
}

function previewWikiHtml(html) {
  return wikiApi()('POST', '/api/content/preview', { html: String(html || '') }).then(function(response) {
    var safe = wikiUnwrap(response);
    if (!safe || typeof safe.html !== 'string') throw new Error('A prévia segura do conteúdo está incompleta.');
    return safe.html;
  });
}

function wikiEditorDraftRestoreToken(resourceId, draft) {
  return wikiDraftAccountId() + ':' + resourceId + ':' + (draft.updatedAt || '') + ':' + wikiEditorLoadedId;
}

function wikiProposalDraftRestoreToken(article, draft) {
  return wikiDraftAccountId() + ':' + article.id + ':' + (draft.updatedAt || '');
}

function restoreWikiEditorDraftContent() {
  if (!isModOrAdmin()) return;
  var id = currentPage === 'wikiCreate' ? null : currentWikiPageId;
  var resourceId = id || 'new';
  var draft = readWikiDraft('editor', resourceId);
  if (!draft || !draft.snapshot || !draft.snapshot.body || !Array.isArray(draft.snapshot.body.sections)) return;
  var key = wikiEditorDraftRestoreToken(resourceId, draft);
  if (wikiEditorDraftRestoreCompleteKey === key
      || (wikiEditorDraftRestoreKey === key && (wikiEditorDraftRestorePending || wikiEditorDraftRestoreError))) return;
  var sections = draft.snapshot.body.sections;
  if (!sections.some(function(section) { return section && typeof section.html === 'string'; })) return;
  wikiEditorDraftRestoreKey = key;
  wikiEditorDraftRestorePending = true;
  wikiEditorDraftRestoreError = null;
  if (currentPage === 'wikiEditor' || currentPage === 'wikiCreate') render();
  Promise.all(sections.map(function(section) {
    return section && typeof section.html === 'string' ? previewWikiHtml(section.html) : Promise.resolve(null);
  })).then(function(safeSections) {
    if (wikiEditorDraftRestoreKey !== key) return;
    // Apply recovered section content only after every section has passed the
    // authenticated sanitizer endpoint. A partial preview failure leaves the
    // editor on its server-provided content.
    wikiEditorSections = wikiEditorSections.map(function(section, index) {
      return Object.assign({}, section, {
        html: safeSections[index] === null ? section.html : safeSections[index],
      });
    });
    wikiEditorDraftRestoreCompleteKey = key;
    wikiEditorDraftRestorePending = false;
    wikiEditorDraftRestoreError = null;
    if (currentPage === 'wikiEditor' || currentPage === 'wikiCreate') render();
  }).catch(function(error) {
    if (wikiEditorDraftRestoreKey !== key) return;
    wikiEditorDraftRestoreError = error && error.message ? error.message : 'Não foi possível validar o rascunho local.';
    // Leave recovered HTML out of the editor until it can be checked.
    if (currentPage === 'wikiEditor' || currentPage === 'wikiCreate') render();
  });
}

function restoreWikiProposalDraftContent() {
  if (currentPage !== 'wikiArticle' || !currentWikiArticle || !DB.session || isModOrAdmin()) return;
  var articleId = currentWikiArticle.id;
  var draft = readWikiDraft('proposal', articleId);
  if (!draft || !draft.snapshot || !draft.snapshot.body || !Array.isArray(draft.snapshot.body.sections)) return;
  var firstSection = draft.snapshot.body.sections[0];
  if (!firstSection || typeof firstSection.html !== 'string') return;
  var editor = document.getElementById('wiki-proposal-body');
  if (!editor) return;
  var key = wikiProposalDraftRestoreToken(currentWikiArticle, draft);
  if (wikiProposalDraftSafeHtmlKey === key
      || (wikiEditorDraftRestoreKey === key && (wikiProposalDraftRestorePending || wikiProposalDraftRestoreError))) return;
  wikiEditorDraftRestoreKey = key;
  wikiProposalDraftRestorePending = true;
  wikiProposalDraftRestoreError = null;
  render();
  previewWikiHtml(firstSection.html).then(function(safeHtml) {
    if (wikiEditorDraftRestoreKey !== key || currentPage !== 'wikiArticle'
        || !currentWikiArticle || currentWikiArticle.id !== articleId) return;
    wikiProposalDraftSafeHtml = safeHtml;
    wikiProposalDraftSafeHtmlKey = key;
    wikiProposalDraftRestorePending = false;
    render();
  }).catch(function() {
    if (wikiEditorDraftRestoreKey === key) {
      wikiProposalDraftRestoreError = 'Não foi possível validar o rascunho local.';
      if (currentPage === 'wikiArticle') render();
    }
  });
}

function wikiSlugFromTitle(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[\s\p{P}]+/gu, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

function wikiCsv(value) {
  return String(value || '').split(',').map(function(item) { return item.trim(); }).filter(Boolean);
}

var wikiEditorSections = [];
var wikiEditorSectionsKey = null;

function wikiEditorResourceId() {
  return (currentPage === 'wikiCreate' ? null : currentWikiPageId) || 'new';
}

function ensureWikiEditorPage(id) {
  var key = id ? String(id).toLowerCase() : 'new';
  if (wikiEditorLoadedId === key || (wikiEditorLoading && wikiEditorLoadingId === key)) return;
  wikiEditorLoading = true;
  wikiEditorLoadingId = key;
  wikiEditorError = null;
  wikiEditorErrorId = null;
  var sequence = ++wikiEditorRequestSequence;
  if (!id) {
    wikiEditorPage = null;
    wikiEditorLoadedId = 'new';
    wikiEditorLoading = false;
    wikiEditorLoadingId = null;
    wikiEditorHistory = { items: [], loading: false, loaded: true, error: null };
    wikiEditorSectionsKey = null;
    return;
  }
  wikiEditorPage = null;
  wikiApi()('GET', '/api/staff/wiki/pages/' + encodeURIComponent(id)).then(function(response) {
    if (sequence !== wikiEditorRequestSequence) return;
    var page = wikiUnwrap(response);
    if (!page || page.id !== id || !page.head || !page.head.snapshot) throw new Error('O servidor não retornou o rascunho deste artigo.');
    wikiEditorPage = page;
    wikiEditorLoadedId = key;
    wikiEditorSectionsKey = null;
    wikiEditorHistory = { items: [], loading: false, loaded: false, error: null };
    loadWikiEditorHistory(id, false);
  }).catch(function(error) {
    if (sequence === wikiEditorRequestSequence) {
      wikiEditorError = error && error.message ? error.message : 'Não foi possível carregar o artigo para edição.';
      wikiEditorErrorId = key;
    }
  }).finally(function() {
    if (sequence !== wikiEditorRequestSequence) return;
    wikiEditorLoading = false;
    wikiEditorLoadingId = null;
    if (currentPage === 'wikiEditor' && String(currentWikiPageId) === String(id)) render();
  });
}

function loadWikiEditorHistory(pageId, force) {
  if (wikiEditorHistory.loading || (wikiEditorHistory.loaded && !force)) return;
  wikiEditorHistory.loading = true;
  wikiEditorHistory.error = null;
  wikiApi()('GET', '/api/staff/wiki/pages/' + encodeURIComponent(pageId) + '/revisions?limit=50&offset=0').then(function(response) {
    if (!response || !Array.isArray(response.data)) throw new Error('A resposta do histórico é inválida.');
    wikiEditorHistory.items = response.data;
    wikiEditorHistory.loaded = true;
  }).catch(function(error) {
    wikiEditorHistory.error = error && error.message ? error.message : 'Não foi possível carregar o histórico.';
  }).finally(function() {
    wikiEditorHistory.loading = false;
    if (currentPage === 'wikiEditor' && String(currentWikiPageId) === String(pageId)) render();
  });
}

function initialWikiSnapshot() {
  var id = newForumIdempotencyKey();
  return {
    schemaVersion: 1,
    title: '', slug: '', aliases: [], type: 'concept', summary: '', categories: [],
    accessLevel: 'public', audience: 'unspecified',
    body: { format: 'richtext-v1', infobox: [], sections: [{
      id: id, heading: 'Visão geral', html: '', blocks: [], authority: [], knowledgeLayer: 'unspecified',
    }] },
  };
}

function initializeWikiEditorSections(resourceId, draft) {
  var key = String(resourceId) + ':' + (draft && draft.updatedAt || 'clean');
  if (wikiEditorSectionsKey === key) return;
  var serverSnapshot = wikiEditorPage && wikiEditorPage.head ? wikiEditorPage.head.snapshot : initialWikiSnapshot();
  var chosen = draft && draft.snapshot && draft.snapshot.body && Array.isArray(draft.snapshot.body.sections)
    ? draft.snapshot : serverSnapshot;
  var serverSections = serverSnapshot.body && Array.isArray(serverSnapshot.body.sections) ? serverSnapshot.body.sections : [];
  wikiEditorSections = (chosen.body.sections || []).map(function(section, index) {
    var safeSection = serverSections[index] || {};
    return {
      id: typeof section.id === 'string' ? section.id : newForumIdempotencyKey(),
      heading: typeof section.heading === 'string' ? section.heading : (safeSection.heading || 'Nova seção'),
      html: typeof safeSection.html === 'string' ? safeSection.html : '',
      blocks: Array.isArray(section.blocks) ? section.blocks : [],
      authority: Array.isArray(section.authority) ? section.authority : [],
      knowledgeLayer: typeof section.knowledgeLayer === 'string' ? section.knowledgeLayer : 'unspecified',
    };
  });
  if (!wikiEditorSections.length) wikiEditorSections = initialWikiSnapshot().body.sections;
  wikiEditorSectionsKey = key;
}

function wikiEditorFormSnapshot() {
  var base = wikiEditorPage && wikiEditorPage.head ? wikiEditorPage.head.snapshot : initialWikiSnapshot();
  var title = ((document.getElementById('wiki-editor-title') || {}).value || '').trim();
  var slugInput = ((document.getElementById('wiki-editor-slug') || {}).value || '').trim();
  var sections = wikiEditorSections.map(function(section, index) {
    var heading = ((document.getElementById('wiki-section-heading-' + index) || {}).value || '').trim();
    var editorId = 'wiki-section-' + index;
    return {
      id: section.id,
      heading: heading || section.heading || 'Nova seção',
      html: typeof getEditorContent === 'function' ? getEditorContent(editorId) : section.html,
      blocks: section.blocks || [],
      authority: section.authority || [],
      knowledgeLayer: section.knowledgeLayer || 'unspecified',
    };
  });
  var type = ((document.getElementById('wiki-editor-type') || {}).value || base.type || 'concept');
  var audience = ((document.getElementById('wiki-editor-audience') || {}).value || base.audience || 'unspecified');
  var accessLevel = ((document.getElementById('wiki-editor-access') || {}).value || base.accessLevel || 'public');
  return {
    schemaVersion: 1,
    title: title,
    slug: slugInput || (base.slug || wikiSlugFromTitle(title)),
    aliases: wikiCsv((document.getElementById('wiki-editor-aliases') || {}).value),
    type: type,
    summary: ((document.getElementById('wiki-editor-summary') || {}).value || '').trim(),
    categories: wikiCsv((document.getElementById('wiki-editor-categories') || {}).value),
    accessLevel: accessLevel,
    audience: audience,
    body: { format: 'richtext-v1', infobox: base.body && Array.isArray(base.body.infobox) ? base.body.infobox : [], sections: sections },
  };
}

function persistWikiEditorDraft() {
  if (!isModOrAdmin()) return false;
  var resourceId = wikiEditorResourceId();
  var snapshot = wikiEditorFormSnapshot();
  var existing = readWikiDraft('editor', resourceId);
  var summary = ((document.getElementById('wiki-editor-edit-summary') || {}).value || '').trim();
  return writeWikiDraft('editor', resourceId, snapshot, {
    summary: summary,
    baseWorkVersion: existing && Number.isInteger(existing.baseWorkVersion)
      ? existing.baseWorkVersion : wikiEditorPage && wikiEditorPage.workVersion,
    idempotencyKey: existing && existing.idempotencyKey,
    idempotencyPayload: existing && existing.idempotencyPayload,
  });
}

function addWikiEditorSection() {
  var snapshot = wikiEditorFormSnapshot();
  wikiEditorSections = snapshot.body.sections;
  wikiEditorSections.push({
    id: newForumIdempotencyKey(), heading: 'Nova seção', html: '', blocks: [], authority: [], knowledgeLayer: 'unspecified',
  });
  wikiEditorSectionsKey = null;
  persistWikiEditorDraft();
  wikiEditorSectionsKey = null;
  render();
}

function removeWikiEditorSection(index) {
  if (wikiEditorSections.length <= 1) return;
  wikiEditorSections = wikiEditorFormSnapshot().body.sections;
  wikiEditorSections.splice(index, 1);
  wikiEditorSectionsKey = null;
  persistWikiEditorDraft();
  wikiEditorSectionsKey = null;
  render();
}

function createWikiArticleFileState() {
  return { resourceId: null, open: false, fileText: '', filename: '', preview: null, targetPageId: '',
    sourceSets: {}, sectionBindings: {}, pending: false, reading: false, error: null,
    guide: null, guideOpen: false, guideLoading: false, guideError: null, exportPending: false };
}

function wikiArticleFileContext(state) {
  var account = wikiDraftAccountId();
  return function() { return wikiArticleFileState === state && isModOrAdmin() && wikiDraftAccountId() === account; };
}

function downloadWikiArticleText(text, filename, mime) {
  var url = window.URL.createObjectURL(new Blob([text], { type: mime || 'application/json;charset=utf-8' }));
  var link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'artigo.json').replace(/[^a-z0-9._-]/gi, '-');
  link.hidden = true;
  document.body.appendChild(link);
  link.click(); link.remove();
  window.setTimeout(function() { window.URL.revokeObjectURL(url); }, 1000);
}

function loadWikiArticleGuide() {
  if (!isModOrAdmin()) return;
  var state = wikiArticleFileState;
  if (state.guideLoading) return;
  var valid = wikiArticleFileContext(state);
  state.guideLoading = true; state.guideError = null;
  wikiApi()('GET', '/api/staff/wiki/article-files/guide').then(function(response) {
    if (!valid()) return;
    var guide = wikiUnwrap(response);
    if (!guide || typeof guide.brief !== 'string' || !guide.example) throw new Error('O modelo de autoria retornado é inválido.');
    state.guide = guide;
  }).catch(function(error) { if (valid()) state.guideError = error && error.message || 'Não foi possível carregar o brief.'; })
    .finally(function() { if (valid()) { state.guideLoading = false; if (currentPage === 'wikiCreate' || currentPage === 'wikiEditor') render(); } });
}

function downloadWikiArticleGuide(kind) {
  if (!isModOrAdmin() || !wikiArticleFileState.guide) return;
  var guide = wikiArticleFileState.guide;
  if (kind === 'example') downloadWikiArticleText(JSON.stringify(guide.example, null, 2) + '\n', 'modelo-artigo.authoring.json');
  else downloadWikiArticleText(guide.brief + '\n\n## Catálogo de fontes disponíveis neste servidor\n\n'
    + JSON.stringify(guide.sourceSets || [], null, 2) + '\n', 'brief-artigo-ia.md', 'text/markdown;charset=utf-8');
}

function readWikiArticleImportFile(input) {
  if (!isModOrAdmin()) return Promise.resolve();
  var file = input && input.files && input.files[0];
  if (!file) return Promise.resolve();
  var state = wikiArticleFileState, valid = wikiArticleFileContext(state);
  state.open = true; state.preview = null; state.error = null; state.sourceSets = {}; state.sectionBindings = {};
  state.targetPageId = currentPage === 'wikiEditor' ? currentWikiPageId || '' : '';
  state.fileText = ''; state.filename = file.name; state.reading = true;
  if (file.size > 4 * 1024 * 1024) {
    state.reading = false; state.error = 'O arquivo deve ter no máximo 4 MiB.'; render(); return Promise.resolve();
  }
  render();
  return file.arrayBuffer().then(function(buffer) {
    if (!valid()) return;
    state.fileText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    state.reading = false;
    return previewWikiArticleFile();
  }).catch(function(error) {
    if (!valid()) return;
    state.reading = false; state.fileText = '';
    state.error = error && error.message || 'Não foi possível ler o arquivo JSON UTF-8.'; render();
  });
}

function changeWikiArticleFileChoice(kind, key, value) {
  if (!isModOrAdmin()) return;
  var state = wikiArticleFileState;
  if (state.pending || state.reading) return;
  if (kind === 'target') { state.targetPageId = value; state.sectionBindings = {}; }
  if (kind === 'source') state.sourceSets[key] = value;
  if (kind === 'section') state.sectionBindings[key] = value;
  if (state.preview) state.preview.previewToken = null;
  state.error = null;
  render();
}

function previewWikiArticleFile() {
  if (!isModOrAdmin()) return Promise.resolve();
  var state = wikiArticleFileState;
  if (!state.fileText || state.pending || state.reading) return Promise.resolve();
  var valid = wikiArticleFileContext(state);
  var body = { fileText: state.fileText };
  var sets = Object.keys(state.sourceSets).filter(function(key) { return state.sourceSets[key]; });
  if (sets.length) body.sourceSets = sets.map(function(key) { return { set: key, archiveSha256: state.sourceSets[key] }; });
  if (state.targetPageId) body.targetPageId = state.targetPageId;
  var bindings = Object.keys(state.sectionBindings);
  if (bindings.length) body.sectionBindings = bindings.map(function(key) { return { sourceSectionId: key, targetSectionId: state.sectionBindings[key] || null }; });
  state.pending = true; state.error = null; state.preview = null;
  render();
  return wikiApi()('POST', '/api/staff/wiki/article-files/preview', body).then(function(response) {
    if (!valid()) return;
    var preview = wikiUnwrap(response);
    if (!preview || typeof preview !== 'object') throw new Error('A prévia retornada é inválida.');
    state.preview = preview;
  }).catch(function(error) { if (valid()) state.error = error && error.message || 'Não foi possível validar o artigo.'; })
    .finally(function() { if (valid()) { state.pending = false; render(); } });
}

function commitWikiArticleFile() {
  if (!isModOrAdmin()) return Promise.resolve();
  var state = wikiArticleFileState;
  if (state.pending || !state.preview || !state.preview.previewToken) return Promise.resolve();
  var valid = wikiArticleFileContext(state);
  var token = state.preview.previewToken;
  state.pending = true; state.error = null;
  render();
  return wikiApi()('POST', '/api/staff/wiki/article-files/commit', { previewToken: token }).then(function(response) {
    if (!valid()) return;
    var result = wikiUnwrap(response);
    if (!result || !result.page || !result.page.id) throw new Error('Não foi possível confirmar o rascunho. Confira o estado antes de repetir.');
    state.pending = false;
    wikiStaffState = { items: null, article: null, loading: false, error: null };
    wikiEditorLoadedId = null;
    wikiArticleFileState = createWikiArticleFileState();
    navigate('wikiStaffArticle', result.page.id);
    showAlert(result.replay ? 'Esta importação já havia sido salva; nenhuma revisão foi duplicada.' : 'Arquivo salvo como rascunho compartilhado. A publicação permanece inalterada.', 'success');
  }).catch(function(error) {
    if (!valid()) return;
    state.error = error && error.message || 'Não foi possível confirmar o rascunho. Confira o estado antes de repetir.';
    // Keep the same signed token on transport failure: replay is idempotent.
    if (error && ((error.status >= 400 && error.status < 500) || ['STALE_VERSION', 'STALE_HEAD', 'WIKI_NAME_CONFLICT', 'WIKI_ARTICLE_FILE_PREVIEW_STALE', 'WIKI_ARTICLE_PREVIEW_EXPIRED'].includes(error.code))) {
      if (state.preview) state.preview.previewToken = null;
    }
  }).finally(function() { if (valid()) { state.pending = false; render(); } });
}

function exportWikiArticleFile(pageId) {
  if (!isModOrAdmin()) return Promise.resolve();
  var state = wikiArticleFileState;
  if (state.exportPending) return Promise.resolve();
  var valid = wikiArticleFileContext(state);
  state.exportPending = true;
  return wikiApi()('GET', '/api/staff/wiki/pages/' + encodeURIComponent(pageId) + '/article-file').then(function(response) {
    if (!valid()) return;
    var result = wikiUnwrap(response);
    if (!result || !result.file || !result.filename) throw new Error('O arquivo exportado é inválido.');
    downloadWikiArticleText(JSON.stringify(result.file, null, 2) + '\n', result.filename);
    showAlert('Versão de trabalho exportada. ' + (result.notes || []).join(' '), 'success');
  }).catch(function(error) { if (valid()) showAlert(error && error.message || 'Não foi possível exportar o artigo.', 'error'); })
    .finally(function() { if (valid()) state.exportPending = false; });
}

function renderWikiArticleFileMetadata(snapshot) {
  return '<dl class="wiki-file-metadata"><dt>Endereço</dt><dd>' + h(snapshot.slug || '') + '</dd><dt>Tipo</dt><dd>' + h(snapshot.type || '') + '</dd><dt>Nomes alternativos</dt><dd>' + h((snapshot.aliases || []).join(', ') || 'Nenhum') + '</dd><dt>Categorias</dt><dd>' + h((snapshot.categories || []).join(', ') || 'Nenhuma') + '</dd><dt>Público-alvo</dt><dd>' + h(snapshot.audience || '') + '</dd></dl>';
}

function renderWikiArticleFilePanel(pageId) {
  if (!isModOrAdmin()) return '';
  var state = wikiArticleFileState;
  var resourceId = pageId || 'new';
  if (state.resourceId !== resourceId) {
    var guide = state.guide;
    wikiArticleFileState = createWikiArticleFileState(); state = wikiArticleFileState;
    state.resourceId = resourceId; state.guide = guide;
  }
  var preview = state.preview;
  var disabled = state.pending || state.reading;
  var html = '<details class="builder-panel wiki-article-file-panel"' + (state.open ? ' open' : '')
    + ' ontoggle="wikiArticleFileState.open=this.open"><summary>Importar artigo JSON e modelo para IA</summary>'
    + '<p>Envie um artigo por arquivo: AetherverseWikiAuthoringV1 (autoria do Work) ou AetherverseWikiBundleV1 (exportação portátil). A prévia não grava nem publica.</p>'
    + '<label for="wiki-article-file">Arquivo JSON UTF-8, até 4 MiB</label><input id="wiki-article-file" type="file" accept=".json,application/json" onchange="readWikiArticleImportFile(this)"' + (disabled ? ' disabled' : '') + '>';
  if (state.filename) html += '<p>Arquivo: ' + h(state.filename) + '</p>';
  if (state.reading) html += '<p>Lendo arquivo…</p>';
  if (state.pending) html += '<p role="status">Processando…</p>';
  if (state.error) html += '<div class="alert alert-error" role="alert">' + h(state.error) + '</div>';
  if (preview) {
    (preview.needsBindings || []).forEach(function(binding) {
      html += '<label>Conjunto de fontes: ' + h(binding.set) + '<select aria-label="Conjunto ' + ha(binding.set) + '" onchange="changeWikiArticleFileChoice(\'source\',' + jsArg(binding.set) + ',this.value)"' + (disabled ? ' disabled' : '') + '><option value="">Selecione o arquivo de origem</option>';
      (binding.choices || []).forEach(function(hash) { html += '<option value="' + ha(hash) + '"' + (state.sourceSets[binding.set] === hash ? ' selected' : '') + '>' + h(hash) + '</option>'; });
      html += '</select></label>';
    });
    if (preview.candidates && preview.candidates.length) {
      html += '<label for="wiki-article-file-target">Artigo existente: importar como revisão</label><select id="wiki-article-file-target" onchange="changeWikiArticleFileChoice(\'target\',\'\',this.value)"' + (disabled ? ' disabled' : '') + '><option value="">Escolha o artigo a revisar</option>';
      preview.candidates.forEach(function(candidate) { html += '<option value="' + ha(candidate.id) + '"' + (state.targetPageId === candidate.id ? ' selected' : '') + '>' + h(candidate.title) + ' · versão ' + Number(candidate.workVersion) + '</option>'; });
      html += '</select>';
    }
    (preview.sectionOptions || []).forEach(function(section) {
      var choice = Object.hasOwn(state.sectionBindings, section.sourceSectionId) ? state.sectionBindings[section.sourceSectionId] : section.selectedTargetId || '';
      html += '<label>Identidade: ' + h(section.heading) + '<select aria-label="Identidade ' + ha(section.heading) + '" onchange="changeWikiArticleFileChoice(\'section\',' + jsArg(section.sourceSectionId) + ',this.value)"' + (disabled ? ' disabled' : '') + '><option value="">Usar identidade gerada do arquivo</option>';
      (section.choices || []).forEach(function(target) { html += '<option value="' + ha(target.id) + '"' + (choice === target.id ? ' selected' : '') + '>' + h(target.heading) + '</option>'; });
      html += '</select></label>';
    });
    (preview.warnings || []).forEach(function(warning) { html += '<p class="alert alert-info">' + h(warning) + '</p>'; });
    if (preview.snapshot) {
      if (preview.beforeSnapshot) html += '<details class="wiki-file-before"><summary>Comparar com a versão atual do artigo</summary><h2>' + h(preview.beforeSnapshot.title) + '</h2><p>' + h(preview.beforeSnapshot.summary || '') + '</p>' + renderWikiArticleFileMetadata(preview.beforeSnapshot) + renderWikiSnapshot(preview.beforeSnapshot) + '</details>';
      html += '<div class="wiki-file-preview"><h2>Prévia: ' + h(preview.snapshot.title) + '</h2>'
        + '<p>' + h(preview.snapshot.summary || '') + '</p>' + renderWikiArticleFileMetadata(preview.snapshot) + '<p>' + (preview.targetPageId ? 'Nova revisão do artigo existente, versão de base ' + Number(preview.expectedVersion) + '.' : (preview.candidates && preview.candidates.length ? 'Artigo existente encontrado: selecione o destino e valide novamente.' : 'Novo artigo.'))
        + ' Somente equipe; nenhuma publicação será alterada.</p>' + renderWikiSnapshot(preview.snapshot) + '</div>';
      html += '<details><summary>Fontes e citações (' + Number((preview.citations || []).length) + ')</summary><ul>';
      (preview.sourceMatches || []).forEach(function(source) { html += '<li>' + h(source.set || '') + ' · ' + h(source.path || '') + '<br>SHA-256: ' + h(source.fileSha256 || '') + '</li>'; });
      (preview.citations || []).forEach(function(citation) {
        var section = (preview.snapshot.body.sections || []).find(function(item) { return item.id === citation.sectionId; });
        var source = (preview.sourceMatches || []).find(function(item) { return (item.sourceId || item.id) === citation.sourceId; });
        html += '<li>' + h(section ? section.heading : citation.sectionId) + ' · ' + h(source ? source.path : citation.sourceId) + ' · ' + h(citation.locator) + '</li>';
      });
      (preview.snapshot.body.sections || []).forEach(function(section) {
        html += '<li>' + h(section.heading) + ' — Camada: ' + h(section.knowledgeLayer) + '; autoridade: ' + h((section.authority || []).join(', ') || 'sem marca agregada') + '</li>';
      });
      html += '</ul></details>';
    }
    if (preview.targetPageId && readWikiDraft('editor', preview.targetPageId)) html += '<p class="alert alert-info">Há um rascunho neste navegador para o artigo. Ele será preservado e poderá ficar desatualizado após a importação.</p>';
  }
  if (state.fileText) html += '<button type="button" class="btn" onclick="previewWikiArticleFile()"' + (disabled ? ' disabled' : '') + '>Validar arquivo / atualizar prévia</button> ';
  if (preview && preview.previewToken) html += '<button type="button" class="btn btn-primary" id="wiki-article-file-commit" onclick="commitWikiArticleFile()"' + (disabled ? ' disabled' : '') + '>Salvar prévia como rascunho</button>';
  html += '<details class="wiki-file-guide"' + (state.guideOpen ? ' open' : '') + ' ontoggle="wikiArticleFileState.guideOpen=this.open"><summary>Como pedir a uma IA que formate o artigo</summary>';
  if (!state.guide) html += '<p><button type="button" class="btn" onclick="loadWikiArticleGuide()"' + (state.guideLoading ? ' disabled' : '') + '>' + (state.guideLoading ? 'Carregando…' : 'Carregar brief e modelo') + '</button></p>';
  if (state.guideError) html += '<p class="alert alert-error">' + h(state.guideError) + '</p>';
  if (state.guide) html += '<p><button type="button" class="btn" onclick="downloadWikiArticleGuide(\'example\')">Baixar exemplo JSON</button> <button type="button" class="btn" onclick="downloadWikiArticleGuide(\'brief\')">Baixar brief para IA</button></p><label for="wiki-article-ai-brief">Instruções de formatação</label><textarea id="wiki-article-ai-brief" readonly rows="12">' + h(state.guide.brief) + '</textarea><p>O brief baixado inclui caminhos e identidades das fontes disponíveis, sem seus textos. Forneça à IA as fontes que ela não tiver. Arquivos exportados podem conter material privado.</p>';
  return html + '</details></details>';
}

function renderWikiEditor() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">A edição de artigos é restrita à equipe.</div>';
  var id = currentPage === 'wikiCreate' ? null : currentWikiPageId;
  var resourceId = id || 'new';
  if (wikiEditorLoadedId !== resourceId) ensureWikiEditorPage(id);
  if (wikiEditorLoading && wikiEditorLoadingId === resourceId) return '<div class="alert alert-info">Carregando editor do artigo…</div>';
  if (wikiEditorError && wikiEditorErrorId === resourceId) return '<div class="alert alert-error">' + h(wikiEditorError)
    + ' <button class="btn btn-small" onclick="ensureWikiEditorPage(' + jsArg(id || '') + ')">Tentar novamente</button></div>';

  var localDraft = readWikiDraft('editor', resourceId);
  var base = wikiEditorPage && wikiEditorPage.head ? wikiEditorPage.head.snapshot : initialWikiSnapshot();
  var snapshot = localDraft && localDraft.snapshot ? localDraft.snapshot : base;
  initializeWikiEditorSections(resourceId, localDraft);
  var restoreKey = localDraft ? wikiEditorDraftRestoreToken(resourceId, localDraft) : null;
  var hasRecoveredHtml = !!(localDraft && localDraft.snapshot.body.sections.some(function(section) {
    return section && typeof section.html === 'string';
  }));
  var restoreComplete = !!(restoreKey && wikiEditorDraftRestoreCompleteKey === restoreKey);
  var restorePending = hasRecoveredHtml && !restoreComplete;
  var restoreError = restoreKey && wikiEditorDraftRestoreKey === restoreKey ? wikiEditorDraftRestoreError : null;
  var restoreDisabled = restorePending || !!restoreError;
  var staleDraft = !!(id && localDraft && Number.isInteger(localDraft.baseWorkVersion)
    && localDraft.baseWorkVersion !== wikiEditorPage.workVersion);
  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Wiki</a> / ' + (id ? 'Editar artigo' : 'Novo artigo') + '</div>'
    + '<div class="cat-header"><span>' + (id ? 'Rascunho do artigo' : 'Novo artigo da wiki') + '</span>'
    + '<button class="btn btn-small" onclick="navigate(\'wikiStaff\')">Wiki da equipe</button>'
    + (id ? '<button class="btn btn-small" onclick="navigate(\'wikiStaffArticle\',' + jsArg(id) + ')">Ler artigo</button>' : '') + '</div>';
  html += renderWikiArticleFilePanel(id);
  if (id) html += '<p><button type="button" class="btn" onclick="exportWikiArticleFile(' + jsArg(id) + ')">Exportar JSON da equipe</button></p>';
  if (staleDraft) html += '<div class="alert alert-error">Este rascunho local foi iniciado na versão '
    + localDraft.baseWorkVersion + ', mas o artigo agora está na versão ' + wikiEditorPage.workVersion
    + '. Atualize a página ou descarte o rascunho local antes de salvar.</div>';
  if (localDraft) html += '<div class="alert alert-info">Rascunho local salvo neste navegador para sua conta.'
    + ' <button class="btn btn-small" onclick="discardWikiEditorDraft()">Descartar rascunho local</button></div>';
  if (restorePending && !restoreError) html += '<div class="alert alert-info">Validando o conteúdo do rascunho local antes de restaurá-lo…</div>';
  if (restoreError) html += '<div class="alert alert-error">' + h(restoreError)
    + ' <button class="btn btn-small" onclick="retryWikiEditorDraftRestore()">Tentar validar novamente</button></div>';
  html += '<fieldset style="border:0;padding:0;margin:0;min-width:0;"' + (restoreDisabled ? ' disabled' : '') + '><div class="builder-panel">'
    + '<div class="form-row"><label for="wiki-editor-title">Título</label><input id="wiki-editor-title" maxlength="200" value="' + ha(snapshot.title || '') + '" oninput="persistWikiEditorDraft()"></div>'
    + '<div class="form-row"><label for="wiki-editor-slug">Endereço curto</label><input id="wiki-editor-slug" maxlength="100" value="' + ha(snapshot.slug || '') + '" placeholder="gerado a partir do título" oninput="persistWikiEditorDraft()"></div>'
    + '<div class="form-row"><label for="wiki-editor-summary">Resumo</label><textarea id="wiki-editor-summary" maxlength="1000" rows="3" oninput="persistWikiEditorDraft()">' + h(snapshot.summary || '') + '</textarea></div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;">'
    + '<div class="form-row"><label for="wiki-editor-type">Tipo</label><select id="wiki-editor-type" onchange="persistWikiEditorDraft()">';
  var wikiTypes = [
    ['concept', 'Conceito'], ['organization', 'Organização'], ['place', 'Lugar'], ['entity', 'Entidade'],
    ['technique', 'Técnica'], ['artifact', 'Artefato'], ['event', 'Evento'], ['character-reference', 'Personagem'],
  ];
  wikiTypes.forEach(function(type) { html += '<option value="' + type[0] + '"' + (snapshot.type === type[0] ? ' selected' : '') + '>' + type[1] + '</option>'; });
  html += '</select></div><div class="form-row"><label for="wiki-editor-audience">Público-alvo</label><select id="wiki-editor-audience" onchange="persistWikiEditorDraft()">';
  [['unspecified', 'Não especificado'], ['reader', 'Leitor'], ['player', 'Jogador'], ['author', 'Autor']].forEach(function(item) {
    html += '<option value="' + item[0] + '"' + (snapshot.audience === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
  });
  html += '</select></div></div>'
    + '<div class="form-row"><label for="wiki-editor-categories">Categorias (separadas por vírgula)</label><input id="wiki-editor-categories" value="' + ha((snapshot.categories || []).join(', ')) + '" oninput="persistWikiEditorDraft()"></div>'
    + '<div class="form-row"><label for="wiki-editor-aliases">Nomes alternativos (separados por vírgula)</label><input id="wiki-editor-aliases" value="' + ha((snapshot.aliases || []).join(', ')) + '" oninput="persistWikiEditorDraft()"></div>'
    + '</div>';
  wikiEditorSections.forEach(function(section, index) {
    var editorId = 'wiki-section-' + index;
    var editorHtml = buildEditor(editorId, section.html || '', 'Escreva o conteúdo desta seção…')
      .replace('contenteditable="true"', 'contenteditable="' + (restoreDisabled ? 'false' : 'true') + '" aria-disabled="' + (restoreDisabled ? 'true' : 'false') + '"')
      .replace('oninput="updateEditorCount(\'' + editorId + '\')"', 'oninput="updateEditorCount(\'' + editorId + '\');persistWikiEditorDraft()"');
    html += '<div class="builder-panel"><div class="builder-panel-title"><span>Seção ' + (index + 1) + '</span>'
      + (wikiEditorSections.length > 1 ? '<button type="button" class="btn btn-small btn-danger" onclick="removeWikiEditorSection(' + index + ')">Remover</button>' : '')
      + '</div><div class="form-row"><label for="wiki-section-heading-' + index + '">Título da seção</label>'
      + '<input id="wiki-section-heading-' + index + '" maxlength="200" value="' + ha(section.heading || '') + '" oninput="persistWikiEditorDraft()"></div>'
      + editorHtml + '</div>';
  });
  html += '<div class="builder-panel"><button type="button" class="btn btn-small" onclick="addWikiEditorSection()">Adicionar seção</button>'
    + '<div class="form-row" style="margin-top:12px;"><label for="wiki-editor-edit-summary">Resumo da alteração</label><input id="wiki-editor-edit-summary" maxlength="1000" value="' + ha(localDraft && localDraft.summary || '') + '" placeholder="O que mudou?" oninput="persistWikiEditorDraft()"></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">'
    + '<button class="btn btn-primary" onclick="saveWikiArticleDraft()">Salvar rascunho</button>';
  if (id && wikiEditorPage && wikiEditorPage.headRevisionId && !wikiEditorPage.archivedAt) {
    html += '<button class="btn" onclick="publishWikiArticle()"' + (localDraft || staleDraft || restoreDisabled ? ' disabled' : '') + '>Publicar para todos</button>';
  }
  html += '</div><p class="field-desc">Salvar cria uma nova revisão privada de trabalho. A publicação é uma ação separada.</p></div>';
  html += '</fieldset>';
  if (id) html += renderWikiDiscussionEditor(id) + renderWikiEditorHistory(id);
  return html;
}

function retryWikiEditorDraftRestore() {
  wikiEditorDraftRestoreKey = null;
  wikiEditorDraftRestoreCompleteKey = null;
  wikiEditorDraftRestoreError = null;
  wikiEditorDraftRestorePending = false;
  render();
}

function renderWikiEditorHistory(pageId) {
  if (!wikiEditorHistory.loaded && !wikiEditorHistory.loading) loadWikiEditorHistory(pageId, false);
  var html = '<div class="builder-panel"><h3>Histórico de revisões</h3>';
  if (wikiEditorHistory.loading) return html + '<p>Carregando histórico…</p></div>';
  if (wikiEditorHistory.error) return html + '<p class="alert alert-error">' + h(wikiEditorHistory.error)
    + ' <button class="btn btn-small" onclick="loadWikiEditorHistory(' + jsArg(pageId) + ',true)">Tentar novamente</button></p></div>';
  if (!wikiEditorHistory.items.length) return html + '<p>Nenhuma revisão registrada.</p></div>';
  if (wikiEditorHistory.items.length > 1) html += renderWikiRevisionDiffControls(pageId);
  html += '<ol>';
  wikiEditorHistory.items.forEach(function(revision) {
    html += '<li style="margin:10px 0;"><b>Revisão ' + Number(revision.sequence) + '</b> — ' + h(revision.editSummary || '')
      + ' <span class="field-desc" style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">' + renderAuthorChip(revision.actor, 'Equipe') + ' · ' + h(formatJoinDate(revision.createdAt)) + '</span>';
    if (!readWikiDraft('editor', pageId)) html += ' <button class="btn btn-small" onclick="restoreWikiRevision(' + jsArg(pageId) + ',' + jsArg(revision.id) + ')">Restaurar como rascunho</button>';
    html += '</li>';
  });
  return html + '</ol></div>';
}

function renderWikiRevisionDiffControls(pageId) {
  var items = wikiEditorHistory.items;
  var state = wikiEditorDiffState;
  var validIds = items.map(function(item) { return item.id; });
  if (state.pageId !== pageId || validIds.indexOf(state.beforeRevisionId) === -1 || validIds.indexOf(state.afterRevisionId) === -1) {
    state = {
      pageId: pageId,
      beforeRevisionId: items[1].id,
      afterRevisionId: items[0].id,
      loading: false,
      error: null,
      result: null,
    };
    wikiEditorDiffState = state;
  }
  var html = '<div class="builder-panel" style="margin:12px 0;"><h4>Comparar revisões</h4>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">'
    + '<div class="form-row"><label for="wiki-diff-before">Versão anterior</label><select id="wiki-diff-before">';
  items.forEach(function(revision) {
    html += '<option value="' + ha(revision.id) + '"' + (revision.id === state.beforeRevisionId ? ' selected' : '') + '>'
      + h(wikiRevisionOptionLabel(revision)) + '</option>';
  });
  html += '</select></div><div class="form-row"><label for="wiki-diff-after">Versão comparada</label><select id="wiki-diff-after">';
  items.forEach(function(revision) {
    html += '<option value="' + ha(revision.id) + '"' + (revision.id === state.afterRevisionId ? ' selected' : '') + '>'
      + h(wikiRevisionOptionLabel(revision)) + '</option>';
  });
  html += '</select></div></div><button class="btn btn-small" onclick="compareWikiRevisions(' + jsArg(pageId) + ')"'
    + (state.loading ? ' disabled' : '') + '>Comparar selecionadas</button>';
  if (state.loading) html += '<p>Comparando revisões…</p>';
  if (state.error) html += '<p class="alert alert-error" style="margin-top:10px;">' + h(state.error) + '</p>';
  if (state.result) html += renderWikiRevisionDiff(state.result);
  return html + '</div>';
}

function wikiRevisionOptionLabel(revision) {
  return 'Revisão ' + Number(revision.sequence) + (revision.editSummary ? ' — ' + revision.editSummary : '');
}

function compareWikiRevisions(pageId) {
  if (!isModOrAdmin() || !wikiEditorPage || wikiEditorPage.id !== pageId) return;
  var beforeId = ((document.getElementById('wiki-diff-before') || {}).value || '');
  var afterId = ((document.getElementById('wiki-diff-after') || {}).value || '');
  if (!beforeId || !afterId || beforeId === afterId) {
    wikiEditorDiffState = { pageId: pageId, beforeRevisionId: beforeId, afterRevisionId: afterId, loading: false, error: 'Escolha duas revisões diferentes.', result: null };
    render();
    return;
  }
  var sequence = ++wikiEditorDiffRequestSequence;
  wikiEditorDiffState = { pageId: pageId, beforeRevisionId: beforeId, afterRevisionId: afterId, loading: true, error: null, result: null };
  render();
  var baseUrl = '/api/staff/wiki/pages/' + encodeURIComponent(pageId) + '/revisions/' + encodeURIComponent(beforeId);
  var comparedUrl = '/api/staff/wiki/pages/' + encodeURIComponent(pageId) + '/revisions/' + encodeURIComponent(afterId)
    + '?compareTo=' + encodeURIComponent(beforeId);
  Promise.all([wikiApi()('GET', baseUrl), wikiApi()('GET', comparedUrl)]).then(function(responses) {
    var before = wikiUnwrap(responses[0]);
    var after = wikiUnwrap(responses[1]);
    if (!before || !before.snapshot || !after || !after.snapshot || !after.diff) throw new Error('O servidor não retornou as duas revisões para comparação.');
    if (sequence !== wikiEditorDiffRequestSequence) return;
    wikiEditorDiffState.result = { before: before, after: after, diff: after.diff };
  }).catch(function(error) {
    if (sequence !== wikiEditorDiffRequestSequence) return;
    wikiEditorDiffState.error = error && error.message ? error.message : 'Não foi possível comparar estas revisões.';
  }).finally(function() {
    if (sequence !== wikiEditorDiffRequestSequence) return;
    wikiEditorDiffState.loading = false;
    if (currentPage === 'wikiEditor' && currentWikiPageId === pageId) render();
  });
}

function renderWikiRevisionDiff(result) {
  var diff = result.diff || {};
  var fieldLabels = {
    title: 'Título', slug: 'Endereço curto', aliases: 'Nomes alternativos', type: 'Tipo',
    summary: 'Resumo', categories: 'Categorias', accessLevel: 'Visibilidade', audience: 'Público-alvo', body: 'Conteúdo',
  };
  var html = '<div class="builder-panel" style="margin-top:12px;"><h4>Resultado da comparação</h4>'
    + '<p>Revisão ' + Number(result.before.sequence) + ' comparada com a revisão ' + Number(result.after.sequence) + '.</p>';
  var changedFields = Array.isArray(diff.changedFields) ? diff.changedFields : [];
  html += '<p><b>Campos alterados:</b> ' + (changedFields.length
    ? changedFields.map(function(field) { return h(fieldLabels[field] || field); }).join(', ')
    : 'nenhum') + '</p>';
  function sectionNames(snapshot, ids) {
    return (Array.isArray(ids) ? ids : []).map(function(id) {
      var section = (snapshot.body && snapshot.body.sections || []).find(function(item) { return item.id === id; });
      return section ? (section.heading || id) : id;
    });
  }
  var added = sectionNames(result.after.snapshot, diff.addedSections);
  var removed = sectionNames(result.before.snapshot, diff.removedSections);
  var changed = sectionNames(result.after.snapshot, diff.changedSections);
  if (added.length || removed.length || changed.length) {
    html += '<ul>';
    if (added.length) html += '<li><b>Seções adicionadas:</b> ' + added.map(h).join(', ') + '</li>';
    if (removed.length) html += '<li><b>Seções removidas:</b> ' + removed.map(h).join(', ') + '</li>';
    if (changed.length) html += '<li><b>Seções alteradas:</b> ' + changed.map(h).join(', ') + '</li>';
    html += '</ul>';
  } else html += '<p>Nenhuma seção foi adicionada, removida ou alterada.</p>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">'
    + '<div><h5>Antes — revisão ' + Number(result.before.sequence) + '</h5>'
    + renderWikiRevisionMetadata(result.before.snapshot) + renderWikiSnapshot(result.before.snapshot, { staff: true }) + '</div>'
    + '<div><h5>Depois — revisão ' + Number(result.after.sequence) + '</h5>'
    + renderWikiRevisionMetadata(result.after.snapshot) + renderWikiSnapshot(result.after.snapshot, { staff: true }) + '</div>'
    + '</div></div>';
  return html;
}

function renderWikiRevisionMetadata(snapshot) {
  var values = [
    ['Título', snapshot.title], ['Endereço curto', snapshot.slug], ['Resumo', snapshot.summary],
    ['Nomes alternativos', (snapshot.aliases || []).join(', ') || 'Nenhum'],
    ['Categorias', (snapshot.categories || []).join(', ') || 'Nenhuma'],
    ['Tipo', snapshot.type], ['Visibilidade', snapshot.accessLevel], ['Público-alvo', snapshot.audience],
  ];
  return '<ul>' + values.map(function(item) { return '<li><b>' + h(item[0]) + ':</b> ' + h(item[1] || '—') + '</li>'; }).join('') + '</ul>';
}

function ensureWikiEditorDiscussion(pageId) {
  var id = String(pageId || '');
  if (!id) return;
  if (wikiEditorDiscussionState.pageId !== id) {
    wikiEditorDiscussionRequestSequence += 1;
    wikiEditorDiscussionState = {
      pageId: id, categories: null, selectedCategoryId: '', threads: [], loadingCategories: false,
      loadingThreads: false, error: null, currentThread: null, currentThreadId: null,
      loadingCurrentThread: false, saving: false, generation: wikiEditorDiscussionRequestSequence,
      categorySequence: 0, threadsSequence: 0, currentThreadSequence: 0,
    };
  }
  var linkedId = wikiEditorPage && wikiEditorPage.discussionThreadId || null;
  if (linkedId !== wikiEditorDiscussionState.currentThreadId) {
    wikiEditorDiscussionState.currentThreadId = linkedId;
    wikiEditorDiscussionState.currentThread = null;
    if (linkedId) loadWikiEditorLinkedThread(id, linkedId);
  }
  if (wikiEditorDiscussionState.categories === null && !wikiEditorDiscussionState.loadingCategories) {
    loadWikiEditorDiscussionCategories(id, false);
  }
}

function loadWikiEditorDiscussionCategories(pageId, force) {
  var state = wikiEditorDiscussionState;
  if (state.loadingCategories || (state.categories !== null && !force)) return;
  state.loadingCategories = true;
  state.error = null;
  var generation = state.generation;
  var sequence = ++state.categorySequence;
  wikiApi()('GET', '/api/forum/categories?limit=100&offset=0').then(function(response) {
    if (!response || !Array.isArray(response.data)) throw new Error('A resposta das categorias do fórum é inválida.');
    if (wikiEditorDiscussionState !== state || generation !== state.generation || sequence !== state.categorySequence) return;
    state.categories = response.data.filter(function(category) { return !category.archivedAt; });
    if (!state.selectedCategoryId && state.categories.length) state.selectedCategoryId = state.categories[0].id;
    if (state.selectedCategoryId) loadWikiEditorDiscussionThreads(pageId, state.selectedCategoryId, true);
  }).catch(function(error) {
    if (wikiEditorDiscussionState === state && generation === state.generation && sequence === state.categorySequence) {
      state.error = error && error.message ? error.message : 'Não foi possível carregar as categorias do fórum.';
    }
  }).finally(function() {
    if (wikiEditorDiscussionState !== state || generation !== state.generation || sequence !== state.categorySequence) return;
    state.loadingCategories = false;
    if (currentPage === 'wikiEditor' && String(currentWikiPageId) === String(pageId)) render();
  });
}

function loadWikiEditorDiscussionThreads(pageId, categoryId, resetSearch) {
  var state = wikiEditorDiscussionState;
  var category = String(categoryId || '');
  if (!category) {
    state.threads = [];
    state.selectedCategoryId = '';
    return;
  }
  state.selectedCategoryId = category;
  var searchInput = document.getElementById('wiki-discussion-search');
  var search = resetSearch ? '' : String(searchInput && searchInput.value || '').trim();
  state.search = search;
  state.loadingThreads = true;
  state.error = null;
  var generation = state.generation;
  var sequence = ++state.threadsSequence;
  var params = new URLSearchParams({ limit: '100', offset: '0' });
  if (search) params.set('search', search);
  wikiApi()('GET', '/api/forum/categories/' + encodeURIComponent(category) + '/threads?' + params.toString()).then(function(response) {
    if (!response || !Array.isArray(response.data)) throw new Error('A resposta das discussões do fórum é inválida.');
    if (wikiEditorDiscussionState === state && generation === state.generation && sequence === state.threadsSequence) state.threads = response.data;
  }).catch(function(error) {
    if (wikiEditorDiscussionState === state && generation === state.generation && sequence === state.threadsSequence) {
      state.error = error && error.message ? error.message : 'Não foi possível carregar as discussões públicas.';
    }
  }).finally(function() {
    if (wikiEditorDiscussionState !== state || generation !== state.generation || sequence !== state.threadsSequence) return;
    state.loadingThreads = false;
    if (currentPage === 'wikiEditor' && String(currentWikiPageId) === String(pageId)) render();
  });
}

function changeWikiDiscussionCategory(categoryId) {
  var input = document.getElementById('wiki-discussion-search');
  if (input) input.value = '';
  wikiEditorDiscussionState.search = '';
  loadWikiEditorDiscussionThreads(wikiEditorDiscussionState.pageId, categoryId, true);
  render();
}

function searchWikiEditorDiscussions() {
  loadWikiEditorDiscussionThreads(wikiEditorDiscussionState.pageId, wikiEditorDiscussionState.selectedCategoryId, false);
  render();
}

function loadWikiEditorLinkedThread(pageId, threadId) {
  var state = wikiEditorDiscussionState;
  state.loadingCurrentThread = true;
  var generation = state.generation;
  var sequence = ++state.currentThreadSequence;
  wikiApi()('GET', '/api/forum/threads/' + encodeURIComponent(threadId)).then(function(response) {
    if (wikiEditorDiscussionState === state && generation === state.generation && sequence === state.currentThreadSequence) state.currentThread = wikiUnwrap(response);
  }).catch(function(error) {
    if (wikiEditorDiscussionState === state && generation === state.generation && sequence === state.currentThreadSequence) {
      state.error = error && error.message ? error.message : 'Não foi possível carregar a discussão vinculada.';
    }
  }).finally(function() {
    if (wikiEditorDiscussionState !== state || generation !== state.generation || sequence !== state.currentThreadSequence) return;
    state.loadingCurrentThread = false;
    if (currentPage === 'wikiEditor' && String(currentWikiPageId) === String(pageId)) render();
  });
}

function renderWikiDiscussionEditor(pageId) {
  ensureWikiEditorDiscussion(pageId);
  var state = wikiEditorDiscussionState;
  var linkedId = wikiEditorPage && wikiEditorPage.discussionThreadId || null;
  var localDraft = !!readWikiDraft('editor', pageId);
  var html = '<div class="builder-panel"><h3>Discussão pública do artigo</h3>';
  if (linkedId) {
    if (state.currentThread) html += '<p>Vinculada: <a onclick="navigate(\'thread\',' + jsArg(linkedId) + ')">'
      + h(state.currentThread.title || 'Abrir tópico') + '</a>'
      + (state.currentThread.categoryName ? ' <span class="field-desc">em ' + h(state.currentThread.categoryName) + '</span>' : '') + '</p>';
    else if (state.loadingCurrentThread) html += '<p>Carregando a discussão vinculada…</p>';
    else html += '<p>Há uma discussão vinculada, mas o tópico não está disponível para consulta. ID: ' + h(linkedId) + '</p>';
    html += '<button class="btn btn-small btn-danger" onclick="removeWikiDiscussionLink(' + jsArg(pageId) + ')"'
      + (localDraft || state.saving ? ' disabled' : '') + '>Remover vínculo</button>';
  } else html += '<p>Nenhuma discussão está vinculada a este artigo.</p>';
  if (localDraft) html += '<p class="field-desc">Salve ou descarte o rascunho local antes de alterar o vínculo da discussão.</p>';
  if (state.loadingCategories) html += '<p>Carregando categorias do fórum…</p>';
  else if (state.categories === null && state.error) html += '<p class="alert alert-error">' + h(state.error)
    + ' <button class="btn btn-small" onclick="loadWikiEditorDiscussionCategories(' + jsArg(pageId) + ',true)">Tentar novamente</button></p>';
  else if (state.categories && !state.categories.length) html += '<p>Não há categorias públicas ativas para escolher uma discussão.</p>';
  else if (state.categories && state.categories.length) {
    html += '<div class="form-row"><label for="wiki-discussion-category">Categoria do fórum</label><select id="wiki-discussion-category" onchange="changeWikiDiscussionCategory(this.value)">';
    state.categories.forEach(function(category) {
      html += '<option value="' + ha(category.id) + '"' + (category.id === state.selectedCategoryId ? ' selected' : '') + '>' + h(category.name) + '</option>';
    });
    html += '</select></div><div class="form-row"><label for="wiki-discussion-search">Buscar tópico público</label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;"><input id="wiki-discussion-search" type="search" maxlength="100" value="' + ha(state.search || '') + '" placeholder="Título do tópico">'
      + '<button class="btn btn-small" onclick="searchWikiEditorDiscussions()"' + (state.loadingThreads ? ' disabled' : '') + '>Buscar tópicos</button></div></div>';
    if (state.loadingThreads) html += '<p>Carregando tópicos públicos…</p>';
    else if (!state.threads.length) html += '<p>Nenhum tópico público encontrado nesta categoria.</p>';
    else {
      html += '<div class="form-row"><label for="wiki-discussion-thread">Discussão pública</label><select id="wiki-discussion-thread">'
        + '<option value="">Escolha um tópico</option>';
      state.threads.forEach(function(thread) {
        html += '<option value="' + ha(thread.id) + '">' + h(thread.title) + (thread.tag ? ' · ' + h(thread.tag) : '') + '</option>';
      });
      html += '</select></div><button class="btn btn-small btn-primary" onclick="saveWikiDiscussionLink(' + jsArg(pageId) + ')"'
        + (localDraft || state.saving ? ' disabled' : '') + '>Vincular discussão selecionada</button>';
    }
  }
  if (state.error && state.categories !== null) html += '<p class="alert alert-error" style="margin-top:10px;">' + h(state.error) + '</p>';
  if (state.saving) html += '<p>Salvando vínculo…</p>';
  return html + '</div>';
}

function saveWikiDiscussionLink(pageId) {
  if (!isModOrAdmin() || !wikiEditorPage || wikiEditorPage.id !== pageId || readWikiDraft('editor', pageId)) return;
  var threadId = ((document.getElementById('wiki-discussion-thread') || {}).value || '');
  if (!threadId || !wikiEditorDiscussionState.threads.some(function(thread) { return thread.id === threadId; })) {
    showAlert('Escolha uma discussão pública da lista.', 'error');
    return;
  }
  if (threadId === wikiEditorPage.discussionThreadId) {
    showAlert('Esta discussão já está vinculada ao artigo.', 'error');
    return;
  }
  updateWikiDiscussionLink(pageId, threadId);
}

function removeWikiDiscussionLink(pageId) {
  if (!isModOrAdmin() || !wikiEditorPage || wikiEditorPage.id !== pageId || !wikiEditorPage.discussionThreadId
      || readWikiDraft('editor', pageId)) return;
  updateWikiDiscussionLink(pageId, null);
}

function updateWikiDiscussionLink(pageId, threadId) {
  var state = wikiEditorDiscussionState;
  state.saving = true;
  state.error = null;
  render();
  wikiApi()('PATCH', '/api/staff/wiki/pages/' + encodeURIComponent(pageId) + '/discussion', {
    threadId: threadId,
    expectedVersion: wikiEditorPage.workVersion,
  }).then(function(response) {
    var page = wikiUnwrap(response);
    if (!page || page.id !== pageId) throw new Error('A resposta ao atualizar o vínculo é inválida.');
    wikiEditorPage = page;
    state.currentThreadId = page.discussionThreadId || null;
    state.currentThread = null;
    if (page.discussionThreadId) loadWikiEditorLinkedThread(pageId, page.discussionThreadId);
    showAlert(threadId ? 'Discussão vinculada ao artigo.' : 'Vínculo da discussão removido.', 'success');
  }).catch(function(error) {
    state.error = error && error.message ? error.message : 'Não foi possível atualizar o vínculo da discussão.';
    showAlert(state.error, 'error');
  }).finally(function() {
    state.saving = false;
    if (currentPage === 'wikiEditor' && String(currentWikiPageId) === String(pageId)) render();
  });
}

function discardWikiEditorDraft() {
  clearWikiDraft('editor', wikiEditorResourceId());
  wikiEditorDraftRestoreKey = null;
  wikiEditorDraftRestoreCompleteKey = null;
  wikiEditorSectionsKey = null;
  render();
}

function wikiIdempotencyKeyForDraft(kind, resourceId, payload) {
  var current = readWikiDraft(kind, resourceId) || {};
  var serialized = wikiDraftRequestPayload(payload);
  var key = current.idempotencyPayload === serialized && /^[0-9a-f-]{36}$/i.test(current.idempotencyKey || '')
    ? current.idempotencyKey : newForumIdempotencyKey();
  var saved = writeWikiDraft(kind, resourceId, payload.snapshot, {
    summary: payload.summary,
    baseWorkVersion: current.baseWorkVersion,
    basePublishedRevisionId: payload.basePublishedRevisionId,
    idempotencyKey: key,
    idempotencyPayload: serialized,
  });
  return saved ? key : null;
}

function wikiDraftRequestPayload(payload) {
  return JSON.stringify({
    snapshot: payload.snapshot,
    summary: payload.summary || '',
    basePublishedRevisionId: payload.basePublishedRevisionId || null,
  });
}

function saveWikiArticleDraft() {
  if (!isModOrAdmin()) return;
  var resourceId = wikiEditorResourceId();
  var snapshot = wikiEditorFormSnapshot();
  var summary = ((document.getElementById('wiki-editor-edit-summary') || {}).value || '').trim() || 'Rascunho da equipe';
  if (!snapshot.title || !snapshot.slug) { showAlert('Preencha o título e o endereço curto do artigo.', 'error'); return; }
  var localDraft = readWikiDraft('editor', resourceId);
  if (wikiEditorPage && localDraft && localDraft.baseWorkVersion !== wikiEditorPage.workVersion) {
    showAlert('O artigo mudou desde que este rascunho local foi iniciado. Atualize ou descarte o rascunho antes de salvar.', 'error');
    return;
  }
  var payload = { snapshot: snapshot, summary: summary };
  var request;
  var finish = beginResourceFormSubmission('wiki-save:' + String(resourceId));
  if (!finish) return;
  if (!wikiEditorPage) {
    var key = wikiIdempotencyKeyForDraft('editor', resourceId, payload);
    if (!key) { finish(); return; }
    request = wikiApi()('POST', '/api/staff/wiki/pages', payload, null, { headers: { 'Idempotency-Key': key } });
  } else {
    payload.expectedVersion = localDraft && Number.isInteger(localDraft.baseWorkVersion)
      ? localDraft.baseWorkVersion : wikiEditorPage.workVersion;
    if (!writeWikiDraft('editor', resourceId, snapshot, { summary: summary, baseWorkVersion: payload.expectedVersion })) {
      finish();
      return;
    }
    request = wikiApi()('POST', '/api/staff/wiki/pages/' + encodeURIComponent(wikiEditorPage.id) + '/revisions', payload);
  }
  request.then(function(response) {
    finish();
    var page = wikiUnwrap(response);
    if (!page || !page.id) throw new Error('A resposta ao salvar o artigo é inválida.');
    clearWikiDraft('editor', resourceId);
    wikiEditorDraftRestoreKey = null;
    wikiEditorDraftRestoreCompleteKey = null;
    wikiEditorPage = page;
    wikiEditorLoadedId = page.id;
    wikiEditorHistory = { items: [], loading: false, loaded: false, error: null };
    wikiEditorSectionsKey = null;
    wikiStaffState = { items: null, article: null, loading: false, error: null };
    if (currentPage === 'wikiCreate' || (currentPage === 'wikiEditor' && !currentWikiPageId)) navigate('wikiEditor', page.id, { replace: true });
    else render();
    loadWikiEditorHistory(page.id, true);
    showAlert('Rascunho salvo como uma nova revisão.', 'success');
  }).catch(function(error) {
    finish();
    showAlert(error && error.message ? error.message : 'Não foi possível salvar o rascunho.', 'error');
  });
}

function publishWikiArticle() {
  if (!isModOrAdmin() || !wikiEditorPage) return;
  if (readWikiDraft('editor', wikiEditorPage.id)) {
    showAlert('Salve ou descarte o rascunho local antes de publicar.', 'error');
    return;
  }
  if (!window.confirm('Publicar esta revisão para todos, inclusive visitantes? O conteúdo deixará de ser restrito à equipe.')) return;
  var payload = {
    makePublic: true,
    revisionId: wikiEditorPage.headRevisionId,
    expectedVersion: wikiEditorPage.workVersion,
    expectedPublishedRevisionId: wikiEditorPage.publishedRevisionId,
    summary: ((document.getElementById('wiki-editor-edit-summary') || {}).value || '').trim() || 'Publicação da revisão',
  };
  var finish = beginResourceFormSubmission('wiki-publish:' + String(wikiEditorPage.id));
  if (!finish) return;
  var publishingAccount = DB.session && (DB.session.serverId || DB.session.id);
  function samePublisher() { return isModOrAdmin() && String(DB.session.serverId || DB.session.id) === String(publishingAccount); }
  wikiApi()('POST', '/api/staff/wiki/pages/' + encodeURIComponent(wikiEditorPage.id) + '/publish', payload).then(function(response) {
    finish();
    if (!samePublisher()) return;
    var page = wikiUnwrap(response);
    if (!page || !page.id) throw new Error('A resposta ao publicar o artigo é inválida.');
    wikiEditorPage = page;
    wikiEditorHistory = { items: [], loading: false, loaded: false, error: null };
    serverWikiPages = null; serverWikiCategories = null;
    serverWikiSections = null; wikiSectionsError = null; wikiSectionsLoading = false; wikiSectionsGeneration += 1;
    currentWikiArticle = null; wikiArticleRequestSequence += 1;
    wikiArticleLoading = false; wikiArticleLoadingSlug = null;
    wikiArticleLoadError = null; wikiArticleLoadErrorSlug = null;
    wikiStaffState = { items: null, article: null, loading: false, error: null };
    render();
    loadWikiEditorHistory(page.id, true);
    showAlert('Revisão publicada para todos.', 'success');
  }).catch(function(error) {
    finish();
    if (!samePublisher()) return;
    showAlert(error && error.message ? error.message : 'Não foi possível publicar esta revisão.', 'error');
  });
}

function restoreWikiRevision(pageId, revisionId) {
  if (!isModOrAdmin() || !wikiEditorPage || readWikiDraft('editor', pageId)) return;
  var reason = window.prompt('Resumo desta restauração:');
  if (reason === null) return;
  wikiApi()('POST', '/api/staff/wiki/pages/' + encodeURIComponent(pageId) + '/restore-revision', {
    oldRevisionId: revisionId,
    expectedVersion: wikiEditorPage.workVersion,
    summary: reason.trim() || 'Restauração de uma revisão anterior',
  }).then(function(response) {
    wikiEditorPage = wikiUnwrap(response);
    wikiEditorHistory = { items: [], loading: false, loaded: false, error: null };
    wikiEditorSectionsKey = null;
    render();
    loadWikiEditorHistory(pageId, true);
    showAlert('A revisão foi copiada para um novo rascunho.', 'success');
  }).catch(function(error) {
    showAlert(error && error.message ? error.message : 'Não foi possível restaurar esta revisão.', 'error');
  });
}

function renderWikiProposalForm(article) {
  var draft = readWikiDraft('proposal', article.id);
  var snapshot = draft && draft.snapshot ? draft.snapshot : article;
  var restoreKey = draft ? wikiProposalDraftRestoreToken(article, draft) : null;
  var hasRecoveredHtml = !!(draft && draft.snapshot.body.sections[0]
    && typeof draft.snapshot.body.sections[0].html === 'string');
  var restoredHtml = restoreKey && wikiProposalDraftSafeHtmlKey === restoreKey;
  var restoreError = restoreKey && wikiEditorDraftRestoreKey === restoreKey ? wikiProposalDraftRestoreError : null;
  var restoreDisabled = hasRecoveredHtml && !restoredHtml || !!restoreError;
  var safeHtml = restoredHtml ? wikiProposalDraftSafeHtml : (article.body.sections[0] && article.body.sections[0].html || '');
  var id = 'wiki-proposal-body';
  var editorHtml = buildEditor(id, safeHtml, 'Descreva a alteração proposta…')
    .replace('contenteditable="true"', 'contenteditable="' + (restoreDisabled ? 'false' : 'true') + '" aria-disabled="' + (restoreDisabled ? 'true' : 'false') + '"')
    .replace('oninput="updateEditorCount(\'' + id + '\')"', 'oninput="updateEditorCount(\'' + id + '\');persistWikiProposalDraft()"');
  var html = '<div class="builder-panel"><h3>Propor uma edição</h3>'
    + '<p>As propostas são revisadas pela equipe e não alteram a publicação automaticamente.</p>';
  if (draft) html += '<p class="field-desc">Rascunho local salvo para sua conta. <button class="btn btn-small" onclick="discardWikiProposalDraft(' + jsArg(article.id) + ')">Descartar rascunho</button></p>';
  if (restoreDisabled && !restoreError) html += '<p class="alert alert-info" id="wiki-proposal-restore-state">Validando o conteúdo do rascunho local antes de restaurá-lo…</p>';
  if (restoreError) html += '<p class="alert alert-error" id="wiki-proposal-restore-state">' + h(restoreError)
    + ' <button class="btn btn-small" onclick="retryWikiProposalDraftRestore()">Tentar validar novamente</button></p>';
  if (!article.publishedRevisionId) html += '<div class="alert alert-error">O artigo ainda não informa a revisão pública usada como base; a proposta ficará indisponível até o servidor fornecer essa referência.</div>';
  html += '<fieldset style="border:0;padding:0;margin:0;min-width:0;"' + (restoreDisabled ? ' disabled' : '') + '><div class="form-row"><label for="wiki-proposal-summary">Resumo da proposta</label><textarea id="wiki-proposal-summary" rows="2" maxlength="1000" oninput="persistWikiProposalDraft()">' + h(draft && draft.summary || '') + '</textarea></div>'
    + '<div class="form-row"><label for="wiki-proposal-heading">Título da seção</label><input id="wiki-proposal-heading" maxlength="200" value="' + ha(snapshot.body.sections[0] && snapshot.body.sections[0].heading || 'Visão geral') + '" oninput="persistWikiProposalDraft()"></div>'
    + editorHtml + '<button class="btn btn-primary" style="margin-top:12px;" onclick="submitWikiProposal(' + jsArg(article.id) + ')"'
    + (article.publishedRevisionId && !restoreDisabled ? '' : ' disabled') + '>Enviar proposta para revisão</button></div></fieldset>';
  return html;
}

function retryWikiProposalDraftRestore() {
  wikiEditorDraftRestoreKey = null;
  wikiProposalDraftRestorePending = false;
  wikiProposalDraftRestoreError = null;
  wikiProposalDraftSafeHtml = null;
  wikiProposalDraftSafeHtmlKey = null;
  render();
}

function wikiProposalFormSnapshot(article) {
  var prior = readWikiDraft('proposal', article.id);
  var section = article.body.sections[0] || { id: newForumIdempotencyKey(), heading: 'Visão geral', blocks: [], authority: [], knowledgeLayer: 'unspecified' };
  var candidate = {
    schemaVersion: 1,
    title: article.title,
    slug: article.slug,
    aliases: Array.isArray(article.aliases) ? article.aliases.slice() : [],
    type: article.type,
    summary: article.summary || '',
    categories: Array.isArray(article.categories) ? article.categories.slice() : [],
    accessLevel: article.accessLevel,
    audience: article.audience,
    body: {
      format: 'richtext-v1',
      infobox: article.body && Array.isArray(article.body.infobox) ? article.body.infobox : [],
      sections: article.body.sections.map(function(item) { return JSON.parse(JSON.stringify(item)); }),
    },
  };
  candidate.body.sections[0] = {
    id: section.id,
    heading: ((document.getElementById('wiki-proposal-heading') || {}).value || '').trim() || section.heading,
    html: typeof getEditorContent === 'function' ? getEditorContent('wiki-proposal-body') : section.html,
    blocks: section.blocks || [], authority: section.authority || [], knowledgeLayer: section.knowledgeLayer || 'unspecified',
  };
  if (prior && prior.snapshot && prior.snapshot.body && prior.snapshot.body.sections.length > 1) {
    candidate.body.sections = [candidate.body.sections[0]].concat(prior.snapshot.body.sections.slice(1));
  }
  return candidate;
}

function persistWikiProposalDraft() {
  if (!DB.session || isModOrAdmin() || !currentWikiArticle) return false;
  var article = currentWikiArticle;
  var snapshot = wikiProposalFormSnapshot(article);
  var prior = readWikiDraft('proposal', article.id);
  return writeWikiDraft('proposal', article.id, snapshot, {
    summary: ((document.getElementById('wiki-proposal-summary') || {}).value || '').trim(),
    basePublishedRevisionId: prior && prior.basePublishedRevisionId || article.publishedRevisionId,
    idempotencyKey: prior && prior.idempotencyKey,
    idempotencyPayload: prior && prior.idempotencyPayload,
  });
}

function discardWikiProposalDraft(pageId) {
  clearWikiDraft('proposal', pageId);
  wikiEditorDraftRestoreKey = null;
  wikiProposalDraftRestorePending = false;
  wikiProposalDraftRestoreError = null;
  wikiProposalDraftSafeHtml = null;
  wikiProposalDraftSafeHtmlKey = null;
  render();
}

function submitWikiProposal(pageId) {
  if (!DB.session || isModOrAdmin()) return;
  var article = currentWikiArticle;
  if (!article || article.id !== pageId || !article.publishedRevisionId) {
    showAlert('Não foi possível confirmar a revisão publicada deste artigo.', 'error');
    return;
  }
  var snapshot = wikiProposalFormSnapshot(article);
  var summary = ((document.getElementById('wiki-proposal-summary') || {}).value || '').trim();
  if (!summary) { showAlert('Explique brevemente a alteração proposta.', 'error'); return; }
  var prior = readWikiDraft('proposal', pageId);
  var basePublishedRevisionId = prior && prior.basePublishedRevisionId || article.publishedRevisionId;
  if (basePublishedRevisionId !== article.publishedRevisionId) {
    showAlert('A publicação mudou desde que este rascunho começou. Atualize a página e revise a proposta antes de enviá-la.', 'error');
    return;
  }
  var payload = { snapshot: snapshot, basePublishedRevisionId: basePublishedRevisionId, summary: summary };
  var key = wikiIdempotencyKeyForDraft('proposal', pageId, payload);
  if (!key) return;
  var finish = beginResourceFormSubmission('wiki-proposal:' + String(pageId));
  if (!finish) return;
  wikiApi()('POST', '/api/wiki/pages/' + encodeURIComponent(pageId) + '/proposals', payload, null,
    { headers: { 'Idempotency-Key': key } }).then(function(response) {
    finish();
    var proposal = wikiUnwrap(response);
    if (!proposal || !proposal.id) throw new Error('A resposta ao enviar a proposta é inválida.');
    clearWikiDraft('proposal', pageId);
    wikiEditorDraftRestoreKey = null;
    wikiProposalState.loaded = false;
    navigate('wikiProposal', proposal.id);
    showAlert('Proposta enviada para revisão.', 'success');
  }).catch(function(error) {
    finish();
    showAlert(error && error.message ? error.message : 'Não foi possível enviar a proposta.', 'error');
  });
}

function loadWikiProposals(force) {
  if (!DB.session) { wikiProposalState = { items: [], staffItems: [], loading: false, loaded: true, error: null }; return; }
  if (wikiProposalState.loading || (wikiProposalState.loaded && !force)) return;
  var sequence = ++wikiProposalRequestSequence;
  wikiProposalState.loading = true;
  wikiProposalState.error = null;
  var requests = [wikiApi()('GET', '/api/wiki/proposals?limit=100&offset=0')];
  if (isModOrAdmin()) requests.push(wikiApi()('GET', '/api/staff/wiki/proposals?limit=100&offset=0'));
  Promise.all(requests).then(function(responses) {
    if (sequence !== wikiProposalRequestSequence) return;
    if (!responses[0] || !Array.isArray(responses[0].data)) throw new Error('A resposta das propostas é inválida.');
    wikiProposalState.items = responses[0].data;
    wikiProposalState.staffItems = responses[1] && Array.isArray(responses[1].data) ? responses[1].data : [];
    wikiProposalState.loaded = true;
  }).catch(function(error) {
    if (sequence === wikiProposalRequestSequence) wikiProposalState.error = error && error.message ? error.message : 'Não foi possível carregar as propostas.';
  }).finally(function() {
    if (sequence !== wikiProposalRequestSequence) return;
    wikiProposalState.loading = false;
    if (currentPage === 'wikiProposals') render();
  });
}

function renderWikiProposals() {
  if (!DB.session) return '<div class="builder-panel"><p>Entre para consultar suas propostas.</p><button class="btn btn-small" onclick="showLoginModal()">Entrar</button></div>';
  if (!wikiProposalState.loaded && !wikiProposalState.loading && !wikiProposalState.error) loadWikiProposals(false);
  if (wikiProposalState.loading) return '<div class="alert alert-info">Carregando propostas…</div>';
  if (wikiProposalState.error) return '<div class="alert alert-error">' + h(wikiProposalState.error)
    + ' <button class="btn btn-small" onclick="loadWikiProposals(true)">Tentar novamente</button></div>';
  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Wiki</a> / Propostas</div>'
    + '<div class="cat-header"><span>Minhas propostas</span><button class="btn btn-small" onclick="navigate(\'wiki\')">Voltar à wiki</button></div>';
  html += renderWikiProposalList(wikiProposalState.items, false);
  if (isModOrAdmin()) {
    html += '<div class="cat-header" style="margin-top:20px;"><span>Fila de revisão da equipe</span></div>'
      + renderWikiProposalList(wikiProposalState.staffItems, true);
  }
  return html;
}

function renderWikiProposalList(items, staffQueue) {
  if (!items || !items.length) return '<div class="builder-panel"><p>' + (staffQueue ? 'Não há propostas pendentes.' : 'Você ainda não enviou propostas.') + '</p></div>';
  var html = '<div class="builder-panel"><ul>';
  items.forEach(function(proposal) {
    html += '<li style="margin:10px 0;"><a onclick="navigate(\'wikiProposal\',' + jsArg(proposal.id) + ')">'
      + h(proposal.page && proposal.page.title || 'Artigo') + '</a> — ' + h(proposal.state)
      + (staffQueue && proposal.proposer && proposal.proposer.username ? ' · ' + renderAuthorChip(proposal.proposer) : '')
      + (proposal.stale ? ' · base desatualizada' : '') + '</li>';
  });
  return html + '</ul></div>';
}

function loadWikiProposalDetail(proposalId, force) {
  var key = String(proposalId || '').toLowerCase();
  if (!key || (wikiProposalDetailLoading && wikiProposalDetailLoadingId === key)
      || (!force && wikiProposalDetail && wikiProposalDetail.id === key)) return;
  wikiProposalDetailLoading = true;
  wikiProposalDetailLoadingId = key;
  wikiProposalDetailError = null;
  wikiProposalDetailErrorId = null;
  wikiProposalDetail = null;
  wikiProposalPage = null;
  var sequence = ++wikiProposalDetailRequestSequence;
  var url = isModOrAdmin() ? '/api/staff/wiki/proposals/' : '/api/wiki/proposals/';
  wikiApi()('GET', url + encodeURIComponent(key)).then(function(response) {
    if (sequence !== wikiProposalDetailRequestSequence) return;
    var proposal = wikiUnwrap(response);
    if (!proposal || proposal.id !== key) throw new Error('A resposta da proposta é inválida.');
    wikiProposalDetail = proposal;
    if (isModOrAdmin()) return wikiApi()('GET', '/api/staff/wiki/pages/' + encodeURIComponent(proposal.pageId)).then(function(pageResponse) {
      if (sequence === wikiProposalDetailRequestSequence) wikiProposalPage = wikiUnwrap(pageResponse);
    });
  }).catch(function(error) {
    if (sequence === wikiProposalDetailRequestSequence) {
      wikiProposalDetailError = error && error.message ? error.message : 'Não foi possível carregar esta proposta.';
      wikiProposalDetailErrorId = key;
    }
  }).finally(function() {
    if (sequence !== wikiProposalDetailRequestSequence) return;
    wikiProposalDetailLoading = false;
    wikiProposalDetailLoadingId = null;
    if (currentPage === 'wikiProposal') render();
  });
}

function renderWikiProposal() {
  if (!DB.session) return '<div class="alert alert-error">Entre para consultar esta proposta.</div>';
  if (!currentWikiPageId) return '<div class="alert alert-error">O endereço da proposta é inválido.</div>';
  if (!wikiProposalDetail || wikiProposalDetail.id !== currentWikiPageId) {
    if (wikiProposalDetailError && wikiProposalDetailErrorId === currentWikiPageId) return '<div class="alert alert-error">' + h(wikiProposalDetailError)
      + ' <button class="btn btn-small" onclick="loadWikiProposalDetail(' + jsArg(currentWikiPageId) + ',true)">Tentar novamente</button></div>';
    if (!wikiProposalDetailLoading || wikiProposalDetailLoadingId !== currentWikiPageId) loadWikiProposalDetail(currentWikiPageId, false);
    return '<div class="alert alert-info">Carregando proposta…</div>';
  }
  var proposal = wikiProposalDetail;
  var html = '<div class="breadcrumb"><a onclick="navigate(\'wikiProposals\')">Propostas</a> / ' + h(proposal.page.title) + '</div>'
    + '<div class="cat-header"><span>' + h(proposal.page.title) + '</span><span class="tag">' + h(proposal.state) + '</span></div>'
    + '<div class="builder-panel"><p><b>Resumo:</b> ' + h(proposal.summary || '') + '</p>'
    + '<p style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b>Proponente:</b> ' + renderAuthorChip(proposal.proposer, 'Membro') + '</p>'
    + '<p><b>Enviada:</b> ' + h(formatJoinDate(proposal.createdAt)) + '</p>';
  if (proposal.stale) html += '<p class="alert alert-error">A proposta usa uma publicação anterior e precisa ser revisada manualmente.</p>';
  if (proposal.reviewReason) html += '<p><b>Resposta da equipe:</b> ' + h(proposal.reviewReason) + '</p>';
  html += '</div><h3>Alteração proposta</h3>' + renderWikiSnapshot(proposal.snapshot, { proposal: true });
  if (isModOrAdmin() && proposal.state === 'submitted') {
    html += '<div class="builder-panel"><p>Aceitar cria um novo rascunho da equipe. A publicação continua sendo uma ação separada.</p>'
      + '<button class="btn btn-primary" onclick="acceptWikiProposal(' + jsArg(proposal.id) + ')">Aceitar como rascunho</button> '
      + '<button class="btn btn-danger" onclick="rejectWikiProposal(' + jsArg(proposal.id) + ')">Rejeitar com comentário</button></div>';
  } else if (!isModOrAdmin() && proposal.state === 'submitted') {
    html += '<div class="builder-panel"><button class="btn btn-small btn-danger" onclick="withdrawWikiProposal(' + jsArg(proposal.id) + ')">Retirar proposta</button></div>';
  }
  return html;
}

function withdrawWikiProposal(proposalId) {
  if (!DB.session || isModOrAdmin() || !wikiProposalDetail || wikiProposalDetail.id !== proposalId) return;
  wikiApi()('POST', '/api/wiki/proposals/' + encodeURIComponent(proposalId) + '/withdraw', { expectedVersion: wikiProposalDetail.version }).then(function(response) {
    wikiProposalDetail = Object.assign({}, wikiProposalDetail, wikiUnwrap(response));
    wikiProposalState.loaded = false;
    render();
    showAlert('Proposta retirada.', 'success');
  }).catch(function(error) { showAlert(error && error.message ? error.message : 'Não foi possível retirar a proposta.', 'error'); });
}

function rejectWikiProposal(proposalId) {
  if (!isModOrAdmin() || !wikiProposalDetail || wikiProposalDetail.id !== proposalId) return;
  var reason = window.prompt('Informe o motivo da rejeição ou as mudanças necessárias:');
  if (reason === null) return;
  wikiApi()('POST', '/api/staff/wiki/proposals/' + encodeURIComponent(proposalId) + '/reject', {
    expectedVersion: wikiProposalDetail.version, reason: reason.trim(),
  }).then(function(response) {
    wikiProposalDetail = Object.assign({}, wikiProposalDetail, wikiUnwrap(response));
    wikiProposalState.loaded = false;
    render();
    showAlert('Proposta revisada.', 'success');
  }).catch(function(error) { showAlert(error && error.message ? error.message : 'Não foi possível revisar a proposta.', 'error'); });
}

function acceptWikiProposal(proposalId) {
  if (!isModOrAdmin() || !wikiProposalDetail || wikiProposalDetail.id !== proposalId) return;
  wikiApi()('GET', '/api/staff/wiki/pages/' + encodeURIComponent(wikiProposalDetail.pageId)).then(function(response) {
    var page = wikiUnwrap(response);
    if (!page || !page.id) throw new Error('Não foi possível carregar a versão de trabalho do artigo.');
    return wikiApi()('POST', '/api/staff/wiki/proposals/' + encodeURIComponent(proposalId) + '/accept', {
      expectedVersion: wikiProposalDetail.version,
      expectedWorkVersion: page.workVersion,
      expectedPublishedRevisionId: page.publishedRevisionId,
    });
  }).then(function(response) {
    var result = wikiUnwrap(response);
    wikiProposalDetail = result.proposal || wikiProposalDetail;
    wikiProposalState.loaded = false;
    if (result.page && result.page.id) {
      wikiEditorPage = null;
      wikiEditorLoadedId = null;
      navigate('wikiEditor', result.page.id);
    } else render();
    showAlert('Proposta aceita como rascunho da equipe. Revise antes de publicar.', 'success');
  }).catch(function(error) { showAlert(error && error.message ? error.message : 'Não foi possível aceitar a proposta.', 'error'); });
}

function renderPersonagemView() {
  if (serverPersonagens === null) {
    if (personagensLoadError) return '<div class="alert alert-error">' + h(personagensLoadError) + ' <button class="btn btn-small" onclick="carregarPersonagensServidor()">Tentar novamente</button></div>';
    carregarPersonagensServidor();
    return '<div class="alert alert-info">Carregando personagem…</div>';
  }
  var lista = listaPersonagens();
  var p = lista.find(function(x) { return String(x.id) === String(currentPersonagem); });
  if (!p) return '<p>Personagem não encontrado.</p>';
  var theme = p.theme || {};
  var pageAccent = theme.accentColor || '#ffffff';

  var html = '<div class="breadcrumb"><a onclick="navigate(\'personagens\')">Personagens</a> / ' + h(p.nome) + '</div>';

  html += '<div class="custom-wiki-page' + (theme.fontFamily ? ' font-' + ha(theme.fontFamily) : '') + (theme.bgEffect ? ' bg-' + ha(theme.bgEffect) : '') + '" style="--page-accent:' + ha(pageAccent) + ';--page-accent-light:' + ha(pageAccent) + ';">';

  html += '<div class="char-sheet-head">';
  html += '<div><h2>' + h(p.nome) + (p.titulo ? ' <em>&mdash; ' + h(p.titulo) + '</em>' : '') + '</h2>';
  if (p.author) {
    html += '<div class="card-author-row" style="margin-top:6px;">' + renderAuthorChip(p.author, '', 'Ficha publicada por') + ' ' + roleBadgeFromRole(p.author.role) + '</div>';
  }
  html += '</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
  if (DB.session) {
    var pidCss = String(p.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    html += '<button type="button" id="like-char-' + pidCss + '" class="btn btn-small like-btn" onclick="toggleLikePersonagem(' + idJs(p.id) + ', this)">Curtir <span class="like-count">(0)</span></button>';
  }
  if (isModOrAdmin()) {
    html += '<button class="btn btn-warn btn-small" onclick="editarPersonagem(' + idJs(p.id) + ')">Editar Ficha</button><button class="btn btn-danger btn-small" onclick="deletarPersonagem(' + idJs(p.id) + ')">Ocultar</button>';
  }
  html += '</div>';
  html += '</div>';

  html += '<div class="char-sheet-grid">';
  html += '<div class="char-sheet-card">';
  html += '<div class="char-sheet-card-title">' + h(p.nome) + '</div>';
  if (p.imagem) html += '<div class="char-sheet-portrait" onclick="openLightbox(' + jsArg(p.imagem) + ',' + jsArg(p.nome) + ')" style="cursor:zoom-in;"><img src="' + ha(p.imagem) + '"></div>';
  html += '<table>';
  if (p.categoria) html += '<tr><td><b>Categoria</b></td><td>' + h(p.categoria) + '</td></tr>';
  if (p.titulo) html += '<tr><td><b>Título</b></td><td>' + h(p.titulo) + '</td></tr>';
  if (p.raca) html += '<tr><td><b>Raça</b></td><td>' + h(p.raca) + '</td></tr>';
  if (p.faccao) html += '<tr><td><b>Facção</b></td><td>' + h(p.faccao) + '</td></tr>';
  if (p.status) html += '<tr><td><b>Status</b></td><td style="color:#ffffff;font-weight:600;">' + h(p.status) + '</td></tr>';
  html += '</table>';
  if (p.mascaraTier) html += '<div class="tier-badge">A Máscara: <b>' + h(p.mascaraTier) + '</b></div>';
  html += '</div>';

  html += '<div class="wiki-content-area">';
  html += '<div class="char-sheet-body">' + p.descricao + '</div>';

  if (Array.isArray(p.blocks) && p.blocks.length) {
    html += renderModularBlocks(p.blocks, 'char-' + p.id);
  }
  html += '</div>';
  html += '</div>';

  if (p.skills && p.skills.length) {
    var skillCards = p.skills.filter(function(sk) { return sk.tipo !== 'equipamento'; });
    var equipCards = p.skills.filter(function(sk) { return sk.tipo === 'equipamento'; });
    if (skillCards.length) {
      html += '<div class="cat-header" style="margin-top:24px;"><span>Habilidades &amp; Técnicas (' + skillCards.length + ')</span></div>';
      html += '<div class="skill-grid">';
      skillCards.forEach(function(sk) {
        html += '<div class="skill-item"><h4>' + h(sk.nome) + '</h4><p>' + h(sk.descricao) + '</p></div>';
      });
      html += '</div>';
    }
    if (equipCards.length) {
      html += '<div class="cat-header" style="margin-top:24px;"><span>Equipamentos &amp; Artefatos (' + equipCards.length + ')</span></div>';
      html += '<div class="skill-grid">';
      equipCards.forEach(function(sk) {
        html += '<div class="skill-item equip-item"><h4>' + h(sk.nome) + '</h4><p>' + h(sk.descricao) + '</p></div>';
      });
      html += '</div>';
    }
  }

  if (statsPreenchidos(p.stats)) {
    var totalPts = calcStatTotal(p.stats);
    var avgPts = (totalPts / STAT_KEYS.length).toFixed(1);
    html += '<div class="cat-header" style="margin-top:24px;"><span>Matriz de Atributos</span><span style="font-size:12px;color:var(--text-secondary);font-weight:400;">Total: <b style="color:#fff;">' + totalPts + '</b> / 1000 &middot; Média: <b style="color:#fff;">' + avgPts + '</b></span></div>';
    html += '<div class="stat-panel">';
    html += '<div>' + buildRadarChart(p.stats, pageAccent) + '</div>';
    html += '<div class="stat-readout">';
    for (var si = 0; si < STAT_LABELS.length; si++) {
      var valorStat = p.stats[STAT_KEYS[si]] !== undefined ? p.stats[STAT_KEYS[si]] : 0;
      html += '<div class="stat-row"><span class="stat-label">' + STAT_LABELS[si] + '</span><span class="stat-bar"><span class="stat-bar-fill" style="width:' + valorStat + '%;"></span></span><span class="stat-value">' + valorStat + '</span></div>';
    }
    html += '</div></div>';
  }

  html += '</div>';
  html += '<div style="margin-top:24px;"><a onclick="navigate(\'personagens\')" class="btn">Voltar para Personagens</a></div>';
  return html;
}

var STAT_LABELS = ['Ataque', 'Destreza', 'Defesa', 'Reserva', 'Controle', 'Refino', 'Emissão', 'Alma', 'Inteligência', 'Habilidade'];
var STAT_ABBR = ['ATK', 'DEX', 'DEF', 'STA', 'CON', 'REF', 'EMI', 'SOUL', 'INT', 'SKILL'];
var STAT_KEYS = ['ataque', 'destreza', 'defesa', 'reserva', 'controle', 'refino', 'emissao', 'alma', 'inteligencia', 'habilidade'];

function statsPreenchidos(stats) {
  if (!stats) return false;
  for (var i = 0; i < STAT_KEYS.length; i++) {
    if (stats[STAT_KEYS[i]] !== undefined) return true;
  }
  return false;
}

function buildRadarChart(stats, accentColor) {
  var strokeColor = accentColor || '#ffffff';
  var labels = STAT_ABBR;
  var keys = STAT_KEYS;
  var n = labels.length;
  var size = 270;
  var cx = size / 2;
  var cy = size / 2;
  var maxR = 92;
  var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';

  var aneis = [0.2, 0.4, 0.6, 0.8, 1];
  for (var a = 0; a < aneis.length; a++) {
    var pontosAnel = '';
    for (var i = 0; i < n; i++) {
      var angAnel = (Math.PI * 2 / n) * i - Math.PI / 2;
      var rAnel = maxR * aneis[a];
      var xAnel = cx + rAnel * Math.cos(angAnel);
      var yAnel = cy + rAnel * Math.sin(angAnel);
      pontosAnel += xAnel.toFixed(1) + ',' + yAnel.toFixed(1) + ' ';
    }
    svg += '<polygon points="' + pontosAnel.trim() + '" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1"></polygon>';
  }

  for (var i = 0; i < n; i++) {
    var ang = (Math.PI * 2 / n) * i - Math.PI / 2;
    var xEixo = cx + maxR * Math.cos(ang);
    var yEixo = cy + maxR * Math.sin(ang);
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + xEixo.toFixed(1) + '" y2="' + yEixo.toFixed(1) + '" stroke="rgba(255,255,255,0.1)" stroke-width="1"></line>';
    var lx = cx + (maxR + 22) * Math.cos(ang);
    var ly = cy + (maxR + 22) * Math.sin(ang);
    var anchor = 'middle';
    if (lx < cx - 5) anchor = 'end';
    if (lx > cx + 5) anchor = 'start';
    svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="10" font-weight="600" fill="#888888" text-anchor="' + anchor + '" font-family="JetBrains Mono, monospace">' + h(labels[i]) + '</text>';
  }

  var pontosDado = '';
  for (var i = 0; i < n; i++) {
    var valor = stats[keys[i]] || 0;
    if (valor > 100) valor = 100;
    if (valor < 0) valor = 0;
    var angDado = (Math.PI * 2 / n) * i - Math.PI / 2;
    var rDado = maxR * (valor / 100);
    var xDado = cx + rDado * Math.cos(angDado);
    var yDado = cy + rDado * Math.sin(angDado);
    pontosDado += xDado.toFixed(1) + ',' + yDado.toFixed(1) + ' ';
  }
  svg += '<polygon points="' + pontosDado.trim() + '" fill="rgba(255, 255, 255, 0.14)" stroke="' + ha(strokeColor) + '" stroke-width="1.8"></polygon>';
  svg += '</svg>';
  return svg;
}

// Estado temporário do Construtor de Blocos durante criação/edição
var activeBuilderBlocks = [];

function renderNovoPersonagem() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">Acesso restrito a Moderadores e Administradores.</div>';

  var editId = sessionStorage.getItem('editPersonagemId');
  var existing = editId ? listaPersonagens().find(function(p) { return String(p.id) === editId; }) : null;
  var theme = (existing && existing.theme) ? existing.theme : {};
  activeBuilderBlocks = (existing && Array.isArray(existing.blocks)) ? JSON.parse(JSON.stringify(existing.blocks)) : [];

  var html = '<div class="breadcrumb"><a onclick="navigate(\'personagens\')">Personagens</a> / ' + (existing ? 'Editar Personagem' : 'Novo Personagem') + '</div>';
  html += '<div class="cat-header"><span>' + (existing ? 'Editar Ficha de Personagem' : 'Cadastrar Novo Personagem') + '</span>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  html += '<button type="button" class="btn btn-small" onclick="previewPersonagemModal()">Pré-visualizar</button>';
  html += '<button type="button" class="btn btn-small" onclick="exportarPersonagemJson()">Exportar JSON</button>';
  html += '<button type="button" class="btn btn-small" onclick="importarPersonagemJsonModal()">Importar JSON</button>';
  html += '</div></div>';

  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>1. Identidade &amp; Dados da Ficha</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:14px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>Nome</label><input type="text" id="p-nome" value="' + (existing ? ha(existing.nome) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Categoria</label><select id="p-categoria"><option value="Personagem Principal"' + (!existing || existing.categoria !== 'Sub-Personagem' ? ' selected' : '') + '>Personagem Principal</option><option value="Sub-Personagem"' + (existing && existing.categoria === 'Sub-Personagem' ? ' selected' : '') + '>Sub-Personagem</option></select></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Título / Epíteto</label><input type="text" id="p-titulo" value="' + (existing ? ha(existing.titulo) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Raça</label><input type="text" id="p-raca" value="' + (existing ? ha(existing.raca) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Facção</label><input type="text" id="p-faccao" value="' + (existing ? ha(existing.faccao) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Status</label><input type="text" id="p-status" value="' + (existing ? ha(existing.status) : '') + '" placeholder="Vivo, Falecido, Afastado..."></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>URL do Retrato / Imagem</label><input type="text" id="p-imagem" value="' + (existing ? ha(existing.imagem) : '') + '" placeholder="https://..."></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Cor de Destaque da Página</label><input type="color" id="p-accent-color" value="' + ha(theme.accentColor || '#ffffff') + '" style="height:38px;width:100%;cursor:pointer;"></div>';
  html += '</div>';

  html += '<div class="form-row"><label>Descrição / Lore Principal (Editor Completo)</label>';
  html += buildEditor('p-editor', existing ? existing.descricao : '');
  html += '</div></div>';

  html += renderBlockBuilderSection();

  var st = (existing && existing.stats) ? existing.stats : {};
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>Atributos &amp; Classificação (Opcional)</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;">';
  for (var ai = 0; ai < STAT_KEYS.length; ai++) {
    var valorAttr = st[STAT_KEYS[ai]] !== undefined ? st[STAT_KEYS[ai]] : '';
    html += '<div class="form-row" style="margin-bottom:0"><label>' + STAT_LABELS[ai] + '</label><input type="number" min="0" max="100" id="p-stat-' + STAT_KEYS[ai] + '" value="' + valorAttr + '" placeholder="0-100"></div>';
  }
  html += '</div>';
  html += '<div class="field-desc">Cada atributo vai de 0 a 100 e gera o gráfico de radar na ficha.</div>';
  html += '<div class="form-row" style="margin-top:12px;"><label>Classificação segundo A Máscara (opcional)</label><input type="text" id="p-mascara-tier" value="' + (existing ? ha(existing.mascaraTier) : '') + '"></div>';
  html += '</div>';

  var skillsExistentes = (existing && existing.skills) ? existing.skills : [];
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>Skills e Equipamentos (Opcional)</span></div>';
  html += '<div id="p-skills-list">';
  skillsExistentes.forEach(function(sk) { html += skillFormRowHtml(sk.nome, sk.descricao, sk.tipo); });
  html += '</div>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="adicionarSkillFormRow()">+ Adicionar Card de Skill / Equipamento</button>';
  html += '</div>';

  var btnLabel = existing ? 'Salvar Alterações' : 'Cadastrar Personagem';
  var onclick = existing ? 'salvarEdicaoPersonagem(' + idJs(existing.id) + ')' : 'submitPersonagem()';
  html += '<div style="display:flex;gap:10px;margin-top:12px;"><button class="btn btn-primary" onclick="' + onclick + '">' + btnLabel + '</button><button type="button" class="btn" onclick="previewPersonagemModal()">Pré-visualizar</button><button class="btn" onclick="navigate(\'personagens\')">Cancelar</button></div>';
  return html;
}

// ==================== WIKIA · CENAS & POSTS CUSTOMIZÁVEIS ====================

var serverWikiPosts = null;
var wikiPostsLoadError = null;
var wikiPostsLoading = false;

function carregarWikiPostsServidor() {
  if (wikiPostsLoading) return;
  wikiPostsLoading = true;
  wikiPostsLoadError = null;
  fetch('/api/wiki-posts')
    .then(function(res) {
      if (!res.ok) throw new Error('Não foi possível carregar as cenas do servidor.');
      return res.json();
    })
    .then(function(data) {
      if (!data || !Array.isArray(data.wikiPosts)) throw new Error('A resposta de cenas é inválida.');
      serverWikiPosts = data.wikiPosts;
      if (currentPage === 'cenas' || currentPage === 'cenaView' || currentPage === 'forum') render();
    })
    .catch(function(error) {
      wikiPostsLoadError = error.message || 'Não foi possível carregar as cenas do servidor.';
      if (currentPage === 'cenas' || currentPage === 'cenaView') render();
    })
    .finally(function() { wikiPostsLoading = false; });
}

function listaWikiPosts() {
  return Array.isArray(serverWikiPosts) ? serverWikiPosts : [];
}

function onCenasFilterChange() {
  var sEl = document.getElementById('cenas-search-input');
  var cEl = document.getElementById('cenas-cat-select');
  var stEl = document.getElementById('cenas-status-select');
  if (sEl) cenasFilterSearch = sEl.value;
  if (cEl) cenasFilterCat = cEl.value;
  if (stEl) cenasFilterStatus = stEl.value;
  render();
  var sElAfter = document.getElementById('cenas-search-input');
  if (sElAfter) {
    sElAfter.focus();
    sElAfter.setSelectionRange(sElAfter.value.length, sElAfter.value.length);
  }
}

function renderCenas() {
  if (serverWikiPosts === null) {
    if (wikiPostsLoadError) return '<div class="alert alert-error">' + h(wikiPostsLoadError) + ' <button class="btn btn-small" onclick="carregarWikiPostsServidor()">Tentar novamente</button></div>';
    carregarWikiPostsServidor();
    return '<div class="alert alert-info">Carregando cenas compartilhadas…</div>';
  }
  var html = '<div class="breadcrumb">Início / Cenas</div>';
  html += '<div class="cat-header"><span>Cenas &amp; Posts</span>';
  if (isModOrAdmin()) {
    html += '<button class="btn btn-small btn-primary" onclick="sessionStorage.removeItem(\'editCenaId\');navigate(\'novaCena\')">+ Nova Cena / Post Customizável</button>';
  }
  html += '</div>';

  html += '<div class="filter-bar">';
  html += '<input type="text" id="cenas-search-input" value="' + ha(cenasFilterSearch) + '" placeholder="Buscar cena por título, arco, participante ou resumo..." oninput="onCenasFilterChange()">';
  html += '<select id="cenas-cat-select" onchange="onCenasFilterChange()">';
  html += '<option value="all"' + (cenasFilterCat === 'all' ? ' selected' : '') + '>Todos os Tipos</option>';
  html += '<option value="Cena de RPG"' + (cenasFilterCat === 'Cena de RPG' ? ' selected' : '') + '>Cena de RPG</option>';
  html += '<option value="Combate / Batalha"' + (cenasFilterCat === 'Combate / Batalha' ? ' selected' : '') + '>Combate / Batalha</option>';
  html += '<option value="Evento / Arco"' + (cenasFilterCat === 'Evento / Arco' ? ' selected' : '') + '>Evento / Arco</option>';
  html += '<option value="Lore & Mundo"' + (cenasFilterCat === 'Lore & Mundo' ? ' selected' : '') + '>Lore &amp; Mundo</option>';
  html += '<option value="Crônica"' + (cenasFilterCat === 'Crônica' ? ' selected' : '') + '>Crônica</option>';
  html += '</select>';
  html += '<select id="cenas-status-select" onchange="onCenasFilterChange()">';
  html += '<option value="all"' + (cenasFilterStatus === 'all' ? ' selected' : '') + '>Todos os Status</option>';
  html += '<option value="Em Andamento"' + (cenasFilterStatus === 'Em Andamento' ? ' selected' : '') + '>Em Andamento</option>';
  html += '<option value="Concluída"' + (cenasFilterStatus === 'Concluída' ? ' selected' : '') + '>Concluída</option>';
  html += '<option value="Canônica"' + (cenasFilterStatus === 'Canônica' ? ' selected' : '') + '>Canônica</option>';
  html += '<option value="Hiato"' + (cenasFilterStatus === 'Hiato' ? ' selected' : '') + '>Hiato</option>';
  html += '</select>';
  html += '</div>';

  var lista = listaWikiPosts().filter(function(w) {
    if (cenasFilterCat !== 'all' && w.categoria !== cenasFilterCat) return false;
    if (cenasFilterStatus !== 'all' && w.status !== cenasFilterStatus) return false;
    if (cenasFilterSearch.trim()) {
      var q = cenasFilterSearch.toLowerCase();
      var parts = (w.infobox && Array.isArray(w.infobox.participants)) ? w.infobox.participants.join(' ') : '';
      var hay = ((w.titulo || '') + ' ' + (w.subtitulo || '') + ' ' + (w.resumo || '') + ' ' + parts).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  if (!lista.length) {
    html += '<div style="text-align:center;padding:44px;color:var(--text-muted);background:var(--bg-surface);border-radius:var(--radius-lg);border:1px solid var(--border-subtle);">';
    html += '<p style="font-size:15px;color:#fff;margin-bottom:6px;">Nenhuma cena ou post encontrado.</p>';
    if (isModOrAdmin()) {
      html += '<p style="margin-bottom:14px;">Crie uma página de cena customizável com blocos modulares e turnos comentados.</p>';
      html += '<button class="btn btn-primary" onclick="sessionStorage.removeItem(\'editCenaId\');navigate(\'novaCena\')">+ Criar Primeira Cena</button>';
    }
    html += '</div>';
    return html;
  }

  html += '<div class="cenas-grid">';
  lista.forEach(function(w) {
    var accent = (w.theme && w.theme.accentColor) ? w.theme.accentColor : '#ffffff';
    var bannerStyle = w.banner
      ? 'background-image:url(\'' + ha(w.banner) + '\');'
      : 'background:linear-gradient(135deg, #161616, #050505);';
    var turnsCount = Array.isArray(w.turns) ? w.turns.length : 0;
    var parts = (w.infobox && Array.isArray(w.infobox.participants)) ? w.infobox.participants : [];
    var descPreview = w.resumo || (w.descricao || '').replace(/<[^>]+>/g, '').substring(0, 140);

    html += '<div class="cena-card" style="--card-accent:' + ha(accent) + ';" onclick="navigate(\'cenaView\',' + idJs(w.id) + ')">';
    html += '<div class="cena-card-banner" style="' + bannerStyle + '">';
    html += '<div class="cena-card-badges">';
    html += '<span class="tag" style="background:rgba(0,0,0,0.85);color:#fff;border-color:rgba(255,255,255,0.2);">' + h(w.categoria || 'Cena de RPG') + '</span>';
    html += '<span class="tag" style="background:rgba(0,0,0,0.85);color:#ccc;">' + h(w.status || 'Em Andamento') + '</span>';
    html += '</div></div>';
    html += '<div class="cena-card-body">';
    html += '<h3>' + h(w.titulo) + '</h3>';
    if (w.subtitulo) html += '<div class="cena-card-subtitle">' + h(w.subtitulo) + '</div>';
    html += '<div class="cena-card-desc">' + h(descPreview) + (descPreview.length >= 140 ? '...' : '') + '</div>';
    if (parts.length) {
      html += '<div style="margin-bottom:12px;display:flex;gap:5px;flex-wrap:wrap;">';
      parts.forEach(function(pt) {
        html += '<span class="tag" style="font-size:10px;">' + h(pt) + '</span>';
      });
      html += '</div>';
    }
    html += '<div class="cena-card-footer">';
    html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
    if (w.author) html += renderAuthorChip(w.author);
    html += '<span><b>' + turnsCount + '</b> ' + (turnsCount === 1 ? 'turno' : 'turnos') + '</span>';
    html += '</div>';
    html += '<span style="color:#ffffff;font-weight:600;">Abrir &rarr;</span>';
    html += '</div></div></div>';
  });
  html += '</div>';
  return html;
}

function renderModularBlocks(blocks, prefixId) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  var html = '';
  blocks.forEach(function(b, idx) {
    if (!b || !b.type) return;
    var bid = (prefixId || 'blk') + '-' + idx;

    if (b.type === 'section') {
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      html += '<div class="char-sheet-body" style="padding:0;border:none;background:transparent;box-shadow:none;">' + (b.content || '') + '</div>';
      html += '</div>';
    } else if (b.type === 'quote') {
      html += '<div class="mod-block" style="padding:0;background:transparent;border:none;box-shadow:none;">';
      html += '<div class="mod-quote-box">';
      if (b.avatar) html += '<img class="mod-quote-avatar" src="' + ha(b.avatar) + '" alt="Avatar">';
      html += '<div><div class="mod-quote-text">&ldquo;' + h(b.text || '') + '&rdquo;</div>';
      if (b.author) html += '<div class="mod-quote-author">&mdash; ' + h(b.author) + '</div>';
      html += '</div></div></div>';
    } else if (b.type === 'tabs') {
      var items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return;
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      html += '<div class="mod-tabs-nav">';
      items.forEach(function(it, tidx) {
        html += '<button type="button" class="mod-tab-btn' + (tidx === 0 ? ' active' : '') + '" onclick="switchModTab(this,' + jsArg(bid + '-tab-' + tidx) + ')">' + h(it.label || ('Aba ' + (tidx + 1))) + '</button>';
      });
      html += '</div>';
      items.forEach(function(it, tidx) {
        html += '<div id="' + bid + '-tab-' + tidx + '" class="mod-tab-pane' + (tidx === 0 ? ' active' : '') + '">' + (it.content || '') + '</div>';
      });
      html += '</div>';
    } else if (b.type === 'gallery') {
      var imgs = Array.isArray(b.items) ? b.items : [];
      if (!imgs.length) return;
      var cols = b.cols || '2';
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      html += '<div class="mod-gallery-grid cols-' + ha(cols) + '">';
      imgs.forEach(function(im) {
        if (!im || !im.url) return;
        html += '<div class="mod-gallery-item" onclick="openLightbox(' + jsArg(im.url) + ',' + jsArg(im.caption || '') + ')">';
        html += '<img src="' + ha(im.url) + '" alt="' + ha(im.caption || 'Imagem') + '">';
        if (im.caption) html += '<div class="mod-gallery-caption">' + h(im.caption) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    } else if (b.type === 'cards') {
      var cards = Array.isArray(b.items) ? b.items : [];
      if (!cards.length) return;
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      html += '<div class="mod-cards-grid">';
      cards.forEach(function(cd) {
        var cColor = cd.color || 'var(--page-accent)';
        html += '<div class="mod-custom-card" style="--card-color:' + ha(cColor) + ';">';
        if (cd.image) html += '<img class="mod-custom-card-img" src="' + ha(cd.image) + '" onclick="openLightbox(' + jsArg(cd.image) + ',' + jsArg(cd.title || '') + ')" style="cursor:zoom-in;">';
        html += '<div class="mod-custom-card-body">';
        html += '<div class="mod-custom-card-head"><h4>' + h(cd.title || '') + '</h4>';
        if (cd.badge) html += '<span class="mod-custom-card-badge">' + h(cd.badge) + '</span>';
        html += '</div>';
        html += '<p>' + h(cd.desc || '') + '</p>';
        html += '</div></div>';
      });
      html += '</div></div>';
    } else if (b.type === 'stats') {
      var bars = Array.isArray(b.items) ? b.items : [];
      if (!bars.length) return;
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      bars.forEach(function(st) {
        var val = Math.max(0, Math.min(100, parseInt(st.value, 10) || 0));
        var barCol = st.color || 'var(--page-accent)';
        html += '<div class="stat-row" style="margin-bottom:10px;">';
        html += '<span class="stat-label" style="width:180px;">' + h(st.label || '') + '</span>';
        html += '<span class="stat-bar"><span class="stat-bar-fill" style="width:' + val + '%;background:' + ha(barCol) + ';"></span></span>';
        html += '<span class="stat-value">' + val + '%</span>';
        html += '</div>';
      });
      html += '</div>';
    } else if (b.type === 'accordion') {
      var accs = Array.isArray(b.items) ? b.items : [];
      if (!accs.length) return;
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      accs.forEach(function(ac) {
        html += '<details class="mod-acc-item"><summary>' + h(ac.title || 'Detalhes') + '</summary><div class="mod-acc-body">' + h(ac.content || '') + '</div></details>';
      });
      html += '</div>';
    } else if (b.type === 'timeline') {
      var tlItems = Array.isArray(b.items) ? b.items : [];
      if (!tlItems.length) return;
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      html += '<div class="mod-timeline">';
      tlItems.forEach(function(tl) {
        html += '<div class="mod-timeline-item">';
        if (tl.date) html += '<div class="mod-timeline-date">' + h(tl.date) + '</div>';
        if (tl.title) html += '<div class="mod-timeline-title">' + h(tl.title) + '</div>';
        if (tl.desc) html += '<div class="mod-timeline-desc">' + h(tl.desc) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
    } else if (b.type === 'datalist') {
      var dlItems = Array.isArray(b.items) ? b.items : [];
      if (!dlItems.length) return;
      html += '<div class="mod-block">';
      if (b.title) html += '<div class="mod-block-title">' + h(b.title) + '</div>';
      html += '<div class="mod-datalist">';
      dlItems.forEach(function(dl) {
        html += '<div class="mod-datalist-item"><div class="mod-datalist-key">' + h(dl.key || '') + '</div><div class="mod-datalist-val">' + h(dl.val || '') + '</div></div>';
      });
      html += '</div></div>';
    }
  });
  return html;
}

function exportarLogCena() {
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w) return;
  var out = [];
  out.push('==================================================');
  out.push((w.titulo || 'CENA').toUpperCase());
  if (w.subtitulo) out.push(w.subtitulo);
  out.push('Categoria: ' + (w.categoria || '') + ' | Status: ' + (w.status || ''));
  out.push('==================================================\n');
  var introPlain = String(w.descricao || '').replace(/<[^>]+>/g, '').trim();
  if (introPlain) {
    out.push(introPlain + '\n');
  }
  var turns = Array.isArray(w.turns) ? w.turns : [];
  turns.forEach(function(t, i) {
    out.push('--------------------------------------------------');
    out.push('TURNO #' + (i + 1) + ' - ' + (t.characterName || t.authorName || 'Narrador') + (t.turnTitle ? ' (' + t.turnTitle + ')' : ''));
    if (t.location) out.push('Local: ' + t.location);
    out.push('Data: ' + (t.date || ''));
    out.push('--------------------------------------------------');
    out.push(String(t.content || '').replace(/<[^>]+>/g, '').trim());
    if (t.oocNotes) out.push('\n[OOC]: ' + t.oocNotes);
    out.push('');
  });
  var blob = new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (w.titulo || 'cena').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-log.txt';
  a.click();
}

function renderCenaView() {
  if (serverWikiPosts === null) {
    if (wikiPostsLoadError) return '<div class="alert alert-error">' + h(wikiPostsLoadError) + ' <button class="btn btn-small" onclick="carregarWikiPostsServidor()">Tentar novamente</button></div>';
    carregarWikiPostsServidor();
    return '<div class="alert alert-info">Carregando cena…</div>';
  }
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w) return '<p>Cena ou post não encontrado.</p>';

  var theme = w.theme || {};
  var accent = theme.accentColor || '#ffffff';
  var bannerStyle = theme.bannerStyle || 'cinematic';
  var layout = theme.layout || 'sidebar-left';
  var fontFamily = theme.fontFamily || 'sans';
  var bgEffect = theme.bgEffect || 'none';
  var infobox = w.infobox || {};
  var showInfobox = infobox.show !== false && layout !== 'full' && layout !== 'book';

  var totalWords = countWordsFromHtml(w.descricao);
  (Array.isArray(w.turns) ? w.turns : []).forEach(function(t) { totalWords += countWordsFromHtml(t.content); });
  var readMin = Math.max(1, Math.ceil(totalWords / 200));

  var html = '<div class="breadcrumb"><a onclick="navigate(\'cenas\')">Cenas</a> / ' + h(w.titulo) + '</div>';

  if (w.turnsReadOnly) {
    html += '<div class="alert alert-info">Esta cena está em modo de leitura enquanto os turnos antigos passam por revisão protegida.</div>';
  }

  html += '<div class="custom-wiki-page font-' + ha(fontFamily) + (bgEffect !== 'none' ? ' bg-' + ha(bgEffect) : '') + '" style="--page-accent:' + ha(accent) + ';--page-accent-light:' + ha(accent) + ';">';

  if (bannerStyle !== 'none') {
    var bgRule = w.banner
      ? 'background-image:url(\'' + ha(w.banner) + '\');'
      : 'background:linear-gradient(135deg, #141414, #050505);';
    html += '<div class="wiki-hero-banner style-' + ha(bannerStyle) + '" style="' + bgRule + '">';
    html += '<div class="wiki-hero-content">';
    html += '<div class="wiki-hero-title-wrap">';
    html += '<div style="margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<span class="tag" style="background:rgba(0,0,0,0.8);color:#fff;border-color:rgba(255,255,255,0.25);">' + h(w.categoria || 'Cena de RPG') + '</span>';
    html += '<span class="tag" style="background:rgba(0,0,0,0.8);color:#ccc;">' + h(w.status || 'Em Andamento') + '</span>';
    html += '<span class="tag" style="background:rgba(0,0,0,0.8);color:#a1a1aa;">' + totalWords + ' palavras &middot; ~' + readMin + ' min</span>';
    html += '</div>';
    html += '<h1>' + h(w.titulo) + '</h1>';
    if (w.subtitulo) html += '<div class="wiki-hero-subtitle">' + h(w.subtitulo) + '</div>';
    if (w.author) html += '<div class="card-author-row" style="margin-top:8px;">' + renderAuthorChip(w.author, '', 'Cena por') + '</div>';
    html += '</div>';
    html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;">';
    if (theme.bgm) {
      html += '<div class="wiki-bgm-pill">' + h(theme.bgm) + '</div>';
    }
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button class="btn btn-small" onclick="exportarLogCena()">Exportar Log</button>';
    if (DB.session) {
      var widCss = String(w.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      html += '<button type="button" id="like-cena-' + widCss + '" class="btn btn-small like-btn" onclick="toggleLikeCena(' + idJs(w.id) + ', this)">Curtir <span class="like-count">(0)</span></button>';
    }
    if (isModOrAdmin()) {
      if (!w.turnsReadOnly) {
        html += '<button class="btn btn-small btn-warn" onclick="editarCena(' + idJs(w.id) + ')">Customizar Página</button>';
      }
      html += '<button class="btn btn-small btn-danger" onclick="deletarCena(' + idJs(w.id) + ')">Ocultar</button>';
    }
    html += '</div>';
    html += '</div></div></div>';
  } else {
    html += '<div class="char-sheet-head">';
    html += '<div><h2>' + h(w.titulo) + '</h2>' + (w.subtitulo ? '<div style="color:var(--text-secondary);font-size:14px;">' + h(w.subtitulo) + '</div>' : '') + (w.author ? '<div class="card-author-row" style="margin-top:6px;">' + renderAuthorChip(w.author, '', 'Cena por') + '</div>' : '') + '</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<button class="btn btn-small" onclick="exportarLogCena()">Exportar Log</button>';
    if (DB.session) {
      var widCss2 = String(w.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      html += '<button type="button" id="like-cena-' + widCss2 + '" class="btn btn-small like-btn" onclick="toggleLikeCena(' + idJs(w.id) + ', this)">Curtir <span class="like-count">(0)</span></button>';
    }
    if (isModOrAdmin()) {
      if (!w.turnsReadOnly) html += '<button class="btn btn-small btn-warn" onclick="editarCena(' + idJs(w.id) + ')">Customizar Página</button>';
      html += '<button class="btn btn-small btn-danger" onclick="deletarCena(' + idJs(w.id) + ')">Ocultar</button>';
    }
    html += '</div></div>';
  }

  var effectiveLayout = showInfobox ? ('layout-' + layout) : (layout === 'book' ? 'layout-book' : 'layout-full');
  html += '<div class="wiki-page-layout ' + ha(effectiveLayout) + '">';

  var infoboxHtml = '';
  if (showInfobox) {
    infoboxHtml += '<aside class="char-sheet-card">';
    infoboxHtml += '<div class="char-sheet-card-title">' + h(infobox.title || w.titulo) + '</div>';
    if (infobox.image) {
      infoboxHtml += '<div class="char-sheet-portrait" onclick="openLightbox(' + jsArg(infobox.image) + ',' + jsArg(infobox.caption || w.titulo) + ')" style="cursor:zoom-in;"><img src="' + ha(infobox.image) + '"></div>';
    }
    if (infobox.caption) {
      infoboxHtml += '<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:12px;font-style:italic;">' + h(infobox.caption) + '</div>';
    }
    infoboxHtml += '<table>';
    if (Array.isArray(infobox.fields)) {
      infobox.fields.forEach(function(f) {
        if (!f || (!f.label && !f.value)) return;
        infoboxHtml += '<tr><td><b>' + h(f.label) + '</b></td><td>' + h(f.value) + '</td></tr>';
      });
    }
    infoboxHtml += '</table>';

    if (Array.isArray(infobox.participants) && infobox.participants.length) {
      infoboxHtml += '<div style="text-align:left;margin-top:10px;">';
      infoboxHtml += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;letter-spacing:0.05em;">Participantes</div>';
      infoboxHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      var allChars = listaPersonagens();
      infobox.participants.forEach(function(pName) {
        var matchedChar = allChars.find(function(c) { return c.nome.toLowerCase() === String(pName).toLowerCase(); });
        if (matchedChar) {
          infoboxHtml += '<a class="tag" style="cursor:pointer;border-color:rgba(255,255,255,0.3);color:#fff;" onclick="navigate(\'personagemView\',' + idJs(matchedChar.id) + ')">' + h(matchedChar.nome) + '</a>';
        } else {
          infoboxHtml += '<span class="tag">' + h(pName) + '</span>';
        }
      });
      infoboxHtml += '</div></div>';
    }
    infoboxHtml += '</aside>';
  }

  var mainContentHtml = '<div class="wiki-content-area">';
  if (w.descricao && w.descricao !== '<br>') {
    mainContentHtml += '<div class="char-sheet-body">' + w.descricao + '</div>';
  }
  mainContentHtml += renderModularBlocks(w.blocks, 'cena-' + w.id);
  mainContentHtml += '</div>';

  if (showInfobox && layout === 'sidebar-right') {
    html += mainContentHtml + infoboxHtml;
  } else if (showInfobox) {
    html += infoboxHtml + mainContentHtml;
  } else {
    html += mainContentHtml;
  }

  html += '</div>';

  // ==================== SEÇÃO DE TURNOS / COMENTÁRIOS DA CENA ====================
  var turns = Array.isArray(w.turns) ? w.turns.slice() : [];
  var indexedTurns = turns.map(function(t, i) { return { turn: t, num: i + 1 }; });
  if (turnSortOrder === 'desc') indexedTurns.reverse();

  html += '<section class="turns-section">';
  html += '<div class="turns-header-bar">';
  html += '<h3><span>Turnos da Cena</span> <span class="turn-number-pill">' + turns.length + (turns.length === 1 ? ' turno' : ' turnos') + '</span></h3>';
  html += '<div style="display:flex;gap:8px;align-items:center;">';
  html += '<select style="width:auto;font-size:12px;padding:5px 10px;" onchange="turnSortOrder=this.value;render()">';
  html += '<option value="asc"' + (turnSortOrder === 'asc' ? ' selected' : '') + '>Ordem Cronológica (#1 &rarr; #' + (turns.length || 1) + ')</option>';
  html += '<option value="desc"' + (turnSortOrder === 'desc' ? ' selected' : '') + '>Mais Recentes Primeiro</option>';
  html += '</select>';
  if (DB.session && !w.turnsReadOnly) {
    html += '<a class="btn btn-small btn-primary" onclick="document.getElementById(\'new-turn-form\').scrollIntoView({behavior:\'smooth\'})">+ Postar Turno</a>';
  }
  html += '</div></div>';

  if (!indexedTurns.length) {
    html += '<div style="text-align:center;padding:34px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);color:var(--text-muted);margin-bottom:24px;">Nenhum turno foi postado nesta cena ainda. Seja o primeiro a iniciar a narrativa abaixo.</div>';
  }

  indexedTurns.forEach(function(item) {
    var t = item.turn;
    var num = item.num;
    var tAccent = t.accentColor || accent;
    var displayName = t.characterName || t.authorName || 'Narrador';
    var initials = displayName.substring(0, 2).toUpperCase();
    var bStyle = t.bannerStyle || 'panoramic';
    var fontCls = t.fontFamily ? (' font-' + ha(t.fontFamily)) : '';

    var turnAvatarUrl = safeAvatarSrc(t.characterAvatar) || safeAvatarSrc(t.authorAvatar);

    html += '<article class="turn-card" style="--turn-accent:' + ha(tAccent) + ';">';
    html += '<div class="turn-top-bar">';
    html += '<div class="turn-identity">';
    if (turnAvatarUrl) {
      html += '<img class="turn-avatar" src="' + ha(turnAvatarUrl) + '" alt="' + ha(displayName) + '" onclick="openLightbox(' + jsArg(turnAvatarUrl) + ',' + jsArg(displayName) + ')" style="cursor:zoom-in;">';
    } else {
      html += '<div class="turn-avatar">' + h(initials) + '</div>';
    }
    html += '<div>';
    html += '<div class="turn-char-name">' + h(displayName);
    if (t.characterTitle) html += ' <span class="turn-char-title">&middot; ' + h(t.characterTitle) + '</span>';
    html += '</div>';
    html += '<div class="turn-player-line">Jogador(a): ' + renderMiniAvatar(t.authorName || 'Membro', t.authorAvatar) + '<b style="color:var(--text-secondary);">' + h(t.authorName || 'Membro') + '</b> ' + roleBadgeFromRole(t.authorRole) + '</div>';
    html += '</div></div>';

    html += '<div class="turn-meta-right">';
    if (t.location) html += '<span class="tag">' + h(t.location) + '</span>';
    html += '<span class="turn-number-pill">Turno #' + num + '</span>';
    html += '<span>' + h(t.date || '') + '</span>';
    if (t.edited) html += '<span class="tag">editado</span>';
    html += '</div></div>';

    if (t.turnTitle) {
      html += '<div class="turn-subbanner-title"><span>' + h(t.turnTitle) + '</span></div>';
    }

    if (t.banner && (bStyle === 'panoramic' || bStyle === 'full')) {
      html += '<div class="turn-banner-media style-' + ha(bStyle) + '" onclick="openLightbox(' + jsArg(t.banner) + ',' + jsArg(t.turnTitle || displayName) + ')">';
      html += '<img src="' + ha(t.banner) + '" alt="Imagem do turno">';
      html += '</div>';
    }

    html += '<div class="turn-content-wrap">';
    if (t.banner && bStyle === 'side') {
      html += '<div class="turn-side-img" onclick="openLightbox(' + jsArg(t.banner) + ',' + jsArg(t.turnTitle || displayName) + ')"><img src="' + ha(t.banner) + '" alt="Retrato do turno"></div>';
    }
    html += '<div class="turn-content-body' + fontCls + '">' + (t.content || '') + '</div>';
    html += '</div>';

    if (Array.isArray(t.images) && t.images.length) {
      html += '<div class="turn-gallery-strip">';
      t.images.forEach(function(imgObj) {
        var u = typeof imgObj === 'string' ? imgObj : (imgObj && imgObj.url);
        var cap = (imgObj && imgObj.caption) ? imgObj.caption : '';
        if (!u) return;
        html += '<div class="turn-gallery-card" onclick="openLightbox(' + jsArg(u) + ',' + jsArg(cap || displayName) + ')">';
        html += '<img src="' + ha(u) + '" alt="Anexo do turno">';
        if (cap) html += '<span>' + h(cap) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    if (t.oocNotes) {
      html += '<div class="turn-ooc-box"><b>Notas OOC / Ações do Turno:</b> ' + h(t.oocNotes) + '</div>';
    }

    html += '<div class="turn-footer-bar">';
    html += '<span>Turno #' + num + ' &middot; ' + h(displayName) + '</span>';
    html += '<div class="post-actions">';
    if (DB.session) {
      var tidCss = String(t.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      html += '<a id="like-turn-' + tidCss + '" class="like-btn-turn" onclick="toggleLikeTurno(' + idJs(w.id) + ', ' + idJs(t.id) + ', this)">Curtir <span class="like-count">(0)</span></a>';
      if (!w.turnsReadOnly) html += '<a onclick="citarTurno(' + idJs(t.id) + ')">Citar Turno</a>';
      if (!w.turnsReadOnly && podeEditarTurno(t)) {
        html += '<a onclick="abrirModalEditarTurno(' + idJs(t.id) + ')">Editar</a>';
        html += '<a class="danger-link" onclick="excluirTurnoCena(' + idJs(t.id) + ')">Excluir</a>';
      }
    }
    html += '</div></div>';
    html += '</article>';
  });

  if (DB.session && !w.turnsReadOnly) {
    var chars = listaPersonagens();
    html += '<div class="builder-panel" id="new-turn-form" style="border-top:2px solid ' + ha(accent) + ';margin-top:26px;">';
    html += '<div class="builder-panel-title"><span>Escrever Novo Turno na Cena</span><span style="font-size:12px;color:var(--text-secondary);display:inline-flex;align-items:center;gap:6px;">Postando como ' + renderMiniAvatar(DB.session.username, DB.session.avatar) + '<b>' + h(DB.session.username) + '</b></span></div>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:12px;">';
    html += '<div class="form-row" style="margin-bottom:0"><label>Preencher com Personagem da Wiki (Opcional)</label><select id="turn-char-preset" onchange="aplicarPresetPersonagemTurno(this.value)"><option value="">— Escolher personagem cadastrado ou digitar livremente —</option>';
    chars.forEach(function(ch) {
      html += '<option value="' + ha(ch.id) + '">' + h(ch.nome) + (ch.titulo ? ' (' + h(ch.titulo) + ')' : '') + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>Nome do Personagem no Turno</label><input type="text" id="turn-char-name" placeholder="Ex: Shidō Akane (ou deixe em branco)"></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>Título / Epíteto do Personagem</label><input type="text" id="turn-char-title" placeholder="Ex: Filha da Tempestade"></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>URL do Avatar no Turno (Opcional)</label><input type="text" id="turn-char-avatar" value="" placeholder="https://... (vazio usa sua foto de perfil)"></div>';
    html += '</div>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px;">';
    html += '<div class="form-row" style="margin-bottom:0"><label>Título / Ação do Turno (Opcional)</label><input type="text" id="turn-title" placeholder="Ex: Turno #' + (turns.length + 1) + ' — O Despertar da Lâmina"></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>Localização / Posição Atual</label><input type="text" id="turn-location" placeholder="Ex: Convés Principal"></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>Fonte do Turno</label><select id="turn-font"><option value="serif">Literária (Serif)</option><option value="sans">Moderna (Sans)</option><option value="mono">Monoespaçada</option></select></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>Cor da Borda do Turno</label><input type="color" id="turn-accent" value="' + ha(accent) + '" style="height:38px;width:100%;cursor:pointer;"></div>';
    html += '</div>';

    html += '<div style="background:var(--bg-surface-2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;margin-bottom:14px;">';
    html += '<div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.04em;">Imagens Ilustrativas do Turno (Opcional)</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 220px;gap:12px;margin-bottom:10px;">';
    html += '<div class="form-row" style="margin-bottom:0"><label>URL da Imagem de Destaque / Banner do Turno</label><input type="text" id="turn-banner-url" placeholder="https://... (aparece em destaque no turno)"></div>';
    html += '<div class="form-row" style="margin-bottom:0"><label>Formato da Imagem de Destaque</label><select id="turn-banner-style"><option value="panoramic">Banner Panorâmico no Topo</option><option value="full">Imagem Inteira no Topo</option><option value="side">Retrato Lateral ao Lado do Texto</option></select></div>';
    html += '</div>';
    html += '<div id="turn-extra-images-list"></div>';
    html += '<button type="button" class="btn btn-small" onclick="adicionarCampoImagemTurno(\'turn-extra-images-list\')">+ Adicionar Mais Imagens / Galeria ao Turno</button>';
    html += '</div>';

    html += '<div class="form-row"><label>Narrativa do Turno</label>';
    html += buildEditor('turn-editor', '', 'Escreva a ação, descrições, pensamentos e falas do seu turno...');
    html += '</div>';

    html += '<div class="form-row"><label>Notas OOC / Resumo de Habilidades ou Dados (Opcional)</label><textarea id="turn-ooc" rows="2" placeholder="Observações fora do personagem, gasto de éter, técnicas ativadas..."></textarea></div>';

    html += '<button class="btn btn-primary" onclick="publicarTurnoCena()">Publicar Turno na Cena</button>';
    html += '</div>';
  } else if (w.turnsReadOnly) {
    html += '<div class="alert alert-info">Novos turnos e alterações ficam desativados até a revisão dos dados antigos terminar.</div>';
  } else {
    html += '<div class="alert alert-info"><span>Faça login para postar seu turno textual e adicionar imagens nesta cena.</span><a class="btn btn-small btn-primary" onclick="showLoginModal()">Entrar</a></div>';
  }

  html += '</section>';
  html += '</div>';
  html += '<div style="margin-top:24px;"><a onclick="navigate(\'cenas\')" class="btn">Voltar para Cenas</a></div>';
  return html;
}

function aplicarPresetPersonagemTurno(charId, prefix) {
  var pfx = prefix || 'turn';
  if (!charId) return;
  var ch = listaPersonagens().find(function(c) { return String(c.id) === String(charId); });
  if (!ch) return;
  var nEl = document.getElementById(pfx + '-char-name');
  var tEl = document.getElementById(pfx + '-char-title');
  var aEl = document.getElementById(pfx + '-char-avatar');
  if (nEl) nEl.value = ch.nome || '';
  if (tEl) tEl.value = ch.titulo || '';
  if (aEl && ch.imagem) aEl.value = ch.imagem;
}

function adicionarCampoImagemTurno(containerId, urlVal, capVal) {
  var c = document.getElementById(containerId);
  if (!c) return;
  var row = '<div class="turn-extra-img-row" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center;">' +
    '<input type="text" class="turn-img-url" value="' + ha(urlVal || '') + '" placeholder="URL da imagem (https://...)">' +
    '<input type="text" class="turn-img-cap" value="' + ha(capVal || '') + '" placeholder="Legenda opcional">' +
    '<button type="button" class="btn btn-small btn-danger" onclick="this.parentNode.remove()">Remover</button>' +
    '</div>';
  c.insertAdjacentHTML('beforeend', row);
}

function lerImagensExtrasTurno(containerId) {
  var imgs = [];
  document.querySelectorAll('#' + containerId + ' .turn-extra-img-row').forEach(function(r) {
    var u = r.querySelector('.turn-img-url').value.trim();
    var cap = r.querySelector('.turn-img-cap').value.trim();
    if (u) imgs.push({ url: u, caption: cap });
  });
  return imgs;
}

function publicarTurnoCena() {
  if (!DB.session) { showAlert('Faça login para postar um turno.', 'error'); return; }
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w) return;

  var payload = readTurnFormValues(false);
  if (!payload.content || payload.content === '<br>') {
    showAlert('Escreva o conteúdo do turno antes de publicar.', 'error');
    return;
  }
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('turn-create:' + String(w.id));
  if (!finish) return;

  apiRequest('POST', '/api/wiki-posts/' + w.id + '/turns', payload, function(err, data) {
    finish();
    if (err) { showAlert(err, 'error'); return; }
    clearResourceFormDraft(descriptor);
    var idx = serverWikiPosts.findIndex(function(x) { return x.id === w.id; });
    if (idx !== -1) serverWikiPosts[idx] = data.wikiPost;
    render();
    showAlert('Turno publicado com sucesso!', 'success');
  });
}

function citarTurno(turnId) {
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w || !Array.isArray(w.turns)) return;
  var t = w.turns.find(function(x) { return String(x.id) === String(turnId); });
  if (!t) return;
  var ed = document.getElementById('turn-editor');
  if (!ed) return;
  ed.focus();
  var speaker = t.characterName || t.authorName || 'Turno anterior';
  var plainSnippet = (t.content || '').replace(/<[^>]+>/g, '').substring(0, 260);
  var qHtml = '<blockquote><strong>' + h(speaker) + ':</strong> &ldquo;' + h(plainSnippet) + '...&rdquo;</blockquote><p><br></p>';
  document.execCommand('insertHTML', false, qHtml);
  ed.scrollIntoView({ behavior: 'smooth' });
}

function abrirModalEditarTurno(turnId) {
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w || !Array.isArray(w.turns)) return;
  var t = w.turns.find(function(x) { return String(x.id) === String(turnId); });
  if (!t || !podeEditarTurno(t)) return;
  editingTurnId = String(turnId);

  var body = '';
  body += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
  body += '<div class="form-row"><label>Nome do Personagem</label><input type="text" id="edit-turn-char-name" value="' + ha(t.characterName || '') + '"></div>';
  body += '<div class="form-row"><label>Título do Personagem</label><input type="text" id="edit-turn-char-title" value="' + ha(t.characterTitle || '') + '"></div>';
  body += '<div class="form-row"><label>URL do Avatar</label><input type="text" id="edit-turn-char-avatar" value="' + ha(t.characterAvatar || '') + '"></div>';
  body += '<div class="form-row"><label>Título do Turno</label><input type="text" id="edit-turn-title" value="' + ha(t.turnTitle || '') + '"></div>';
  body += '<div class="form-row"><label>Localização</label><input type="text" id="edit-turn-location" value="' + ha(t.location || '') + '"></div>';
  body += '<div class="form-row"><label>Cor do Turno</label><input type="color" id="edit-turn-accent" value="' + ha(t.accentColor || '#ffffff') + '" style="height:38px;width:100%;"></div>';
  body += '<div class="form-row"><label>Banner do Turno (URL)</label><input type="text" id="edit-turn-banner" value="' + ha(t.banner || '') + '"></div>';
  body += '<div class="form-row"><label>Estilo do Banner</label><select id="edit-turn-banner-style"><option value="panoramic"' + (t.bannerStyle === 'panoramic' ? ' selected' : '') + '>Panorâmico</option><option value="full"' + (t.bannerStyle === 'full' ? ' selected' : '') + '>Imagem Inteira</option><option value="side"' + (t.bannerStyle === 'side' ? ' selected' : '') + '>Lateral</option></select></div>';
  body += '</div>';
  body += '<div class="form-row"><label>Imagens Extras da Galeria do Turno</label><div id="edit-turn-extra-imgs"></div><button type="button" class="btn btn-small" onclick="adicionarCampoImagemTurno(\'edit-turn-extra-imgs\')">+ Imagem</button></div>';
  body += '<div class="form-row"><label>Conteúdo do Turno</label>' + buildEditor('edit-turn-editor', t.content || '') + '</div>';
  body += '<div class="form-row"><label>Notas OOC</label><textarea id="edit-turn-ooc" rows="2">' + h(t.oocNotes || '') + '</textarea></div>';
  body += '<button class="btn btn-primary" onclick="salvarEdicaoTurno(' + idJs(t.id) + ')">Salvar Turno</button>';

  showModal('Editar Turno', body);
  if (Array.isArray(t.images)) {
    t.images.forEach(function(im) {
      adicionarCampoImagemTurno('edit-turn-extra-imgs', im.url, im.caption);
    });
  }
  restoreResourceFormDraft();
  addResourceDraftNotice();
}

function salvarEdicaoTurno(turnId) {
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w || !Array.isArray(w.turns)) return;

  var updated = readTurnFormValues(true);

  var existing = w.turns.find(function(turn) { return String(turn.id) === String(turnId); });
  if (!existing) return;
  updated.expectedVersion = existing.version;
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('turn-edit:' + String(w.id) + ':' + String(turnId));
  if (!finish) return;
  apiRequest('PUT', '/api/wiki-posts/' + w.id + '/turns/' + encodeURIComponent(turnId), updated, function(err, data) {
    finish();
    if (err) { showAlert(err, 'error'); return; }
    clearResourceFormDraft(descriptor);
    var idx = serverWikiPosts.findIndex(function(x) { return x.id === w.id; });
    if (idx !== -1) serverWikiPosts[idx] = data.wikiPost;
    closeModal();
    render();
    showAlert('Turno atualizado.', 'success');
  });
}

function excluirTurnoCena(turnId) {
  if (!confirm('Deseja excluir este turno da cena?')) return;
  var lista = listaWikiPosts();
  var w = lista.find(function(x) { return String(x.id) === String(currentCena); });
  if (!w) return;

  var existing = (w.turns || []).find(function(turn) { return String(turn.id) === String(turnId); });
  if (!existing) return;
  apiRequest('POST', '/api/wiki-posts/' + w.id + '/turns/' + encodeURIComponent(turnId) + '/hide', { expectedVersion: existing.version }, function(err, data) {
    if (err) { showAlert(err, 'error'); return; }
    var idx = serverWikiPosts.findIndex(function(x) { return x.id === w.id; });
    if (idx !== -1) serverWikiPosts[idx] = data.wikiPost;
    render();
  });
}

// ==================== CONSTRUTOR DE PÁGINAS & BLOCOS MODULARES ====================

function renderBlockBuilderSection() {
  var html = '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>Construtor de Blocos &amp; Seções Modulares</span><span style="font-size:12px;color:var(--text-muted);">Adicione quantos blocos quiser na página</span></div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'tabs\')">+ Abas Interativas</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'gallery\')">+ Galeria de Imagens</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'cards\')">+ Cards Customizados</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'quote\')">+ Citação / Epígrafe</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'stats\')">+ Barras de Status / Progresso</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'accordion\')">+ Acordeão / Gavetas</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'timeline\')">+ Cronologia / Eventos</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'datalist\')">+ Grade de Dados</button>';
  html += '<button type="button" class="btn btn-small btn-primary" onclick="addBuilderBlock(\'section\')">+ Seção de Texto Extra</button>';
  html += '</div>';
  html += '<div id="modular-blocks-container">' + renderBuilderBlocksList() + '</div>';
  html += '</div>';
  return html;
}

function syncBuilderBlocksFromDOM() {
  var cards = document.querySelectorAll('#modular-blocks-container .block-builder-card');
  if (!cards.length && !activeBuilderBlocks.length) return;
  var updated = [];
  cards.forEach(function(card) {
    var type = card.getAttribute('data-btype');
    var titleEl = card.querySelector('.bb-title');
    var title = titleEl ? titleEl.value.trim() : '';

    if (type === 'quote') {
      updated.push({
        type: 'quote',
        title: title,
        text: (card.querySelector('.bb-quote-text') || {}).value || '',
        author: (card.querySelector('.bb-quote-author') || {}).value || '',
        avatar: (card.querySelector('.bb-quote-avatar') || {}).value || ''
      });
    } else if (type === 'section') {
      updated.push({
        type: 'section',
        title: title,
        content: (card.querySelector('.bb-sec-content') || {}).value || ''
      });
    } else if (type === 'tabs') {
      var items = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var lb = sub.querySelector('.bb-tab-label').value.trim();
        var ct = sub.querySelector('.bb-tab-content').value;
        if (lb || ct) items.push({ label: lb || 'Aba', content: ct });
      });
      updated.push({ type: 'tabs', title: title, items: items });
    } else if (type === 'gallery') {
      var cols = (card.querySelector('.bb-gal-cols') || {}).value || '2';
      var gItems = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var u = sub.querySelector('.bb-gal-url').value.trim();
        var cp = sub.querySelector('.bb-gal-cap').value.trim();
        if (u) gItems.push({ url: u, caption: cp });
      });
      updated.push({ type: 'gallery', title: title, cols: cols, items: gItems });
    } else if (type === 'cards') {
      var cItems = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var t = sub.querySelector('.bb-card-title').value.trim();
        var b = sub.querySelector('.bb-card-badge').value.trim();
        var col = sub.querySelector('.bb-card-color').value;
        var img = sub.querySelector('.bb-card-img').value.trim();
        var d = sub.querySelector('.bb-card-desc').value.trim();
        if (t || d) cItems.push({ title: t, badge: b, color: col, image: img, desc: d });
      });
      updated.push({ type: 'cards', title: title, items: cItems });
    } else if (type === 'stats') {
      var sItems = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var lb = sub.querySelector('.bb-stat-label').value.trim();
        var vl = parseInt(sub.querySelector('.bb-stat-val').value, 10) || 0;
        var col = sub.querySelector('.bb-stat-col').value;
        if (lb) sItems.push({ label: lb, value: vl, color: col });
      });
      updated.push({ type: 'stats', title: title, items: sItems });
    } else if (type === 'accordion') {
      var aItems = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var t = sub.querySelector('.bb-acc-title').value.trim();
        var c = sub.querySelector('.bb-acc-content').value.trim();
        if (t || c) aItems.push({ title: t, content: c });
      });
      updated.push({ type: 'accordion', title: title, items: aItems });
    } else if (type === 'timeline') {
      var tlItems = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var dt = sub.querySelector('.bb-tl-date').value.trim();
        var tt = sub.querySelector('.bb-tl-title').value.trim();
        var ds = sub.querySelector('.bb-tl-desc').value.trim();
        if (dt || tt || ds) tlItems.push({ date: dt, title: tt, desc: ds });
      });
      updated.push({ type: 'timeline', title: title, items: tlItems });
    } else if (type === 'datalist') {
      var dlItems = [];
      card.querySelectorAll('.bb-subitem').forEach(function(sub) {
        var lb = sub.querySelector('.bb-dl-label').value.trim();
        var vl = sub.querySelector('.bb-dl-val').value.trim();
        if (lb || vl) dlItems.push({ label: lb, value: vl });
      });
      updated.push({ type: 'datalist', title: title, items: dlItems });
    }
  });
  activeBuilderBlocks = updated;
}

function refreshBuilderDOM() {
  var c = document.getElementById('modular-blocks-container');
  if (c) c.innerHTML = renderBuilderBlocksList();
}

function addBuilderBlock(type) {
  syncBuilderBlocksFromDOM();
  if (type === 'tabs') {
    activeBuilderBlocks.push({ type: 'tabs', title: 'Informações em Abas', items: [{ label: 'Aba 1', content: '<p>Conteúdo da primeira aba...</p>' }, { label: 'Aba 2', content: '<p>Conteúdo da segunda aba...</p>' }] });
  } else if (type === 'gallery') {
    activeBuilderBlocks.push({ type: 'gallery', title: 'Galeria Visual', cols: '2', items: [{ url: '', caption: '' }] });
  } else if (type === 'cards') {
    activeBuilderBlocks.push({ type: 'cards', title: 'Cards em Destaque', items: [{ title: 'Novo Card', badge: 'Item', color: '#ffffff', image: '', desc: 'Descrição do card...' }] });
  } else if (type === 'quote') {
    activeBuilderBlocks.push({ type: 'quote', title: '', text: 'Uma frase marcante para a abertura ou clímax da cena...', author: 'Autor / Personagem', avatar: '' });
  } else if (type === 'stats') {
    activeBuilderBlocks.push({ type: 'stats', title: 'Indicadores / Progresso', items: [{ label: 'Tensão da Cena', value: 75, color: '#ffffff' }] });
  } else if (type === 'accordion') {
    activeBuilderBlocks.push({ type: 'accordion', title: 'Segredos & Notas Recolhíveis', items: [{ title: 'Clique para expandir', content: 'Texto oculto dentro da gaveta...' }] });
  } else if (type === 'timeline') {
    activeBuilderBlocks.push({ type: 'timeline', title: 'Cronologia dos Eventos', items: [{ date: 'Ato I · 22h15', title: 'O Encontro Inicial', desc: 'Descrição sucinta do marco cronológico...' }] });
  } else if (type === 'datalist') {
    activeBuilderBlocks.push({ type: 'datalist', title: 'Especificações Técnicas', items: [{ label: 'Classificação', value: 'Nível Sigiloso' }, { label: 'Jurisdição', value: 'Setor Norte' }] });
  } else if (type === 'section') {
    activeBuilderBlocks.push({ type: 'section', title: 'Nova Seção', content: '<p>Texto da seção adicional...</p>' });
  }
  refreshBuilderDOM();
}

function moveBuilderBlock(idx, dir) {
  syncBuilderBlocksFromDOM();
  var target = idx + dir;
  if (target < 0 || target >= activeBuilderBlocks.length) return;
  var tmp = activeBuilderBlocks[idx];
  activeBuilderBlocks[idx] = activeBuilderBlocks[target];
  activeBuilderBlocks[target] = tmp;
  refreshBuilderDOM();
}

function removeBuilderBlock(idx) {
  syncBuilderBlocksFromDOM();
  activeBuilderBlocks.splice(idx, 1);
  refreshBuilderDOM();
}

function addSubItemToBlock(bIdx) {
  syncBuilderBlocksFromDOM();
  var b = activeBuilderBlocks[bIdx];
  if (!b) return;
  if (!Array.isArray(b.items)) b.items = [];
  if (b.type === 'tabs') b.items.push({ label: 'Nova Aba', content: '<p>Texto...</p>' });
  else if (b.type === 'gallery') b.items.push({ url: '', caption: '' });
  else if (b.type === 'cards') b.items.push({ title: '', badge: '', color: '#ffffff', image: '', desc: '' });
  else if (b.type === 'stats') b.items.push({ label: 'Novo Medidor', value: 50, color: '#ffffff' });
  else if (b.type === 'accordion') b.items.push({ title: 'Título da Gaveta', content: '' });
  else if (b.type === 'timeline') b.items.push({ date: 'Marco', title: 'Novo Evento', desc: '' });
  else if (b.type === 'datalist') b.items.push({ label: 'Campo', value: 'Valor' });
  refreshBuilderDOM();
}

function removeSubItemFromBlock(bIdx, sIdx) {
  syncBuilderBlocksFromDOM();
  var b = activeBuilderBlocks[bIdx];
  if (b && Array.isArray(b.items)) {
    b.items.splice(sIdx, 1);
    refreshBuilderDOM();
  }
}

function renderBuilderBlocksList() {
  if (!activeBuilderBlocks.length) {
    return '<div style="padding:18px;text-align:center;color:var(--text-muted);border:1px dashed var(--border-medium);border-radius:var(--radius-md);font-size:12.5px;">Nenhum bloco modular adicionado. Use os botões acima para adicionar abas, galerias, cards, citações, barras, cronologias, grades ou gavetas.</div>';
  }
  var typeNames = {
    tabs: 'Bloco de Abas Interativas',
    gallery: 'Bloco de Galeria de Imagens',
    cards: 'Grade de Cards Customizados',
    quote: 'Citação / Epígrafe Destacada',
    stats: 'Barras de Status / Progresso',
    accordion: 'Acordeão / Gavetas (Spoilers)',
    timeline: 'Cronologia / Linha do Tempo',
    datalist: 'Grade de Dados / Especificações',
    section: 'Seção de Texto Extra'
  };
  var html = '';
  activeBuilderBlocks.forEach(function(b, idx) {
    html += '<div class="block-builder-card" data-btype="' + ha(b.type) + '">';
    html += '<div class="block-builder-head">';
    html += '<strong style="color:var(--accent-light);font-size:13px;">' + (typeNames[b.type] || b.type) + '</strong>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<button type="button" class="btn btn-small" onclick="moveBuilderBlock(' + idx + ',-1)">Subir</button>';
    html += '<button type="button" class="btn btn-small" onclick="moveBuilderBlock(' + idx + ',1)">Descer</button>';
    html += '<button type="button" class="btn btn-small btn-danger" onclick="removeBuilderBlock(' + idx + ')">Remover Bloco</button>';
    html += '</div></div>';

    if (b.type !== 'quote') {
      html += '<div class="form-row"><label>Título do Bloco</label><input type="text" class="bb-title" value="' + ha(b.title || '') + '" placeholder="Título desta seção"></div>';
    }

    if (b.type === 'quote') {
      html += '<div class="form-row"><label>Texto da Citação / Fala</label><textarea class="bb-quote-text" rows="2">' + h(b.text || '') + '</textarea></div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
      html += '<div><label>Autor / Personagem</label><input type="text" class="bb-quote-author" value="' + ha(b.author || '') + '"></div>';
      html += '<div><label>URL do Avatar (opcional)</label><input type="text" class="bb-quote-avatar" value="' + ha(b.avatar || '') + '"></div>';
      html += '</div>';
    } else if (b.type === 'section') {
      html += '<div class="form-row"><label>Conteúdo (aceita texto ou HTML)</label><textarea class="bb-sec-content" rows="4">' + h(b.content || '') + '</textarea></div>';
    } else if (b.type === 'tabs') {
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="background:rgba(0,0,0,0.25);padding:10px;border-radius:4px;margin-bottom:8px;border:1px solid var(--border-subtle);">';
        html += '<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;"><input type="text" class="bb-tab-label" value="' + ha(it.label || '') + '" placeholder="Nome da Aba"><button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button></div>';
        html += '<textarea class="bb-tab-content" rows="3" placeholder="Conteúdo da aba (pode usar tags HTML como <p>, <b>, <ul>)">' + h(it.content || '') + '</textarea>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Aba</button>';
    } else if (b.type === 'gallery') {
      html += '<div class="form-row"><label>Colunas da Galeria</label><select class="bb-gal-cols"><option value="1"' + (b.cols === '1' ? ' selected' : '') + '>1 Coluna (Grande)</option><option value="2"' + (b.cols !== '1' && b.cols !== '3' ? ' selected' : '') + '>2 Colunas</option><option value="3"' + (b.cols === '3' ? ' selected' : '') + '>3 Colunas</option></select></div>';
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;">';
        html += '<input type="text" class="bb-gal-url" value="' + ha(it.url || '') + '" placeholder="URL da Imagem (https://...)">';
        html += '<input type="text" class="bb-gal-cap" value="' + ha(it.caption || '') + '" placeholder="Legenda opcional">';
        html += '<button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Imagem na Galeria</button>';
    } else if (b.type === 'cards') {
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="background:rgba(0,0,0,0.25);padding:10px;border-radius:4px;margin-bottom:8px;border:1px solid var(--border-subtle);">';
        html += '<div style="display:grid;grid-template-columns:1fr 130px 70px auto;gap:8px;margin-bottom:8px;align-items:center;">';
        html += '<input type="text" class="bb-card-title" value="' + ha(it.title || '') + '" placeholder="Título do Card">';
        html += '<input type="text" class="bb-card-badge" value="' + ha(it.badge || '') + '" placeholder="Tag (Ex: NPC)">';
        html += '<input type="color" class="bb-card-color" value="' + ha(it.color || '#ffffff') + '" style="height:36px;width:100%;">';
        html += '<button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button>';
        html += '</div>';
        html += '<div class="form-row" style="margin-bottom:6px;"><input type="text" class="bb-card-img" value="' + ha(it.image || '') + '" placeholder="URL de Imagem do Card (opcional)"></div>';
        html += '<textarea class="bb-card-desc" rows="2" placeholder="Descrição do card...">' + h(it.desc || '') + '</textarea>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Card</button>';
    } else if (b.type === 'stats') {
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="display:grid;grid-template-columns:1fr 100px 70px auto;gap:8px;margin-bottom:8px;align-items:center;">';
        html += '<input type="text" class="bb-stat-label" value="' + ha(it.label || '') + '" placeholder="Nome do Indicador">';
        html += '<input type="number" min="0" max="100" class="bb-stat-val" value="' + ha(it.value !== undefined ? it.value : 50) + '" placeholder="0-100">';
        html += '<input type="color" class="bb-stat-col" value="' + ha(it.color || '#ffffff') + '" style="height:36px;width:100%;">';
        html += '<button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Barra</button>';
    } else if (b.type === 'accordion') {
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="background:rgba(0,0,0,0.25);padding:10px;border-radius:4px;margin-bottom:8px;border:1px solid var(--border-subtle);">';
        html += '<div style="display:flex;gap:8px;margin-bottom:6px;"><input type="text" class="bb-acc-title" value="' + ha(it.title || '') + '" placeholder="Título visível da gaveta"><button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button></div>';
        html += '<textarea class="bb-acc-content" rows="2" placeholder="Conteúdo oculto...">' + h(it.content || '') + '</textarea>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Gaveta</button>';
    } else if (b.type === 'timeline') {
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="background:rgba(0,0,0,0.25);padding:10px;border-radius:4px;margin-bottom:8px;border:1px solid var(--border-subtle);">';
        html += '<div style="display:grid;grid-template-columns:160px 1fr auto;gap:8px;margin-bottom:6px;align-items:center;">';
        html += '<input type="text" class="bb-tl-date" value="' + ha(it.date || '') + '" placeholder="Data / Hora / Ato">';
        html += '<input type="text" class="bb-tl-title" value="' + ha(it.title || '') + '" placeholder="Título do Evento">';
        html += '<button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button>';
        html += '</div>';
        html += '<textarea class="bb-tl-desc" rows="2" placeholder="Descrição do acontecimento...">' + h(it.desc || '') + '</textarea>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Evento na Cronologia</button>';
    } else if (b.type === 'datalist') {
      (b.items || []).forEach(function(it, sIdx) {
        html += '<div class="bb-subitem" style="display:grid;grid-template-columns:180px 1fr auto;gap:8px;margin-bottom:8px;align-items:center;">';
        html += '<input type="text" class="bb-dl-label" value="' + ha(it.label || '') + '" placeholder="Rótulo / Chave">';
        html += '<input type="text" class="bb-dl-val" value="' + ha(it.value || '') + '" placeholder="Valor / Descrição">';
        html += '<button type="button" class="btn btn-small btn-danger" onclick="removeSubItemFromBlock(' + idx + ',' + sIdx + ')">Remover</button>';
        html += '</div>';
      });
      html += '<button type="button" class="btn btn-small" onclick="addSubItemToBlock(' + idx + ')">+ Adicionar Par de Dados</button>';
    }

    html += '</div>';
  });
  return html;
}

function infoboxFieldRowHtml(label, value) {
  return '<div class="infobox-field-row" style="display:grid;grid-template-columns:180px 1fr auto;gap:8px;margin-bottom:8px;align-items:center;">' +
    '<input type="text" class="ib-field-label" value="' + ha(label || '') + '" placeholder="Campo (Ex: Local)">' +
    '<input type="text" class="ib-field-val" value="' + ha(value || '') + '" placeholder="Valor (Ex: Manaus, AM)">' +
    '<button type="button" class="btn btn-small btn-danger" onclick="this.parentNode.remove()">Remover</button>' +
    '</div>';
}

function addInfoboxFieldRow() {
  var c = document.getElementById('c-infobox-fields');
  if (c) c.insertAdjacentHTML('beforeend', infoboxFieldRowHtml('', ''));
}

function toggleParticipanteInput(nome) {
  var el = document.getElementById('c-ib-participants');
  if (!el) return;
  var parts = el.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var idx = parts.findIndex(function(p) { return p.toLowerCase() === nome.toLowerCase(); });
  if (idx === -1) parts.push(nome);
  else parts.splice(idx, 1);
  el.value = parts.join(', ');
}

function renderNovaCena() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">Apenas Moderadores e Administradores podem criar ou editar páginas da Wikia.</div>';

  var editId = sessionStorage.getItem('editCenaId');
  var existing = editId ? listaWikiPosts().find(function(w) { return String(w.id) === String(editId); }) : null;
  var theme = (existing && existing.theme) ? existing.theme : { accentColor: '#ffffff', bannerStyle: 'cinematic', layout: 'sidebar-left', fontFamily: 'serif', bgEffect: 'none', bgm: '' };
  var infobox = (existing && existing.infobox) ? existing.infobox : { show: true, title: '', image: '', caption: '', participants: [], fields: [{ label: 'Localização', value: '' }, { label: 'Arco', value: '' }, { label: 'Clima / Ambiente', value: '' }] };
  activeBuilderBlocks = (existing && Array.isArray(existing.blocks)) ? JSON.parse(JSON.stringify(existing.blocks)) : [];

  var html = '<div class="breadcrumb"><a onclick="navigate(\'cenas\')">Cenas</a> / ' + (existing ? 'Customizar Página' : 'Nova Cena / Post Customizável') + '</div>';
  html += '<div class="cat-header"><span>' + (existing ? 'Customizar Página: ' + h(existing.titulo) : 'Criar Nova Cena / Post na Wikia') + '</span></div>';

  // Painel 1: Dados principais
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>1. Identidade da Cena / Post</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>Título da Página</label><input type="text" id="c-titulo" value="' + (existing ? ha(existing.titulo) : '') + '" placeholder="Ex: Ecos sob o Rio Negro"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Subtítulo / Arco (Opcional)</label><input type="text" id="c-subtitulo" value="' + (existing ? ha(existing.subtitulo) : '') + '" placeholder="Ex: Ato I · A Rota Clandestina"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Categoria / Tipo</label><select id="c-categoria">';
  ['Cena de RPG', 'Combate / Batalha', 'Evento / Arco', 'Lore & Mundo', 'Crônica'].forEach(function(cat) {
    var sel = (existing && existing.categoria === cat) ? ' selected' : '';
    html += '<option value="' + ha(cat) + '"' + sel + '>' + h(cat) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Status</label><select id="c-status">';
  ['Em Andamento', 'Concluída', 'Canônica', 'Hiato'].forEach(function(st) {
    var sel = (existing && existing.status === st) ? ' selected' : '';
    html += '<option value="' + ha(st) + '"' + sel + '>' + h(st) + '</option>';
  });
  html += '</select></div>';
  html += '</div>';
  html += '<div class="form-row"><label>Resumo Curto (exibido no card da listagem)</label><input type="text" id="c-resumo" value="' + (existing ? ha(existing.resumo) : '') + '" placeholder="Breve sinopse da cena ou artigo..."></div>';
  html += '</div>';

  // Painel 2: Customização Visual da Página
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>2. Estilo Visual &amp; Layout da Página</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:12px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>Cor de Destaque da Página</label>';
  html += '<div class="swatch-row"><input type="color" id="c-accent" value="' + ha(theme.accentColor || '#ffffff') + '" style="width:44px;height:34px;cursor:pointer;">';
  [['#ffffff', 'Branco'], ['#d4d4d4', 'Prata'], ['#a3a3a3', 'Cinza Claro'], ['#737373', 'Cinza Médio'], ['#404040', 'Grafite'], ['#262626', 'Carvão']].forEach(function(sw) {
    html += '<button type="button" class="color-swatch-btn" title="' + sw[1] + '" style="background:' + sw[0] + ';" onclick="document.getElementById(\'c-accent\').value=\'' + sw[0] + '\'"></button>';
  });
  html += '</div></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Estilo do Banner de Topo</label><select id="c-banner-style">';
  html += '<option value="cinematic"' + (theme.bannerStyle === 'cinematic' ? ' selected' : '') + '>Cinematográfico (Grande)</option>';
  html += '<option value="standard"' + (theme.bannerStyle === 'standard' ? ' selected' : '') + '>Padrão</option>';
  html += '<option value="compact"' + (theme.bannerStyle === 'compact' ? ' selected' : '') + '>Compacto</option>';
  html += '<option value="none"' + (theme.bannerStyle === 'none' ? ' selected' : '') + '>Sem Banner</option>';
  html += '</select></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Layout da Página</label><select id="c-layout">';
  html += '<option value="sidebar-left"' + (theme.layout === 'sidebar-left' ? ' selected' : '') + '>Infobox na Esquerda + Conteúdo</option>';
  html += '<option value="sidebar-right"' + (theme.layout === 'sidebar-right' ? ' selected' : '') + '>Conteúdo + Infobox na Direita</option>';
  html += '<option value="full"' + (theme.layout === 'full' ? ' selected' : '') + '>Largura Total (Sem Infobox)</option>';
  html += '<option value="book"' + (theme.layout === 'book' ? ' selected' : '') + '>Modo Livro (Coluna Central Literária)</option>';
  html += '</select></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Tipografia de Leitura</label><select id="c-font">';
  html += '<option value="serif"' + (theme.fontFamily === 'serif' ? ' selected' : '') + '>Literária (Serif — Lora)</option>';
  html += '<option value="sans"' + (theme.fontFamily === 'sans' ? ' selected' : '') + '>Moderna (Sans — Inter)</option>';
  html += '<option value="mono"' + (theme.fontFamily === 'mono' ? ' selected' : '') + '>Monoespaçada (Arquivo Técnico)</option>';
  html += '</select></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Atmosfera de Fundo</label><select id="c-bg-effect">';
  html += '<option value="none"' + (theme.bgEffect === 'none' ? ' selected' : '') + '>Fundo Minimalista Puro</option>';
  html += '<option value="aura"' + (theme.bgEffect === 'aura' ? ' selected' : '') + '>Luz Radial Sutil</option>';
  html += '<option value="grid"' + (theme.bgEffect === 'grid' ? ' selected' : '') + '>Grade Tática Sutil</option>';
  html += '<option value="dots"' + (theme.bgEffect === 'dots' ? ' selected' : '') + '>Pontilhado Sutil</option>';
  html += '</select></div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>URL da Imagem de Banner (Opcional)</label><input type="text" id="c-banner" value="' + (existing ? ha(existing.banner) : '') + '" placeholder="https://... (deixe vazio para usar fundo neutro)"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Música Tema / Ambiente (Opcional)</label><input type="text" id="c-bgm" value="' + ha(theme.bgm || '') + '" placeholder="Ex: OST — Rain Over the Black River"></div>';
  html += '</div></div>';

  // Painel 3: Infobox Customizável
  var partsStr = Array.isArray(infobox.participants) ? infobox.participants.join(', ') : '';
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>3. Infobox Lateral Customizável</span><label style="display:inline-flex;align-items:center;gap:6px;margin:0;cursor:pointer;"><input type="checkbox" id="c-ib-show"' + (infobox.show !== false ? ' checked' : '') + '> Exibir Infobox</label></div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>Título da Infobox</label><input type="text" id="c-ib-title" value="' + ha(infobox.title || '') + '" placeholder="Ex: Registro de Cena"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Imagem da Infobox (URL)</label><input type="text" id="c-ib-image" value="' + ha(infobox.image || '') + '" placeholder="https://..."></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Legenda da Imagem</label><input type="text" id="c-ib-caption" value="' + ha(infobox.caption || '') + '" placeholder="Legenda opcional"></div>';
  html += '</div>';

  html += '<div class="form-row"><label>Participantes da Cena (separe por vírgula ou clique nos personagens abaixo)</label>';
  html += '<input type="text" id="c-ib-participants" value="' + ha(partsStr) + '" placeholder="Ex: Shin Hae, Shidō Akane">';
  var chars = listaPersonagens();
  if (chars.length) {
    html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><span style="font-size:11px;color:var(--text-muted);">Adicionar rápido:</span>';
    chars.forEach(function(ch) {
      html += '<button type="button" class="btn btn-small" style="padding:3px 9px;font-size:11px;" onclick="toggleParticipanteInput(' + jsArg(ch.nome) + ')">+ ' + h(ch.nome) + '</button>';
    });
    html += '</div>';
  }
  html += '</div>';

  html += '<label>Campos Personalizados da Infobox</label>';
  html += '<div id="c-infobox-fields">';
  if (Array.isArray(infobox.fields)) {
    infobox.fields.forEach(function(f) { html += infoboxFieldRowHtml(f.label, f.value); });
  }
  html += '</div>';
  html += '<button type="button" class="btn btn-small" onclick="addInfoboxFieldRow()">+ Adicionar Linha na Infobox</button>';
  html += '</div>';

  // Painel 4: Texto de Abertura
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>4. Texto de Abertura / Contextualização da Cena</span></div>';
  html += buildEditor('c-editor', existing ? existing.descricao : '', 'Escreva a introdução da cena, ambientação inicial ou lore...');
  html += '</div>';

  // Painel 5: Construtor de Blocos Modulares
  html += renderBlockBuilderSection();

  var btnLabel = existing ? 'Salvar Alterações da Página' : 'Publicar Cena / Post na Wikia';
  var onclick = existing ? 'salvarEdicaoCena(' + idJs(existing.id) + ')' : 'submitNovaCena()';
  html += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">';
  html += '<button class="btn btn-primary" onclick="' + onclick + '">' + btnLabel + '</button>';
  html += '<button type="button" class="btn" onclick="previewCenaModal()">Pré-visualizar</button>';
  html += '<button type="button" class="btn" onclick="exportarCenaJson()">Exportar JSON</button>';
  html += '<button type="button" class="btn" onclick="importarCenaJsonModal()">Importar JSON</button>';
  html += '<button class="btn" onclick="navigate(\'cenas\')">Cancelar</button>';
  html += '</div>';
  return html;
}

function previewPersonagemModal() {
  var d = lerFormularioPersonagem();
  requestSafeContentPreview({ html: d.descricao || '' }).then(function(safe) {
    var html = '<div style="max-height:70vh;overflow-y:auto;padding-right:4px;">';
    html += '<div style="display:flex;gap:16px;align-items:center;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border-subtle);">';
    var imageUrl = d.imagem && typeof editorSafeContentUrl === 'function'
      ? editorSafeContentUrl(d.imagem, { image: true }) : null;
    if (imageUrl) html += '<img src="' + ha(imageUrl) + '" style="width:72px;height:72px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border-medium);">';
    html += '<div><h3 style="font-size:18px;font-weight:700;color:var(--text-primary);">' + h(d.nome || 'Sem Nome') + '</h3>';
    html += '<div style="font-size:12px;color:var(--text-secondary);">' + h(d.titulo || '') + ' · ' + h(d.raca || '') + '</div></div></div>';
    html += '<div class="char-sheet-body" style="padding:18px;">' + safe.html + '</div>';
    html += '</div>';
    showModal('Pré-visualização: ' + (d.nome || 'Personagem'), html);
  }).catch(function(error) {
    showAlert(error.message || 'Não foi possível validar a prévia da ficha.', 'error');
  });
}

function exportarPersonagemJson() {
  var d = lerFormularioPersonagem();
  var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ((d.nome || 'personagem').toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showAlert('Ficha exportada em JSON.', 'success');
}

function importarPersonagemJsonModal() {
  var body = '<div class="form-row"><label>Cole o JSON da ficha de personagem abaixo</label><textarea id="import-char-json" rows="8" style="font-family:var(--font-mono);font-size:12px;" placeholder=\'{"nome": "...", "titulo": "..."}\'></textarea></div>';
  body += '<div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="confirmImportPersonagemJson()">Carregar Dados</button></div>';
  showModal('Importar Ficha via JSON', body);
}

var importJsonPending = false;

function requestSafeContentPreview(payload) {
  if (!window.Aetherverse || typeof window.Aetherverse.apiRequest !== 'function') {
    return Promise.reject(new Error('O serviço de validação segura não está disponível.'));
  }
  return window.Aetherverse.apiRequest('POST', '/api/content/preview', payload).then(function(response) {
    var safe = response && response.data && typeof response.data === 'object' ? response.data : response;
    if (!safe || typeof safe !== 'object' || Array.isArray(safe)) throw new Error('A resposta de validação está incompleta.');
    if (Object.prototype.hasOwnProperty.call(payload, 'html') && typeof safe.html !== 'string') {
      throw new Error('A resposta de validação não incluiu HTML seguro.');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'blocks') && !Array.isArray(safe.blocks)) {
      throw new Error('A resposta de validação não incluiu blocos seguros.');
    }
    return safe;
  });
}

function importedStringFields(source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('O JSON deve conter um objeto.');
  var values = {};
  fields.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) return;
    var value = source[field.name];
    if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
    if (typeof value !== 'string' || value.length > field.max) throw new Error('O campo "' + field.name + '" tem formato inválido.');
    values[field.name] = value;
  });
  return values;
}

function confirmImportPersonagemJson() {
  if (importJsonPending) return Promise.resolve();
  var source = document.getElementById('import-char-json');
  var raw = source ? source.value : '';
  var data;
  var values;
  try {
    data = JSON.parse(raw);
    values = importedStringFields(data, [
      { name: 'nome', max: 200 }, { name: 'titulo', max: 200 }, { name: 'raca', max: 100 },
      { name: 'idade', max: 100 }, { name: 'afiliacao', max: 300 }, { name: 'imagem', max: 2048 },
      { name: 'resumo', max: 2000 }, { name: 'descricao', max: 250000 }
    ]);
  } catch (error) {
    showAlert(error && error.message && error.message !== 'Unexpected end of JSON input' ? error.message : 'JSON inválido.', 'error');
    return Promise.resolve();
  }
  var description = Object.prototype.hasOwnProperty.call(values, 'descricao') ? values.descricao : '';
  var targets = {};
  var ids = { nome: 'p-nome', titulo: 'p-titulo', raca: 'p-raca', idade: 'p-idade',
    afiliacao: 'p-afiliacao', imagem: 'p-imagem', resumo: 'p-resumo' };
  try {
    Object.keys(values).forEach(function(field) {
      if (field === 'descricao') return;
      targets[field] = document.getElementById(ids[field]);
      if (!targets[field]) throw new Error('O formulário da ficha não está disponível.');
    });
  } catch (error) {
    showAlert(error.message, 'error');
    return Promise.resolve();
  }
  var editor = Object.prototype.hasOwnProperty.call(values, 'descricao') ? document.getElementById('p-editor') : null;
  if (Object.prototype.hasOwnProperty.call(values, 'descricao') && !editor) {
    showAlert('O editor da ficha não está disponível.', 'error');
    return Promise.resolve();
  }
  importJsonPending = true;
  var button = document.querySelector('#modal-container button.btn-primary');
  if (button) button.disabled = true;
  return requestSafeContentPreview({ html: description }).then(function(safe) {
    if (document.getElementById('import-char-json') !== source || (editor && document.getElementById('p-editor') !== editor)) return;
    Object.keys(targets).forEach(function(field) { targets[field].value = values[field]; });
    if (editor && !setEditorContent('p-editor', safe.html)) throw new Error('Não foi possível atualizar o editor da ficha.');
    closeModal();
    showAlert(safe.formattingLoss && safe.formattingLoss.discarded
      ? 'Dados importados; a formatação não permitida foi removida.'
      : 'Dados importados para o formulário.', 'success');
  }).catch(function(error) {
    showAlert(error.message || 'Não foi possível validar o JSON importado.', 'error');
  }).finally(function() {
    importJsonPending = false;
    if (button) button.disabled = false;
  });
}

function previewCenaModal() {
  var d = lerFormularioCena();
  var payload = { html: d.descricao || '', blocks: Array.isArray(d.blocks) ? d.blocks : [] };
  requestSafeContentPreview(payload).then(function(safe) {
    var html = '<div style="max-height:72vh;overflow-y:auto;padding-right:4px;">';
    html += '<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle);">';
    html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);">' + h(d.categoria) + ' · ' + h(d.status) + '</div>';
    html += '<h2 style="font-size:20px;font-weight:700;color:var(--text-primary);margin-top:4px;">' + h(d.titulo || 'Sem Título') + '</h2>';
    if (d.subtitulo) html += '<div style="font-size:13px;color:var(--text-secondary);">' + h(d.subtitulo) + '</div>';
    html += '</div>';
    if (safe.html) html += '<div class="char-sheet-body" style="padding:18px;margin-bottom:16px;">' + safe.html + '</div>';
    if (safe.blocks.length) html += renderModularBlocks(safe.blocks);
    html += '</div>';
    showModal('Pré-visualização da Página', html);
  }).catch(function(error) {
    showAlert(error.message || 'Não foi possível validar a prévia da página.', 'error');
  });
}

function exportarCenaJson() {
  var d = lerFormularioCena();
  var blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ((d.titulo || 'cena-wikia').toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showAlert('Estrutura da página exportada em JSON.', 'success');
}

function importarCenaJsonModal() {
  var body = '<div class="form-row"><label>Cole o JSON da página customizável abaixo</label><textarea id="import-cena-json" rows="8" style="font-family:var(--font-mono);font-size:12px;" placeholder=\'{"titulo": "...", "blocks": [...]}\'></textarea></div>';
  body += '<div style="display:flex;justify-content:flex-end;gap:8px;"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="confirmImportCenaJson()">Carregar Página</button></div>';
  showModal('Importar Página via JSON', body);
}

function confirmImportCenaJson() {
  if (importJsonPending) return Promise.resolve();
  var source = document.getElementById('import-cena-json');
  var data;
  var values;
  var hasBlocks;
  try {
    data = JSON.parse(source ? source.value : '');
    values = importedStringFields(data, [
      { name: 'titulo', max: 200 }, { name: 'subtitulo', max: 300 }, { name: 'resumo', max: 2000 },
      { name: 'banner', max: 2048 }, { name: 'descricao', max: 250000 }
    ]);
    hasBlocks = Object.prototype.hasOwnProperty.call(data, 'blocks');
    if (hasBlocks && !Array.isArray(data.blocks)) throw new Error('O campo "blocks" deve ser uma lista.');
  } catch (error) {
    showAlert(error && error.message && error.message !== 'Unexpected end of JSON input' ? error.message : 'JSON inválido.', 'error');
    return Promise.resolve();
  }
  var targets = {};
  var ids = { titulo: 'c-titulo', subtitulo: 'c-subtitulo', resumo: 'c-resumo', banner: 'c-banner' };
  try {
    Object.keys(values).forEach(function(field) {
      if (field === 'descricao') return;
      targets[field] = document.getElementById(ids[field]);
      if (!targets[field]) throw new Error('O formulário da cena não está disponível.');
    });
  } catch (error) {
    showAlert(error.message, 'error');
    return Promise.resolve();
  }
  var editor = Object.prototype.hasOwnProperty.call(values, 'descricao') ? document.getElementById('c-editor') : null;
  if (Object.prototype.hasOwnProperty.call(values, 'descricao') && !editor) {
    showAlert('O editor da cena não está disponível.', 'error');
    return Promise.resolve();
  }
  var payload = { html: Object.prototype.hasOwnProperty.call(values, 'descricao') ? values.descricao : '' };
  if (hasBlocks) payload.blocks = data.blocks;
  importJsonPending = true;
  var button = document.querySelector('#modal-container button.btn-primary');
  if (button) button.disabled = true;
  return requestSafeContentPreview(payload).then(function(safe) {
    if (document.getElementById('import-cena-json') !== source || (editor && document.getElementById('c-editor') !== editor)) return;
    Object.keys(targets).forEach(function(field) { targets[field].value = values[field]; });
    if (editor && !setEditorContent('c-editor', safe.html)) throw new Error('Não foi possível atualizar o editor da cena.');
    if (hasBlocks) {
      activeBuilderBlocks = JSON.parse(JSON.stringify(safe.blocks));
      refreshBuilderDOM();
    }
    closeModal();
    showAlert(safe.formattingLoss && safe.formattingLoss.discarded
      ? 'Estrutura carregada; a formatação não permitida foi removida.'
      : 'Estrutura JSON carregada no construtor.', 'success');
  }).catch(function(error) {
    showAlert(error.message || 'Não foi possível validar o JSON importado.', 'error');
  }).finally(function() {
    importJsonPending = false;
    if (button) button.disabled = false;
  });
}

function lerFormularioCena() {
  syncBuilderBlocksFromDOM();
  var fields = [];
  document.querySelectorAll('#c-infobox-fields .infobox-field-row').forEach(function(r) {
    var lb = r.querySelector('.ib-field-label').value.trim();
    var vl = r.querySelector('.ib-field-val').value.trim();
    if (lb || vl) fields.push({ label: lb, value: vl });
  });
  var partsRaw = document.getElementById('c-ib-participants').value;
  var participants = partsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  return {
    titulo: document.getElementById('c-titulo').value.trim(),
    subtitulo: document.getElementById('c-subtitulo').value.trim(),
    categoria: document.getElementById('c-categoria').value,
    status: document.getElementById('c-status').value,
    resumo: document.getElementById('c-resumo').value.trim(),
    banner: document.getElementById('c-banner').value.trim(),
    descricao: getEditorContent('c-editor'),
    theme: {
      accentColor: document.getElementById('c-accent').value,
      bannerStyle: document.getElementById('c-banner-style').value,
      layout: document.getElementById('c-layout').value,
      fontFamily: document.getElementById('c-font').value,
      bgEffect: document.getElementById('c-bg-effect').value,
      bgm: document.getElementById('c-bgm').value.trim()
    },
    infobox: {
      show: document.getElementById('c-ib-show').checked,
      title: document.getElementById('c-ib-title').value.trim(),
      image: document.getElementById('c-ib-image').value.trim(),
      caption: document.getElementById('c-ib-caption').value.trim(),
      participants: participants,
      fields: fields
    },
    blocks: activeBuilderBlocks
  };
}

function submitNovaCena() {
  if (!isModOrAdmin()) { showAlert('Apenas Moderadores e Administradores podem criar páginas na Wikia.', 'error'); return; }
  var dados = lerFormularioCena();
  if (!dados.titulo) { showAlert('Preencha o título da cena/post.', 'error'); return; }
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('scene-create');
  if (!finish) return;

  apiRequest('POST', '/api/wiki-posts', dados, function(err, data) {
    finish();
    if (err) { showAlert(err, 'error'); return; }
    clearResourceFormDraft(descriptor);
    if (serverWikiPosts === null) serverWikiPosts = [];
    serverWikiPosts.unshift(data.wikiPost);
    navigate('cenaView', data.wikiPost.id);
    showAlert('Cena publicada na Wikia!', 'success');
  });
}

function editarCena(id) {
  sessionStorage.setItem('editCenaId', id);
  navigate('novaCena');
}

function salvarEdicaoCena(id) {
  if (!isModOrAdmin()) { showAlert('Sem permissão.', 'error'); return; }
  var dados = lerFormularioCena();
  if (!dados.titulo) { showAlert('O título é obrigatório.', 'error'); return; }

  var existing = listaWikiPosts().find(function(item) { return String(item.id) === String(id); });
  if (!existing) { showAlert('Atualize a cena antes de salvar.', 'error'); return; }
  dados.expectedVersion = existing.version;
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('scene-edit:' + String(id));
  if (!finish) return;
  apiRequest('PUT', '/api/wiki-posts/' + encodeURIComponent(id), dados, function(err, data) {
    finish();
    if (err) { showAlert(err, 'error'); return; }
    clearResourceFormDraft(descriptor);
    var idx = serverWikiPosts.findIndex(function(x) { return x.id === id; });
    if (idx !== -1) serverWikiPosts[idx] = data.wikiPost;
    sessionStorage.removeItem('editCenaId');
    navigate('cenaView', id);
    showAlert('Página customizada salva!', 'success');
  });
}

function deletarCena(id) {
  if (!isModOrAdmin()) return;
  if (!confirm('Ocultar esta cena? Ela poderá ser recuperada pela equipe.')) return;
  var scene = listaWikiPosts().find(function(item) { return String(item.id) === String(id); });
  if (!scene) return;
  apiRequest('POST', '/api/wiki-posts/' + encodeURIComponent(id) + '/hide', { expectedVersion: scene.version }, function(err) {
    if (err) { showAlert(err, 'error'); return; }
    serverWikiPosts = serverWikiPosts.filter(function(w) { return w.id !== id; });
    navigate('cenas');
  });
}

// ==================== PERFIL, REGISTRO, SOBRE & ADMIN ====================

function estimateBase64DecodedBytes(dataUrl) {
  var idx = String(dataUrl || '').indexOf(',');
  if (idx === -1) return Infinity;
  var b64 = dataUrl.slice(idx + 1);
  var padding = b64.slice(-2) === '==' ? 2 : (b64.slice(-1) === '=' ? 1 : 0);
  return Math.floor((b64.length * 3) / 4) - padding;
}

function currentProfilePreviewSrc() {
  var u = DB.session;
  if (!u) return '';
  if (pendingProfileAvatarUpload && safeProfilePreviewSrc(pendingProfileAvatarUpload)) {
    return pendingProfileAvatarUpload;
  }
  if (pendingProfileAvatarCleared) return '';
  var inputEl = document.getElementById('prof-avatar');
  if (inputEl && typeof inputEl.value === 'string' && inputEl.value.trim()) {
    return safeAvatarSrc(inputEl.value.trim());
  }
  return safeAvatarSrc(u.avatar || '');
}

function renderProfileAvatarPreviewMarkup(username, previewSrc) {
  var safeSrc = safeProfilePreviewSrc(previewSrc);
  if (safeSrc) {
    return '<img class="avatar-preview" src="' + ha(safeSrc) + '" alt="' + ha(username || 'Avatar') + '">';
  }
  return '<div class="avatar-preview-ph">' + h(userInitials(username, 1)) + '</div>';
}

function profileAvatarStatusText() {
  if (profileAvatarPreparing) return 'Processando imagem selecionada…';
  if (pendingProfileAvatarUpload) return 'Nova foto pronta. Clique em "Salvar Alterações do Perfil" para confirmar.';
  if (pendingProfileAvatarCleared) return 'A foto será removida ao salvar o perfil.';
  var inputEl = document.getElementById('prof-avatar');
  var typed = inputEl && typeof inputEl.value === 'string' ? inputEl.value.trim() : '';
  if (typed) {
    return safeAvatarSrc(typed)
      ? 'Usando URL externa (HTTPS).'
      : 'Informe uma URL iniciada por https:// ou envie uma imagem do dispositivo.';
  }
  if (DB.session && DB.session.avatar && DB.session.avatar.indexOf('/api/users/') === 0) {
    return 'Foto enviada do seu dispositivo ativa.';
  }
  if (DB.session && safeAvatarSrc(DB.session.avatar)) {
    return 'Foto de perfil ativa.';
  }
  return 'Formatos aceitos: PNG, JPG, WebP ou GIF (redimensionado automaticamente até 512 KB).';
}

function refreshProfileAvatarPreview() {
  if (!DB.session) return;
  var box = document.getElementById('prof-avatar-preview-box');
  if (box) {
    box.innerHTML = renderProfileAvatarPreviewMarkup(DB.session.username, currentProfilePreviewSrc());
  }
  var statusEl = document.getElementById('prof-avatar-status');
  if (statusEl) {
    statusEl.textContent = profileAvatarStatusText();
  }
}

function onProfileAvatarUrlInput() {
  var inputEl = document.getElementById('prof-avatar');
  var val = inputEl && typeof inputEl.value === 'string' ? inputEl.value.trim() : '';
  if (val) {
    pendingProfileAvatarUpload = null;
    pendingProfileAvatarCleared = false;
  } else if (DB.session && DB.session.avatar && DB.session.avatar.indexOf('https://') === 0) {
    pendingProfileAvatarCleared = true;
  }
  refreshProfileAvatarPreview();
}

function removerFotoPerfil() {
  if (!DB.session) return;
  pendingProfileAvatarUpload = null;
  pendingProfileAvatarCleared = true;
  var urlInput = document.getElementById('prof-avatar');
  if (urlInput) urlInput.value = '';
  var fileInput = document.getElementById('prof-avatar-file');
  if (fileInput) fileInput.value = '';
  refreshProfileAvatarPreview();
  saveActiveResourceFormDraft();
}

function readDataUrlFromFile(file) {
  return new Promise(function(resolve, reject) {
    if (typeof window.FileReader !== 'function') {
      reject(new Error('Seu navegador não suporta leitura de arquivos locais.'));
      return;
    }
    var reader = new window.FileReader();
    reader.onload = function() {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = function() {
      reject(new Error('Não foi possível ler o arquivo selecionado.'));
    };
    reader.readAsDataURL(file);
  });
}

function rasterizeAvatarDataUrl(sourceDataUrl) {
  return new Promise(function(resolve, reject) {
    if (typeof window.Image !== 'function' || typeof document.createElement !== 'function') {
      if (DATA_AVATAR_PREVIEW_PATTERN.test(sourceDataUrl) && estimateBase64DecodedBytes(sourceDataUrl) <= 524288) {
        resolve(sourceDataUrl);
        return;
      }
      reject(new Error('Não foi possível processar a imagem neste ambiente.'));
      return;
    }
    var img = new window.Image();
    img.onload = function() {
      var srcW = img.naturalWidth || img.width || 0;
      var srcH = img.naturalHeight || img.height || 0;
      if (!srcW || !srcH) {
        reject(new Error('A imagem selecionada é inválida.'));
        return;
      }
      var side = Math.min(srcW, srcH);
      var sx = Math.floor((srcW - side) / 2);
      var sy = Math.floor((srcH - side) / 2);
      var targetSize = Math.min(256, side);
      var canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Não foi possível preparar o recorte da foto.'));
        return;
      }
      ctx.clearRect(0, 0, targetSize, targetSize);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);

      var candidates = [
        function() { return canvas.toDataURL('image/webp', 0.86); },
        function() { return canvas.toDataURL('image/webp', 0.72); },
        function() {
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#0b0b0b';
          ctx.fillRect(0, 0, targetSize, targetSize);
          ctx.globalCompositeOperation = 'source-over';
          return canvas.toDataURL('image/jpeg', 0.84);
        },
        function() { return canvas.toDataURL('image/jpeg', 0.68); },
        function() { return canvas.toDataURL('image/png'); }
      ];
      for (var i = 0; i < candidates.length; i++) {
        try {
          var out = candidates[i]();
          if (typeof out === 'string' && DATA_AVATAR_PREVIEW_PATTERN.test(out) && estimateBase64DecodedBytes(out) <= 524288) {
            resolve(out);
            return;
          }
        } catch (_) { /* Try next encoder candidate. */ }
      }
      reject(new Error('A imagem ficou acima do limite de 512 KB mesmo após compressão. Escolha outra imagem.'));
    };
    img.onerror = function() {
      reject(new Error('Arquivo de imagem inválido ou corrompido.'));
    };
    img.src = sourceDataUrl;
  });
}

function prepareProfileAvatarFile(file) {
  if (!file) return Promise.reject(new Error('Nenhum arquivo selecionado.'));
  var mime = String(file.type || '').toLowerCase();
  var name = String(file.name || '').toLowerCase();
  var allowedMime = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/gif';
  var allowedExt = /\.(png|jpe?g|webp|gif)$/i.test(name);
  if (!allowedMime && !allowedExt) {
    return Promise.reject(new Error('Formato não suportado. Envie PNG, JPG, WebP ou GIF.'));
  }
  if (typeof file.size === 'number' && file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error('Escolha uma imagem de até 8 MB.'));
  }
  return readDataUrlFromFile(file).then(function(rawDataUrl) {
    if ((mime === 'image/gif' || /\.gif$/i.test(name))
        && DATA_AVATAR_PREVIEW_PATTERN.test(rawDataUrl)
        && estimateBase64DecodedBytes(rawDataUrl) <= 524288) {
      return rawDataUrl;
    }
    return rasterizeAvatarDataUrl(rawDataUrl);
  });
}

function onProfileAvatarFileChange(inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return Promise.resolve();
  profileAvatarPreparing = true;
  refreshProfileAvatarPreview();
  return prepareProfileAvatarFile(file).then(function(dataUrl) {
    profileAvatarPreparing = false;
    pendingProfileAvatarUpload = dataUrl;
    pendingProfileAvatarCleared = false;
    var urlInput = document.getElementById('prof-avatar');
    if (urlInput) urlInput.value = '';
    if (inputEl) inputEl.value = '';
    refreshProfileAvatarPreview();
    saveActiveResourceFormDraft();
  }).catch(function(err) {
    profileAvatarPreparing = false;
    if (inputEl) inputEl.value = '';
    refreshProfileAvatarPreview();
    showAlert((err && err.message) ? err.message : 'Não foi possível carregar a foto selecionada.', 'error');
  });
}

function syncCachedAuthorData(updatedUser) {
  if (!updatedUser || !updatedUser.id) return;
  var uid = String(updatedUser.id);
  var nextAuthor = {
    id: uid,
    username: updatedUser.username,
    avatar: updatedUser.avatar || '',
    title: updatedUser.title || 'Membro',
    role: updatedUser.role || 'member'
  };
  if (Array.isArray(serverPersonagens)) {
    serverPersonagens.forEach(function(p) {
      if (p && (String(p.authorId || '') === uid || (p.author && String(p.author.id) === uid))) {
        p.author = Object.assign({}, nextAuthor);
      }
    });
  }
  if (Array.isArray(serverWikiPosts)) {
    serverWikiPosts.forEach(function(w) {
      if (!w) return;
      if (String(w.authorId || '') === uid || (w.author && String(w.author.id) === uid)) {
        w.author = Object.assign({}, nextAuthor);
      }
      if (Array.isArray(w.turns)) {
        w.turns.forEach(function(t) {
          if (t && String(t.authorId || '') === uid) {
            t.authorAvatar = updatedUser.avatar || '';
            t.authorRole = updatedUser.role || t.authorRole;
            t.authorName = updatedUser.username || t.authorName;
          }
        });
      }
    });
  }
  serverWikiPages = null;
  currentWikiArticle = null;
  wikiStaffState = { items: null, article: null, loading: false, error: null };
  wikiProposalState.loaded = false;
  wikiProposalDetail = null;
  serverForumThread = null;
  serverForumPosts = null;
}

function renderPerfil() {
  if (!DB.session) {
    return '<div class="alert alert-info"><span>Você não está logado.</span><div><a class="btn btn-small btn-primary" onclick="showLoginModal()">Entrar</a> <a class="btn btn-small" onclick="navigate(\'registro\')">Cadastrar</a></div></div>';
  }
  var u = DB.session;
  var initialExternalAvatar = (!pendingProfileAvatarUpload && !pendingProfileAvatarCleared && u.avatar && u.avatar.indexOf('https://') === 0)
    ? u.avatar
    : '';
  var previewSrc = pendingProfileAvatarUpload
    ? pendingProfileAvatarUpload
    : (pendingProfileAvatarCleared ? '' : safeAvatarSrc(u.avatar || ''));

  var html = '<div class="breadcrumb">Início / Perfil</div>';
  html += '<div class="cat-header"><span>Perfil de ' + h(u.username) + '</span><button class="btn btn-danger btn-small" onclick="doLogout()">Sair da conta</button></div>';

  html += '<div class="profile-grid">';
  html += '<div class="profile-avatar-card">';
  html += '<div id="prof-avatar-preview-box">' + renderProfileAvatarPreviewMarkup(u.username, previewSrc) + '</div>';
  html += '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">' + h(u.username) + '</div>';
  html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">' + h(u.title || 'Membro') + '</div>';
  html += '<div style="margin-bottom:14px;">' + badgeHtml(u) + '</div>';
  if (u.bio) {
    html += '<div style="font-size:12.5px;color:var(--text-secondary);line-height:1.6;padding:12px 0;border-top:1px solid var(--border-subtle);text-align:left;">' + h(u.bio) + '</div>';
  }
  html += '<div style="font-size:11px;color:var(--text-muted);border-top:1px solid var(--border-subtle);padding-top:12px;margin-top:8px;display:flex;justify-content:space-between;">';
  html += '<span>Posts: <b style="color:var(--text-primary);">' + (u.posts || 0) + '</b></span>';
  html += '<span>Desde: <b style="color:var(--text-primary);">' + h(u.joinDate) + '</b></span>';
  html += '</div>';
  html += '</div>';

  html += '<div>';
  html += '<div class="builder-panel">';
  html += '<div class="builder-panel-title"><span>Editar Identidade &amp; Credenciais</span></div>';
  html += '<div class="form-row"><label>Foto de Perfil</label>';
  html += '<div class="avatar-upload-actions">';
  html += '<label class="btn btn-small" for="prof-avatar-file" style="margin:0;cursor:pointer;">Enviar foto do dispositivo</label>';
  html += '<input type="file" id="prof-avatar-file" class="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" onchange="onProfileAvatarFileChange(this)">';
  html += '<button type="button" class="btn btn-small" onclick="removerFotoPerfil()">Remover foto</button>';
  html += '</div>';
  html += '<div id="prof-avatar-status" class="field-desc" style="margin-top:6px;">' + h(profileAvatarStatusText()) + '</div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
  html += '<div class="form-row"><label>Título Pessoal / Epíteto</label><input type="text" id="prof-title" value="' + ha(u.title || '') + '" placeholder="Ex: Cronista do Vazio"></div>';
  html += '<div class="form-row"><label>Ou URL Externa do Avatar (HTTPS)</label><input type="text" id="prof-avatar" value="' + ha(initialExternalAvatar) + '" placeholder="https://..." oninput="onProfileAvatarUrlInput()"></div>';
  html += '</div>';
  html += '<div class="form-row"><label>Biografia / Assinatura de Perfil</label><textarea id="prof-bio" rows="3" placeholder="Escreva uma breve apresentação ou citação do seu perfil...">' + h(u.bio || '') + '</textarea></div>';
  html += '<div class="form-row"><label>Senha atual (obrigatória para trocar a senha)</label><input type="password" id="prof-current-password" autocomplete="current-password"></div>';
  html += '<div class="form-row"><label>Nova senha (deixe em branco para manter a atual)</label><input type="password" id="prof-password" autocomplete="new-password" placeholder="Nova senha (mín. 6 caracteres)"></div>';
  html += '<button class="btn btn-primary" onclick="salvarEdicaoPerfil()">Salvar Alterações do Perfil</button>';
  html += '</div>';

  html += '</div>';
  html += '</div>';

  return html;
}

function salvarEdicaoPerfil() {
  if (!DB.session) return;
  if (profileAvatarPreparing) {
    showAlert('Aguarde o processamento da imagem antes de salvar.', 'error');
    return;
  }
  var title = ((document.getElementById('prof-title') || {}).value || '').trim();
  var typedAvatar = ((document.getElementById('prof-avatar') || {}).value || '').trim();
  var bio = ((document.getElementById('prof-bio') || {}).value || '').trim();
  var currentPassword = (document.getElementById('prof-current-password') || {}).value || '';
  var newPassword = (document.getElementById('prof-password') || {}).value || '';

  var resolvedAvatar = '';
  if (!pendingProfileAvatarUpload) {
    if (typedAvatar) {
      resolvedAvatar = typedAvatar;
    } else if (!pendingProfileAvatarCleared && DB.session.avatar && DB.session.avatar.indexOf('/api/users/') === 0) {
      resolvedAvatar = DB.session.avatar;
    }
  }

  var payload = {
    title: title || 'Membro',
    avatar: resolvedAvatar,
    bio: bio,
    expectedVersion: DB.session.version
  };
  if (pendingProfileAvatarUpload) {
    payload.avatarUpload = pendingProfileAvatarUpload;
  }
  if (newPassword && newPassword.trim()) {
    payload.currentPassword = currentPassword;
    payload.newPassword = newPassword;
  }

  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('profile-update');
  if (!finish) return;
  apiRequest('PUT', '/api/auth/profile', payload, function(err, data) {
    finish();
    if (err) {
      showAlert(err, 'error');
      return;
    }
    pendingProfileAvatarUpload = null;
    pendingProfileAvatarCleared = false;
    clearResourceFormDraft(descriptor);
    applyServerSession(data.user);
    syncCachedAuthorData(data.user);
    updateTopBar();
    var curPwdEl = document.getElementById('prof-current-password');
    var newPwdEl = document.getElementById('prof-password');
    if (curPwdEl) curPwdEl.value = '';
    if (newPwdEl) newPwdEl.value = '';
    render();
    showAlert('Perfil atualizado com sucesso.', 'success');
  });
}

function renderRegistro() {
  if (DB.session) return '<div class="alert alert-info">Você já está logado.</div>';
  var html = '<div class="breadcrumb">Início / Registro</div>';
  html += '<div class="cat-header"><span>Criar Conta no aetherverse vault</span></div>';
  html += '<div class="builder-panel" style="max-width:440px;">';
  html += '<div class="form-row"><label>Usuário</label><input type="text" id="reg-username" placeholder="Seu nome de usuário"></div>';
  html += '<div class="form-row"><label>Email</label><input type="email" id="reg-email" placeholder="seu@email.com"></div>';
  html += '<div class="form-row"><label>Senha</label><input type="password" id="reg-password" placeholder="Mínimo de 6 caracteres"></div>';
  html += '<div class="form-row"><label>Confirmar Senha</label><input type="password" id="reg-confirm" placeholder="Repita a senha"></div>';
  html += '<button class="btn btn-primary" onclick="submitRegistro()" style="width:100%;">Cadastrar Conta</button>';
  html += '</div>';
  return html;
}

// ==================== TIMELINE (LINHA DO TEMPO) ====================

var serverTimelineEvents = null;
var timelineLoading = false;
var timelineLoadError = null;
var timelineFilterEra = 'all';
var timelineFilterSearch = '';
var timelineFilterChar = 'all';
var timelineEditingId = null;

function carregarTimelineServidor(force) {
  if (timelineLoading || (serverTimelineEvents !== null && !force)) return;
  timelineLoading = true;
  timelineLoadError = null;
  apiRequest('GET', '/api/timeline', undefined, function(err, data) {
    timelineLoading = false;
    if (err) {
      timelineLoadError = (err && err.message) ? err.message : 'Não foi possível carregar a linha do tempo.';
      if (currentPage === 'timeline') render();
      return;
    }
    serverTimelineEvents = Array.isArray(data && data.events) ? data.events : [];
    if (currentPage === 'timeline') render();
  });
}

function setTimelineEra(era) {
  timelineFilterEra = era;
  render();
}

function onTimelineSearch(val) {
  timelineFilterSearch = val;
  render();
  var input = document.getElementById('timeline-search-input');
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function onTimelineCharFilter(char) {
  timelineFilterChar = char;
  render();
}

function getFilteredTimelineEvents() {
  if (!Array.isArray(serverTimelineEvents)) return [];
  var list = serverTimelineEvents.slice();

  if (timelineFilterEra && timelineFilterEra !== 'all') {
    list = list.filter(function(e) { return e.era === timelineFilterEra; });
  }

  if (timelineFilterChar && timelineFilterChar !== 'all') {
    var cLower = timelineFilterChar.toLowerCase();
    list = list.filter(function(e) {
      return (e.characters && e.characters.toLowerCase().indexOf(cLower) !== -1);
    });
  }

  if (timelineFilterSearch) {
    var q = timelineFilterSearch.toLowerCase();
    list = list.filter(function(e) {
      return (e.title && e.title.toLowerCase().indexOf(q) !== -1)
        || (e.summary && e.summary.toLowerCase().indexOf(q) !== -1)
        || (e.storyArc && e.storyArc.toLowerCase().indexOf(q) !== -1)
        || (e.characters && e.characters.toLowerCase().indexOf(q) !== -1)
        || (e.startDate && e.startDate.toLowerCase().indexOf(q) !== -1)
        || (e.tags && e.tags.toLowerCase().indexOf(q) !== -1);
    });
  }

  return list;
}

function renderTimeline() {
  if (serverTimelineEvents === null) {
    if (timelineLoadError) {
      return '<div class="alert alert-error">' + h(timelineLoadError) + ' <button class="btn btn-small" onclick="carregarTimelineServidor(true)">Tentar novamente</button></div>';
    }
    carregarTimelineServidor(false);
    return '<div class="alert alert-info">Carregando cronologia do Eterverso...</div>';
  }

  var allEvents = serverTimelineEvents || [];
  var filtered = getFilteredTimelineEvents();

  var charSet = {};
  allEvents.forEach(function(e) {
    if (e.characters) {
      e.characters.split(',').forEach(function(c) {
        var trimmed = c.trim();
        if (trimmed) charSet[trimmed] = true;
      });
    }
  });
  var allChars = Object.keys(charSet).sort();

  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Wiki</a> / Linha do Tempo</div>';

  html += '<div class="timeline-hero">';
  html += '<div class="timeline-hero-top">';
  html += '<div>';
  html += '<h2>Cronologia de Daare e Eterverso</h2>';
  html += '<p>Registro temporal dos acontecimentos do universo, desde as origens da Casa de Leão e Dragão e o exílio empíreo até o Marco Zero em Daare e as incursões Akáshicas.</p>';
  html += '</div>';
  if (isModOrAdmin()) {
    html += '<button class="btn btn-primary btn-small" onclick="openTimelineModal()">Novo Evento</button>';
  }
  html += '</div>';
  html += '</div>';

  html += '<div class="timeline-controls">';
  html += '<div class="timeline-pills">';
  html += '<button type="button" class="timeline-pill' + (timelineFilterEra === 'all' ? ' active' : '') + '" onclick="setTimelineEra(\'all\')">Todas (' + allEvents.length + ')</button>';
  html += '<button type="button" class="timeline-pill' + (timelineFilterEra === 'Before Daare' ? ' active' : '') + '" onclick="setTimelineEra(\'Before Daare\')">Antes de Daare</button>';
  html += '<button type="button" class="timeline-pill' + (timelineFilterEra === 'Marco Zero' ? ' active' : '') + '" onclick="setTimelineEra(\'Marco Zero\')">Marco Zero</button>';
  html += '<button type="button" class="timeline-pill' + (timelineFilterEra === 'Campanha / Presente' ? ' active' : '') + '" onclick="setTimelineEra(\'Campanha / Presente\')">Campanha</button>';
  html += '</div>';

  html += '<div class="timeline-filters-right">';
  html += '<div class="timeline-search-box">';
  html += '<input type="text" id="timeline-search-input" placeholder="Filtrar eventos..." value="' + ha(timelineFilterSearch) + '" oninput="onTimelineSearch(this.value)">';
  html += '</div>';

  html += '<select class="timeline-character-select" onchange="onTimelineCharFilter(this.value)">';
  html += '<option value="all"' + (timelineFilterChar === 'all' ? ' selected' : '') + '>Todos os personagens</option>';
  allChars.forEach(function(charName) {
    html += '<option value="' + ha(charName) + '"' + (timelineFilterChar === charName ? ' selected' : '') + '>' + h(charName) + '</option>';
  });
  html += '</select>';
  html += '</div>';
  html += '</div>';

  if (filtered.length === 0) {
    html += '<div class="alert alert-info">Nenhum evento corresponde aos filtros selecionados.</div>';
    return html;
  }

  html += '<div class="timeline-wrapper">';
  html += '<div class="timeline-spine"></div>';

  var currentEraHeading = null;

  filtered.forEach(function(e) {
    var isMarcoZero = e.era === 'Marco Zero' || e.internalId === 'EV89';

    if (timelineFilterEra === 'all' && e.era !== currentEraHeading) {
      currentEraHeading = e.era;
      var eraTitle = e.era === 'Before Daare' ? 'Origens, Clãs e Empíreo'
        : (e.era === 'Marco Zero' ? 'Incidente da Fenda em Daare (01/01/1 AD)'
        : 'Trifarix, Ascensão e Incursões');
      html += '<div class="timeline-era-divider"><div class="timeline-era-divider-inner">';
      html += '<span class="timeline-era-badge">' + h(e.era) + '</span>';
      html += '<span class="timeline-era-title">' + eraTitle + '</span>';
      html += '</div></div>';
    }

    var colorClass = 'color-' + (e.color || 'Green');
    var marcoClass = isMarcoZero ? ' marco-zero' : '';

    html += '<div class="timeline-item' + marcoClass + '" id="event-' + ha(e.id) + '">';
    html += '<div class="timeline-node ' + ha(colorClass) + '"></div>';
    html += '<div class="timeline-card">';

    html += '<div class="timeline-card-head">';
    html += '<div class="timeline-meta-bar">';
    html += '<span class="timeline-date-tag">' + h(e.startDate || e.internalId) + '</span>';
    if (e.storyArc) {
      html += '<span class="timeline-arc-tag">Arco: ' + h(e.storyArc) + '</span>';
    }
    if (e.characterGroup) {
      html += '<span class="timeline-group-tag">' + h(e.characterGroup) + '</span>';
    }
    if (e.location) {
      html += '<span class="timeline-loc-tag">Local: ' + h(e.location) + '</span>';
    }
    html += '</div>';

    if (isModOrAdmin()) {
      html += '<div class="timeline-actions">';
      html += '<button class="btn btn-small" onclick="openTimelineModal(\'' + ha(e.id) + '\')">Editar</button>';
      html += '<button class="btn btn-small btn-danger" onclick="excluirTimelineEvento(\'' + ha(e.id) + '\',' + jsArg(e.title) + ')">Excluir</button>';
      html += '</div>';
    }
    html += '</div>';

    html += '<h3>' + h(e.title) + '</h3>';

    if (e.summary) {
      html += '<div class="timeline-card-summary">' + h(e.summary) + '</div>';
    }

    if (e.characters) {
      html += '<div class="timeline-footer">';
      html += '<div class="timeline-chars-list">';
      html += '<span class="timeline-chars-label">Envolvidos:</span>';
      e.characters.split(',').forEach(function(c) {
        var trimmed = c.trim();
        if (trimmed) {
          html += '<span class="timeline-char-chip">' + h(trimmed) + '</span>';
        }
      });
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function openTimelineModal(eventId) {
  if (!isModOrAdmin()) {
    showAlert('Apenas administradores e moderadores podem gerenciar a linha do tempo.', 'error');
    return;
  }
  timelineEditingId = eventId || null;
  var existing = null;
  if (eventId && Array.isArray(serverTimelineEvents)) {
    existing = serverTimelineEvents.find(function(e) { return String(e.id) === String(eventId); });
  }

  var c = document.getElementById('modal-container');
  if (!c) return;

  var title = existing ? existing.title : '';
  var startDate = existing ? existing.startDate : '';
  var endDate = existing ? existing.endDate : '';
  var era = existing ? existing.era : (timelineFilterEra !== 'all' ? timelineFilterEra : 'Before Daare');
  var color = existing ? existing.color : 'Green';
  var storyArc = existing ? existing.storyArc : '';
  var characters = existing ? existing.characters : '';
  var characterGroup = existing ? existing.characterGroup : '';
  var location = existing ? existing.location : '';
  var summary = existing ? existing.summary : '';

  var modalHtml = '<div class="modal-overlay" onclick="if(event.target===this)closeTimelineModal()">';
  modalHtml += '<div class="modal" style="max-width:580px;">';
  modalHtml += '<div class="modal-header">';
  modalHtml += '<span>' + (existing ? 'Editar Evento da Cronologia' : 'Novo Evento na Cronologia') + '</span>';
  modalHtml += '<button type="button" onclick="closeTimelineModal()" style="font-size:13px;padding:2px 6px;">Fechar</button>';
  modalHtml += '</div>';

  modalHtml += '<div class="modal-body">';
  modalHtml += '<div class="form-row"><label>Título do Evento</label><input type="text" id="tm-title" value="' + ha(title) + '" placeholder="Ex: Vincent ascende como Argus da Casa de Dragão"></div>';
  modalHtml += '<div class="form-row" style="display:flex;gap:10px;">';
  modalHtml += '<div style="flex:1;"><label>Data Narrativa</label><input type="text" id="tm-start-date" value="' + ha(startDate) + '" placeholder="Ex: Before Daare 24 ou 1-01-01"></div>';
  modalHtml += '<div style="flex:1;"><label>Data Término (opcional)</label><input type="text" id="tm-end-date" value="' + ha(endDate) + '" placeholder="Ex: Before Daare 24"></div>';
  modalHtml += '</div>';

  modalHtml += '<div class="form-row" style="display:flex;gap:10px;">';
  modalHtml += '<div style="flex:1;"><label>Era Narrativa</label>';
  modalHtml += '<select id="tm-era">';
  modalHtml += '<option value="Before Daare"' + (era === 'Before Daare' ? ' selected' : '') + '>Antes de Daare (BD)</option>';
  modalHtml += '<option value="Marco Zero"' + (era === 'Marco Zero' ? ' selected' : '') + '>Marco Zero (01/01/1 AD)</option>';
  modalHtml += '<option value="Campanha / Presente"' + (era === 'Campanha / Presente' ? ' selected' : '') + '>Campanha / Presente (AD)</option>';
  modalHtml += '</select></div>';

  modalHtml += '<div style="flex:1;"><label>Tom do Marcador</label>';
  modalHtml += '<select id="tm-color">';
  var colors = [
    { id: 'Indigo', label: 'Branco Puro (Destaque Principal)' },
    { id: 'Green', label: 'Prata Claro' },
    { id: 'Purple', label: 'Cinza Médio' },
    { id: 'Teal', label: 'Cinza Neutro' },
    { id: 'Yellow', label: 'Grafite Claro' },
    { id: 'Orange', label: 'Grafite' },
    { id: 'Red', label: 'Contraste Forte' },
    { id: 'Gray', label: 'Discreto' }
  ];
  colors.forEach(function(col) {
    modalHtml += '<option value="' + col.id + '"' + (color === col.id ? ' selected' : '') + '>' + col.label + '</option>';
  });
  modalHtml += '</select></div>';
  modalHtml += '</div>';

  modalHtml += '<div class="form-row"><label>Arco Narrativo</label><input type="text" id="tm-story-arc" value="' + ha(storyArc) + '" placeholder="Ex: Chains of Crown, Empyreal Traveler"></div>';
  modalHtml += '<div class="form-row"><label>Personagens Envolvidos (separados por vírgula)</label><input type="text" id="tm-characters" value="' + ha(characters) + '" placeholder="Ex: Cristopher, Dianne, Vincent"></div>';
  modalHtml += '<div class="form-row" style="display:flex;gap:10px;">';
  modalHtml += '<div style="flex:1;"><label>Facção / Organização</label><input type="text" id="tm-group" value="' + ha(characterGroup) + '" placeholder="Ex: Éden Mortis, Shidou"></div>';
  modalHtml += '<div style="flex:1;"><label>Local</label><input type="text" id="tm-location" value="' + ha(location) + '" placeholder="Ex: Caer Annwn, Daare"></div>';
  modalHtml += '</div>';

  modalHtml += '<div class="form-row"><label>Resumo dos Fatos</label><textarea id="tm-summary" rows="4" placeholder="Descreva os fatos ocorridos neste marco cronológico...">' + h(summary) + '</textarea></div>';

  modalHtml += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">';
  modalHtml += '<button type="button" class="btn btn-small" onclick="closeTimelineModal()">Cancelar</button>';
  modalHtml += '<button type="button" class="btn btn-primary btn-small" onclick="salvarTimelineModal()">' + (existing ? 'Salvar Alterações' : 'Criar Evento') + '</button>';
  modalHtml += '</div>';

  modalHtml += '</div>';
  modalHtml += '</div>';
  modalHtml += '</div>';

  c.innerHTML = modalHtml;
}

function closeTimelineModal() {
  timelineEditingId = null;
  var c = document.getElementById('modal-container');
  if (c) c.innerHTML = '';
}

function salvarTimelineModal() {
  var titleEl = document.getElementById('tm-title');
  var dateEl = document.getElementById('tm-start-date');
  var endDateEl = document.getElementById('tm-end-date');
  var eraEl = document.getElementById('tm-era');
  var colorEl = document.getElementById('tm-color');
  var arcEl = document.getElementById('tm-story-arc');
  var charsEl = document.getElementById('tm-characters');
  var groupEl = document.getElementById('tm-group');
  var locEl = document.getElementById('tm-location');
  var sumEl = document.getElementById('tm-summary');

  if (!titleEl || !titleEl.value.trim()) {
    showAlert('Informe o título do evento.', 'error');
    if (titleEl) titleEl.focus();
    return;
  }
  if (!dateEl || !dateEl.value.trim()) {
    showAlert('Informe a data narrativa do evento.', 'error');
    if (dateEl) dateEl.focus();
    return;
  }

  var payload = {
    title: titleEl.value.trim(),
    startDate: dateEl.value.trim(),
    endDate: endDateEl ? endDateEl.value.trim() : '',
    era: eraEl ? eraEl.value : 'Before Daare',
    color: colorEl ? colorEl.value : 'Green',
    storyArc: arcEl ? arcEl.value.trim() : '',
    characters: charsEl ? charsEl.value.trim() : '',
    characterGroup: groupEl ? groupEl.value.trim() : '',
    location: locEl ? locEl.value.trim() : '',
    summary: sumEl ? sumEl.value.trim() : ''
  };

  var method = timelineEditingId ? 'PUT' : 'POST';
  var endpoint = timelineEditingId ? ('/api/timeline/' + encodeURIComponent(timelineEditingId)) : '/api/timeline';

  apiRequest(method, endpoint, payload, function(err, data) {
    if (err) {
      showAlert(err.message || 'Falha ao salvar evento na linha do tempo.', 'error');
      return;
    }
    closeTimelineModal();
    showAlert('Evento salvo com sucesso na cronologia!', 'success');
    carregarTimelineServidor(true);
  });
}

function excluirTimelineEvento(id, title) {
  if (!isModOrAdmin()) {
    showAlert('Apenas moderadores e administradores podem excluir eventos.', 'error');
    return;
  }
  if (!confirm('Deseja realmente remover o evento "' + (title || id) + '" da linha do tempo?')) return;

  apiRequest('DELETE', '/api/timeline/' + encodeURIComponent(id), {}, function(err) {
    if (err) {
      showAlert(err.message || 'Falha ao excluir evento da cronologia.', 'error');
      return;
    }
    showAlert('Evento removido da cronologia.', 'success');
    if (Array.isArray(serverTimelineEvents)) {
      serverTimelineEvents = serverTimelineEvents.filter(function(e) { return String(e.id) !== String(id); });
    }
    render();
  });
}

function renderSobre() {
  var html = '<div class="breadcrumb">Início / Sobre</div>';
  html += '<div class="cat-header"><span>Sobre o Projeto</span></div>';
  html += '<div class="char-sheet-body" style="margin-bottom:24px;">';
  html += '<p><b>aetherverse vault</b> é um fórum e wikia interativa para postar histórias, criar fichas de personagem, registrar cenas customizadas e desenvolver roleplay. Tudo fica guardado em banco de dados próprio do projeto.</p>';
  html += '<p>O aetherverse vault constitui um universo ficcional de Roleplay (RPG) de autoria original, cujos personagens, enredos, ambientações e demais elementos narrativos são de criação e titularidade exclusiva de seus idealizadores e mantenedores. Eventuais imagens de referência utilizadas nas fichas de personagens — sejam elas extraídas de wikis, bancos de imagem ou outras fontes externas — são empregadas estritamente como recurso ilustrativo e de caráter não-comercial, sob amparo dos princípios de uso justo e de citação para fins de caracterização ficcional, não configurando, em nenhuma hipótese, apropriação de autoria sobre a obra literária em si, a qual permanece integralmente resguardada por direito autoral em favor de seus criadores.</p>';
  html += '<p style="margin-bottom:0;">Está nos planos do projeto, a médio e longo prazo, expandir o aetherverse vault para além deste fórum: a proposta é transformá-lo em uma plataforma aberta a todos os rpgistas textuais que desejem narrar histórias dentro deste universo, além de dar origem, futuramente, a uma série de livros baseada no material produzido pela comunidade e pelos criadores originais.</p>';
  html += '</div>';

  html += '<div class="cat-header"><span>Equipe Atual</span></div>';
  html += '<div class="char-grid">';
  DB.equipe.forEach(function(m) {
    html += '<div class="char-card team-card" style="cursor:default;">';
    html += '<div class="char-card-info"><h4>' + h(m.nome) + '</h4><p>' + h(m.cargo) + '</p></div>';
    html += '</div>';
  });
  html += '</div>';

  return html;
}

function renderAdmin() {
  if (!isAdmin()) return '<div class="alert alert-error">Acesso negado.</div>';
  if (!adminWikiTransferState.pagesLoaded && !adminWikiTransferState.pagesLoading) loadAdminWikiTransferPages(false);
  if (!adminState.loaded && !adminState.loading) loadAdminData(false);
  if (adminState.loading && !adminState.loaded) return '<div class="breadcrumb">Início / Painel Admin</div><div class="alert alert-info">Carregando dados administrativos do servidor…</div>';
  if (adminState.error && !adminState.loaded) {
    return '<div class="breadcrumb">Início / Painel Admin</div><div class="alert alert-error">' + h(adminState.error) + '</div><button class="btn" onclick="loadAdminData(true)">Tentar novamente</button>';
  }

  var html = '<div class="breadcrumb">Início / Painel Admin</div>';
  html += '<div class="cat-header"><span>Contas</span><button class="btn btn-small" onclick="loadAdminData(true)">Atualizar</button></div>';
  if (adminState.error) html += '<div class="alert alert-error">' + h(adminState.error) + '</div>';
  html += '<div style="overflow-x:auto"><table class="forum-table"><thead><tr><th>Usuário</th><th>Email</th><th>Cargo</th><th>Estado</th><th>Versão</th><th>Ações</th></tr></thead><tbody>';
  adminState.users.forEach(function(user) {
    var id = String(user.id);
    html += '<tr><td><b>' + h(user.username) + '</b></td><td>' + h(user.email) + '</td><td>' + roleBadgeFromRole(user.role) + '</td>';
    html += '<td>' + (user.disabledAt ? 'Desativada' : 'Ativa') + '</td><td>' + user.version + '</td><td style="min-width:270px;">';
    html += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><select id="admin-role-' + ha(id) + '" style="width:auto;">';
    html += '<option value="member"' + (user.role === 'member' ? ' selected' : '') + '>Membro</option>';
    html += '<option value="moderador"' + (user.role === 'moderador' ? ' selected' : '') + '>Moderador</option>';
    html += '<option value="admin"' + (user.role === 'admin' ? ' selected' : '') + '>Admin</option></select>';
    html += '<button class="btn btn-small" onclick="changeAdminUserRole(' + jsArg(id) + ',' + user.version + ')">Salvar cargo</button>';
    html += '<button class="btn btn-small ' + (user.disabledAt ? 'btn-primary' : 'btn-danger') + '" onclick="changeAdminUserAccess(' + jsArg(id) + ',' + user.version + ',' + (user.disabledAt ? 'false' : 'true') + ')">' + (user.disabledAt ? 'Reativar' : 'Desativar') + '</button></div></td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin:10px 0 22px;">';
  html += '<button class="btn btn-small" onclick="changeAdminUserPage(-1)"' + (adminState.userPage.offset === 0 ? ' disabled' : '') + '>Anterior</button>';
  html += '<span style="align-self:center;font-size:12px;color:var(--text-muted);">' + (adminState.userPage.offset + 1) + '–' + (adminState.userPage.offset + adminState.users.length) + '</span>';
  html += '<button class="btn btn-small" onclick="changeAdminUserPage(1)"' + (!adminState.userPage.hasMore ? ' disabled' : '') + '>Próxima</button></div>';

  html += '<div class="cat-header"><span>Categorias do fórum</span></div>';
  html += '<div style="overflow-x:auto"><table class="forum-table"><thead><tr><th>Nome</th><th>Descrição</th><th>Estado</th><th>Ações</th></tr></thead><tbody>';
  adminState.categories.forEach(function(category) {
    html += '<tr><td><b>' + h(category.name) + '</b></td><td>' + h(category.description || '') + '</td><td>' + (category.archivedAt ? 'Arquivada' : 'Ativa') + '</td><td style="min-width:230px;">';
    html += '<button class="btn btn-small" onclick="editAdminCategory(' + jsArg(category.id) + ')">Editar</button> ';
    html += '<button class="btn btn-small ' + (category.archivedAt ? 'btn-primary' : 'btn-danger') + '" onclick="changeAdminCategoryArchive(' + jsArg(category.id) + ',' + category.version + ',' + (category.archivedAt ? 'false' : 'true') + ')">' + (category.archivedAt ? 'Restaurar' : 'Arquivar') + '</button></td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="builder-panel"><div class="builder-panel-title"><span>Nova categoria</span></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end;">';
  html += '<div class="form-row"><label>Nome</label><input id="admin-category-name" maxlength="100"></div>';
  html += '<div class="form-row"><label>Descrição</label><input id="admin-category-description" maxlength="1000"></div>';
  html += '<div class="form-row"><label>Motivo administrativo</label><input id="admin-category-reason" maxlength="1000"></div>';
  html += '</div><button class="btn btn-primary" onclick="createAdminCategory()">Criar categoria</button></div>';

  html += renderAdminWikiTransfers();

  html += '<div class="cat-header"><span>Auditoria recente</span></div>';
  html += '<div style="overflow-x:auto"><table class="forum-table"><thead><tr><th>Data</th><th>Operador</th><th>Ação</th><th>Alvo</th><th>Motivo</th></tr></thead><tbody>';
  adminState.events.forEach(function(event) {
    html += '<tr><td>' + h(formatForumTimestamp(event.createdAt)) + '</td><td>' + h(event.actorLabel || event.actorId || 'Operador') + '</td><td>' + h(event.action) + '</td><td>' + h(event.targetType) + (event.targetId ? ' · ' + h(event.targetId) : '') + '</td><td>' + h(event.reason) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function renderAdminWikiTransfers() {
  var state = adminWikiTransferState;
  var html = '<section class="builder-panel admin-wiki-transfers" id="admin-wiki-transfers" aria-labelledby="admin-wiki-transfers-title">';
  html += '<div class="builder-panel-title"><h2 id="admin-wiki-transfers-title">Transferência da wiki</h2></div>';
  html += '<p class="field-desc">Exporte revisões atuais da wiki ou analise um pacote portátil antes de importar. A importação não publica artigos.</p>';
  html += '<div class="admin-wiki-transfer-grid">';

  html += '<section class="wiki-transfer-panel" aria-labelledby="wiki-transfer-export-title">';
  html += '<h3 id="wiki-transfer-export-title">Exportar páginas</h3>';
  html += '<p class="field-desc">Cada página selecionada será exportada a partir da revisão atual.</p>';
  if (state.pagesLoading && !state.pagesLoaded) {
    html += '<p class="alert alert-info" role="status">Carregando páginas da wiki…</p>';
  } else if (state.pagesError) {
    html += '<p class="alert alert-error" role="alert">' + h(state.pagesError) + '</p>';
    html += '<button type="button" class="btn btn-small" onclick="loadAdminWikiTransferPages(true)">Tentar novamente</button>';
  } else if (!state.pages.length) {
    html += '<p class="field-desc">Nenhuma página disponível para exportação.</p>';
  } else {
    html += '<div class="wiki-transfer-selection-actions">';
    html += '<button type="button" class="btn btn-small" onclick="setAdminWikiTransferExportSelection(true)"' + (state.exportPending ? ' disabled' : '') + '>Selecionar todas</button>';
    html += '<button type="button" class="btn btn-small" onclick="setAdminWikiTransferExportSelection(false)"' + (state.exportPending ? ' disabled' : '') + '>Limpar seleção</button>';
    html += '<span id="wiki-transfer-export-selection-count" aria-live="polite">' + state.exportPageIds.length + ' selecionada(s)</span></div>';
    html += '<fieldset class="wiki-transfer-page-list" id="wiki-transfer-export-pages"><legend class="sr-only">Páginas da wiki para exportação</legend>';
    state.pages.forEach(function(page) {
      var id = String(page.id || '');
      if (!id) return;
      var snapshot = page.head && page.head.snapshot ? page.head.snapshot : null;
      var title = snapshot && snapshot.title || page.title || page.slug || 'Página sem título';
      var sequence = page.head && page.head.sequence;
      var detail = 'Revisão atual' + (Number.isInteger(sequence) ? ' #' + sequence : '');
      if (page.archivedAt) detail += ' · arquivada';
      else if (page.publishedRevisionId) detail += ' · ' + (page.accessLevel === 'public' ? 'publicada' : 'restrita');
      else detail += ' · ainda não publicada';
      var checked = state.exportPageIds.indexOf(id) !== -1 ? ' checked' : '';
      html += '<label class="wiki-transfer-page" for="wiki-transfer-export-' + ha(id) + '">';
      html += '<input type="checkbox" id="wiki-transfer-export-' + ha(id) + '" class="wiki-transfer-export-choice" value="' + ha(id) + '" onchange="setAdminWikiTransferExportPage(' + jsArg(id) + ',this.checked)"' + checked + (state.exportPending ? ' disabled' : '') + '>';
      html += '<span class="wiki-transfer-page-copy"><strong>' + h(title) + '</strong><span>' + h(detail) + '</span>';
      if (page.headRevisionId || (page.head && page.head.id)) html += '<code>' + h(page.headRevisionId || page.head.id) + '</code>';
      html += '</span></label>';
    });
    html += '</fieldset>';
  }
  if (state.exportError) html += '<p class="alert alert-error" role="alert">' + h(state.exportError) + '</p>';
  if (state.exportMessage) html += '<p class="alert alert-info" role="status">' + h(state.exportMessage) + '</p>';
  html += '<button type="button" class="btn btn-primary" id="wiki-transfer-export-button" onclick="exportAdminWikiBundle()"' + (state.exportPending || !state.exportPageIds.length || !state.pagesLoaded ? ' disabled' : '') + '>';
  html += state.exportPending ? 'Preparando exportação…' : 'Baixar pacote JSON';
  html += '</button></section>';

  html += '<section class="wiki-transfer-panel" aria-labelledby="wiki-transfer-import-title">';
  html += '<h3 id="wiki-transfer-import-title">Importar pacote</h3>';
  html += '<p class="field-desc">Escolha um arquivo JSON para gerar uma prévia com páginas, fontes, hashes e conflitos.</p>';
  html += '<div class="form-row"><label for="wiki-transfer-file">Pacote JSON</label>';
  html += '<input type="file" id="wiki-transfer-file" accept="application/json,.json" onchange="readAdminWikiTransferFile(this.files && this.files[0])">';
  html += '</div>';
  if (state.fileName) html += '<p class="wiki-transfer-file-name" aria-live="polite">Arquivo selecionado: ' + h(state.fileName) + '</p>';
  if (state.importError) html += '<p class="alert alert-error" role="alert">' + h(state.importError) + '</p>';
  html += '<div class="wiki-transfer-actions">';
  html += '<button type="button" class="btn btn-primary" id="wiki-transfer-upload-button" onclick="startAdminWikiTransferImport()"' + (state.importPending || !state.bundle ? ' disabled' : '') + '>';
  html += state.importPending ? 'Analisando pacote…' : 'Enviar e analisar';
  html += '</button>';
  if (state.importId) html += '<button type="button" class="btn btn-small" onclick="refreshAdminWikiTransferPreview()"' + (state.refreshPending || state.commitPending ? ' disabled' : '') + '>Atualizar prévia</button>';
  if (state.importId || state.bundle) html += '<button type="button" class="btn btn-small" onclick="clearAdminWikiTransferImport()"' + (state.importPending || state.commitPending ? ' disabled' : '') + '>Descartar pacote</button>';
  html += '</div>';
  if (state.importPreview) html += renderAdminWikiTransferPreview();
  html += '</section></div></section>';
  return html;
}

function renderAdminWikiTransferPreview() {
  var state = adminWikiTransferState;
  var preview = state.importPreview || {};
  var pages = Array.isArray(preview.pages) ? preview.pages : [];
  var sources = Array.isArray(preview.sources) ? preview.sources : [];
  var sourceMap = adminWikiTransferSourceMap(preview);
  var selectedIds = state.importPageIds;
  var html = '<div class="wiki-transfer-preview" id="wiki-transfer-preview">';
  html += '<h4>Prévia da importação</h4>';
  html += '<dl class="wiki-transfer-metadata">';
  html += '<div><dt>Pacote de origem</dt><dd>' + h(preview.bundleId || 'Não informado') + '</dd></div>';
  html += '<div><dt>Importação</dt><dd>' + h(state.importId || 'Não informada') + (preview.status ? ' · ' + h(adminWikiTransferActionLabel(String(preview.status).toLowerCase())) : '') + '</dd></div>';
  html += '<div><dt>Versão da prévia</dt><dd>' + h(state.importVersion === null ? (preview.planVersion || 'Não informada') : state.importVersion) + '</dd></div>';
  html += '<div><dt>Hash do plano</dt><dd><code>' + h(state.importPlanHash || preview.planHash || 'Não informado') + '</code></dd></div>';
  html += '</dl>';
  html += '<div class="wiki-transfer-count-grid"><div><strong>Páginas</strong><span>' + h(adminWikiTransferCounts(preview.pageCounts, pages)) + '</span></div>';
  html += '<div><strong>Fontes</strong><span>' + h(adminWikiTransferCounts(preview.sourceCounts, sources)) + '</span></div></div>';

  html += '<div class="wiki-transfer-preview-block"><h5>Páginas do pacote</h5>';
  if (!pages.length) html += '<p class="field-desc">A prévia não contém páginas.</p>';
  else {
    html += '<fieldset class="wiki-transfer-page-list"><legend class="sr-only">Páginas que podem ser incluídas na importação</legend>';
    pages.forEach(function(page) {
      var pageId = adminWikiTransferPageId(page);
      var action = adminWikiTransferAction(page.action || page.status);
      var disabledReason = adminWikiTransferPageDisabledReason(page, sourceMap);
      var disabled = disabledReason || state.commitPending || state.commitMessage ? ' disabled' : '';
      var checked = selectedIds.indexOf(pageId) !== -1 ? ' checked' : '';
      html += '<label class="wiki-transfer-page' + (disabledReason ? ' is-disabled' : '') + '" for="wiki-transfer-import-' + ha(pageId) + '">';
      html += '<input type="checkbox" class="wiki-transfer-page-choice" id="wiki-transfer-import-' + ha(pageId) + '" value="' + ha(pageId) + '" onchange="setAdminWikiTransferImportPage(' + jsArg(pageId) + ',this.checked)"' + checked + disabled + '>';
      html += '<span class="wiki-transfer-page-copy"><strong>' + h(page.title || page.slug || pageId || 'Página sem título') + '</strong>';
      html += '<span>' + h(page.slug || 'Sem slug') + ' · ' + h(adminWikiTransferActionLabel(action)) + '</span>';
      if (page.sourceRevisionId) html += '<code>Revisão de origem: ' + h(page.sourceRevisionId) + '</code>';
      if (page.targetPageId) html += '<code>Destino: ' + h(page.targetPageId) + '</code>';
      if (page.reason || disabledReason) html += '<span class="wiki-transfer-reason">' + h(page.reason || disabledReason) + '</span>';
      html += '</span></label>';
    });
    html += '</fieldset>';
    html += '<div class="wiki-transfer-selection-actions">';
    html += '<button type="button" class="btn btn-small" onclick="setAdminWikiTransferImportSelection(true)"' + (state.commitPending || state.commitMessage || !adminWikiTransferSelectablePages(preview).length ? ' disabled' : '') + '>Selecionar páginas sem conflito</button>';
    html += '<button type="button" class="btn btn-small" onclick="setAdminWikiTransferImportSelection(false)"' + (state.commitPending || state.commitMessage ? ' disabled' : '') + '>Limpar seleção</button>';
    html += '<span id="wiki-transfer-import-selection-count" aria-live="polite">' + selectedIds.length + ' selecionada(s)</span></div>';
  }
  html += '</div>';

  html += '<div class="wiki-transfer-preview-block"><h5>Fontes e proveniência</h5>';
  if (!sources.length) html += '<p class="field-desc">Nenhuma fonte incluída nesta prévia.</p>';
  else {
    html += '<div class="wiki-transfer-table-wrap"><table class="wiki-transfer-table"><thead><tr><th>Arquivo / fonte</th><th>Hash do arquivo</th><th>Estado</th></tr></thead><tbody>';
    sources.forEach(function(source) {
      var action = adminWikiTransferAction(source.action || source.status);
      var label = [source.relativePath, source.sourceSourceId].filter(Boolean).join(' · ') || 'Fonte sem identificador';
      html += '<tr><td><strong>' + h(label) + '</strong>';
      if (source.sourceSourceId) html += '<code>Origem: ' + h(source.sourceSourceId) + '</code>';
      if (source.archiveSha256) html += '<code>Arquivo: ' + h(source.archiveSha256) + '</code>';
      if (source.reason) html += '<span class="wiki-transfer-reason">' + h(source.reason) + '</span>';
      html += '</td><td><code>' + h(source.sha256 || 'Não informado') + '</code></td>';
      html += '<td><span class="wiki-transfer-status wiki-transfer-status-' + ha(action) + '">' + h(adminWikiTransferActionLabel(action)) + '</span></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  var conflicts = Array.isArray(preview.conflicts) ? preview.conflicts : [];
  var validationErrors = Array.isArray(preview.validationErrors) ? preview.validationErrors : [];
  if (conflicts.length || validationErrors.length) {
    html += '<div class="wiki-transfer-preview-block wiki-transfer-attention"><h5>Conflitos e validações</h5><ul>';
    conflicts.forEach(function(item) { html += '<li>' + h(adminWikiTransferIssueText(item)) + '</li>'; });
    validationErrors.forEach(function(item) { html += '<li>' + h(adminWikiTransferIssueText(item)) + '</li>'; });
    html += '</ul></div>';
  }

  if (state.commitError) html += '<p class="alert alert-error" role="alert">' + h(state.commitError) + '</p>';
  if (state.commitMessage) html += '<p class="alert alert-info" role="status">' + h(state.commitMessage) + '</p>';
  if (state.commitReport) html += '<details class="wiki-transfer-result"><summary>Resultado da importação</summary><pre>' + h(JSON.stringify(state.commitReport, null, 2)) + '</pre></details>';
  html += '<div class="wiki-transfer-confirm">';
  html += '<label><input type="checkbox" id="wiki-transfer-confirm" onchange="setAdminWikiTransferConfirmation(this.checked)"' + (state.importConfirmed ? ' checked' : '') + (state.commitPending || !!state.commitMessage ? ' disabled' : '') + '>';
  html += '<span>Confirmo a importação das páginas selecionadas no destino. A publicação continua sendo uma ação editorial separada.</span></label>';
  html += '<button type="button" class="btn btn-primary" id="wiki-transfer-commit-button" onclick="commitAdminWikiTransferImport()"' + (state.commitPending || !!state.commitMessage || !state.importConfirmed || !selectedIds.length || !state.importId || !state.importPlanHash || state.importVersion === null ? ' disabled' : '') + '>';
  html += state.commitPending ? 'Importando…' : 'Confirmar importação';
  html += '</button></div>';
  html += '</div>';
  return html;
}

function adminWikiTransferSourceMap(preview) {
  var sourceMap = Object.create(null);
  (Array.isArray(preview.sources) ? preview.sources : []).forEach(function(source) {
    var id = String(source.sourceSourceId || source.id || '');
    if (id) sourceMap[id] = source;
  });
  return sourceMap;
}

function adminWikiTransferPageId(page) {
  return String(page && (page.sourcePageId || page.id) || '');
}

function adminWikiTransferAction(value) {
  return String(value || 'invalid').toLowerCase();
}

function adminWikiTransferActionLabel(action) {
  var labels = {
    total: 'Total',
    create: 'Será criada',
    reuse: 'Será reutilizada',
    already_imported: 'Já importada',
    conflict: 'Conflito',
    invalid: 'Inválida',
    ready: 'Pronta',
    staged: 'Em análise',
    committed: 'Concluída',
  };
  return labels[action] || action || 'Sem estado';
}

function adminWikiTransferPageDisabledReason(page, sourceMap) {
  var action = adminWikiTransferAction(page.action || page.status);
  if (action === 'conflict') return page.reason || 'Este item tem um conflito e não pode ser sobrescrito.';
  if (action === 'invalid') return page.reason || 'Este item não passou pela validação.';
  if (action !== 'create' && action !== 'reuse') return page.reason || 'Este item não pode ser incluído nesta importação.';
  var required = Array.isArray(page.requiredSourceIds) ? page.requiredSourceIds : [];
  for (var index = 0; index < required.length; index++) {
    var source = sourceMap[String(required[index])];
    if (!source) return 'Uma fonte necessária não está disponível na prévia.';
    var sourceAction = adminWikiTransferAction(source.action || source.status);
    if (sourceAction === 'conflict') return source.reason || 'Uma fonte necessária tem conflito e não pode ser sobrescrita.';
    if (sourceAction === 'invalid') return source.reason || 'Uma fonte necessária não passou pela validação.';
  }
  return '';
}

function adminWikiTransferSelectablePages(preview) {
  var sourceMap = adminWikiTransferSourceMap(preview || {});
  return (Array.isArray(preview && preview.pages) ? preview.pages : []).filter(function(page) {
    return !adminWikiTransferPageDisabledReason(page, sourceMap);
  });
}

function adminWikiTransferCounts(counts, items) {
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    var keys = Object.keys(counts);
    if (keys.length) return keys.map(function(key) { return adminWikiTransferActionLabel(key) + ': ' + Number(counts[key] || 0); }).join(' · ');
  }
  var total = Array.isArray(items) ? items.length : 0;
  return total + (total === 1 ? ' item' : ' itens');
}

function adminWikiTransferIssueText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item || 'Item com conflito.');
  var parts = [item.title || item.slug || item.relativePath || item.sourcePageId || item.sourceSourceId || item.id, item.reason || item.message || item.code];
  return parts.filter(Boolean).join(' · ') || JSON.stringify(item);
}

function loadAdminWikiTransferPages(force) {
  var state = adminWikiTransferState;
  if (!isAdmin() || state.pagesLoading || (state.pagesLoaded && !force)) return;
  state.pagesLoading = true;
  state.pagesError = null;
  var offset = 0;
  var pages = [];
  function loadPage() {
    return apiRequest('GET', '/api/staff/wiki/pages?limit=100&offset=' + offset + '&includeArchived=true').then(function(response) {
      if (!response || !Array.isArray(response.data)) throw new Error('A resposta das páginas da wiki é inválida.');
      pages = pages.concat(response.data);
      var page = response.page || {};
      if (!page.hasMore) return pages;
      offset = Number(page.offset || offset) + Number(page.limit || 100);
      return loadPage();
    });
  }
  loadPage().then(function(items) {
    if (!isAdmin()) return;
    state.pages = items;
    state.pagesLoaded = true;
    var pageIds = new Set(items.map(function(page) { return String(page.id); }));
    state.exportPageIds = state.exportPageIds.filter(function(id) { return pageIds.has(id); });
  }).catch(function(error) {
    if (isAdmin()) state.pagesError = error && error.message ? error.message : 'Não foi possível carregar as páginas da wiki.';
  }).finally(function() {
    state.pagesLoading = false;
    if (currentPage === 'admin' && isAdmin()) render();
  });
}

function setAdminWikiTransferExportPage(pageId, selected) {
  if (!isAdmin()) return;
  var id = String(pageId || '');
  if (!adminWikiTransferState.pages.some(function(page) { return String(page.id) === id; })) return;
  var ids = adminWikiTransferState.exportPageIds.filter(function(value) { return value !== id; });
  if (selected) ids.push(id);
  adminWikiTransferState.exportPageIds = ids;
  syncAdminWikiTransferSelectionUi();
}

function setAdminWikiTransferExportSelection(selected) {
  if (!isAdmin()) return;
  adminWikiTransferState.exportPageIds = selected
    ? adminWikiTransferState.pages.map(function(page) { return String(page.id); }).filter(Boolean)
    : [];
  syncAdminWikiTransferSelectionUi();
}

function setAdminWikiTransferImportPage(pageId, selected) {
  if (!isAdmin()) return;
  var state = adminWikiTransferState;
  var id = String(pageId || '');
  if (!adminWikiTransferSelectablePages(state.importPreview).some(function(page) { return adminWikiTransferPageId(page) === id; })) return;
  var ids = state.importPageIds.filter(function(value) { return value !== id; });
  if (selected) ids.push(id);
  state.importPageIds = ids;
  syncAdminWikiTransferSelectionUi();
}

function setAdminWikiTransferImportSelection(selected) {
  if (!isAdmin()) return;
  var state = adminWikiTransferState;
  state.importPageIds = selected
    ? adminWikiTransferSelectablePages(state.importPreview).map(adminWikiTransferPageId).filter(Boolean)
    : [];
  syncAdminWikiTransferSelectionUi();
}

function setAdminWikiTransferConfirmation(confirmed) {
  if (!isAdmin()) return;
  adminWikiTransferState.importConfirmed = !!confirmed;
  syncAdminWikiTransferSelectionUi();
}

function syncAdminWikiTransferSelectionUi() {
  var state = adminWikiTransferState;
  var exportButton = document.getElementById('wiki-transfer-export-button');
  if (exportButton) exportButton.disabled = !!(state.exportPending || !state.exportPageIds.length || !state.pagesLoaded);
  var exportCount = document.getElementById('wiki-transfer-export-selection-count');
  if (exportCount) exportCount.textContent = state.exportPageIds.length + ' selecionada(s)';
  document.querySelectorAll('.wiki-transfer-export-choice').forEach(function(input) {
    input.checked = state.exportPageIds.indexOf(input.value) !== -1;
  });
  var importCount = document.getElementById('wiki-transfer-import-selection-count');
  if (importCount) importCount.textContent = state.importPageIds.length + ' selecionada(s)';
  document.querySelectorAll('.wiki-transfer-page-choice').forEach(function(input) {
    input.checked = state.importPageIds.indexOf(input.value) !== -1;
  });
  var commitButton = document.getElementById('wiki-transfer-commit-button');
  if (commitButton) commitButton.disabled = !!(state.commitPending || state.commitMessage || !state.importConfirmed
    || !state.importPageIds.length || !state.importId || !state.importPlanHash || state.importVersion === null);
}

function exportAdminWikiBundle() {
  var state = adminWikiTransferState;
  if (!isAdmin() || state.exportPending || !state.exportPageIds.length) return Promise.resolve();
  state.exportPending = true;
  state.exportError = null;
  state.exportMessage = null;
  render();
  return apiRequest('POST', '/api/admin/wiki-transfers/export', { pageIds: state.exportPageIds.slice() }).then(function(response) {
    if (!isAdmin()) return;
    var bundle = response && response.bundle ? response.bundle : (response && response.data ? response.data : response);
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('O servidor retornou um pacote inválido.');
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'aetherverse-wiki-' + new Date().toISOString().slice(0, 10) + '.json';
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function() { window.URL.revokeObjectURL(url); }, 1000);
    state.exportMessage = 'Pacote JSON baixado com as revisões atuais das páginas selecionadas.';
  }).catch(function(error) {
    if (isAdmin()) state.exportError = error && error.message ? error.message : 'Não foi possível exportar as páginas selecionadas.';
  }).finally(function() {
    state.exportPending = false;
    if (currentPage === 'admin' && isAdmin()) render();
  });
}

function readAdminWikiTransferFile(file) {
  var state = adminWikiTransferState;
  if (!isAdmin()) return Promise.resolve();
  state.fileName = file && file.name ? file.name : '';
  state.bundle = null;
  state.importError = null;
  state.importId = null;
  state.importVersion = null;
  state.importPlanHash = null;
  state.importPreview = null;
  state.importPageIds = [];
  state.importConfirmed = false;
  state.commitError = null;
  state.commitMessage = null;
  state.commitReport = null;
  if (!file) { render(); return Promise.resolve(); }
  var readFile = typeof file.text === 'function'
    ? file.text()
    : new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(String(reader.result || '')); };
      reader.onerror = function() { reject(new Error('Não foi possível ler o arquivo selecionado.')); };
      reader.readAsText(file);
    });
  return Promise.resolve(readFile).then(function(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('O arquivo deve conter um objeto JSON de pacote.');
    state.bundle = parsed;
  }).catch(function(error) {
    state.fileName = '';
    state.importError = error && error.message ? error.message : 'Não foi possível ler o pacote JSON.';
  }).finally(function() {
    if (currentPage === 'admin' && isAdmin()) render();
  });
}

function applyAdminWikiTransferPreview(response, preserveSelection) {
  var state = adminWikiTransferState;
  var result = response && response.data && typeof response.data === 'object' ? response.data : (response || {});
  var preview = result.preview && typeof result.preview === 'object' ? result.preview
    : (result.report && typeof result.report === 'object' ? result.report : result);
  var id = result.id || result.importId || state.importId;
  var version = Number.isInteger(result.version) ? result.version
    : (Number.isInteger(preview.planVersion) ? preview.planVersion : null);
  var planHash = result.planHash || preview.planHash || null;
  if (!id || !preview || typeof preview !== 'object') throw new Error('A prévia retornada pelo servidor está incompleta.');
  var previous = preserveSelection ? new Set(state.importPageIds) : null;
  state.importId = String(id);
  state.importVersion = version;
  state.importPlanHash = typeof planHash === 'string' ? planHash : null;
  state.importPreview = preview;
  var selectable = adminWikiTransferSelectablePages(preview).map(adminWikiTransferPageId).filter(Boolean);
  state.importPageIds = previous
    ? selectable.filter(function(pageId) { return previous.has(pageId); })
    : selectable;
  state.importConfirmed = false;
  state.commitError = null;
  state.commitMessage = null;
  state.commitReport = null;
}

function startAdminWikiTransferImport() {
  var state = adminWikiTransferState;
  if (!isAdmin() || state.importPending || !state.bundle) return Promise.resolve();
  state.importPending = true;
  state.importError = null;
  state.commitError = null;
  render();
  return apiRequest('POST', '/api/admin/wiki-transfers/imports', { bundle: state.bundle }).then(function(response) {
    if (!isAdmin()) return;
    applyAdminWikiTransferPreview(response, false);
  }).catch(function(error) {
    if (isAdmin()) state.importError = error && error.message ? error.message : 'Não foi possível analisar o pacote.';
  }).finally(function() {
    state.importPending = false;
    if (currentPage === 'admin' && isAdmin()) render();
  });
}

function refreshAdminWikiTransferPreview() {
  var state = adminWikiTransferState;
  if (!isAdmin() || !state.importId || state.refreshPending || state.commitPending) return Promise.resolve();
  state.refreshPending = true;
  state.commitError = null;
  state.commitMessage = null;
  state.commitReport = null;
  render();
  return apiRequest('POST', '/api/admin/wiki-transfers/imports/' + encodeURIComponent(state.importId) + '/refresh', {}).then(function(response) {
    if (!isAdmin()) return;
    applyAdminWikiTransferPreview(response, true);
  }).catch(function(error) {
    if (isAdmin()) state.commitError = error && error.message ? error.message : 'Não foi possível atualizar a prévia.';
  }).finally(function() {
    state.refreshPending = false;
    if (currentPage === 'admin' && isAdmin()) render();
  });
}

function clearAdminWikiTransferImport() {
  if (!isAdmin() || adminWikiTransferState.importPending || adminWikiTransferState.commitPending) return;
  var state = adminWikiTransferState;
  state.fileName = '';
  state.bundle = null;
  state.importError = null;
  state.importId = null;
  state.importVersion = null;
  state.importPlanHash = null;
  state.importPreview = null;
  state.importPageIds = [];
  state.importConfirmed = false;
  state.commitError = null;
  state.commitMessage = null;
  state.commitReport = null;
  render();
}

function adminWikiTransferSelectedSourceIds(preview, pageIds) {
  var pages = Array.isArray(preview && preview.pages) ? preview.pages : [];
  var selected = new Set(pageIds);
  var sourceIds = new Set();
  pages.forEach(function(page) {
    if (!selected.has(adminWikiTransferPageId(page))) return;
    (Array.isArray(page.requiredSourceIds) ? page.requiredSourceIds : []).forEach(function(id) {
      if (id) sourceIds.add(String(id));
    });
  });
  return Array.from(sourceIds).sort();
}

function commitAdminWikiTransferImport() {
  var state = adminWikiTransferState;
  if (!isAdmin() || state.commitPending || state.commitMessage || !state.importConfirmed) return Promise.resolve();
  var selectable = new Set(adminWikiTransferSelectablePages(state.importPreview).map(adminWikiTransferPageId));
  var pageIds = state.importPageIds.filter(function(id) { return selectable.has(id); }).sort();
  if (!pageIds.length || !state.importId || !state.importPlanHash || !Number.isInteger(state.importVersion)) return Promise.resolve();
  state.commitPending = true;
  state.commitError = null;
  render();
  var payload = {
    expectedVersion: state.importVersion,
    planHash: state.importPlanHash,
    pageIds: pageIds,
    sourceIds: adminWikiTransferSelectedSourceIds(state.importPreview, pageIds),
  };
  return apiRequest('POST', '/api/admin/wiki-transfers/imports/' + encodeURIComponent(state.importId) + '/commit', payload).then(function(response) {
    if (!isAdmin()) return;
    var result = response && response.data && typeof response.data === 'object' ? response.data : response;
    state.commitReport = result && (result.report || result) || null;
    state.commitMessage = 'Importação concluída. Revise as páginas no destino; a publicação é uma ação editorial separada.';
  }).catch(function(error) {
    if (isAdmin()) state.commitError = error && error.message ? error.message : 'Não foi possível confirmar a importação.';
  }).finally(function() {
    state.commitPending = false;
    if (currentPage === 'admin' && isAdmin()) render();
  });
}

function showModal(title, bodyHtml) {
  var c = document.getElementById('modal-container');
  c.innerHTML = '<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-header"><span>' + h(title) + '</span><button onclick="closeModal()">&times;</button></div><div class="modal-body">' + bodyHtml + '</div></div></div>';
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
  editingTurnId = null;
  editingForumPostId = null;
}

function showLoginModal() {
  var bodyHtml = '';
  bodyHtml += '<div class="form-row"><label>Usuário</label><input type="text" id="login-username" placeholder="Seu nome de usuário"></div>';
  bodyHtml += '<div class="form-row"><label>Senha</label><input type="password" id="login-password" placeholder="Sua senha" onkeydown="if(event.key===\'Enter\')doLogin()"></div>';
  bodyHtml += '<button class="btn btn-primary" style="width:100%;" onclick="doLogin()">Entrar</button>';
  bodyHtml += '<div style="margin-top:14px;font-size:12px;text-align:center;color:var(--text-secondary);">Não tem conta? <a onclick="closeModal();navigate(\'registro\')">Cadastre-se gratuitamente</a></div>';
  showModal('Entrar no aetherverse vault', bodyHtml);
}

function showAlert(msg, type) {
  var container = document.getElementById('toast-container');
  if (container) {
    var toast = document.createElement('div');
    toast.className = 'toast-item toast-' + (type || 'info');
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3500);
    return;
  }
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

function apiRequest(method, url, body, cb) {
  var promise = window.Aetherverse.apiRequest(method, url, body, cb);
  // Callback-style UI handlers already report request failures. Observe their
  // rejection here so an ignored callback result (including anonymous /me
  // during startup) does not become an unhandled browser error. Callers that
  // explicitly return or await the original promise still receive rejection.
  if (typeof cb === 'function' && promise && typeof promise.catch === 'function') {
    promise.catch(function() {});
  }
  return promise;
}

function apiPost(url, body, cb) {
  apiRequest('POST', url, body, cb);
}

function formatJoinDate(iso) {
  if (!iso) return '';
  var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return m[3] + '/' + m[2] + '/' + m[1];
}

function applyServerSession(serverUser) {
  var previousId = DB.session && (DB.session.serverId || DB.session.id);
  var previousRole = DB.session && DB.session.role;
  if (!serverUser) {
    pendingProfileAvatarUpload = null;
    pendingProfileAvatarCleared = false;
    profileAvatarPreparing = false;
    if (previousId) {
      clearForumDraftEditors();
      clearWikiTransientState();
    }
    DB.session = null;
    if (window.Aetherverse) window.Aetherverse.clearSessionUser();
    return;
  }
  var safeUser = window.Aetherverse.setSessionUser(serverUser);
  if (!safeUser || typeof safeUser.id !== 'string') {
    pendingProfileAvatarUpload = null;
    pendingProfileAvatarCleared = false;
    profileAvatarPreparing = false;
    if (previousId) {
      clearForumDraftEditors();
      clearWikiTransientState();
    }
    DB.session = null;
    return;
  }
  if (previousId && String(previousId) !== safeUser.id) {
    pendingProfileAvatarUpload = null;
    pendingProfileAvatarCleared = false;
    profileAvatarPreparing = false;
    clearForumDraftEditors();
    clearWikiTransientState();
  } else if (['admin', 'moderador'].includes(previousRole) && !['admin', 'moderador'].includes(safeUser.role)) {
    clearWikiTransientState();
  } else if (previousRole === 'admin' && safeUser.role !== 'admin') {
    adminWikiTransferState = createAdminWikiTransferState();
  }
  DB.session = Object.assign({}, safeUser, {
    serverId: safeUser.id,
    posts: typeof safeUser.posts === 'number' ? safeUser.posts : 0,
    joinDate: formatJoinDate(safeUser.joinDate),
  });
}

function syncSessionUser(user) {
  applyServerSession(user);
}

function doLogin() {
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;
  if (!username || !password) {
    showAlert('Preencha usuário e senha.', 'error');
    return;
  }
  apiPost('/api/auth/login', { username: username, password: password }, function(err, data) {
    if (err) { showAlert(err, 'error'); return; }
    applyServerSession(data.user);
    carregarNotificacoesServidor();
    closeModal();
    navigate('forum');
    showAlert('Login realizado com sucesso.', 'success');
  });
}

function doLogout() {
  apiPost('/api/auth/logout', {}, function(err) {
    if (err) { showAlert(err, 'error'); return; }
    applyServerSession(null);
    DB.notifications = [];
    DB.unreadCount = 0;
    navigate('forum');
  });
}

function submitRegistro() {
  var username = document.getElementById('reg-username').value.trim();
  var password = document.getElementById('reg-password').value;
  var confirm2 = document.getElementById('reg-confirm').value;
  var email = document.getElementById('reg-email').value.trim();

  if (!username || !password || !email) {
    showAlert('Preencha todos os campos.', 'error');
    return;
  }
  if (password !== confirm2) {
    showAlert('As senhas não conferem.', 'error');
    return;
  }

  apiPost('/api/auth/signup', { username: username, email: email, password: password }, function(err, data) {
    if (err) { showAlert(err, 'error'); return; }
    applyServerSession(data.user);
    carregarNotificacoesServidor();
    navigate('forum');
    showAlert('Cadastro realizado. Bem-vindo(a)!', 'success');
  });
}

function startNewThread(catId) {
  currentCat = catId;
  editandoThread = null;
  navigate('novaThread');
}

function submitThread() {
  if (!DB.session) { showAlert('Faça login para criar tópicos.', 'error'); return; }
  saveActiveForumDraft();
  var title = document.getElementById('thread-title').value.trim();
  var content = getEditorContent('thread-editor');
  var catId = document.getElementById('thread-cat').value;
  var tag = document.getElementById('thread-tag').value;
  if (!title || !content || content === '<br>') { showAlert('Preencha o título e o conteúdo!', 'error'); return; }
  var payload = { categoryId: catId, title: title, tag: tag, content: content };
  var serialized = JSON.stringify(payload);
  if (!pendingTopicKey || pendingTopicPayload !== serialized) {
    pendingTopicKey = newForumIdempotencyKey();
    pendingTopicPayload = serialized;
  }
  writeForumDraft('topic', 'new', payload, pendingTopicKey);
  var button = document.querySelector('#main button[onclick="submitThread()"]');
  if (button) button.disabled = true;
  forumApi().apiRequest('POST', '/api/forum/threads', payload, null, { headers: { 'Idempotency-Key': pendingTopicKey } })
    .then(function(response) {
      clearForumDraft('topic', 'new');
      pendingTopicKey = null;
      pendingTopicPayload = null;
      forumLandingLoaded = false;
      navigate('thread', response.data.thread.id);
    })
    .catch(function(error) {
      if (button) button.disabled = false;
      showAlert(error.message || 'Não foi possível publicar o tópico. O conteúdo continua no formulário.', 'error');
    });
}

function editarThread(threadId) {
  var thread = serverForumThread && String(serverForumThread.id) === String(threadId) ? serverForumThread : null;
  if (!thread || !canEditForumAuthor(thread.author)) { showAlert('Você não tem permissão para editar este tópico.', 'error'); return; }
  editandoThread = threadId;
  navigate('novaThread');
}

function salvarEdicaoThread() {
  var thr = serverForumThread && String(serverForumThread.id) === String(editandoThread) ? serverForumThread : null;
  if (!thr) return;
  if (!canEditForumAuthor(thr.author)) { showAlert('Você não tem permissão para salvar este tópico.', 'error'); return; }
  saveActiveForumDraft();
  var title = document.getElementById('thread-title').value.trim();
  var tag = document.getElementById('thread-tag').value;
  if (!title) { showAlert('O título não pode ficar vazio.', 'error'); return; }
  var button = document.querySelector('#main button[onclick="salvarEdicaoThread()"]');
  if (button) button.disabled = true;
  forumApi().apiRequest('PATCH', '/api/forum/threads/' + encodeURIComponent(thr.id), {
    title: title, tag: tag, expectedVersion: thr.version
  }).then(function(response) {
    clearForumDraft('topic-edit', thr.id);
    serverForumThread = response.data;
    updateCachedForumThread(response.data);
    editandoThread = null;
    navigate('thread', response.data.id);
  }).catch(function(error) {
    if (button) button.disabled = false;
    showAlert(error.message || 'Não foi possível salvar o tópico. Suas alterações continuam no formulário.', 'error');
  });
}

function deleteThread(threadId) {
  if (!isModOrAdmin()) { showAlert('Somente a equipe pode arquivar tópicos.', 'error'); return; }
  if (!confirm('Arquivar este tópico e manter suas publicações recuperáveis?')) return;
  moderateForumThread(threadId, 'archive');
}

function submitReply() {
  if (!DB.session) { showAlert('Faça login para responder.', 'error'); return; }
  saveActiveForumDraft();
  var content = getEditorContent('reply-editor');
  if (!content || content === '<br>') { showAlert('Escreva algo antes de enviar!', 'error'); return; }
  var payload = { content: content };
  var serialized = JSON.stringify(payload);
  if (!pendingReplyKey || pendingReplyPayload !== serialized) {
    pendingReplyKey = newForumIdempotencyKey();
    pendingReplyPayload = serialized;
  }
  writeForumDraft('reply', currentThread, payload, pendingReplyKey);
  var button = document.querySelector('#main button[onclick="submitReply()"]');
  if (button) button.disabled = true;
  forumApi().apiRequest('POST', '/api/forum/threads/' + encodeURIComponent(currentThread) + '/posts', payload, null, {
    headers: { 'Idempotency-Key': pendingReplyKey }
  }).then(function() {
    clearForumDraft('reply', currentThread);
    pendingReplyKey = null;
    pendingReplyPayload = null;
    serverForumThread = null;
    serverForumPosts = null;
    loadForumThread(currentThread, { force: true });
    showAlert('Resposta publicada.', 'success');
  }).catch(function(error) {
    if (button) button.disabled = false;
    showAlert(error.message || 'Não foi possível publicar a resposta. O texto continua no editor.', 'error');
  });
}

function quotePost(postId) {
  var post = (serverForumPosts || []).find(function(p) { return String(p.id) === String(postId); });
  if (!post || post.deleted) return;
  var author = post.author;
  var replyEditor = document.getElementById('reply-editor');
  if (replyEditor) {
    replyEditor.focus();
    var quoteHtml = '<blockquote><strong>' + h(author ? author.username : (post.authorLabel || '?')) + ' escreveu:</strong><br>' + post.content + '</blockquote><p></p>';
    document.execCommand('insertHTML', false, quoteHtml);
    replyEditor.scrollIntoView({ behavior: 'smooth' });
  }
}

function editPost(postId) {
  var post = (serverForumPosts || []).find(function(p) { return String(p.id) === String(postId); });
  if (!post || post.deleted || !canEditForumAuthor(post.author)) return;
  editingForumPostId = String(postId);
  showModal('Editar Post',
    '<div class="form-row"><label>Conteúdo:</label>' + buildEditor('edit-post-editor', post.content) + '</div>' +
    '<div class="form-row"><label>Resumo da alteração:</label><input id="edit-post-summary" maxlength="1000" placeholder="Explique brevemente o que foi corrigido"></div>' +
    '<div style="margin-top:10px;"><button class="btn btn-primary" onclick="saveEditPost(' + idJs(postId) + ')">Salvar</button></div>'
  );
  restoreResourceFormDraft();
  addResourceDraftNotice();
}

function saveEditPost(postId) {
  var post = (serverForumPosts || []).find(function(p) { return String(p.id) === String(postId); });
  if (!post || !canEditForumAuthor(post.author)) return;
  var content = getEditorContent('edit-post-editor');
  var summary = document.getElementById('edit-post-summary').value.trim();
  if (!content || !summary) { showAlert('Informe o conteúdo e um resumo da alteração.', 'error'); return; }
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('forum-post-edit:' + String(postId));
  if (!finish) return;
  forumApi().apiRequest('PATCH', '/api/forum/posts/' + encodeURIComponent(post.id), {
    content: content, summary: summary, expectedVersion: post.version
  }).then(function() {
    finish();
    clearResourceFormDraft(descriptor);
    closeModal();
    serverForumThread = null;
    serverForumPosts = null;
    loadForumThread(currentThread, { force: true });
    showAlert('Publicação atualizada.', 'success');
  }).catch(function(error) {
    finish();
    showAlert(error.message || 'Não foi possível editar a publicação.', 'error');
  });
}

function deletePost(postId) {
  var post = (serverForumPosts || []).find(function(p) { return String(p.id) === String(postId); });
  if (!post || post.deleted || !DB.session) return;
  if (Number(post.postNo) === 1 && !isModOrAdmin()) { showAlert('A publicação de abertura só pode ser ocultada pela equipe.', 'error'); return; }
  if (!confirm('Ocultar esta publicação mantendo o registro recuperável?')) return;
  var reason = window.prompt('Informe o motivo da ocultação:');
  if (!reason || !reason.trim()) return;
  forumApi().apiRequest('POST', '/api/forum/posts/' + encodeURIComponent(post.id) + '/hide', {
    reason: reason.trim(), expectedVersion: post.version
  }).then(function(response) {
    serverForumPosts = serverForumPosts.map(function(item) { return String(item.id) === String(post.id) ? response.data : item; });
    render();
  }).catch(function(error) { showAlert(error.message || 'Não foi possível ocultar a publicação.', 'error'); });
}

function restoreForumPost(postId) {
  var post = (serverForumPosts || []).find(function(p) { return String(p.id) === String(postId); });
  if (!isModOrAdmin() || !post || !post.deleted) return;
  var reason = window.prompt('Informe o motivo para restaurar esta publicação:');
  if (!reason || !reason.trim()) return;
  forumApi().apiRequest('POST', '/api/forum/posts/' + encodeURIComponent(post.id) + '/restore', {
    reason: reason.trim(), expectedVersion: post.version
  }).then(function(response) {
    serverForumPosts = serverForumPosts.map(function(item) { return String(item.id) === String(post.id) ? response.data : item; });
    render();
  }).catch(function(error) { showAlert(error.message || 'Não foi possível restaurar a publicação.', 'error'); });
}

function editarPersonagem(id) {
  sessionStorage.setItem('editPersonagemId', id);
  navigate('novoPersonagem');
}

function lerStatsDoFormulario() {
  var stats = {};
  var algumPreenchido = false;
  for (var i = 0; i < STAT_KEYS.length; i++) {
    var bruto = document.getElementById('p-stat-' + STAT_KEYS[i]).value.trim();
    if (bruto === '') continue;
    var n = parseInt(bruto, 10);
    if (isNaN(n)) n = 0;
    if (n < 0) n = 0;
    if (n > 100) n = 100;
    stats[STAT_KEYS[i]] = n;
    algumPreenchido = true;
  }
  return algumPreenchido ? stats : {};
}

function skillFormRowHtml(nome, descricao, tipo) {
  var isEquip = tipo === 'equipamento';
  return '<div class="skill-form-item">' +
    '<div style="display:grid;grid-template-columns:160px 1fr auto;gap:10px;margin-bottom:8px;align-items:end;">' +
    '<div><label>Tipo do Card</label><select class="skill-tipo"><option value="skill"' + (!isEquip ? ' selected' : '') + '>Skill</option><option value="equipamento"' + (isEquip ? ' selected' : '') + '>Equipamento</option></select></div>' +
    '<div><label>Nome</label><input type="text" class="skill-nome" value="' + ha(nome || '') + '" placeholder="Ex: Poison of Wrath"></div>' +
    '<button type="button" class="btn btn-small btn-danger" onclick="this.parentNode.parentNode.remove()">Remover</button>' +
    '</div>' +
    '<div><label>Descrição</label><textarea class="skill-desc" rows="2" spellcheck="false" placeholder="O que a habilidade ou equipamento faz...">' + h(descricao || '') + '</textarea></div>' +
    '</div>';
}

function adicionarSkillFormRow() {
  var container = document.getElementById('p-skills-list');
  container.insertAdjacentHTML('beforeend', skillFormRowHtml('', '', 'skill'));
}

function lerSkillsDoFormulario() {
  var skills = [];
  document.querySelectorAll('#p-skills-list .skill-form-item').forEach(function(item) {
    var nome = item.querySelector('.skill-nome').value.trim();
    var descricao = item.querySelector('.skill-desc').value.trim();
    var tipo = item.querySelector('.skill-tipo').value === 'equipamento' ? 'equipamento' : 'skill';
    if (nome || descricao) skills.push({ nome: nome, descricao: descricao, tipo: tipo });
  });
  return skills;
}

function lerFormPersonagem() {
  syncBuilderBlocksFromDOM();
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
    skills: lerSkillsDoFormulario(),
    mascaraTier: document.getElementById('p-mascara-tier').value.trim(),
    theme: {
      accentColor: (document.getElementById('p-accent-color') || {}).value || '#ffffff'
    },
    blocks: activeBuilderBlocks
  };
}

function submitPersonagem() {
  if (!isModOrAdmin()) { showAlert('Apenas administradores e moderadores podem cadastrar personagens.', 'error'); return; }
  var dados = lerFormPersonagem();
  if (!dados.nome || !dados.descricao || dados.descricao === '<br>') { showAlert('Preencha ao menos o nome e a descrição.', 'error'); return; }
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('character-create');
  if (!finish) return;

  apiRequest('POST', '/api/personagens', dados, function(err, data) {
    finish();
    if (err) { showAlert(err, 'error'); return; }
    clearResourceFormDraft(descriptor);
    if (serverPersonagens === null) serverPersonagens = [];
    serverPersonagens.push(data.personagem);
    navigate('personagens');
    showAlert('Personagem cadastrado.', 'success');
  });
}

function salvarEdicaoPersonagem(id) {
  if (!isModOrAdmin()) { showAlert('Apenas administradores e moderadores podem editar personagens.', 'error'); return; }
  var dados = lerFormPersonagem();
  if (!dados.nome || !dados.descricao || dados.descricao === '<br>') { showAlert('Preencha ao menos o nome e a descrição.', 'error'); return; }

  var existing = listaPersonagens().find(function(item) { return String(item.id) === String(id); });
  if (!existing) { showAlert('Atualize a ficha antes de salvar.', 'error'); return; }
  dados.expectedVersion = existing.version;
  var descriptor = resourceFormDraftDescriptor();
  saveActiveResourceFormDraft();
  var finish = beginResourceFormSubmission('character-edit:' + String(id));
  if (!finish) return;
  apiRequest('PUT', '/api/personagens/' + encodeURIComponent(id), dados, function(err, data) {
    finish();
    if (err) { showAlert(err, 'error'); return; }
    clearResourceFormDraft(descriptor);
    var idx = serverPersonagens.findIndex(function(x) { return x.id === id; });
    if (idx !== -1) serverPersonagens[idx] = data.personagem;
    sessionStorage.removeItem('editPersonagemId');
    navigate('personagemView', id);
  });
}

function deletarPersonagem(id) {
  if (!isModOrAdmin()) { showAlert('Apenas administradores e moderadores podem ocultar personagens.', 'error'); return; }
  if (!confirm('Ocultar esta ficha? Ela poderá ser recuperada pela equipe.')) return;
  var personagem = listaPersonagens().find(function(item) { return String(item.id) === String(id); });
  if (!personagem) return;
  apiRequest('POST', '/api/personagens/' + encodeURIComponent(id) + '/hide', { expectedVersion: personagem.version }, function(err) {
    if (err) { showAlert(err, 'error'); return; }
    serverPersonagens = serverPersonagens.filter(function(p) { return p.id !== id; });
    navigate('personagens');
  });
}

function loadAdminData(force) {
  if (!isAdmin() || (adminState.loading && !force)) return;
  var sequence = ++adminLoadSequence;
  adminState.loading = true;
  adminState.error = null;
  var offset = adminState.userPage.offset;
  Promise.all([
    apiRequest('GET', '/api/admin/users?limit=50&offset=' + offset),
    apiRequest('GET', '/api/admin/categories?limit=100&offset=0'),
    apiRequest('GET', '/api/admin/audit-events?limit=50&offset=0')
  ]).then(function(responses) {
    if (sequence !== adminLoadSequence) return;
    adminState.users = Array.isArray(responses[0].data) ? responses[0].data : [];
    adminState.userPage = responses[0].page || { limit: 50, offset: offset, hasMore: false };
    adminState.categories = Array.isArray(responses[1].data) ? responses[1].data : [];
    adminState.events = Array.isArray(responses[2].data) ? responses[2].data : [];
    adminState.loaded = true;
  }).catch(function(error) {
    if (sequence === adminLoadSequence) adminState.error = error && error.message ? error.message : 'Não foi possível carregar o painel administrativo.';
  }).finally(function() {
    if (sequence !== adminLoadSequence) return;
    adminState.loading = false;
    if (currentPage === 'admin') render();
  });
}

function adminMutation(method, url, payload, successMessage) {
  apiRequest(method, url, payload).then(function() {
    return apiRequest('GET', '/api/auth/me').then(function(identity) {
      applyServerSession(identity.user || null);
      if (!isAdmin()) {
        adminState = { users: [], categories: [], events: [], userPage: { limit: 50, offset: 0, hasMore: false }, loading: false, loaded: false, error: null };
        updateTopBar();
        navigate('forum');
        showAlert('Sua sessão administrativa foi atualizada.', 'success');
        return;
      }
      showAlert(successMessage, 'success');
      adminState.loaded = false;
      loadAdminData(true);
    });
  }).catch(function(error) {
    if (error && /sessão expirou/i.test(error.message || '')) {
      applyServerSession(null);
      updateTopBar();
      navigate('forum');
    }
    showAlert(error && error.message ? error.message : 'A alteração não foi salva.', 'error');
  });
}

function adminReason() {
  var value = window.prompt('Informe o motivo administrativo desta alteração.');
  return value === null ? null : value.trim();
}

function changeAdminUserRole(userId, expectedVersion) {
  var select = document.getElementById('admin-role-' + userId);
  if (!select) return;
  var reason = adminReason();
  if (reason === null) return;
  adminMutation('PATCH', '/api/admin/users/' + encodeURIComponent(userId), {
    role: select.value, expectedVersion: expectedVersion, reason: reason
  }, 'Cargo atualizado. As sessões anteriores foram revogadas.');
}

function changeAdminUserAccess(userId, expectedVersion, disabled) {
  var reason = adminReason();
  if (reason === null) return;
  adminMutation('PATCH', '/api/admin/users/' + encodeURIComponent(userId), {
    disabled: disabled, expectedVersion: expectedVersion, reason: reason
  }, disabled ? 'Conta desativada e sessões revogadas.' : 'Conta reativada.');
}

function changeAdminUserPage(direction) {
  var nextOffset = Math.max(0, adminState.userPage.offset + direction * adminState.userPage.limit);
  if (direction > 0 && !adminState.userPage.hasMore) return;
  adminState.userPage.offset = nextOffset;
  adminState.loaded = false;
  loadAdminData(true);
}

function createAdminCategory() {
  var name = (document.getElementById('admin-category-name') || {}).value || '';
  var description = (document.getElementById('admin-category-description') || {}).value || '';
  var reason = (document.getElementById('admin-category-reason') || {}).value || '';
  adminMutation('POST', '/api/admin/categories', { name: name.trim(), description: description.trim(), reason: reason.trim() }, 'Categoria criada.');
}

function editAdminCategory(categoryId) {
  var category = adminState.categories.find(function(item) { return String(item.id) === String(categoryId); });
  if (!category) return;
  var name = window.prompt('Nome da categoria:', category.name);
  if (name === null) return;
  var description = window.prompt('Descrição da categoria:', category.description || '');
  if (description === null) return;
  var reason = adminReason();
  if (reason === null) return;
  adminMutation('PATCH', '/api/admin/categories/' + encodeURIComponent(categoryId), {
    name: name.trim(), description: description.trim(), expectedVersion: category.version, reason: reason
  }, 'Categoria atualizada.');
}

function changeAdminCategoryArchive(categoryId, expectedVersion, archive) {
  var reason = adminReason();
  if (reason === null) return;
  adminMutation('POST', '/api/admin/categories/' + encodeURIComponent(categoryId) + '/' + (archive ? 'archive' : 'restore'), {
    expectedVersion: expectedVersion, reason: reason
  }, archive ? 'Categoria arquivada; os tópicos foram preservados.' : 'Categoria restaurada.');
}

window.addEventListener('DOMContentLoaded', function() {
  loadDB();
  parseRouteFromLocation();
  initializeResourceFormDraftPersistence();
  initializeForumDraftPersistence();
  updateTopBar();
  render();
  carregarPersonagensServidor();
  carregarWikiPostsServidor();

  apiRequest('GET', '/api/auth/me', undefined, function(err, data) {
      if (err) {
        applyServerSession(null);
        if (err !== 'Sua sessão expirou. Faça login novamente.') {
          showAlert('Não foi possível confirmar a sessão. Você está desconectado até a próxima tentativa.', 'error');
        }
        return;
      }
      applyServerSession(data.user);
      carregarNotificacoesServidor();
      render();
      updateTopBar();
    });
});

