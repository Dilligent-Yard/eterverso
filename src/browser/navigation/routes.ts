export interface SimpleNavigateTarget {
  page: string;
  extra?: string | number;
}

export function routePath(page: string, extra?: string | number): string | null {
  if (page === 'forum') return '/forum';
  if (page === 'cat' && typeof extra === 'string') return '/forum/categorias/' + encodeURIComponent(extra);
  if (page === 'thread' && typeof extra === 'string') return '/forum/topicos/' + encodeURIComponent(extra);
  if (page === 'threadEdit' && typeof extra === 'string') return '/forum/topicos/' + encodeURIComponent(extra) + '/editar';
  if (page === 'novaThread' && typeof extra === 'string') return '/forum/categorias/' + encodeURIComponent(extra) + '/novo';
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
  if (page === 'novoPersonagem') return typeof extra === 'string' ? '/personagens/' + encodeURIComponent(extra) + '/editar' : '/personagens/novo';
  if (page === 'cenas') return '/cenas';
  if (page === 'cenaView' && typeof extra === 'string') return '/cenas/' + encodeURIComponent(extra);
  if (page === 'novaCena') return typeof extra === 'string' ? '/cenas/' + encodeURIComponent(extra) + '/editar' : '/cenas/nova';
  if (page === 'timeline') return '/timeline';
  if (page === 'sobre') return '/sobre';
  if (page === 'perfil') return '/perfil';
  if (page === 'registro') return '/registro';
  if (page === 'admin') return '/admin';
  return null;
}

export function parseSimpleNavigateOnclick(code: string | null | undefined): SimpleNavigateTarget | null {
  const match = String(code || '').trim().match(/^navigate\(\s*(['"])([^'"]+)\1\s*(?:,\s*(?:(['"])([^'"]*)\3|([0-9]+))\s*)?\)$/);
  if (!match) return null;
  const page = match[2];
  if (!page) return null;
  const quotedExtra = match[4];
  const numericExtra = match[5];
  const target: SimpleNavigateTarget = { page };
  if (match[3] !== undefined && quotedExtra !== undefined) target.extra = quotedExtra;
  else if (numericExtra !== undefined) target.extra = Number(numericExtra);
  return target;
}
