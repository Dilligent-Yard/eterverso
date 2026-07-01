var DB = {
  users: [
    { id: 1, username: 'Admin', password: 'admin123', email: 'admin@forum.com', avatar: '', title: 'Administrador', posts: 0, role: 'admin', bio: '', joinDate: '01/01/2026', admTentativaUsada: false },
    { id: 2, username: 'MandRaiden', password: 'mandraiden123', email: 'mandraiden@forum.com', avatar: '', title: 'Dono do Éterverso', posts: 0, role: 'admin', bio: 'Criador e dono do Éterverso.', joinDate: '01/01/2026', admTentativaUsada: true },
    { id: 3, username: 'Rick', password: 'rick123', email: 'rick@forum.com', avatar: 'https://i.pinimg.com/736x/02/bc/1d/02bc1ddfb478c7069ac1db5017955648.jpg', title: 'Moderador — Dono da Wikia', posts: 0, role: 'moderador', bio: 'Responsável pela wikia de personagens e criador do sistema Apex Scale.', joinDate: '01/01/2026', admTentativaUsada: true }
  ],
  nextUserId: 4,

  categories: [
    { id: 1, name: 'Geral & Anúncios', desc: 'Notícias e avisos importantes do fórum.' },
    { id: 2, name: 'Roleplay — Cenas', desc: 'Poste e continue cenas de RPG aqui.' },
    { id: 4, name: 'Power Scaling', desc: 'O sistema oficial de avaliação de poder dos personagens do fórum.' }
  ],

  threads: [
    { id: 1, catId: 4, title: 'Como funciona o Power Scaling neste fórum', authorId: 2, date: '30/06/2026 12:00', views: 0, pinned: true, tag: 'wiki' },
    { id: 2, catId: 4, title: 'APEX SCALE — Restricted Notes', authorId: 3, date: '30/06/2026 12:05', views: 0, pinned: true, tag: 'wiki' },
    { id: 3, catId: 1, title: 'Alpha da Wikia está oficialmente aberta', authorId: 3, date: '30/06/2026 13:00', views: 0, pinned: true, tag: 'ooc' }
  ],
  nextThreadId: 4,

  posts: [
    {
      id: 1, threadId: 1, authorId: 2, date: '30/06/2026 12:00',
      content: '<p>Esse fórum usa duas formas de avaliação de poder pros personagens:</p>' +
        '<ul><li><b>Scalling feito pela moderação</b> — também parte de cálculo, mas um cálculo conduzido sob o critério e a leitura própria dos administradores sobre os feitos e o contexto da história do personagem.</li>' +
        '<li><b>Scalling feito pelo Apex Scale</b> — o sistema oficial e matemático do fórum, criado pelo <b>Rick</b>. Tem tópico fixado logo abaixo explicando como funciona.</li></ul>' +
        '<p>Deixe sempre claro qual das duas você está usando ao falar do poder de um personagem.</p>',
      edited: false
    },
    {
      id: 2, threadId: 2, authorId: 3, date: '30/06/2026 12:05',
      content: '<p><b>APEX SCALE — Technical Readout</b></p>' +
        '<p>Computed attributes: IFC, CCM, LRB, ACG, TPC, CEO, FDV, ICF.</p>' +
        '<p>Derived indices: NPB, ICP, PG.</p>' +
        '<p>Final output: Tier, Grade.</p>' +
        '<p>Unlike moderation-based assessments, this instrument is governed exclusively by closed-form mathematical formalism — deterministic, reproducible, and structurally indifferent to subjective interpretation.</p>' +
        '<p style="font-size:11px;color:#666;">System under construction. Figures subject to revision. Definitions restricted.</p>',
      edited: false
    },
    {
      id: 3, threadId: 3, authorId: 3, date: '30/06/2026 13:00',
      content: '<p>A alpha da Wikia do Éterverso foi oficialmente disponibilizada para uso público. O módulo de cadastro de fichas já está habilitado, contudo trata-se de uma build inicial, ainda em estágio preliminar de maturação técnica. Segue o levantamento das pendências estruturais do sistema:</p>' +
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

  personagens: [
    {
      id: 1,
      nome: 'Shin Hae',
      categoria: 'Personagem Principal',
      titulo: '',
      raca: 'Néfilim',
      faccao: 'Clã Myung-Jin',
      status: 'Vivo',
      imagem: 'https://i.pinimg.com/1200x/0c/0c/f4/0c0cf480011fd28dcd724588d0cbd5ee.jpg',
      descricao: '<h3>Biografia</h3>' +
        '<p>Shin Hae é um jovem néfilim em busca de vingança. Ou, respostas. Suas Marcas despertaram verdadeiramente após a morte de sua amada. Antes, ele conseguia fazer fogo a bel prazer, hoje é um vulcão humano. Shin possui um transtorno de vazio identitário fundacional. Ele se baseia na personalidade de seus queridos companheiros, como Akane e a casca-vazia que se tornou Zeratsu.</p>' +
        '<p>Graças ao Rosey, Shin Hae possui um grande senso de depender de estrutura militar, e é por isso que se aproximou de Akane, que ao menos, tenta simular essa dinâmica. Ayumi Hajiwara o amou por quem ele era, e não pelo que ele produzia. Ela se tornou, para Shin, um símbolo de verdade de identidade.</p>' +
        '<p>Depois de anos vivendo num ambiente hermético, hierárquico e vigiado, Shin teve seu primeiro contato com Yuna, através do Reddit. Uma jovem de vinte e poucos anos, com ligação aos povos indígenas. O povo de Yuna categorizava os portais e espectros de outra forma, até aprendendo a viver em comunhão com eles. Nessa viagem, ele conheceu Akane e se tornou pupilo dela. Meses depois, descobriu da conexão dela com Zeratsu.</p>' +
        '<p>Meses depois, Shin voltou ao Brasil com Akane, em uma missão, rastrear uma rede de contrabando de artefatos paranormais que escoava pelo Atlântico Sul. A rota de ambos os levou aos cantos mais escuros de Manáus, depois afluentes do Rio Negro. Lá, conheceram o povo Tikuna, os Baniwa e os Yanomami.</p>' +
        '<p>Ao retornar pro Japão, Shin se aliou a grupos revolucionários como os Orácion Seis, uma organização formada por seis mentalistas, mas que foram traídos por um que superou todos os outros; também andou com outra organização chamada Lâminas de Manticora. Atualmente, Shin está em busca da Demon Blade, artefato sagrado de seu clã que demonstra legitimidade, e a Armadura de Atikaya.</p>' +
        '<h3>Myung-Jin Clan</h3>' +
        '<p>The Myung-Jin Clan (明真, "Illuminated Truth") is a millennia-old shamanic-mediator lineage that has adopted the structure and vocabulary of modern corporate governance without abandoning its original internal organization, which remains divided into three institutional tiers. The <b>Bon-ga</b> (Root House), headquartered in Seoul, functions as the clan\'s central governing body, serving as custodian of the foundational artifacts and holding final arbitral authority over all subordinate divisions. The <b>Jong-ga</b> (Intermediate Chambers) oversee the clan\'s visible corporate sectors, operating as the administrative link between central leadership and regional units. The <b>Bun-ga</b> (Peripheral Cells), dispersed throughout Asia, are responsible for older and more localized practices such as exorcism and spiritual mediation — it is from this category that Shin\'s cell of origin descends.</p>' +
        '<p>The clan maintains an operational network of cells spanning Korea, Japan, China, Southeast Asia, and Central Asia. Unlike conventional corporate structures, cohesion among these units is not based on hierarchical subordination but on ritual and karmic bonds, which constitute the clan\'s true mechanism of institutional unity. Shin\'s cell of origin is characterized by its peripheral and traditionalist profile, a factor that directly accounts for her early exile: a child bearing an uncategorizable gift was regarded as an institutional liability by a cell that considers itself the guardian of doctrinal purity within the tradition.</p>' +
        '<p>Following the death of the Bon-ga\'s leader without a clearly designated successor, the Conclave of Proven-Merit Succession was formally activated, initiating a succession dispute between Shin Hae and Kael for leadership of the Root House.</p>' +
        '<h3>Habilidades — Marcas dos Pecados</h3>' +
        '<h4>Veneno da Ira</h4>' +
        '<p>Da ignorância, nasce o veneno da aversão, cuja forma mais violenta é a ira. Aqueles que morrem com vidas marcadas por atos de profunda aversão — crueldade, malícia, ira paranoica — tendem ao inferno, onde sofrem tormentos profundos condicionados por seus próprios atos e que, através de trauma que reflete seus próprios pecados, purifica tais más inclinações.</p>' +
        '<p>Ao despertar o Veneno da Ira, Shin obteve a capacidade de manifestar as chamas do inferno: um fogo rubro como o pôr do Sol, imbuído de um único efeito paradoxal de negar consumindo. Em contato com algo, estas chamas reagem com aquilo degradando o alvo, mas no processo, assim como fogo que consome certos sais ganha uma cor própria, evoluem de forma transversal ao alvo, se tornando mais capazes de queimar aquele exato combustível, ao passo que o alvo em questão, ao ser degradado, se torna cada vez mais vulnerável. Assim, as chamas infernais possuem uma eficiência de éter incrível e crescente com o contato ao alvo, que é desnaturado e se torna cada vez mais frágil e suscetível. Os subprodutos das chamas podem também alimentar as Demon Cells de Shin, tal como as chamas podem aprimorar esse processo absorvendo anticorpos gerados pelas DCs, em um processo recíproco.</p>' +
        '<blockquote><i>Que as chamas do inferno queimem todas as máculas das almas vis o bastante para lá cair.</i></blockquote>' +
        '<h3>Skills</h3>' +
        '<div class="skill-grid">' +
        '<div class="skill-item"><h4>Magma Mantle</h4><p>Undocumented.</p></div>' +
        '<div class="skill-item"><h4>Roar of Igneous Ether</h4><p>Shin exhales a stream of Ether condensed into magma. The stream has mass, causing both impact and burn damage. On contact with the ground it spreads and hardens within seconds, trapping anything inside the affected area. Output can be shaped wide, to cover an area, or narrowed into a high-penetration projectile.</p></div>' +
        '<div class="skill-item"><h4>Ether Rasengan</h4><p>Shin concentrates Ether into a spinning sphere of magma in his palm. The rotation causes simultaneous abrasion and burn damage on contact. It forms in under a second, and its size increases with the amount of Ether used. Signature technique.</p></div>' +
        '<div class="skill-item"><h4>Basalt Chains</h4><p>Shin projects threads of igneous Ether that harden into chains. They restrain targets, restrict movement, and can anchor objects in place. The core remains molten and continues to burn after hardening. Can be attached to his other long-range techniques to alter their trajectory mid-flight.</p></div>' +
        '<div class="skill-item"><h4>Fission Spear</h4><p>Shin gathers Ether into a sharpened point with a hardened shell and a molten core, then drives it into the target. The shell handles penetration; the heated core cauterizes and expands inside the wound afterward.</p></div>' +
        '<div class="skill-item"><h4>Ether Scales</h4><p>Shin solidifies his Ether aura into overlapping plates, increasing defense and melee damage output. Coverage can be full-body or partial. Contact with the plates causes burns from residual heat. The heavy configuration reduces mobility in exchange for higher defense; the light configuration preserves mobility with less defense. He can switch between the two instantly.</p></div>' +
        '<div class="skill-item"><h4>Ether Tide</h4><p>Shin converts the surrounding terrain into an advancing wave of lava that causes burn and impact damage. It hardens after a few seconds, trapping anyone caught inside. Used for area control against multiple targets.</p></div>' +
        '<div class="skill-item"><h4>Haste Seal</h4><p>A seal that accelerates biological and chemical processes in the target. On an ally, this increases reaction speed and healing rate. Used on an enemy, it accelerates fatigue and oxidation instead.</p></div>' +
        '<div class="skill-item"><h4>Delay Seal</h4><p>A seal that slows biological and physical processes in the target. Movement, reaction time, and technique charge time are all reduced. It is not paralysis — the target retains full control, just at reduced speed.</p></div>' +
        '<div class="skill-item"><h4>Instant Corrosion</h4><p>Accelerates oxidation and wear on inert objects: weapons rust to dust, walls crumble, ropes rot. Limited to non-living matter.</p></div>' +
        '<div class="skill-item"><h4>Stasis Seal</h4><p>Slows a targeted process to near zero, halting its progression without ending it. Can stop bleeding, suspend the spread of a toxin, or hold a charged technique in reserve. Used to stabilize allies or store an effect for later use.</p></div>' +
        '<div class="skill-item"><h4>Slow Wall</h4><p>A stationary field that drastically reduces the speed of anything that enters it, including incoming projectiles. It does not block attacks; it removes their velocity.</p></div>' +
        '<div class="skill-item"><h4>Stolen Momentum Spear</h4><p>Shin slows an incoming attack and redirects the velocity removed from it into an accelerated counter-attack. The speed of the original attack determines the strength of the counter.</p></div>' +
        '<div class="skill-item"><h4>Differential Field</h4><p>Shin divides an area into accelerated zones, which increase ally speed, and decelerated zones, which reduce enemy speed. Shin is unaffected by either zone.</p></div>' +
        '<div class="skill-item"><h4>Absolute Refraction</h4><p>Shin alters the local permittivity of Ether (ε₀), changing the refractive index of the surrounding space. This can bend light around him for invisibility, deflect beams and projectiles, create visual mirages, or slow light enough to produce a static afterimage. Because the effect acts on the medium rather than the attack, it cannot be countered with force.</p></div>' +
        '<div class="skill-item"><h4>Electromagnetic Veto</h4><p>By altering Ether\'s permeability (μ₀), Shin weakens or suppresses electromagnetic field propagation in a region. This disrupts conduction, electric and magnetic-based techniques, and electronic devices within the affected area.</p></div>' +
        '<div class="skill-item"><h4>Law of Mass</h4><p>Shin manipulates the Ether field responsible for a target\'s inertial mass. He can reduce a target\'s mass close to zero, limiting its ability to generate force, or increase it to an extreme degree, restricting its movement under its own weight. The effect targets mass directly rather than the target\'s physical structure.</p></div>' +
        '<div class="skill-item"><h4>Casimir Pressure</h4><p>Shin arranges boundary conditions in the Ether so that vacuum zero-point energy produces a measurable force. This generates a push or crushing effect without a projectile or visible point of origin.</p></div>' +
        '<div class="skill-item"><h4>Zero-Point Well</h4><p>Shin draws energy directly from vacuum fluctuations. While active, his techniques do not draw from his personal energy reserve, removing fatigue as a limiting factor.</p></div>' +
        '<div class="skill-item"><h4>Ether Gravitational Lens</h4><p>By condensing Ether into a point, Shin creates a field that bends nearby trajectories, including projectiles, light, and physical bodies. He can redirect incoming attacks away from allies, hold a target inside a pulling field, or concentrate energy at a single point.</p></div>' +
        '<div class="skill-item"><h4>Flow Zero Point</h4><p>Shin halts nearly all processes in a single target, including aging, movement, casting, healing, and decay. Only Shin can release the effect. The technique uses nearly all of his energy reserve and can only affect one target at a time.</p></div>' +
        '<div class="skill-item"><h4>False Vacuum</h4><p>Shin triggers a localized vacuum collapse inside an expanding field, shifting the local Ether constants to a lower-energy state. Inside the field, molecular and structural bonds weaken, causing matter and active effects to break down. The effect targets ambient conditions rather than the target directly. It is difficult to control and leaves Shin fully depleted afterward.</p></div>' +
        '<div class="skill-item"><h4>Imposed Heat Death</h4><p>A combined technique. Shin saturates the target with igneous Ether at maximum concentration while simultaneously accelerating entropy in the same area using Maxwell\'s Demon. This causes localized heat death: the target\'s physical and Ether structure breaks down into heat and disorder.</p></div>' +
        '<div class="skill-item"><h4>Maxwell\'s Demon</h4><p>Shin can locally control entropy within a chosen area. Accelerating entropy pushes a target toward rapid heat death, breaking down energy and structure. Reversing entropy restores matter to an earlier state, repairing allies or objects. Reversal requires significantly more energy than acceleration.</p></div>' +
        '</div>',
      stats: { ifc: 55, ccm: 45, lrb: 60, acg: 35, tpc: 50, ceo: 65, fdv: 45, icf: 30 },
      apexTier: 'Intermediário',
      mascaraTier: 'Expert'
    },
    {
      id: 2,
      nome: 'Zeferino',
      categoria: 'Sub-Personagem',
      titulo: 'Master of Cultivation',
      raca: 'Unknown / disputed',
      faccao: 'Unaffiliated',
      status: 'Alive (allegedly) — has died at least ten times',
      imagem: '',
      descricao: '<h3>Biography</h3>' +
        '<p>Zeferino is an elderly master of cultivation. According to his own stories, he once shared a toast with Odin in the hall of the dead — while still alive. Or nearly alive. No one knows his true age, not even himself.</p>' +
        '<p>Old stories, which now survive only in the memory of one senile old man, claim that Zeferino was born not once, but three times in the same morning: the first in a Greek temple, son of a distracted nymph; the second beneath a sacred fig tree in India, crying in Sanskrit; and the third — the most annoying one, by his own account — inside a hut in the middle of the forest, where a giant serpent decided he deserved to be born again just so he would learn to respect his elders. He claims this is why he was born lazy.</p>' +
        '<p>They say that one day, a bored Zeus threw a lightning bolt at Zeferino\'s crops from Olympus, and Zeferino, annoyed, threw it right back. Furious, Zeus turned him into a goat. Zeferino had already been a goat twice before and found the punishment repetitive, so he simply said he didn\'t have time for it.</p>' +
        '<p>Once, he claims to have drunk mead at Mimir\'s well. He drank seven cups. They charged him seven eyes for it. Since he only had two, he paid with both his eyes, both his knees, three fingers of his left hand, and a piece of his soul. In return, he gained the wisdom of a god.</p>' +
        '<p>When he died for the tenth time, he ended up on Anubis\'s scale. Zeferino\'s heart was so heavy it sank the scale, cracked the temple floor, and kept sinking — letting him escape once again, successfully.</p>' +
        '<p>Zeferino also once met the Brazilian entity known as Curupira, who asked him for a remedy to remove genipap stains from the skin, having turned too purple after a bet with Boitatá. Zeferino taught him the recipe and, in exchange, asked for only one night without nightmares. He slept, for the first time in centuries, like a child.</p>' +
        '<p>The legends about him are always astonishing, but when he puts his aura on the line, no one stays nearby. Shin Hae says the old man would be capable of destroying the sky itself if it ever annoyed him.</p>',
      stats: { ifc: 100, ccm: 100, lrb: 100, acg: 100, tpc: 100, ceo: 100, fdv: 100, icf: 100 },
      apexTier: 'Unclassifiable — exceeds scale range',
      mascaraTier: 'Unranked'
    },
    {
      id: 3,
      nome: 'Hermes',
      categoria: 'Personagem Principal',
      titulo: '',
      raca: '',
      faccao: 'Eden and Project KaIi',
      status: 'Vivo',
      imagem: 'https://i.pinimg.com/1200x/98/6a/e9/986ae93e4e01abd3b2e844961fa249a4.jpg',
      descricao: '<h3>Skills</h3>' +
        '<div class="skill-grid">' +
        '<div class="skill-item"><h4>相対論的時間拡張 (Sōtairon-teki Jikan Kakuchō)</h4><p>Instead of halting time on a global scale, Hermes locally manipulates the Higgs field around himself through Ether, reducing his own inertial mass to near zero. This lets his neural impulses and movement occur at a significant fraction of light speed, making him appear to teleport — or the world appear to freeze — to outside observers. The resulting kinetic friction with air molecules is dissipated as harmless heat by his coat, purpose-built to prevent what would otherwise be a nuclear-scale release of energy.</p></div>' +
        '<div class="skill-item"><h4>The Everett Tower</h4><p>Based on the Many-Worlds Interpretation, Hermes treats time not as a line but as a tree of superposed probable futures. When activated, he links his consciousness to the Entropic Ether, briefly pulling the physical state or knowledge of a possible future version of himself into the present — for example, dodging a fatal blow by overlaying the outcome of a future where he already dodged it. The cost is entropic: retrieving that state collapses the wave function, permanently erasing the future he drew from. Each use burns away a timeline where he could have been happy, found a cure, or won, and the Entropic Ether left behind slowly poisons him.</p></div>' +
        '</div>',
      stats: { ifc: 35, ccm: 80, lrb: 40, acg: 85, tpc: 70, ceo: 75, fdv: 90, icf: 80 },
      apexTier: 'Avançado'
    }
  ],
  nextPersonagemId: 4,

  equipe: [
    { nome: 'Rick', cargo: 'Dono e Moderador', foto: 'https://i.pinimg.com/736x/02/bc/1d/02bc1ddfb478c7069ac1db5017955648.jpg' },
    { nome: 'Mand Eden', cargo: 'Criador, Escritor e Dono da Obra', foto: '' },
    { nome: 'Ghostmaker', cargo: 'Criador, Escritor e Vice-Dono da Obra', foto: '' },
    { nome: 'Scautz', cargo: 'Criador e Escritor', foto: 'https://i.pinimg.com/736x/55/86/5a/55865a10f994f2379e4a4ac484def034.jpg' },
    { nome: 'Lucas Kabii', cargo: 'Criador e Colaborador', foto: 'https://i.pinimg.com/control1/736x/94/b1/6b/94b16b73301e10ea0b4f5a63500cc619.jpg' }
  ],

  session: null
};

function saveDB() {
  try { localStorage.setItem('forum-antigo-db-v18', JSON.stringify(DB)); } catch (e) {}
}

function loadDB() {
  try {
    var saved = localStorage.getItem('forum-antigo-db-v18');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed && parsed.nextUserId) DB = parsed;
    }
  } catch (e) {}

  if (DB.session) {
    var liveUser = DB.users.find(function(u) { return u.id === DB.session.id; });
    DB.session = liveUser || null;
  }
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

function bumpPosts() {
  if (!DB.session) return;
  DB.session.posts = (DB.session.posts || 0) + 1;
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
    var lastInfo = lastThread ? ('<a onclick="navigate(\'thread\',' + lastThread.id + ')">' + h(lastThread.title.substring(0, 35)) + '...</a><br><small style="color:#888;">' + lastThread.date + '</small>') : '<span style="color:#888;">Nenhum</span>';

    html += '<div class="cat-header"><span>' + h(cat.name) + '</span>';
    if (DB.session) html += '<button class="btn btn-small btn-success" onclick="startNewThread(' + cat.id + ')">+ Novo Tópico</button>';
    html += '</div>';
    html += '<table class="forum-table"><thead><tr><th style="width:45%">Categoria</th><th>Tópicos</th><th>Posts</th><th>Último Post</th></tr></thead><tbody>';
    html += '<tr><td><a onclick="navigate(\'cat\',' + cat.id + ')">' + h(cat.name) + '</a><br><small style="color:#666;">' + h(cat.desc) + '</small></td>';
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
  threads.sort(function(a, b) { return b.pinned - a.pinned || b.id - a.id; });

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> &raquo; ' + h(cat.name) + '</div>';
  html += '<div class="cat-header"><span>' + h(cat.name) + '</span>';
  if (DB.session) html += '<button class="btn btn-small btn-success" onclick="startNewThread(' + cat.id + ')">+ Novo Tópico</button>';
  html += '</div>';
  html += '<table class="forum-table"><thead><tr><th>Tópico</th><th>Autor</th><th>Respostas</th><th>Views</th><th>Último Post</th></tr></thead><tbody>';

  if (!threads.length) {
    html += '<tr><td colspan="5" style="text-align:center;color:#888;padding:20px;">Nenhum tópico ainda. <a onclick="startNewThread(' + cat.id + ')">Criar o primeiro!</a></td></tr>';
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
    html += '<a onclick="navigate(\'thread\',' + t.id + ')">' + h(t.title) + '</a>';
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
  thread.views = (thread.views || 0) + 1;
  saveDB();

  var posts = DB.posts.filter(function(p) { return p.threadId === currentThread; });
  var tagClass = 'tag-' + (thread.tag || 'ooc');

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> &raquo; <a onclick="navigate(\'cat\',' + thread.catId + ')">' + h(cat ? cat.name : '') + '</a> &raquo; ' + h(thread.title) + '</div>';
  html += '<div class="thread-tools">';
  html += '<h2><span class="tag ' + tagClass + '">' + (thread.tag || 'ooc').toUpperCase() + '</span> ' + h(thread.title) + '</h2>';
  html += '<div style="display:flex;gap:5px;">';
  if (podeEditarThread(thread.authorId)) {
    html += '<button class="btn btn-warn btn-small" onclick="editarThread(' + thread.id + ')">Editar</button>';
    html += '<button class="btn btn-danger btn-small" onclick="deleteThread(' + thread.id + ')">Deletar Tópico</button>';
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
      html += '<a onclick="quotePost(' + post.id + ')">Citar</a>';
      if (podeEditarPost(post.authorId)) {
        html += '<a onclick="editPost(' + post.id + ')">Editar</a>';
        html += '<a class="danger-link" onclick="deletePost(' + post.id + ')">Deletar</a>';
      }
    }
    html += '</div></div></div>';
  });

  if (DB.session) {
    html += '<div class="reply-box">';
    html += '<div class="reply-title"><span>Responder ao Tópico</span><span>' + h(DB.session.username) + '</span></div>';
    html += '<div class="reply-inner">';
    html += buildEditor('reply-editor', '');
    html += '<div style="margin-top:8px;"><button class="btn btn-primary" onclick="submitReply()">Enviar Resposta</button></div>';
    html += '</div></div>';
  } else {
    html += '<div class="alert alert-info" style="margin-top:10px;"><a onclick="showLoginModal()">Faça login</a> para responder neste tópico.</div>';
  }

  return html;
}

