# Wiki no site local: navegação editorial e índice

Planejado em 2 de novembro de 2026. Arthur autorizou planejar a implementação
no checkout local. Este documento não é evidência de implementação. Não
publicar lore nem fazer deploy, merge ou envio de PR.

Atualização de execução em 2 de novembro: navegação staff, leitor de rascunhos,
índice e publicação pública explícita foram implementados e testados conforme
EXECUTION_STATE. Em seguida, Arthur autorizou seções visíveis na própria página
Wiki, inclusive vazias. A migração 0015 adicionou o cadastro persistente de quatro
áreas/doze subseções públicas e seus filtros por ramo. Nomes estruturais públicos
não implicam publicação de artigos: contagens excluem todo conteúdo restrito.
Não foi criado um editor administrativo de taxonomia. O plano abaixo registra
as decisões de origem; EXECUTION_STATE registra as diferenças e a execução atual.

## Ponto de partida e resultado esperado

A revisão aprovada de Percepção paranormal está salva na página original:
workVersion 2, duas revisões, oito citações, staff e sem publicação. A leitura
posterior confirmou o snapshot exato aprovado, o histórico/citações antigos e
os outros quatro pilotos intactos. Fontes continuam 28. Evidência privada em
`.local/wiki-work/compiled/percepcao-2026-11-02/post-save-verification.json`.

Hoje `/wiki` lista exclusivamente publicações, e suas categorias são derivadas
dessas publicações. Logo, não é erro que o rascunho não apareça ali. A próxima
entrega deve permitir a staff navegar a estrutura editorial, inclusive áreas
vazias, e ler Percepção paranormal no layout real da Wiki com índice clicável.
Leitores públicos continuam vendo somente material publicado.

## Escopo proposto

1. Navegação em dois modos: Publicada e Equipe, com o segundo restrito a
   moderador/admin no servidor. Não inferir permissão de localhost ou de flags
   do navegador. Identificar claramente rascunhos e o modo editorial.
2. Estrutura de categorias independente da presença de artigos. Usar como
   proposta os navGroup/group do pacote editorial, sem importar seu catálogo
   inteiro como artigos vazios ou tratar candidatos como lore aprovada.
3. Leitura staff do head atual da página, usando o renderer compartilhado
   e o CSS do site, com breadcrumb, resumo, categorias e estado não publicado.
   Uma leitura não salva revisão nem move ponteiro publicado. Link separado
   para o editor existente.
4. Índice interno com links para seções e subtítulos, inclusive os oito de
   Sensoriamento; navegação por teclado e comportamento adequado no celular.
5. Testar o artigo salvo e categorias vazias no site de verdade. As capturas
   da prévia privada anterior não comprovam esta integração futura.

## Estrutura editorial inicial proposta

| Área | Subseções |
| --- | --- |
| Paranormalidade | Percepção; Classes; Feitiços e rituais; Fundamentos e transformações |
| Cosmologia | Conceitos e fenômenos; Planos e lugares; Religião; Vínculos arquetípicos |
| Sociedade e Instituições | Trabalho Paranormal; Vida social e instituições |
| Seres e Entidades | Personagens; Seres e entidades |

São quatro áreas e doze subseções propostas, recuperadas de `article-plan.json`
do pacote recebido. Nesta primeira versão, “Personagens” é uma categoria
editorial da wiki de referência; não duplicar, importar nem reclassificar
automaticamente as fichas da funcionalidade `/personagens`.

Vínculo inicial confirmado: Percepção paranormal → Paranormalidade / Percepção.
Mostrar os demais pilotos staff sem atribuir automaticamente equivalências
novas entre categorias legadas e a proposta. Uma área vazia deve mostrar
“Ainda não há artigos nesta seção”, com zero real, sem criar páginas fictícias.

## Persistência e interfaces

Adicionar registro persistente de taxonomia no PostgreSQL, em vez de derivar
a estrutura apenas de revisões ou gravá-la no localStorage. Proposta:
`wiki_taxonomy_nodes` com id, key única normalizada, nome, parentId, ordem,
visibilidade editorial e versão. Inicialmente todos os nós são staff.
Validar pais, impedir ciclos/autoparentesco e limitar esta entrega a dois níveis.
Seed idempotente explícito: não renomear nem sobrescrever registros editados.

