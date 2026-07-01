var draftTimers = {};

function buildEditor(id, initialContent) {
  var html = '';
  html += '<div class="editor-wrap" id="wrap-' + id + '">';
  html += '<div class="editor-toolbar" id="tb-' + id + '">';
  html += '<select class="editor-select" onchange="execCmd(\'formatBlock\',this.value,\'' + id + '\');this.value=\'p\'"><option value="p">Parágrafo</option><option value="h1">Título 1</option><option value="h2">Título 2</option><option value="h3">Título 3</option><option value="pre">Código</option></select>';
  html += '<select class="editor-select" onchange="applyFont(\'' + id + '\',this.value);this.value=\'\'"><option value="">Fonte</option><option value="Verdana">Verdana</option><option value="Georgia">Georgia</option><option value="Times New Roman">Times</option><option value="Courier New">Courier</option></select>';
  html += '<select class="editor-select" onchange="execCmd(\'fontSize\',this.value,\'' + id + '\');this.value=\'\'"><option value="">Tamanho</option><option value="2">Pequeno</option><option value="3">Normal</option><option value="4">Médio</option><option value="5">Grande</option><option value="6">Enorme</option></select>';
  html += '<div class="sep"></div>';
  html += '<button type="button" data-cmd="bold" title="Negrito" onclick="execCmd(\'bold\',null,\'' + id + '\')"><b>N</b></button>';
  html += '<button type="button" data-cmd="italic" title="Itálico" onclick="execCmd(\'italic\',null,\'' + id + '\')"><i>I</i></button>';
  html += '<button type="button" data-cmd="underline" title="Sublinhado" onclick="execCmd(\'underline\',null,\'' + id + '\')"><u>S</u></button>';
  html += '<button type="button" data-cmd="strikeThrough" title="Tachado" onclick="execCmd(\'strikeThrough\',null,\'' + id + '\')"><s>T</s></button>';
  html += '<button type="button" title="Limpar formatação" onclick="execCmd(\'removeFormat\',null,\'' + id + '\')">Tx</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Alinhar à esquerda" onclick="execCmd(\'justifyLeft\',null,\'' + id + '\')">&#8676;</button>';
  html += '<button type="button" title="Centralizar" onclick="execCmd(\'justifyCenter\',null,\'' + id + '\')">&#8644;</button>';
  html += '<button type="button" title="Alinhar à direita" onclick="execCmd(\'justifyRight\',null,\'' + id + '\')">&#8677;</button>';
  html += '<button type="button" title="Justificar" onclick="execCmd(\'justifyFull\',null,\'' + id + '\')">Just</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Lista com marcadores" onclick="execCmd(\'insertUnorderedList\',null,\'' + id + '\')">• Lista</button>';
  html += '<button type="button" title="Lista numerada" onclick="execCmd(\'insertOrderedList\',null,\'' + id + '\')">1. Lista</button>';
  html += '<button type="button" title="Recuar" onclick="execCmd(\'indent\',null,\'' + id + '\')">&gt;&gt;</button>';
  html += '<button type="button" title="Voltar recuo" onclick="execCmd(\'outdent\',null,\'' + id + '\')">&lt;&lt;</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Citação" onclick="wrapTag(\'' + id + '\',\'blockquote\')">Citar</button>';
  html += '<button type="button" title="Spoiler" onclick="insertSpoiler(\'' + id + '\')">Spoiler</button>';
  html += '<button type="button" title="Bloco de código" onclick="insertCodeBlock(\'' + id + '\')">Código</button>';
  html += '<button type="button" title="Linha horizontal" onclick="execCmd(\'insertHorizontalRule\',null,\'' + id + '\')">Linha</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Inserir link" onclick="insertLink(\'' + id + '\')">Link</button>';
  html += '<button type="button" title="Inserir imagem" onclick="insertImage(\'' + id + '\')">Imagem</button>';
  html += '<button type="button" title="Inserir tabela" onclick="insertTable(\'' + id + '\')">Tabela</button>';
  html += '<div class="sep"></div>';
  html += '<select class="editor-select" onchange="applyColor(\'' + id + '\',this.value);this.value=\'\'"><option value="">Cor do texto</option><option value="#1a2860">Azul escuro</option><option value="#007700">Verde</option><option value="#aa0000">Vermelho</option><option value="#774400">Marrom</option><option value="#6644aa">Roxo</option><option value="#cc6600">Laranja</option><option value="#333333">Preto</option></select>';
  html += '<select class="editor-select" onchange="applyBgColor(\'' + id + '\',this.value);this.value=\'\'"><option value="">Fundo</option><option value="#fff2aa">Amarelo</option><option value="#dff1ff">Azul claro</option><option value="#e7ffd9">Verde claro</option><option value="#ffdede">Vermelho claro</option><option value="#eeeeee">Cinza</option></select>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Desfazer" onclick="execCmd(\'undo\',null,\'' + id + '\')">↶</button>';
  html += '<button type="button" title="Refazer" onclick="execCmd(\'redo\',null,\'' + id + '\')">↷</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" id="fs-btn-' + id + '" title="Tela cheia" onclick="toggleFullscreen(\'' + id + '\')">&#9974; Tela cheia</button>';
  html += '</div>';

  if (!initialContent && loadDraft(id)) {
    html += '<div class="editor-draft-bar" id="draft-' + id + '">Encontramos um rascunho salvo deste texto.';
    html += ' <a onclick="restaurarRascunho(\'' + id + '\')">Restaurar</a> ·';
    html += ' <a onclick="descartarRascunho(\'' + id + '\')">Descartar</a></div>';
  }

  html += '<div class="editor-body" id="' + id + '" contenteditable="true" data-placeholder="Escreva aqui..."' +
    ' oninput="onEditorInput(\'' + id + '\')"' +
    ' onkeyup="syncToolbarState(\'' + id + '\')"' +
    ' onmouseup="syncToolbarState(\'' + id + '\')"' +
    ' onpaste="handlePaste(event,\'' + id + '\')">' + (initialContent || '') + '</div>';
  html += '<div class="editor-status"><span>Editor completo</span><span id="count-' + id + '">0 caracteres</span></div>';
  html += '</div>';
  setTimeout(function() { updateEditorCount(id); }, 50);
  return html;
}

