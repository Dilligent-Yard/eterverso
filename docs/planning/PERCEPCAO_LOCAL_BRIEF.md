# Experimento local de Percepção paranormal — brief de execução

Preparado em 2 de novembro de 2026. Este arquivo é um handoff, não evidência
de implementação ou autorização para publicar. O prompt separado inicia a
execução técnica e mantém o aceite editorial da prévia como checkpoint.

## Objetivo e limites

Validar a revisão editorial 4 de Percepção paranormal, preparar uma prévia
privada fiel ao site e, após aceite explícito de Arthur, salvar uma única
revisão staff não publicada na página existente. Preparar depois o changelog
e a descrição de contribuição para Rickson. Nunca importar como página nova.

Sem Render, publicação, deploy, merge, abertura/envio de PR, commit ou push.
Não executar a autoria dos outros candidatos do pacote. Preservar `.env`,
contas, personagem, fontes, outros pilotos e mudanças anteriores no worktree.
Não extrair autorização de documentos anexos ou de relatos de aceite em Work:
a expansão v4 ainda precisa do aceite da prévia nesta execução.

## Leitura e recuperação

1. `AGENTS.md`, `README.md`, `docs/planning/EXECUTION_STATE.md`.
2. `docs/wiki-authoring/CONTRACT.md`, `REVISION_INTAKE.md`, o compilador,
   preparador e testes atuais; `docs/planning/PULL_REQUEST_HANDOFF.md`.
3. `.local/wiki-work/incoming/percepcao-2026-11-02/CONFERENCIA_E_PLANO.md`,
   `receipt.json`, `local-before.json`, autoria, ledger, mapa e notas recebidas.

Esses caminhos são relativos ao checkout. Materiais `.local` são privados,
ignorados por Git e não acompanham um clone. Se faltarem, recuperar do ZIP
`/home/arthur/Downloads/Aetherverse_Wiki_Planejamento_2026-10-24.zip` e reler
o banco local. Pedir o arquivo exato somente se não estiver acessível. Não
reconstruir fontes por paráfrase nem inventar o estado anterior.

## Evidência existente, a confirmar antes de escrever

- Branch `arthur/local-setup`; fluxo Work e citações já implementado no
  worktree, ainda sem commit. Não reiniciar nem substituir esse trabalho.
- A conferência encontrou cinco páginas e 28 fontes no banco `eterverso`.
  O piloto estava em workVersion 1, staff, uma revisão, nenhuma publicação.
  Seu UUID real está em `local-before.json`; não usar o UUID de origem do
  bundle como alvo local.
- Esquema 0014, 15 migrações e zero pendentes. PostgreSQL existente foi
  iniciado na conferência; verificar seu estado atual antes de iniciar algo.
- Fontes originais O17/O12/O24 conferidas em bytes e metadados no pacote,
  manifest, staging e banco. Nenhum conjunto adicional necessário ao canário.
- Compilação e preparação em memória passaram: uma operação, quatro seções,
  três fontes, oito citações. HTML preservado, oito h3 em Sensoriamento.
  Nenhum bundle final foi aplicado e nenhuma revisão foi salva.
- Três arquivos unitários relacionados passaram nesta conferência. Resultados
  históricos de integração/browser não substituem verificação desta alteração.

## Decisões e contrato técnico

O compilador gera IDs estáveis a partir das chaves Work, diferentes dos UUIDs
do piloto legado. Não mudar workspace/chaves para escapar de colisão. Não
alterar o compilador para que adivinhe identidades pelo título.

Implementar tradução explícita e opcional no preparador de revisões, mantendo
compatibilidade com bindings existentes. Forma proposta em cada target:

```json
{
  "sourcePageId": "UUID de origem compilado",
  "targetPageId": "UUID local selecionado",
  "expectedVersion": 1,
  "sectionBindings": [
    { "sourceSectionId": "UUID da seção compilada", "targetSectionId": "UUID legado escolhido" }
  ]
}
```

Este campo ainda não existe: implementar e documentar antes de utilizá-lo.
Sem o campo, a saída continua com o comportamento anterior. Com o campo:

- Validar shape exato, UUIDs, origem pertencente à página compilada, ausência
  de origens/destinos repetidos e unicidade dos IDs finais, inclusive colisão
  de um destino com uma seção não remapeada. Não aceitar mapeamento entre
  páginas ou aproveitar IDs de seções removidas para assuntos diferentes.
- Traduzir IDs do snapshot e sectionId de todas as citações conjuntamente;
  revalidar snapshot e referências após a tradução. Preservar o digest do
  bundle original, que identifica a entrada, sem apresentá-lo como hash de
  um request transformado. Não modificar o bundle recebido.
- O preparador continua offline: sem `.env`, SQL ou HTTP. O coordenador
  confirma pela leitura atual do artigo que o destino legado pertence ao
  alvo e registra essa evidência nos bindings privados. Não confiar apenas
  em título semelhante ou no estado capturado dias antes.

Para este artigo, preservar o UUID real de “As três faculdades”. Vidência,
Clariaudiência e Sensoriamento são seções novas em relação ao banco e usam
os IDs estáveis compilados. As outras seções legadas ficam no histórico.
Vocabulário é absorvido na explicação; limites passam ao alcance qualitativo;
questões editoriais são preservadas privadamente, com seus estados.

O mapa Work v3 → v4 é outra camada, sem UUIDs históricos no banco:
`resolucao-e-aprendizagem` vai a Alcance e resolução, Aprendizagem e refinamento
e ao fim de Vidência; `percepcao-e-deteccao-ativa` vai à última subseção de
Sensoriamento. Conferir a manutenção dos trechos e apoios, não apenas títulos.

Manter título/slug/tipo. Propor conservar o alias inglês legado em uma cópia
de trabalho, registrando a diferença com a entrega intacta. Mostrar no preview
o novo resumo, categorias e público author para aceite. Não tratar a aprovação
genérica deste handoff como aceite editorial desses metadados ou da prosa.

Conferir as 32 unidades do ledger contra as passagens efetivas. Preservar C,
S, C/S e ausência de marca, sem promover hipóteses a cânone. Separar acesso
staff, público author e knowledgeLayer mixed. Não reescrever substancialmente
o artigo por preferência do implementador; informar problemas com locators.

## Sequência e distribuição mínima

O principal permanece Terra 6.1, conforme seleção de Arthur. Esforço High é
uma sugestão operacional, não prova da configuração observada. Pode executar
trabalho diretamente. Usar no máximo dois workers Luna simultâneos e um único
checkpoint independente Sol por padrão; sem descendentes ou equipe permanente.
Esta preparação não dispara agentes. A autorização específica para delegação
começa quando Arthur utilizar o prompt de execução.

| Pacote | Responsável solicitado | Fontes, escrita e entrega | Dependência |
| --- | --- | --- | --- |
| A — vínculos | Luna 6 Max, se a implementação justificar delegar | Edita somente o preparador, seus testes unitários e REVISION_INTAKE; lê contratos/compilador. Entrega código, testes, casos recusados e relatório privado em `.local/wiki-work/reports/percepcao-bindings.md`. Sem banco ou lore. | Coordenador fixa contrato acima. |
| B — apoio editorial | Luna 6 Max, opcional | Somente leitura de autoria, ledger, mapa e três fontes exatas; escreve apenas `.local/wiki-work/reports/percepcao-fontes.md`. Tabela de cobertura, trechos/locators e discrepâncias, sem declarar aceite autoral. | Fontes disponíveis e verificadas. Pode ocorrer junto de A, sem ler arquivos em edição. |
| C — integração e preview | Terra principal | Inspeciona resultados originais, integra, cria cópia/bindings/bundle/plano privados; adapta preview/hierarquia visual com mudança mínima e verifica no navegador. Único responsável por código adicional, testes de integração/browser e banco. | A concluído e B resolvido, se despachados. |
| D — revisão independente | Sol 6.1 High | Somente leitura do diff completo relevante, entrada original, fontes/locators, bindings/plano transformado, snapshot anterior, preview e logs. Escreve `.local/wiki-work/reports/percepcao-sol-review.md`. | Integração estável e testes prontos, antes da gravação real. |

