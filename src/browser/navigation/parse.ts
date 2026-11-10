export interface ParsedRoute {
  page: string;
  id?: string;
  category?: string;
  redirectToForum?: boolean;
  editThread?: string | null;
}

const UUID = '([0-9a-f-]{36})';
const CATEGORY_RE = new RegExp('^/forum/categorias/' + UUID + '$', 'i');
const THREAD_EDIT_RE = new RegExp('^/forum/topicos/' + UUID + '/editar$', 'i');
const THREAD_RE = new RegExp('^/forum/topicos/' + UUID + '$', 'i');
const NEW_THREAD_RE = new RegExp('^/forum/categorias/' + UUID + '/novo$', 'i');
const STAFF_ARTICLE_RE = new RegExp('^/wiki/rascunhos/' + UUID + '$', 'i');
const WIKI_EDITOR_RE = new RegExp('^/wiki/editor/' + UUID + '$', 'i');
const WIKI_PROPOSAL_RE = new RegExp('^/wiki/propostas/' + UUID + '$', 'i');
const WIKI_ARTICLE_RE = /^\/wiki\/([a-z0-9][a-z0-9_-]{0,119})$/i;
const CHARACTER_VIEW_RE = new RegExp('^/personagens/' + UUID + '$', 'i');
const CHARACTER_EDIT_RE = new RegExp('^/personagens/' + UUID + '/editar$', 'i');
const SCENE_VIEW_RE = new RegExp('^/cenas/' + UUID + '$', 'i');
const SCENE_EDIT_RE = new RegExp('^/cenas/' + UUID + '/editar$', 'i');

export function parsePath(pathname: string, search = ''): ParsedRoute {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index.html' || path === '/forum') {
    return { page: 'forum', redirectToForum: path !== '/forum' };
  }
  let match = path.match(CATEGORY_RE);
  if (match?.[1]) return { page: 'cat', id: decodeURIComponent(match[1]) };
  match = path.match(THREAD_EDIT_RE);
  if (match?.[1]) {
    const id = decodeURIComponent(match[1]).toLowerCase();
    return { page: 'threadEdit', id, editThread: id };
  }
  match = path.match(THREAD_RE);
  if (match?.[1]) return { page: 'thread', id: decodeURIComponent(match[1]) };
  match = path.match(NEW_THREAD_RE);
  if (match?.[1]) return { page: 'novaThread', id: decodeURIComponent(match[1]).toLowerCase(), editThread: null };
  if (path === '/sobre') return { page: 'sobre' };
  if (path === '/perfil') return { page: 'perfil' };
  if (path === '/registro') return { page: 'registro' };
  if (path === '/wiki') {
    const category = new URLSearchParams(search).get('categoria');
    return {
      page: 'wiki',
      category: category && /^[a-z0-9][a-z0-9-]{0,99}$/.test(category) ? category : 'all',
    };
  }
  if (path === '/wiki/equipe') return { page: 'wikiStaff' };
  match = path.match(STAFF_ARTICLE_RE);
  if (match?.[1]) return { page: 'wikiStaffArticle', id: match[1].toLowerCase() };
  if (path === '/wiki/novo') return { page: 'wikiCreate' };
  if (path === '/wiki/editor') return { page: 'wikiEditor' };
  match = path.match(WIKI_EDITOR_RE);
  if (match?.[1]) return { page: 'wikiEditor', id: decodeURIComponent(match[1]).toLowerCase() };
  if (path === '/wiki/propostas') return { page: 'wikiProposals' };
  match = path.match(WIKI_PROPOSAL_RE);
  if (match?.[1]) return { page: 'wikiProposal', id: decodeURIComponent(match[1]).toLowerCase() };
  match = path.match(WIKI_ARTICLE_RE);
  if (match?.[1]) return { page: 'wikiArticle', id: decodeURIComponent(match[1]) };
  if (path === '/personagens') return { page: 'personagens' };
  if (path === '/admin') return { page: 'admin' };
  if (path === '/personagens/novo') return { page: 'novoPersonagem' };
  match = path.match(CHARACTER_VIEW_RE);
  if (match?.[1]) return { page: 'personagemView', id: decodeURIComponent(match[1]) };
  match = path.match(CHARACTER_EDIT_RE);
  if (match?.[1]) return { page: 'novoPersonagem', id: decodeURIComponent(match[1]).toLowerCase() };
  if (path === '/cenas') return { page: 'cenas' };
  if (path === '/cenas/nova') return { page: 'novaCena' };
  match = path.match(SCENE_VIEW_RE);
  if (match?.[1]) return { page: 'cenaView', id: decodeURIComponent(match[1]) };
  match = path.match(SCENE_EDIT_RE);
  if (match?.[1]) return { page: 'novaCena', id: decodeURIComponent(match[1]).toLowerCase() };
  if (path === '/timeline') return { page: 'timeline' };
  return { page: 'notFound' };
}