function execCmd(cmd, val, editorId) {
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand(cmd, false, val);
  syncToolbarState(editorId);
}

function wrapTag(editorId, tag) {
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('formatBlock', false, tag);
}

function applyColor(editorId, color) {
  if (!color) return;
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('foreColor', false, color);
}

function applyBgColor(editorId, color) {
  if (!color) return;
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('hiliteColor', false, color);
}

function applyFont(editorId, fontName) {
  if (!fontName) return;
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('fontName', false, fontName);
}

function insertLink(editorId) {
  var url = prompt('URL do link:');
  if (!url) return;
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('createLink', false, url);
}

function insertImage(editorId) {
  var url = prompt('URL da imagem:');
  if (!url) return;
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('insertImage', false, url);
}

function insertTable(editorId) {
  var linhas = prompt('Quantas linhas?', '2');
  var colunas = prompt('Quantas colunas?', '2');
  linhas = parseInt(linhas);
  colunas = parseInt(colunas);
  if (!linhas || !colunas) return;
  if (linhas < 1) linhas = 1;
  if (colunas < 1) colunas = 1;
  if (linhas > 8) linhas = 8;
  if (colunas > 6) colunas = 6;

  var html = '<table><tbody>';
  for (var i = 0; i < linhas; i++) {
    html += '<tr>';
    for (var j = 0; j < colunas; j++) {
      html += '<td>Texto</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table><p><br></p>';
  insertHtml(editorId, html);
}

function insertSpoiler(editorId) {
  var texto = prompt('Texto do spoiler:', 'spoiler');
  if (!texto) return;
  insertHtml(editorId, '<span class="spoiler">' + h(texto) + '</span>');
}

function insertCodeBlock(editorId) {
  var texto = prompt('Código ou trecho:');
  if (!texto) return;
  insertHtml(editorId, '<pre>' + h(texto) + '</pre><p><br></p>');
}

function insertHtml(editorId, html) {
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('insertHTML', false, html);
  onEditorInput(editorId);
}

function handlePaste(ev, editorId) {
  ev.preventDefault();
  var clipboard = ev.clipboardData || window.clipboardData;
  var texto = clipboard ? clipboard.getData('text/plain') : '';
  document.execCommand('insertText', false, texto);
  onEditorInput(editorId);
}

function onEditorInput(editorId) {
  updateEditorCount(editorId);
  scheduleDraftSave(editorId);
}

function updateEditorCount(editorId) {
  var el = document.getElementById(editorId);
  var count = document.getElementById('count-' + editorId);
  if (!el || !count) return;
  var texto = el.textContent || '';
  var textoLimpo = texto.trim();
  var palavras = textoLimpo ? textoLimpo.split(/\s+/).length : 0;
  count.textContent = texto.length + ' caracteres — ' + palavras + ' palavras';
}

function syncToolbarState(editorId) {
  var toolbar = document.getElementById('tb-' + editorId);
  if (!toolbar) return;
  var botoes = toolbar.querySelectorAll('button[data-cmd]');
  for (var i = 0; i < botoes.length; i++) {
    var botao = botoes[i];
    var cmd = botao.getAttribute('data-cmd');
    var ativo = false;
    try { ativo = document.queryCommandState(cmd); } catch (e) { ativo = false; }
    if (ativo) {
      botao.classList.add('active-btn');
    } else {
      botao.classList.remove('active-btn');
    }
  }
}

function toggleFullscreen(editorId) {
  var wrap = document.getElementById('wrap-' + editorId);
  var botao = document.getElementById('fs-btn-' + editorId);
  if (!wrap) return;
  wrap.classList.toggle('editor-fullscreen');
  if (botao) botao.textContent = wrap.classList.contains('editor-fullscreen') ? '⛶ Sair da tela cheia' : '⛶ Tela cheia';
}

function scheduleDraftSave(editorId) {
  if (draftTimers[editorId]) clearTimeout(draftTimers[editorId]);
  draftTimers[editorId] = setTimeout(function() { saveDraft(editorId); }, 800);
}

function saveDraft(editorId) {
  var el = document.getElementById(editorId);
  if (!el) return;
  try { localStorage.setItem('rascunho-' + editorId, el.innerHTML); } catch (e) {}
}

function loadDraft(editorId) {
  try { return localStorage.getItem('rascunho-' + editorId); } catch (e) { return null; }
}

function clearDraft(editorId) {
  try { localStorage.removeItem('rascunho-' + editorId); } catch (e) {}
}

function restaurarRascunho(editorId) {
  var el = document.getElementById(editorId);
  var rascunho = loadDraft(editorId);
  if (el && rascunho) el.innerHTML = rascunho;
  updateEditorCount(editorId);
  var barra = document.getElementById('draft-' + editorId);
  if (barra) barra.parentNode.removeChild(barra);
}

function descartarRascunho(editorId) {
  clearDraft(editorId);
  var barra = document.getElementById('draft-' + editorId);
  if (barra) barra.parentNode.removeChild(barra);
}

function getEditorContent(id) {
  var el = document.getElementById(id);
  return el ? el.innerHTML : '';
}
