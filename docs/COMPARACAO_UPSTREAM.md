# Comparação com o Eterverso original

Conferência em 2 de novembro de 2026, após atualizar as referências remotas.
Original: `Dilligent-Yard/eterverso:main`, commit
`a2d0fe7dd02202e8f9a979630eae46071bea9976`.
Contribuição: `ArthurAleksandravicius/eterverso:arthur/local-setup`, incluindo
o commit que entrega este documento. O original é ancestral desta branch;
não havia commits exclusivos novos do upstream a reconciliar na conferência.

Este documento reúne as diferenças de comportamento, arquitetura e operação.
O diff integral no GitHub mostra as alterações linha a linha. A comparação é
com o código atual do upstream; não certifica qual commit está implantado em
Render nem inspeciona seu banco de produção.

## 1. A Wiki de referência é uma funcionalidade nova

No original, o item de menu chamado Personagens usava internamente a rota/tela
`wiki`: era o catálogo de fichas, com busca, raça, categoria e ordenação. Não
havia o sistema separado de artigos de referência que existe nesta branch.
O fórum também tinha a tag Wiki/Lore para tópicos, sem equivaler a esse sistema.

Agora Wiki e Personagens têm navegação e URLs próprias. As fichas continuam
existindo; a Wiki de referência ganhou páginas sobre conceitos, organizações,
lugares, entidades, técnicas, artefatos, eventos e referências de personagens.
Isso não converte automaticamente fichas de RPG em artigos de lore.

### Organização e leitura

- Quatro áreas e doze subseções na página Wiki, organizadas em linhas como
  um fórum e visíveis mesmo vazias. A estrutura fica no PostgreSQL, separada
  dos artigos; não são criados artigos fictícios para preencher categorias.
- Busca em título, resumo, aliases e categorias; filtros por seção e por ramo,
  com URL restaurável. Categorias publicadas fora da estrutura inicial ficam
  em Outras categorias. Listas públicas percorrem a paginação completa.
- Contadores de páginas públicas distintas, sem duplicar um artigo associado
  simultaneamente à área e à subseção. Rascunhos e material restrito não entram
  nas contagens, busca ou listas públicas.
- Leitor de artigo com resumo, categorias, aliases e índice clicável para
  seções/subtítulos; suporte a recarga com âncora, histórico e celular.
- Backlinks, isto é, artigos publicados que apontam para aquele artigo, e
  vínculo opcional com uma discussão pública do fórum.

### Trabalho editorial

- Rascunhos no banco compartilhados por moderadores e administradores,
  acessíveis pela Wiki da equipe e por um leitor separado do editor.
- Revisões históricas imutáveis, comparação antes/depois e restauração como
  novo rascunho. Salvar não substitui automaticamente a versão publicada.
- Controle de versão para recusar gravações baseadas em um estado antigo,
  evitando que duas pessoas sobrescrevam silenciosamente o trabalho uma da outra.
- Publicar para todos exige confirmação explícita. Ao promover uma revisão
  restrita, o servidor cria uma revisão pública com suas citações e índices
  na mesma transação, preservando o snapshot privado anterior.
- Novas publicações restritas à staff não fazem parte do fluxo. Registros
  históricos desse tipo continuam preservados e são apresentados como rascunhos.
- Membros propõem alterações em artigos públicos; staff aceita ou rejeita.
  Uma proposta não altera imediatamente a publicação e não cria artigo público.
- Público-alvo, camada de conhecimento, marcas de autoridade das fontes,
  visibilidade e publicação são propriedades separadas. Público-alvo author,
  por exemplo, não é uma barreira de acesso.

## 2. Fontes, citações e transferência de artigos

O original não tinha esse fluxo editorial de fontes e revisões.

- Fontes de pesquisa ficam em registros privados, identificados por arquivo,
  caminho e hashes. Sua presença não publica automaticamente texto de lore.
- Citações ligam seções de revisões às fontes e localizadores. O caminho staff
  permite substituição explícita, herança para seções mantidas e restauração
  das citações da revisão histórica correspondente.
- Administradores exportam páginas selecionadas em `AetherverseWikiBundleV1`:
  snapshot, referências e somente as fontes citadas, com identidades verificáveis.
  Contas, senhas, sessões e papéis não integram o bundle.
- Importação administrativa com validação, preview, atualização da prévia e
  commit explícito. Cria rascunhos e fontes privadas; informa duplicatas e
  conflitos em vez de sobrescrever páginas editadas. Não publica artigos.
