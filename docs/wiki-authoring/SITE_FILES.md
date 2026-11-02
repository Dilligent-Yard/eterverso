# Arquivos de artigo pela interface da Wiki

O formato JSON de autoria utilizado no pacote do Work chama-se
`AetherverseWikiAuthoringV1`. A interface de arquivos da Wiki reutiliza esse
contrato e o formato portátil existente, `AetherverseWikiBundleV1`, para um
artigo por arquivo. Limite: 4 MiB, JSON UTF-8, sem campos duplicados.

## Importar

Moderadores e administradores encontram “Importar artigo JSON e modelo para
IA” em Novo artigo e no editor de artigos existentes. A seleção do arquivo
solicita uma prévia ao servidor; não grava nem publica imediatamente.

O servidor valida estrutura, conteúdo e referências. Fontes precisam já existir
no banco de destino com identidades/bytes verificáveis; este fluxo não instala
arquivos de fontes novos. Caso faltem, utilizar o procedimento de fontes ou
transferências administrativas, com a autorização correspondente.

Um conjunto com mais de um arquivo de origem compatível exige escolha explícita.
A prévia mostra os caminhos/hashes efetivamente usados. Um artigo que coincide
com uma página existente não é importado automaticamente como novo: selecionar
o destino e validar a revisão. O editor já identifica seu próprio destino.

As identidades de seção podem ser conferidas no preview; vínculos só podem
apontar para seções daquele artigo. Arquivos exportados pelo site geram chaves estáveis a partir das identidades
locais; mantê-las permite reconhecer as seções existentes. Mudar as
escolhas invalida a prévia anterior e exige revalidação.

Compare a versão atual com a proposta, inclusive categorias, aliases, público,
seções e citações. “Salvar prévia como rascunho” cria uma página staff ou uma
nova revisão staff, mantendo o histórico e a publicação existente. Rascunhos
de formulário deste navegador são preservados e podem ficar desatualizados.

A prévia assinada é temporária, vinculada ao usuário e às versões/fontes
conferidas. O commit verifica novamente o estado. Um conflito exige nova
conferência; não alterar uma versão esperada para contornar o erro. Repetir
o mesmo commit não cria outra página/revisão. Depois de uma falha de conexão,
reutilizar a mesma prévia permite reconhecer a operação já concluída.

## Exportar

O botão “Exportar JSON da equipe” aparece somente para staff nos leitores e no
editor. Os endpoints também verificam o papel no servidor. A exportação usa a
versão de trabalho mais recente, que pode diferir do texto atualmente público.

Quando o artigo cabe sem perdas no contrato de autoria — seções citadas e sem
blocos estruturados adicionais — o arquivo é `AetherverseWikiAuthoringV1`, com
referências às fontes e chaves estáveis. Pode ser devolvido por uma IA após
edição e importado novamente com preview.

Quando esse contrato não representa todo o artigo, a exportação usa o bundle
portátil existente: conserva snapshots, blocos, citações e as fontes citadas.
Ele pode conter texto privado das fontes. Não o tratar como um arquivo público
apenas porque o artigo também tem uma versão pública.

O bundle completo também precisa caber em 4 MiB, incluindo suas fontes. Se
ultrapassar esse limite, a exportação informa o erro sem truncar conteúdo.
No formato de autoria, as fontes ficam no banco: são conferidas até 10 MiB
por documento e 100 MiB no conjunto citado, sem serem embutidas no JSON.

Bundles possuem hashes de integridade e não devem ser editados manualmente
como se fossem arquivos de autoria. Para pedir nova redação à IA, usar o brief
e o contrato de autoria; preservar conscientemente conteúdo que não caiba nesse
formato, em vez de descartar blocos ou referências silenciosamente.

## Brief e exemplo para IA

O painel oferece um brief mantido no código do servidor e um exemplo JSON
sintético. O brief baixado inclui o catálogo de caminhos/conjuntos de fontes
disponíveis naquele servidor, sem incluir o texto desses documentos.

Fornecer à IA as fontes que ela não tiver. Não pedir que invente caminhos,
localizadores, UUIDs, hashes ou cânone. O modelo é um exemplo de formatação,
não um artigo de lore pronto nem uma fonte a citar por conveniência.

O formato completo continua documentado em [CONTRACT.md](CONTRACT.md). O procedimento offline
e os bundles administrativos permanecem disponíveis; a interface de arquivos
não substitui a revisão editorial ou a autorização para publicar.