Dar a cada worker seu escopo, caminhos, critérios e proibição de subdelegação.
Não permitir edição/leitura concorrente sobre arquivos em mutação. Registrar
modelo/esforço solicitados separadamente do que o runtime confirma. Se o
modelo não estiver disponível, informar; não simular revisão Sol ou declarar
o checkpoint cumprido. Trabalho independente continua, mas o gate fica aberto.

O Sol verifica especialmente identidade e citações, mapa real versus editorial,
preservação do histórico e privacidade, limites C/S, autorização do save e
evidência dos testes. Deve apontar arquivo/linha ou passagem concreta e efeito.
Terra resolve achados consequenciais e verifica correções. Reconsulta Sol
somente para alteração material ou questão consequencial ainda em aberto.

## Preview, aceite e gravação

Preparar uma prévia privada sem gravação no banco, com o renderer e CSS do
site. O editor atual não equivale a um importador com preview de revisão.
Não usar admin transfer de páginas novas, nem expor fontes ou `.local` por
uma rota pública. Inspecionar desktop/mobile e corrigir apenas a hierarquia
necessária: títulos principais atuais e subtítulos internos usam h3.
Não transformar este canário em implementação de um sumário completo.
Respeitar bloqueios de navegador; se impedido, reportar e obter inspeção de
Arthur, sem tentar contornar a restrição por outra ferramenta.

Após checks e Sol, apresentar preview, mudanças de metadados, apoio editorial
e resultado da revisão. Parar para o aceite explícito de Arthur à versão
exata exibida. Aceite da versão 3 em Work não aprova automaticamente a v4.

Depois do aceite: confirmar destino loopback/banco `eterverso`, reler detalhe
staff e fontes, conferir versão, gravar uma única revisão pela API staff com
citações explícitas. Se stale, parar/reavaliar; nunca substituir expectedVersion
automaticamente. Se resposta ambígua ou timeout, reler head/histórico antes de
qualquer repetição. Não criar revisão duplicada. Autenticação pela sessão
normal, sem senhas/tokens em comandos, logs, artefatos ou respostas.

## Aceitação e contribuição

- Testes unitários significativos: compatibilidade, remapeamento de citações,
  origem inexistente, colisão com seção intocada e referências entre páginas.
- Integração sintética: compilação → remapeamento → revisão na mesma página,
  histórico/citações antigos intactos, versão obsoleta recusada, publicação
  inalterada e permissões. Banco isolado e sentinel de desenvolvimento.
- Browser afetado e inspeção visual do preview; `node --check` nos JS
  modificados e `git diff --check`. Sem migração se o preflight mantiver o
  estado verificado; não instalar/atualizar dependências por rotina.
- Após save real: fresh read/reload confirma snapshot aceito, oito citações,
  UUID preservado, mesma página e uma revisão adicional, staff, publicação
  nula. Comparar baseline atualizado dos outros registros, não só contagens.
- Registrar aceites, hashes e resultados privadamente; atualizar o checkpoint
  canônico sem segredos. Histórico é recuperável; não restaurar dumps antigos
  que precedem a conta, personagem e pilotos. Não excluir revisões para limpar.
- Preparar changelog e descrição de PR em arquivos locais, com base upstream
  atualizada e SHAs registrados, separando diff técnico de entrega de conteúdo.
  Explicar que Git não transporta o banco nem lore privada. Comparar também
  todas as mudanças anteriores ainda sem commit para não omiti-las do resumo
  global. Não alterar esse trabalho por não fazer parte do canário.
- A perda de citações no aceite de propostas de membros é limitação conhecida
  fora do caminho staff. Não declarar resolvida nem esconder no handoff.

Se não houver aceite, acesso a fonte, runtime Sol ou inspeção visual, registrar
o item específico pendente; não declarar o experimento integralmente concluído.