function renderNovaThread() {
  if (!DB.session) return '<div class="alert alert-error">Você precisa estar logado.</div>';
  var selCat = currentCat || 1;
  var isEdit = editandoThread !== null;
  var thr = isEdit ? DB.threads.find(function(t) { return t.id === editandoThread; }) : null;
  var priPost = isEdit ? DB.posts.find(function(p) { return p.threadId === editandoThread; }) : null;

  var html = '<div class="breadcrumb"><a onclick="navigate(\'forum\')">Fórum</a> &raquo; ' + (isEdit ? 'Editar Tópico' : 'Novo Tópico') + '</div>';
  html += '<div class="cat-header"><span>' + (isEdit ? 'Editar Tópico' : 'Criar Novo Tópico') + '</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';

  if (!isEdit) {
    html += '<div class="form-row"><label>Categoria</label><select id="thread-cat">';
    DB.categories.forEach(function(c) {
      html += '<option value="' + c.id + '"' + (c.id === selCat ? ' selected' : '') + '>' + h(c.name) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="form-row"><label>Tipo</label><select id="thread-tag"><option value="ooc">OOC (Discussão fora do personagem)</option><option value="rp">RP (Cena de Roleplay)</option><option value="wiki">Wiki / Lore</option></select></div>';
  }

  html += '<div class="form-row"><label>Título</label><input type="text" id="thread-title" value="' + (thr ? ha(thr.title) : '') + '" placeholder="Título do tópico"></div>';
  html += '<div class="form-row"><label>Conteúdo</label>';
  html += buildEditor('thread-editor', priPost ? priPost.content : '');
  html += '</div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px;">';
  if (isEdit) {
    html += '<button class="btn btn-primary" onclick="salvarEdicaoThread()">Salvar Alterações</button>';
  } else {
    html += '<button class="btn btn-primary" onclick="submitThread()">Publicar Tópico</button>';
  }
  html += '<button class="btn btn-small" onclick="navigate(\'forum\')">Cancelar</button></div>';
  html += '</div>';
  return html;
}

function renderCharCard(p) {
  var statusColor = p.status === 'Vivo' || p.status === 'Viva' ? '#007700' : (p.status === 'Afastada' || p.status === 'Afastado' ? '#774400' : '#770000');
  var html = '<div class="char-card" onclick="navigate(\'personagemView\',' + p.id + ')">';
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
    html += '<div style="display:flex;gap:5px;"><button class="btn btn-warn btn-small" onclick="editarPersonagem(' + p.id + ')">Editar</button><button class="btn btn-danger btn-small" onclick="deletarPersonagem(' + p.id + ')">Deletar</button></div>';
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
    html += '<div>' + buildRadarChart(p.stats) + '</div>';
    html += '<div class="apex-readout">';
    var apexLabels = ['IFC', 'CCM', 'LRB', 'ACG', 'TPC', 'CEO', 'FDV', 'ICF'];
    var apexKeys = ['ifc', 'ccm', 'lrb', 'acg', 'tpc', 'ceo', 'fdv', 'icf'];
    for (var si = 0; si < apexLabels.length; si++) {
      var valorStat = p.stats[apexKeys[si]] !== undefined ? p.stats[apexKeys[si]] : 0;
      html += '<div class="apex-stat-row"><span class="apex-stat-label">' + apexLabels[si] + '</span><span class="apex-stat-bar"><span class="apex-stat-bar-fill" style="width:' + valorStat + '%;"></span></span><span class="apex-stat-value">' + valorStat + '</span></div>';
    }
    html += '</div></div>';
  }

  html += '<div style="clear:both;margin-top:15px;"><a onclick="navigate(\'wiki\')" class="btn btn-primary btn-small">Voltar</a></div>';
  return html;
}

function buildRadarChart(stats) {
  var labels = ['IFC', 'CCM', 'LRB', 'ACG', 'TPC', 'CEO', 'FDV', 'ICF'];
  var keys = ['ifc', 'ccm', 'lrb', 'acg', 'tpc', 'ceo', 'fdv', 'icf'];
  var n = labels.length;
  var size = 260;
  var cx = size / 2;
  var cy = size / 2;
  var maxR = 90;
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
    svg += '<polygon points="' + pontosAnel.trim() + '" fill="none" stroke="#aab6cc" stroke-width="1"></polygon>';
  }

  for (var i = 0; i < n; i++) {
    var ang = (Math.PI * 2 / n) * i - Math.PI / 2;
    var xEixo = cx + maxR * Math.cos(ang);
    var yEixo = cy + maxR * Math.sin(ang);
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + xEixo.toFixed(1) + '" y2="' + yEixo.toFixed(1) + '" stroke="#aab6cc" stroke-width="1"></line>';
    var lx = cx + (maxR + 22) * Math.cos(ang);
    var ly = cy + (maxR + 22) * Math.sin(ang);
    var anchor = 'middle';
    if (lx < cx - 5) anchor = 'end';
    if (lx > cx + 5) anchor = 'start';
    svg += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="9" fill="#1a2860" text-anchor="' + anchor + '" font-family="Verdana">' + h(labels[i]) + '</text>';
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
  svg += '<polygon points="' + pontosDado.trim() + '" fill="rgba(58,80,128,0.35)" stroke="#1a2860" stroke-width="2"></polygon>';
  svg += '</svg>';
  return svg;
}

function renderNovoPersonagem() {
  if (!isModOrAdmin()) return '<div class="alert alert-error">Acesso negado.</div>';

  var editId = sessionStorage.getItem('editPersonagemId');
  var existing = editId ? DB.personagens.find(function(p) { return p.id === parseInt(editId); }) : null;

  var html = '<div class="breadcrumb"><a onclick="navigate(\'wiki\')">Personagens</a> &raquo; ' + (existing ? 'Editar Personagem' : 'Novo Personagem') + '</div>';
  html += '<div class="cat-header"><span>' + (existing ? 'Editar Personagem' : 'Cadastrar Personagem') + '</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>Nome</label><input type="text" id="p-nome" value="' + (existing ? ha(existing.nome) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Categoria</label><select id="p-categoria"><option value="Personagem Principal"' + (!existing || existing.categoria !== 'Sub-Personagem' ? ' selected' : '') + '>Personagem Principal</option><option value="Sub-Personagem"' + (existing && existing.categoria === 'Sub-Personagem' ? ' selected' : '') + '>Sub-Personagem</option></select></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Título</label><input type="text" id="p-titulo" value="' + (existing ? ha(existing.titulo) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Raça</label><input type="text" id="p-raca" value="' + (existing ? ha(existing.raca) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Facção</label><input type="text" id="p-faccao" value="' + (existing ? ha(existing.faccao) : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>Status</label><input type="text" id="p-status" value="' + (existing ? ha(existing.status) : '') + '" placeholder="Vivo, Falecido, Afastado..."></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>URL da Imagem</label><input type="text" id="p-imagem" value="' + (existing ? ha(existing.imagem) : '') + '" placeholder="https://..."></div>';
  html += '</div>';
  html += '<div class="form-row"><label>Descrição / Lore (editor completo)</label>';
  html += buildEditor('p-editor', existing ? existing.descricao : '');
  html += '</div>';

  var st = (existing && existing.stats) ? existing.stats : {};
  html += '<div class="cat-header" style="margin-top:10px;"><span>Apex Scale</span></div>';
  html += '<div style="border:1px solid #8899aa;background:#fff;padding:12px;margin-bottom:10px;">';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">';
  html += '<div class="form-row" style="margin-bottom:0"><label>IFC</label><input type="text" id="p-stat-ifc" value="' + (st.ifc !== undefined ? st.ifc : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>CCM</label><input type="text" id="p-stat-ccm" value="' + (st.ccm !== undefined ? st.ccm : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>LRB</label><input type="text" id="p-stat-lrb" value="' + (st.lrb !== undefined ? st.lrb : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>ACG</label><input type="text" id="p-stat-acg" value="' + (st.acg !== undefined ? st.acg : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>TPC</label><input type="text" id="p-stat-tpc" value="' + (st.tpc !== undefined ? st.tpc : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>CEO</label><input type="text" id="p-stat-ceo" value="' + (st.ceo !== undefined ? st.ceo : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>FDV</label><input type="text" id="p-stat-fdv" value="' + (st.fdv !== undefined ? st.fdv : '') + '"></div>';
  html += '<div class="form-row" style="margin-bottom:0"><label>ICF</label><input type="text" id="p-stat-icf" value="' + (st.icf !== undefined ? st.icf : '') + '"></div>';
  html += '</div>';
  html += '<div class="field-desc">Cada eixo vai de 0 a 100.</div>';
  html += '<div class="form-row" style="margin-top:8px;"><label>Classificação Apex Scale</label><input type="text" id="p-apex-tier" value="' + (existing ? ha(existing.apexTier) : '') + '" placeholder="Iniciante, Intermediário, Expert..."></div>';
  html += '<div class="form-row"><label>Classificação segundo A Máscara (opcional)</label><input type="text" id="p-mascara-tier" value="' + (existing ? ha(existing.mascaraTier) : '') + '"></div>';
  html += '</div>';

  var btnLabel = existing ? 'Salvar Alterações' : 'Cadastrar Personagem';
  var onclick = existing ? 'salvarEdicaoPersonagem(' + existing.id + ')' : 'submitPersonagem()';
  html += '<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-primary" onclick="' + onclick + '">' + btnLabel + '</button><button class="btn btn-small" onclick="navigate(\'wiki\')">Cancelar</button></div>';
  html += '</div>';
  return html;
}

function renderPerfil() {
  if (!DB.session) {
    return '<div class="alert alert-info">Você não está logado. <a onclick="showLoginModal()">Entrar</a> ou <a onclick="navigate(\'registro\')">cadastrar-se</a>.</div>';
  }
  var u = DB.session;
  var html = '<div class="breadcrumb">Início &raquo; Perfil</div>';
  html += '<div class="cat-header"><span>Perfil de ' + h(u.username) + '</span></div>';
  html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';
  html += '<table class="forum-table"><tbody>';
  html += '<tr><td><b>Usuário</b></td><td>' + h(u.username) + '</td></tr>';
  html += '<tr><td><b>Título</b></td><td>' + h(u.title) + ' ' + badgeHtml(u) + '</td></tr>';
  html += '<tr><td><b>Email</b></td><td>' + h(u.email) + '</td></tr>';
  html += '<tr><td><b>Posts</b></td><td>' + (u.posts || 0) + '</td></tr>';
  html += '<tr><td><b>Cadastrado em</b></td><td>' + h(u.joinDate) + '</td></tr>';
  html += '</tbody></table>';
  html += '</div>';

  if (u.role !== 'admin') {
    html += '<div class="cat-header" style="margin-top:14px;"><span>Validação de ADM (1 tentativa)</span></div>';
    html += '<div style="background:#f8f9ff;border:1px solid #8899aa;padding:16px;">';
    if (jaTentouValidarAdmin()) {
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
  html += '<p>Éterverso é um fórum para postar histórias, criar fichas de personagem e discutir roleplay. Tudo fica guardado em um banco de dados próprio do projeto.</p>';
  html += '<p>O Éterverso constitui um universo ficcional de Roleplay (RPG) de autoria original, cujos personagens, enredos, ambientações e demais elementos narrativos são de criação e titularidade exclusiva de seus idealizadores e mantenedores. Eventuais imagens de referência utilizadas nas fichas de personagens — sejam elas extraídas de wikis, bancos de imagem ou outras fontes externas — são empregadas estritamente como recurso ilustrativo e de caráter não-comercial, sob amparo dos princípios de uso justo e de citação para fins de caracterização ficcional, não configurando, em nenhuma hipótese, apropriação de autoria sobre a obra literária em si, a qual permanece integralmente resguardada por direito autoral em favor de seus criadores.</p>' +
    '<p>Está nos planos do projeto, a médio e longo prazo, expandir o Éterverso para além deste fórum: a proposta é transformá-lo em uma plataforma aberta a todos os rpgistas textuais que desejem narrar histórias dentro deste universo, além de dar origem, futuramente, a uma série de livros baseada no material produzido pela comunidade e pelos criadores originais.</p>';
  html += '</div>';

  html += '<div class="cat-header" style="margin-top:14px;"><span>Equipe Atual</span></div>';
  DB.equipe.forEach(function(m) {
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
    html += '<select onchange="alterarCargoUsuario(' + u.id + ', this.value)">';
    html += '<option value="member"' + (u.role === 'member' ? ' selected' : '') + '>Membro</option>';
    html += '<option value="moderador"' + (u.role === 'moderador' ? ' selected' : '') + '>Moderador</option>';
    html += '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>';
    html += '</select>';
    html += ' <button class="btn btn-small btn-danger" onclick="deletarUsuario(' + u.id + ')">Excluir</button>';
    html += '</td></tr>';
  });
  html += '</tbody></table>';

  html += '<div class="cat-header"><span>Categorias</span></div>';
  html += '<table class="forum-table"><thead><tr><th>Nome</th><th>Descrição</th><th>Ações</th></tr></thead><tbody>';
  DB.categories.forEach(function(c) {
    html += '<tr><td>' + h(c.name) + '</td><td>' + h(c.desc) + '</td><td><button class="btn btn-small btn-danger" onclick="removerCategoria(' + c.id + ')">Excluir</button></td></tr>';
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

function doLogin() {
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;
  var user = DB.users.find(function(u) { return u.username.toLowerCase() === username.toLowerCase(); });
  if (!user || user.password !== password) {
    showAlert('Usuário ou senha incorretos.', 'error');
    return;
  }
  DB.session = user;
  saveDB();
  closeModal();
  navigate('forum');
  showAlert('Login realizado com sucesso.', 'success');
}

function doLogout() {
  DB.session = null;
  saveDB();
  navigate('forum');
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
  var existe = DB.users.find(function(u) { return u.username.toLowerCase() === username.toLowerCase(); });
  if (existe) {
    showAlert('Esse nome de usuário já existe.', 'error');
    return;
  }

  var agora = new Date();
  var novo = {
    id: DB.nextUserId++,
    username: username,
    password: password,
    email: email,
    avatar: '',
    title: 'Membro',
    posts: 0,
    role: 'member',
    bio: '',
    joinDate: agora.toLocaleDateString('pt-BR'),
    admTentativaUsada: false
  };
  DB.users.push(novo);
  DB.session = novo;
  saveDB();
  navigate('forum');
  showAlert('Cadastro realizado. Bem-vindo(a)!', 'success');
}

function startNewThread(catId) {
  currentCat = catId;
  editandoThread = null;
  navigate('novaThread');
}

function submitThread() {
  if (!DB.session) { showAlert('Faça login para criar tópicos.', 'error'); return; }
  var title = document.getElementById('thread-title').value.trim();
  var content = getEditorContent('thread-editor');
  var catId = parseInt(document.getElementById('thread-cat').value);
  var tag = document.getElementById('thread-tag').value;
  if (!title || !content || content === '<br>') { showAlert('Preencha o título e o conteúdo!', 'error'); return; }
  var now = new Date();
  var dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  var newThread = { id: DB.nextThreadId++, catId: catId, title: title, authorId: DB.session.id, date: dateStr, views: 0, pinned: false, tag: tag };
  var newPost = { id: DB.nextPostId++, threadId: newThread.id, authorId: DB.session.id, date: dateStr, content: content, edited: false };
  DB.threads.push(newThread);
  DB.posts.push(newPost);
  bumpPosts();
  saveDB();
  editandoThread = null;
  navigate('thread', newThread.id);
}

function editarThread(threadId) {
  var thread = DB.threads.find(function(t) { return t.id === threadId; });
  if (!thread) return;
  if (!podeEditarThread(thread.authorId)) { showAlert('Você não tem permissão para editar este tópico.', 'error'); return; }
  editandoThread = threadId;
  navigate('novaThread');
}

function salvarEdicaoThread() {
  var thr = DB.threads.find(function(t) { return t.id === editandoThread; });
  if (!thr) return;
  if (!podeEditarThread(thr.authorId)) { showAlert('Você não tem permissão para salvar este tópico.', 'error'); return; }
  var title = document.getElementById('thread-title').value.trim();
  var content = getEditorContent('thread-editor');
  if (!title) { showAlert('O título não pode ficar vazio.', 'error'); return; }
  thr.title = title;
  var firstPost = DB.posts.find(function(p) { return p.threadId === editandoThread; });
  if (firstPost) { firstPost.content = content; firstPost.edited = true; }
  saveDB();
  var tid = editandoThread;
  editandoThread = null;
  navigate('thread', tid);
}

function deleteThread(threadId) {
  var thread = DB.threads.find(function(t) { return t.id === threadId; });
  if (!thread) return;
  if (!podeEditarThread(thread.authorId)) { showAlert('Você não tem permissão para deletar este tópico.', 'error'); return; }
  if (!confirm('Deletar este tópico inteiro e todas as respostas?')) return;
  var catId = thread.catId;
  DB.threads = DB.threads.filter(function(t) { return t.id !== threadId; });
  DB.posts = DB.posts.filter(function(p) { return p.threadId !== threadId; });
  saveDB();
  navigate('cat', catId);
}

function submitReply() {
  if (!DB.session) { showAlert('Faça login para responder.', 'error'); return; }
  var content = getEditorContent('reply-editor');
  if (!content || content === '<br>') { showAlert('Escreva algo antes de enviar!', 'error'); return; }
  var now = new Date();
  var dateStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  var newPost = { id: DB.nextPostId++, threadId: currentThread, authorId: DB.session.id, date: dateStr, content: content, edited: false };
  DB.posts.push(newPost);
  bumpPosts();
  saveDB();
  navigate('thread', currentThread);
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
    '<div style="margin-top:8px;"><button class="btn btn-primary" onclick="saveEditPost(' + postId + ')">Salvar</button></div>'
  );
}

function saveEditPost(postId) {
  var post = DB.posts.find(function(p) { return p.id === postId; });
  if (!post) return;
  if (!podeEditarPost(post.authorId)) { showAlert('Você não tem permissão para salvar este post.', 'error'); return; }
  var content = getEditorContent('edit-post-editor');
  if (!content) return;
  post.content = content;
  post.edited = true;
  saveDB();
  closeModal();
  navigate('thread', currentThread);
}

function deletePost(postId) {
  var post = DB.posts.find(function(p) { return p.id === postId; });
  if (!post) return;
  if (!podeEditarPost(post.authorId)) { showAlert('Você não tem permissão para deletar este post.', 'error'); return; }
  if (!confirm('Deletar este post?')) return;
  var postsInThread = DB.posts.filter(function(p) { return p.threadId === currentThread; });
  if (postsInThread.length <= 1) {
    if (!confirm('Esse é o único post — deletar vai apagar o tópico inteiro. Confirma?')) return;
    var thr = DB.threads.find(function(t) { return t.id === currentThread; });
    var catId = thr ? thr.catId : 1;
    DB.threads = DB.threads.filter(function(t) { return t.id !== currentThread; });
    DB.posts = DB.posts.filter(function(p) { return p.threadId !== currentThread; });
    saveDB();
    navigate('cat', catId);
    return;
  }
  DB.posts = DB.posts.filter(function(p) { return p.id !== postId; });
  saveDB();
  render();
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

function submitPersonagem() {
  if (!isModOrAdmin()) { showAlert('Apenas administradores e moderadores podem cadastrar personagens.', 'error'); return; }
  var nome = document.getElementById('p-nome').value.trim();
  var categoria = document.getElementById('p-categoria').value;
  var titulo = document.getElementById('p-titulo').value.trim();
  var raca = document.getElementById('p-raca').value.trim();
  var faccao = document.getElementById('p-faccao').value.trim();
  var status = document.getElementById('p-status').value.trim();
  var imagem = document.getElementById('p-imagem').value.trim();
  var descricao = getEditorContent('p-editor');
  var apexTier = document.getElementById('p-apex-tier').value.trim();
  var mascaraTier = document.getElementById('p-mascara-tier').value.trim();

  if (!nome || !descricao || descricao === '<br>') { showAlert('Preencha ao menos o nome e a descrição.', 'error'); return; }

  DB.personagens.push({
    id: DB.nextPersonagemId++,
    nome: nome,
    categoria: categoria,
    titulo: titulo,
    raca: raca,
    faccao: faccao,
    status: status,
    imagem: imagem,
    descricao: descricao,
    stats: lerStatsDoFormulario(),
    apexTier: apexTier,
    mascaraTier: mascaraTier
  });
  saveDB();
  navigate('wiki');
  showAlert('Personagem cadastrado.', 'success');
}

function salvarEdicaoPersonagem(id) {
  if (!isModOrAdmin()) { showAlert('Apenas administradores e moderadores podem editar personagens.', 'error'); return; }
  var p = DB.personagens.find(function(x) { return x.id === id; });
  if (!p) return;
  p.nome = document.getElementById('p-nome').value.trim();
  p.categoria = document.getElementById('p-categoria').value;
  p.titulo = document.getElementById('p-titulo').value.trim();
  p.raca = document.getElementById('p-raca').value.trim();
  p.faccao = document.getElementById('p-faccao').value.trim();
  p.status = document.getElementById('p-status').value.trim();
  p.imagem = document.getElementById('p-imagem').value.trim();
  p.descricao = getEditorContent('p-editor');
  p.stats = lerStatsDoFormulario();
  p.apexTier = document.getElementById('p-apex-tier').value.trim();
  p.mascaraTier = document.getElementById('p-mascara-tier').value.trim();
  saveDB();
  sessionStorage.removeItem('editPersonagemId');
  navigate('personagemView', id);
}

function deletarPersonagem(id) {
  if (!isModOrAdmin()) { showAlert('Apenas administradores e moderadores podem excluir personagens.', 'error'); return; }
  if (!confirm('Excluir este personagem?')) return;
  DB.personagens = DB.personagens.filter(function(p) { return p.id !== id; });
  saveDB();
  navigate('wiki');
}

function alterarCargoUsuario(id, novoCargo) {
  var u = getUserById(id);
  if (!u) return;
  if (DB.session && DB.session.id === id && novoCargo !== 'admin') {
    showAlert('Você não pode remover seu próprio cargo de admin por aqui.', 'error');
    render();
    return;
  }
  u.role = novoCargo;
  if (novoCargo === 'admin') u.title = 'Administrador';
  else if (novoCargo === 'moderador') u.title = 'Moderador';
  else u.title = 'Membro';
  saveDB();
  render();
}

function deletarUsuario(id) {
  if (DB.session && DB.session.id === id) { showAlert('Você não pode excluir sua própria conta por aqui.', 'error'); return; }
  if (!confirm('Excluir este usuário?')) return;
  DB.users = DB.users.filter(function(u) { return u.id !== id; });
  saveDB();
  render();
}

function adicionarCategoria() {
  var nome = document.getElementById('nova-cat-nome').value.trim();
  var desc = document.getElementById('nova-cat-desc').value.trim();
  if (!nome) { showAlert('Digite um nome para a categoria.', 'error'); return; }
  DB.categories.push({ id: Date.now(), name: nome, desc: desc });
  saveDB();
  render();
}

function removerCategoria(id) {
  if (!confirm('Excluir esta categoria? Os tópicos dentro dela também serão removidos.')) return;
  var threadIds = DB.threads.filter(function(t) { return t.catId === id; }).map(function(t) { return t.id; });
  DB.threads = DB.threads.filter(function(t) { return t.catId !== id; });
  DB.posts = DB.posts.filter(function(p) { return threadIds.indexOf(p.threadId) === -1; });
  DB.categories = DB.categories.filter(function(c) { return c.id !== id; });
  saveDB();
  render();
}

function verificarNomeAdmin(nome) {
  var ok = false;
  var nomeBaixo = nome.toLowerCase();
  if (nomeBaixo == 'admin') ok = true;
  if (nomeBaixo == 'administrador') ok = true;
  if (nomeBaixo == 'adm') ok = true;
  if (nome == 'Admin') ok = true;
  if (nome == 'ADM') ok = true;
  return ok;
}

function verificarCargoAdmin(cargo) {
  var pontos = 0;
  if (cargo == 'adm') pontos = pontos + 1;
  if (cargo == 'admin') pontos = pontos + 1;
  if (cargo == 'administrador') pontos = pontos + 2;
  if (cargo == 'moderador') pontos = pontos + 1;
  if (cargo == 'mod') pontos = pontos + 1;
  if (pontos > 0) {
    return true;
  } else {
    return false;
  }
}

function verificarNivelAcesso(nivel) {
  var nivelNumero = parseInt(nivel);
  if (isNaN(nivelNumero)) {
    nivelNumero = 0;
  }
  if (nivelNumero == 1) return true;
  if (nivelNumero >= 5) return true;
  if (nivelNumero == 99) return true;
  return false;
}

function calcularPontuacaoFinal(nome, cargo, nivel) {
  var pontuacao = 0;
  var resultadoNome = verificarNomeAdmin(nome);
  var resultadoCargo = verificarCargoAdmin(cargo);
  var resultadoNivel = verificarNivelAcesso(nivel);

  if (resultadoNome == true) pontuacao = pontuacao + 10;
  if (resultadoCargo == true) pontuacao = pontuacao + 10;
  if (resultadoNivel == true) pontuacao = pontuacao + 10;
  if (resultadoNome == false && resultadoCargo == true) pontuacao = pontuacao + 5;
  if (nome == '' && cargo == '') pontuacao = 0;

  return pontuacao;
}

function decidirSeEhAdmin(nome, cargo, nivel) {
  var pontuacao = calcularPontuacaoFinal(nome, cargo, nivel);
  var liberado = false;

  if (pontuacao >= 10) liberado = true;
  if (pontuacao >= 20) liberado = true;
  if (pontuacao < 10) liberado = false;
  if (nome == 'visitante') liberado = false;
  if (cargo == 'banido') liberado = true;

  return liberado;
}

function jaTentouValidarAdmin() {
  if (!DB.session) return true;
  if (DB.session.admTentativaUsada == true) return true;
  return false;
}

function onClickValidarAdmin() {
  if (!DB.session) return;
  var msg = document.getElementById('adm-message');
  var botao = document.getElementById('validar-adm');

  if (jaTentouValidarAdmin() == true) {
    if (msg) msg.textContent = 'Você já usou sua única tentativa.';
    if (botao) botao.disabled = true;
    return;
  }

  var nome = document.getElementById('adm-nome').value.trim();
  var cargo = document.getElementById('adm-cargo').value.trim().toLowerCase();
  var nivel = document.getElementById('adm-nivel').value.trim();

  var resultado = decidirSeEhAdmin(nome, cargo, nivel);
  DB.session.admTentativaUsada = true;

  if (resultado == true) {
    DB.session.role = 'admin';
    DB.session.title = 'Administrador';
    if (msg) msg.textContent = 'Acesso de administrador concedido (talvez).';
  } else {
    if (msg) msg.textContent = 'Acesso negado. Essa foi sua única tentativa.';
  }

  saveDB();
  updateTopBar();
  if (botao) botao.disabled = true;
  setTimeout(function() { navigate('perfil'); }, 900);
}

window.addEventListener('DOMContentLoaded', function() {
  loadDB();
  navigate('forum');
});
