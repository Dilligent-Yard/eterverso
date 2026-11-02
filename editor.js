function buildEditor(id, initialContent, placeholderText) {
  var ph = placeholderText || 'Escreva aqui...';
  var html = '';
  html += '<div class="editor-wrap" id="wrap-' + id + '">';
  html += '<div class="editor-toolbar" id="tb-' + id + '">';
  html += '<select class="editor-select" title="Formato de bloco" onchange="execCmd(\'formatBlock\',this.value,\'' + id + '\');this.value=\'p\'"><option value="p">Parágrafo</option><option value="h2">Título 1</option><option value="h3">Título 2</option><option value="h4">Subtítulo</option><option value="pre">Bloco de Código</option></select>';
  html += '<select class="editor-select" title="Tipografia" onchange="applyFont(\'' + id + '\',this.value);this.value=\'\'"><option value="">Tipografia</option><option value="Inter, sans-serif">Sans (Inter)</option><option value="Lora, Georgia, serif">Serif (Lora)</option><option value="Georgia, serif">Clássica (Georgia)</option><option value="JetBrains Mono, monospace">Mono (JetBrains)</option></select>';
  html += '<select class="editor-select" title="Tamanho da fonte" onchange="execCmd(\'fontSize\',this.value,\'' + id + '\');this.value=\'\'"><option value="">Tamanho</option><option value="2">Pequeno</option><option value="3">Normal</option><option value="4">Médio</option><option value="5">Grande</option><option value="6"> Destaque</option></select>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Negrito (Ctrl+B)" onclick="execCmd(\'bold\',null,\'' + id + '\')"><b>B</b></button>';
  html += '<button type="button" title="Itálico (Ctrl+I)" onclick="execCmd(\'italic\',null,\'' + id + '\')"><i>I</i></button>';
  html += '<button type="button" title="Sublinhado (Ctrl+U)" onclick="execCmd(\'underline\',null,\'' + id + '\')"><u>U</u></button>';
  html += '<button type="button" title="Tachado" onclick="execCmd(\'strikeThrough\',null,\'' + id + '\')"><s>S</s></button>';
  html += '<button type="button" title="Limpar formatação" onclick="execCmd(\'removeFormat\',null,\'' + id + '\')">Limpar</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Alinhar à esquerda" onclick="execCmd(\'justifyLeft\',null,\'' + id + '\')">Esq</button>';
  html += '<button type="button" title="Centralizar" onclick="execCmd(\'justifyCenter\',null,\'' + id + '\')">Centro</button>';
  html += '<button type="button" title="Alinhar à direita" onclick="execCmd(\'justifyRight\',null,\'' + id + '\')">Dir</button>';
  html += '<button type="button" title="Justificar" onclick="execCmd(\'justifyFull\',null,\'' + id + '\')">Just</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Lista com marcadores" onclick="execCmd(\'insertUnorderedList\',null,\'' + id + '\')">Lista</button>';
  html += '<button type="button" title="Lista numerada" onclick="execCmd(\'insertOrderedList\',null,\'' + id + '\')">1. Lista</button>';
  html += '<button type="button" title="Bloco de citação" onclick="wrapTag(\'' + id + '\',\'blockquote\')">Citação</button>';
  html += '<button type="button" title="Inserir fala / diálogo de RPG" onclick="openEditorDrawer(\'' + id + '\',\'dialogue\')">Diálogo</button>';
  html += '<button type="button" title="Inserir caixa de destaque / nota" onclick="openEditorDrawer(\'' + id + '\',\'callout\')">Nota</button>';
  html += '<button type="button" title="Inserir trecho oculto (spoiler)" onclick="openEditorDrawer(\'' + id + '\',\'spoiler\')">Spoiler</button>';
  html += '<button type="button" title="Inserir divisor horizontal" onclick="execCmd(\'insertHorizontalRule\',null,\'' + id + '\')">Divisor</button>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Inserir link" onclick="openEditorDrawer(\'' + id + '\',\'link\')">Link</button>';
  html += '<button type="button" title="Inserir imagem" onclick="openEditorDrawer(\'' + id + '\',\'image\')">Imagem</button>';
  html += '<button type="button" title="Inserir tabela" onclick="openEditorDrawer(\'' + id + '\',\'table\')">Tabela</button>';
  html += '<div class="sep"></div>';
  html += '<select class="editor-select" title="Tom do texto" onchange="applyColor(\'' + id + '\',this.value);this.value=\'\'">';
  html += '<option value="">Tom</option>';
  html += '<option value="#ffffff">Branco</option>';
  html += '<option value="#d4d4d8">Prata</option>';
  html += '<option value="#a1a1aa">Cinza médio</option>';
  html += '<option value="#71717a">Cinza escuro</option>';
  html += '</select>';
  html += '<label class="editor-color-picker" title="Cor personalizada">Cor<input type="color" value="#ffffff" onchange="applyColor(\'' + id + '\',this.value)"></label>';
  html += '<div class="sep"></div>';
  html += '<button type="button" title="Alternar código HTML" onclick="toggleEditorHtmlMode(\'' + id + '\')" id="htmlbtn-' + id + '">HTML</button>';
  html += '<button type="button" title="Expandir editor" onclick="toggleEditorFullscreen(\'' + id + '\')" id="fsbtn-' + id + '">Expandir</button>';
  html += '</div>';
  html += '<div class="editor-drawer" id="drawer-' + id + '" style="display:none;"></div>';
  html += '<div class="editor-body" id="' + id + '" contenteditable="true" spellcheck="false" data-placeholder="' + ph.replace(/"/g, '&quot;') + '" oninput="updateEditorCount(\'' + id + '\')">' + (initialContent || '') + '</div>';
  html += '<textarea class="editor-source" id="src-' + id + '" style="display:none;" spellcheck="false" oninput="syncFromSource(\'' + id + '\')"></textarea>';
  html += '<div class="editor-status"><span id="mode-' + id + '">Editor visual</span><span id="count-' + id + '">0 caracteres · 0 palavras</span></div>';
  html += '</div>';
  setTimeout(function() { updateEditorCount(id); }, 40);
  return html;
}

function execCmd(cmd, val, editorId) {
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand(cmd, false, val);
  updateEditorCount(editorId);
}

function wrapTag(editorId, tag) {
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('formatBlock', false, tag);
  updateEditorCount(editorId);
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

function openEditorDrawer(editorId, type) {
  var d = document.getElementById('drawer-' + editorId);
  if (!d) return;
  if (d.style.display !== 'none' && d.getAttribute('data-dtype') === type) {
    closeEditorDrawer(editorId);
    return;
  }
  d.setAttribute('data-dtype', type);
  var inner = '';
  if (type === 'link') {
    inner += '<div class="editor-drawer-row">';
    inner += '<input type="text" id="ed-' + editorId + '-ltext" placeholder="Texto do link (opcional)">';
    inner += '<input type="text" id="ed-' + editorId + '-lurl" placeholder="URL (https://...)">';
    inner += '<button type="button" class="btn btn-small btn-primary" onclick="confirmEditorDrawer(\'' + editorId + '\',\'link\')">Inserir</button>';
    inner += '<button type="button" class="btn btn-small" onclick="closeEditorDrawer(\'' + editorId + '\')">Cancelar</button>';
    inner += '</div>';
  } else if (type === 'image') {
    inner += '<div class="editor-drawer-row">';
    inner += '<input type="text" id="ed-' + editorId + '-iurl" placeholder="URL da imagem (https://...)">';
    inner += '<input type="text" id="ed-' + editorId + '-icap" placeholder="Legenda opcional">';
    inner += '<button type="button" class="btn btn-small btn-primary" onclick="confirmEditorDrawer(\'' + editorId + '\',\'image\')">Inserir</button>';
    inner += '<button type="button" class="btn btn-small" onclick="closeEditorDrawer(\'' + editorId + '\')">Cancelar</button>';
    inner += '</div>';
  } else if (type === 'dialogue') {
    inner += '<div class="editor-drawer-row">';
    inner += '<input type="text" id="ed-' + editorId + '-dspeaker" placeholder="Personagem (opcional)" style="max-width:200px;">';
    inner += '<input type="text" id="ed-' + editorId + '-dtext" placeholder="Fala do personagem...">';
    inner += '<button type="button" class="btn btn-small btn-primary" onclick="confirmEditorDrawer(\'' + editorId + '\',\'dialogue\')">Inserir</button>';
    inner += '<button type="button" class="btn btn-small" onclick="closeEditorDrawer(\'' + editorId + '\')">Cancelar</button>';
    inner += '</div>';
  } else if (type === 'callout') {
    inner += '<div class="editor-drawer-row">';
    inner += '<input type="text" id="ed-' + editorId + '-ctitle" placeholder="Título da nota" value="Nota" style="max-width:180px;">';
    inner += '<input type="text" id="ed-' + editorId + '-cbody" placeholder="Conteúdo da nota ou observação...">';
    inner += '<button type="button" class="btn btn-small btn-primary" onclick="confirmEditorDrawer(\'' + editorId + '\',\'callout\')">Inserir</button>';
    inner += '<button type="button" class="btn btn-small" onclick="closeEditorDrawer(\'' + editorId + '\')">Cancelar</button>';
    inner += '</div>';
  } else if (type === 'spoiler') {
    inner += '<div class="editor-drawer-row">';
    inner += '<input type="text" id="ed-' + editorId + '-stext" placeholder="Texto que ficará oculto como spoiler...">';
    inner += '<button type="button" class="btn btn-small btn-primary" onclick="confirmEditorDrawer(\'' + editorId + '\',\'spoiler\')">Inserir</button>';
    inner += '<button type="button" class="btn btn-small" onclick="closeEditorDrawer(\'' + editorId + '\')">Cancelar</button>';
    inner += '</div>';
  } else if (type === 'table') {
    inner += '<div class="editor-drawer-row">';
    inner += '<input type="number" id="ed-' + editorId + '-trows" min="1" max="12" value="3" placeholder="Linhas" style="max-width:110px;">';
    inner += '<input type="number" id="ed-' + editorId + '-tcols" min="1" max="6" value="3" placeholder="Colunas" style="max-width:110px;">';
    inner += '<button type="button" class="btn btn-small btn-primary" onclick="confirmEditorDrawer(\'' + editorId + '\',\'table\')">Criar Tabela</button>';
    inner += '<button type="button" class="btn btn-small" onclick="closeEditorDrawer(\'' + editorId + '\')">Cancelar</button>';
    inner += '</div>';
  }
  d.innerHTML = inner;
  d.style.display = 'block';
  var firstInput = d.querySelector('input');
  if (firstInput) firstInput.focus();
}

function closeEditorDrawer(editorId) {
  var d = document.getElementById('drawer-' + editorId);
  if (d) {
    d.style.display = 'none';
    d.innerHTML = '';
  }
}

function editorSafeContentUrl(value, options) {
  options = options || {};
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value !== value.trim()) return null;
  if (/[\u0000-\u0020\u007f\\<>"'`]/.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|2f|5c)/i.test(value)) return null;
  if (/&(?:[a-z][a-z0-9]+|#\d+|#x[\da-f]+);/i.test(value)) return null;

  var decoded = value;
  for (var i = 0; i < 3 && decoded.indexOf('%') !== -1; i += 1) {
    var next;
    try { next = decodeURIComponent(decoded); } catch (_) { return null; }
    if (/%(?:2f|5c)/i.test(next)) return null;
    if (next === decoded) break;
    decoded = next;
  }
  if (/[\u0000-\u0020\u007f\\<>"'`]/.test(decoded) || /^\/\//.test(decoded) || /^\\\\/.test(decoded)) return null;
  var rawScheme = /^([a-z][a-z\d+.-]*):/i.exec(value);
  var decodedScheme = /^([a-z][a-z\d+.-]*):/i.exec(decoded);
  if (decodedScheme && (!rawScheme || rawScheme[1].toLowerCase() !== decodedScheme[1].toLowerCase())) return null;

  var parsed;
  try { parsed = new URL(value, window.location.href); } catch (_) { return null; }
  var page;
  try { page = new URL(window.location.href); } catch (_) { return null; }
  if (rawScheme) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    if (options.image && parsed.protocol !== 'https:') return null;
    return parsed.href;
  }
  if (parsed.origin !== page.origin) return null;
  if (options.image) {
    var allowed = window.Aetherverse && Array.isArray(window.Aetherverse.allowedImagePaths)
      ? window.Aetherverse.allowedImagePaths
      : [];
    if (parsed.hash || allowed.indexOf(parsed.pathname) === -1) return null;
  }
  return value;
}

function confirmEditorDrawer(editorId, type) {
  if (type === 'link') {
    var lurl = (document.getElementById('ed-' + editorId + '-lurl') || {}).value || '';
    var ltext = (document.getElementById('ed-' + editorId + '-ltext') || {}).value || '';
    lurl = lurl.trim();
    if (!lurl) return;
    lurl = editorSafeContentUrl(lurl);
    if (!lurl) {
      if (typeof showAlert === 'function') showAlert('Informe um endereço HTTP, HTTPS ou caminho local permitido.', 'error');
      return;
    }
    if (ltext.trim()) {
      insertHtml(editorId, '<a href="' + h(lurl) + '" target="_blank" rel="noopener noreferrer">' + h(ltext.trim()) + '</a> ');
    } else {
      var el = document.getElementById(editorId);
      if (el) el.focus();
      document.execCommand('createLink', false, lurl);
    }
  } else if (type === 'image') {
    var iurl = (document.getElementById('ed-' + editorId + '-iurl') || {}).value || '';
    var icap = (document.getElementById('ed-' + editorId + '-icap') || {}).value || '';
    iurl = iurl.trim();
    if (!iurl) return;
    iurl = editorSafeContentUrl(iurl, { image: true });
    if (!iurl) {
      if (typeof showAlert === 'function') showAlert('A imagem deve usar HTTPS ou um caminho local de mídia permitido.', 'error');
      return;
    }
    var fig = '<figure class="inline-media"><img src="' + h(iurl) + '" alt="Imagem">';
    if (icap.trim()) fig += '<figcaption>' + h(icap.trim()) + '</figcaption>';
    fig += '</figure><p><br></p>';
    insertHtml(editorId, fig);
  } else if (type === 'dialogue') {
    var spk = (document.getElementById('ed-' + editorId + '-dspeaker') || {}).value || '';
    var dtxt = (document.getElementById('ed-' + editorId + '-dtext') || {}).value || '';
    if (!dtxt.trim()) return;
    var dlg = '<div class="rp-dialogue">';
    if (spk.trim()) dlg += '<div class="rp-dialogue-speaker">' + h(spk.trim()) + '</div>';
    dlg += '<div class="rp-dialogue-text">&ldquo;' + h(dtxt.trim()) + '&rdquo;</div></div><p><br></p>';
    insertHtml(editorId, dlg);
  } else if (type === 'callout') {
    var ctitle = (document.getElementById('ed-' + editorId + '-ctitle') || {}).value || 'Nota';
    var cbody = (document.getElementById('ed-' + editorId + '-cbody') || {}).value || '';
    if (!cbody.trim()) return;
    var cal = '<div class="rp-callout"><div class="rp-callout-title">' + h(ctitle.trim()) + '</div><div class="rp-callout-body">' + h(cbody.trim()) + '</div></div><p><br></p>';
    insertHtml(editorId, cal);
  } else if (type === 'spoiler') {
    var stxt = (document.getElementById('ed-' + editorId + '-stext') || {}).value || '';
    if (!stxt.trim()) return;
    insertHtml(editorId, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')" title="Clique para revelar">' + h(stxt.trim()) + '</span>&nbsp;');
  } else if (type === 'table') {
    var rows = parseInt((document.getElementById('ed-' + editorId + '-trows') || {}).value, 10) || 2;
    var cols = parseInt((document.getElementById('ed-' + editorId + '-tcols') || {}).value, 10) || 2;
    rows = Math.max(1, Math.min(12, rows));
    cols = Math.max(1, Math.min(6, cols));
    var tbl = '<table><tbody>';
    for (var r = 0; r < rows; r++) {
      tbl += '<tr>';
      for (var c = 0; c < cols; c++) {
        tbl += '<td>' + (r === 0 ? '<b>Cabeçalho</b>' : 'Valor') + '</td>';
      }
      tbl += '</tr>';
    }
    tbl += '</tbody></table><p><br></p>';
    insertHtml(editorId, tbl);
  }
  closeEditorDrawer(editorId);
}

var editorPreviewSequence = Object.create(null);

function toggleEditorHtmlMode(editorId) {
  var body = document.getElementById(editorId);
  var src = document.getElementById('src-' + editorId);
  var btn = document.getElementById('htmlbtn-' + editorId);
  var mode = document.getElementById('mode-' + editorId);
  if (!body || !src) return;
  if (src.style.display === 'none') {
    src.value = body.innerHTML;
    body.style.display = 'none';
    src.style.display = 'block';
    if (btn) btn.classList.add('active');
    if (mode) mode.textContent = 'Código HTML';
  } else {
    previewEditorSource(editorId);
  }
}

function syncFromSource(editorId) {
  var src = document.getElementById('src-' + editorId);
  var count = document.getElementById('count-' + editorId);
  if (!src || !count) return;
  var text = src.value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim();
  var words = text ? text.split(/\s+/).length : 0;
  count.textContent = text.length + ' caracteres · ' + words + ' palavras';
}

function previewEditorSource(editorId) {
  var body = document.getElementById(editorId);
  var src = document.getElementById('src-' + editorId);
  var btn = document.getElementById('htmlbtn-' + editorId);
  var mode = document.getElementById('mode-' + editorId);
  if (!body || !src || !window.Aetherverse) return;
  var source = src.value;
  var sequence = (editorPreviewSequence[editorId] || 0) + 1;
  editorPreviewSequence[editorId] = sequence;
  if (mode) mode.textContent = 'Validando prévia no servidor…';
  window.Aetherverse.apiRequest('POST', '/api/content/preview', { html: source })
    .then(function(result) {
      result = result && result.data && typeof result.data === 'object' ? result.data : result;
      if (editorPreviewSequence[editorId] !== sequence || src.style.display === 'none') return;
      if (src.value !== source) {
        previewEditorSource(editorId);
        return;
      }
      if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.html !== 'string') {
        throw new Error('A prévia validada está incompleta.');
      }
      setEditorContent(editorId, result.html);
      src.style.display = 'none';
      body.style.display = 'block';
      if (btn) btn.classList.remove('active');
      if (mode) mode.textContent = result.formattingLoss && result.formattingLoss.discarded
        ? 'Prévia segura · formatação não permitida removida'
        : 'Prévia validada pelo servidor';
      updateEditorCount(editorId);
    })
    .catch(function(error) {
      if (editorPreviewSequence[editorId] !== sequence) return;
      if (mode) mode.textContent = 'Prévia não validada';
      if (typeof showAlert === 'function') showAlert(error.message || 'Não foi possível validar a prévia.', 'error');
    });
}

function setEditorContent(editorId, safeHtml) {
  if (typeof safeHtml !== 'string') return false;
  var body = document.getElementById(editorId);
  if (!body) return false;
  var source = document.getElementById('src-' + editorId);
  body.innerHTML = safeHtml;
  body.style.display = 'block';
  if (source) {
    source.value = '';
    source.style.display = 'none';
  }
  updateEditorCount(editorId);
  return true;
}

function toggleEditorFullscreen(editorId) {
  var wrap = document.getElementById('wrap-' + editorId);
  var btn = document.getElementById('fsbtn-' + editorId);
  if (!wrap) return;
  var isFs = wrap.classList.toggle('editor-fullscreen');
  if (btn) btn.textContent = isFs ? 'Reduzir' : 'Expandir';
}

function insertHtml(editorId, html) {
  var el = document.getElementById(editorId);
  if (el) el.focus();
  document.execCommand('insertHTML', false, html);
  updateEditorCount(editorId);
}

function updateEditorCount(editorId) {
  var el = document.getElementById(editorId);
  var count = document.getElementById('count-' + editorId);
  if (!el || !count) return;
  var texto = (el.textContent || '').trim();
  var words = texto ? texto.split(/\s+/).length : 0;
  var readMin = Math.max(1, Math.ceil(words / 200));
  count.textContent = texto.length + ' caracteres · ' + words + ' palavras' + (words > 30 ? ' · ~' + readMin + ' min de leitura' : '');
}

function getEditorContent(id) {
  var src = document.getElementById('src-' + id);
  var el = document.getElementById(id);
  if (src && src.style.display !== 'none') {
    return src.value;
  }
  return el ? el.innerHTML : '';
}