Planejar a próxima migração livre após verificar novamente o journal. Se o
estado continuar 0014, será 0015. Atualizar schema, relações e verificações de
readiness; nunca executar DDL no startup. Backup local atual antes da migração,
preflight e procedimento documentado. Dumps antigos anteriores à conta e aos
pilotos não são baseline suficiente para esta mudança.

Categorias dos snapshots permanecem como estão. Relacionar suas chaves
normalizadas à taxonomia por correspondência exata nesta fase. Mostrar itens
sem correspondência no modo editorial, sem descartá-los. Não modificar
revisões antigas para preencher navegação. Contagens de área agregam páginas
distintas do ramo, sem duplicar um artigo que tenha categoria de pai e filho.

Reutilizar GET `/api/staff/wiki/pages` e `/api/staff/wiki/pages/:id` para os
heads autorizados. Propor GET `/api/staff/wiki/taxonomy` e parâmetros de filtro
validados para navegação editorial. A lista deve expor apenas metadados
necessários e suportar paginação completa; não truncar silenciosamente em 100.
Não incluir texto de fontes/citações privadas no payload geral de navegação.

URLs propostas: `/wiki?view=staff`, `/wiki/categoria/:key?view=staff` e
`/wiki/rascunhos/:id`. Ajustar parser/navigate e restaurar busca/categoria via
URL. O backend exige autenticação em cada leitura. Deslogar, trocar conta ou
perder papel limpa caches/dados staff e não deixa o artigo no DOM público.
Não alterar as regras ou DTOs dos endpoints públicos para tornar o teste visível.

## Índice e âncoras

Usar UUID de seção para IDs únicos, como `wiki-section-UUID`. A seção principal
permanece h2 e subtítulos internos h3, sem alterar seu HTML editorial armazenado.
O renderer pode preparar DOM a partir do HTML já saneado e atribuir âncoras aos
subtítulos; nunca inserir HTML não saneado nem confiar em atributos recebidos.
Usar texto escapado no índice, IDs com prefixo controlado e sufixo de desempate
para subtítulos homônimos. Não mudar UUIDs no banco para fabricar âncoras.

Índice hierárquico recolhível, com links reais e nomes compreensíveis. Desktop:
ao lado ou acima do artigo conforme o espaço; celular: acima do conteúdo, sem
coluna fixa. Respeitar redução de movimento, foco visível e scroll-margin para
o cabeçalho. O hash deve funcionar após a leitura assíncrona e em recarga,
voltar/avançar e link direto; não deixar o render do SPA devolver o leitor ao topo.
Se o conteúdo mudar e a âncora não existir, continuar mostrando o artigo.

## Ordem de implementação e verificação

1. Reconfirmar branch, diff, alvo local e baseline; preservar alterações sem
   commit. Fechar contrato de taxonomia e estados vazios antes de implementar.
2. Implementar e testar migração/taxonomia no banco isolado, incluindo baseline
   populado sintético, preservação dos dados e seed sem overwrite.
3. Implementar APIs/contagens/filtros e testes de autorização: visitante e
   membro não obtêm drafts, taxonomia staff, nomes, buscas ou contagens privados.
4. Implementar leitura staff e índice compartilhado. Testar UI no navegador:
   área vazia, ramo Percepção, abertura do artigo salvo, oito subtítulos,
   clique/foco/teclado, hashes, recarga, mobile, logout e cache entre contas.
5. Rodar testes relevantes, node --check e git diff --check; conferir sentinel
   de desenvolvimento. Inspeção visual real do site staff após migração local
   autorizada, sem publicar o artigo. Não contornar bloqueios de navegador.
6. Revisão independente Sol 6.1 High no limite estável desta entrega, focada
   em privacidade, migração preservadora e navegação. Evitar nova equipe grande.
7. Atualizar changelog/rascunho de PR contra upstream vigente, distinguindo
   implementação, dados locais e material editorial privado. Nenhum envio.

Concluído quando Mand, após login, encontra as áreas/subseções vazias e lê o
artigo salvo dentro da Wiki, usando o índice, enquanto um visitante não recebe
essa lore. Sua publicação permanece uma decisão editorial separada. Nenhuma
das funcionalidades acima deve ser descrita como pronta antes de sua execução.