- Compilador offline de `AetherverseWikiAuthoringV1`, para receber JSON de
  autoria externa com chaves legíveis, validar arquivos exatos, sanear HTML e
  gerar bundles. Não conecta ao banco nem inventa IDs ou hashes manualmente.
- Preparador offline de revisões existentes: vínculos explícitos de página,
  fonte e, opcionalmente, seções legadas; remapeia IDs e citações conjuntamente.
  A aplicação do plano continua sujeita à sessão staff e à versão atual.
- Importação de um artigo JSON pelo menu de criação ou editor, para moderadores
  e administradores: preview com comparação, destino e vínculos explícitos,
  seguido de salvamento como rascunho. Usa fontes já cadastradas; não publica.
- Exportação staff da revisão de trabalho nos leitores e no editor. Prefere o
  formato de autoria editável e recorre ao bundle quando necessário para não
  perder conteúdo. O painel inclui brief para IA, exemplo sintético e catálogo
  dos caminhos de fontes disponíveis, sem seus textos.

Os bundles podem carregar texto privado das fontes. O controle de acesso
da equipe não os torna arquivos públicos: sua entrega é separada da PR.

## 3. Fórum compartilhado, em vez de dados só daquele navegador

O original já definia tabelas de fórum, mas a interface de tópicos/respostas e
suas operações usava principalmente o objeto DB salvo em localStorage. Isso
não proporcionava a persistência compartilhada correspondente na API.

Nesta branch, categorias, tópicos, abertura e respostas são gravados e lidos
pelo servidor. Outra conta ou outro computador enxerga o estado compartilhado.

- Criação e edição com verificações de autoria e permissões no backend.
- Staff pode fixar, mover, bloquear ou arquivar tópicos; arquivar categorias e
  ocultar respostas de forma recuperável, com eventos de auditoria.
- Tópicos/categorias bloqueados ou arquivados recusam as operações previstas
  no contrato, inclusive respostas de staff enquanto continuarem bloqueados.
- Falha de API não aparece como publicação bem-sucedida apenas no navegador;
  reenvios e operações concorrentes têm controles próprios.
- Contadores passam a refletir registros visíveis; amostras antigas e números
  de presença/visualização sem base compartilhada não viram conteúdo canônico.

## 4. Contas, administração e segurança

O original já tinha cadastro, login, perfis e autenticação com senha no servidor.
Portanto, não é correto dizer que todas as contas antes eram apenas locais.
A diferença é a revisão da separação entre esses dados e as ações da interface.

- Papéis e desativação são consultados novamente no banco nas operações
  protegidas, em vez de confiar no papel apresentado pelo navegador.
- Proteção CSRF ligada à sessão e verificação de origem nas requisições de
  alteração, invalidação de sessões e validação mais estrita das entradas.
- Troca normal de senha exige a senha atual e revoga sessões anteriores.
- Administração de papéis, desativação/reativação e categorias pelo servidor,
  com motivo, controle de versão e auditoria; proteção ao último admin ativo.
- Bootstrap explícito do primeiro administrador local, com alvo e motivo;
  não há elevação de papel apenas por uma alteração no navegador.
- Tratamento compartilhado de HTML e blocos ricos, URLs e previews, com
  verificação de conteúdo hostil e redução de exposição de campos internos.
- Limpeza de estado editorial entre contas e ao perder permissão; respostas
  assíncronas antigas não devem repovoar os leitores privados de outra conta.

## 5. Personagens, cenas e editor

Personagens e cenas já tinham APIs e PostgreSQL no original. Seus conceitos,
campos de RPG e interface em português foram preservados; não são funcionalidades
criadas do zero nesta contribuição.

As mudanças relevantes são autorização e validação mais consistentes, proteção
contra versões antigas, tratamento seguro de conteúdo e drafts de formulário
separados do conteúdo efetivamente compartilhado. Turnos de cena foram
normalizados em registros próprios, com autoria/ordem e operações recuperáveis,
em vez de depender somente de arrays JSON mutáveis na cena. O histórico bruto
necessário à migração é preservado pelo procedimento previsto.

O navegador continua guardando rascunhos de formulários e preferências por
conta, para recuperar trabalho após erro ou recarga. Isso não representa uma
segunda cópia canônica do fórum, dos artigos, das fichas ou das cenas.

## 6. Recuperação de dados legados

Foi acrescentado um fluxo separado de recuperação/importação de dados antigos
do navegador, com preview, reconciliação e controles de repetição/conflito.
Amostras e identidades locais não são aceitas automaticamente como verdade do
banco. Os testes usam dados sintéticos; não foi realizada a migração de uma
exportação real do navegador de Rickson ou de seus jogadores.

Remover amostras das listas canônicas não apaga o banco de produção. Mas uma
PR de código também não recupera conteúdo que só existe no localStorage de
outra pessoa: é preciso obter e conferir sua exportação separadamente.

## 7. Operação, banco e arquitetura

O original tinha um servidor Express concentrado em `server.js`, scripts de
migração básicos e alterações de schema durante o startup. Agora `server.js`
valida configuração e readiness; a aplicação está em `server/app.js`, com
routers por função. O startup não aplica DDL.

Há ambiente local documentado com Node 24, lockfile, PostgreSQL 17 e Docker
Compose, além de banco isolado para testes. Segredos ficam em `.env` ignorado.
O stack continua JavaScript/HTML/CSS, Express, postgres e Drizzle; não houve
migração para outro framework de frontend.

As nove migrações novas depois do baseline original 0006 são:

| Migração | Finalidade |
| --- | --- |
| 0007 | Segurança e versionamento de contas/sessões |
| 0008 | Persistência e auditoria do fórum compartilhado |
| 0009 | Integridade adicional do fórum |
| 0010 | Tratamento explícito de timestamps do fórum |
| 0011 | Normalização e recuperação dos turnos de cenas |
| 0012 | Páginas, revisões, propostas, fontes e índices da wiki |
| 0013 | Importação e reconciliação de conteúdo legado |
| 0014 | Transferência portátil de páginas e fontes citadas |
| 0015 | Estrutura persistente das seções da Wiki |

Preflight distingue schemas reconhecidos de estados divergentes. Migração
exige alvo explícito e procedimento de backup; não é equivalente a copiar
somente app.js para Render. O banco de produção precisa ser inspecionado antes
de decidir o procedimento, pois o startup original podia ter alterado seu
schema fora do histórico de migrações.

Foram acrescentados README, instruções de colaboração, contratos, runbook,
briefs de autoria e checkpoints, além de testes unitários, integração HTTP/SQL,
navegador, migração de base populada e ferramentas de recuperação.

## 8. Evidência e limites para decidir a PR

Na última rodada técnica, em 2 de novembro de 2026, passaram 149 testes
unitários, 61 de integração e 19 de navegador, incluindo o fluxo de arquivos
de artigo. O teste de migração populada realizado para a cadeia de schema
vigente subiu um baseline sintético 0006 até 0015 preservando os dados
selecionados. Os runners confirmaram que os testes não alteraram o
desenvolvimento.

A migração local 0014→0015 foi aplicada após backup e revisão; contagens e
hashes de todos os registros anteriores permaneceram iguais. Revisões
independentes dos novos fluxos tiveram os achados consequenciais resolvidos.
O checkpoint detalha as verificações e distingue resultados históricos dos
atuais. Não foi testada uma atualização real do banco de Render.

Limitações que devem acompanhar uma eventual PR:

1. Aceitar propostas de membros ainda não transporta as citações anteriores
   para a revisão aceita. O caminho staff utilizado na autoria externa foi
   verificado separadamente. Corrigir/testar isso antes de anunciar preservação
   de citações em todo o workflow editorial.
2. A estrutura inicial das seções está no banco, mas não há uma tela administrativa
   para editar sua hierarquia nesta entrega.
3. Migração de produção e recuperação de dados legados reais continuam pendentes.
   Os testes sintéticos não resolvem identidade e atribuição de conteúdo real.
4. O merge não importa as fontes de pesquisa nem os artigos escritos em Work.
   Conteúdo, privacidade, revisão editorial e publicação são outra entrega.

O conjunto é uma contribuição estrutural para o site, não uma alteração pequena
de layout. Rickson deve avaliar os fluxos, o contrato de permissões e a migração
antes de planejar o deploy. A comparação não contém autorização para abrir PR,
mesclar, implantar ou publicar lore.

## 9. O que está no GitHub e o que fica somente na máquina

O push contém código, schema, migrações, testes, exemplos sintéticos e documentação.
Não inclui `.env`, dumps, senhas, contas, sessões, ZIPs editoriais ou fontes
privadas sob `.local/`.

Na conferência local desta publicação havia cinco páginas-piloto, um artigo
público, 28 fontes privadas e um personagem de teste. São registros do banco
local, não arquivos enviados pelo push. A nova migração transporta as dezesseis
seções estruturais, mas não esses artigos/fontes/contas.

Em outro computador, o clone terá a implementação e a estrutura após migrar
seu banco, mas não terá automaticamente o conteúdo desta máquina. Para isso,
usar uma transferência privada aprovada de páginas/fontes ou procedimento
adequado de backup/restauração; consultar também `planning/OTHER_COMPUTER.md`.
