(function (root) {
  'use strict';

  var STORAGE_KEY = 'forum-antigo-db-v22';
  var MAX_CONVERSION_BYTES = 5 * 1024 * 1024;

  var FIELD_SETS = {
    category: ['id', 'name', 'desc', 'description', 'date', 'createdAt', 'updatedAt'],
    thread: ['id', 'catId', 'title', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt', 'tag', 'pinned', 'locked', 'archived', 'content'],
    post: ['id', 'threadId', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt', 'content', 'edited'],
    character: ['id', 'nome', 'name', 'categoria', 'category', 'titulo', 'title', 'raca', 'race', 'faccao', 'faction', 'status', 'imagem', 'image', 'descricao', 'description', 'stats', 'mascaraTier', 'skills', 'blocks', 'theme', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt'],
    scene: ['id', 'titulo', 'title', 'subtitulo', 'subtitle', 'categoria', 'category', 'status', 'resumo', 'summary', 'banner', 'descricao', 'description', 'theme', 'infobox', 'blocks', 'turns', 'authorId', 'authorLabel', 'authorName', 'date', 'createdAt', 'updatedAt', 'created_at', 'updated_at'],
    turn: ['id', 'authorId', 'authorLabel', 'authorName', 'username', 'date', 'createdAt', 'updatedAt', 'content', 'edited', 'blocks'],
    theme: ['accentColor', 'bannerStyle', 'layout', 'fontFamily', 'bgEffect', 'bgm'],
    infobox: ['show', 'title', 'image', 'caption', 'participants', 'fields'],
    infoboxField: ['label', 'value', 'title', 'name', 'content'],
    block: ['type', 'title', 'items', 'cols', 'text', 'author', 'avatar', 'content'],
    blockItem: ['label', 'content', 'url', 'caption', 'title', 'badge', 'color', 'image', 'desc', 'value', 'date'],
    skill: ['nome', 'name', 'descricao', 'description', 'tipo', 'type']
  };

  var SECURITY_FIELD = /(^|_)(email|e-?mail|password|passwd|passhash|hash|credential|token|secret|session|cookie|role|permission|privilege|auth|serverid|staff|admin|moderator)(_|$)/i;
  var COUNTER_FIELD = /(^|_)(views?|posts?_count|postcount|threadcount|counter|count|next[a-z]*id|admTentativaUsada)(_|$)/i;
  var ALWAYS_EXCLUDED = {
    email: 'security', password: 'security', password_hash: 'security', passwordHash: 'security',
    role: 'security', roles: 'security', session: 'session', sessions: 'session',
    admTentativaUsada: 'security', adminAttemptUsed: 'security',
    views: 'counter', posts_count: 'counter', postCount: 'counter', nextUserId: 'counter',
    nextThreadId: 'counter', nextPostId: 'counter', nextPersonagemId: 'counter', nextWikiPostId: 'counter'
  };

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function makeReport() {
    return {
      counts: { categories: 0, threads: 0, posts: 0, characters: 0, scenes: 0, turns: 0, attributionLabels: 0 },
      exclusions: { security: 0, session: 0, counter: 0, unsupported: 0 },
      excludedFields: [],
      missingParents: [],
      unmappedAuthors: [],
      candidateDuplicates: [],
      legacyDates: [],
      formatChanges: [],
      urlChanges: [],
      samples: []
    };
  }

  function noteExcluded(report, path, key, category) {
    report.exclusions[category] += 1;
    if (report.excludedFields.length < 100) {
      report.excludedFields.push({ path: path, field: key, reason: category });
    }
  }

  function exclusionCategory(key) {
    if (Object.prototype.hasOwnProperty.call(ALWAYS_EXCLUDED, key)) return ALWAYS_EXCLUDED[key];
    if (SECURITY_FIELD.test(key)) return 'security';
    if (COUNTER_FIELD.test(key) || /^posts?$/i.test(key)) return 'counter';
    return 'unsupported';
  }

  function addDate(report, path, value) {
    if (typeof value !== 'string' || !value) return;
    if (report.legacyDates.length < 100) report.legacyDates.push({ path: path, value: value });
  }

  function copyScalar(value) {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  function copyRecord(source, allowed, path, report, nested) {
    if (!isObject(source)) {
      noteExcluded(report, path, '(registro)', 'unsupported');
      return null;
    }
    var result = {};
    Object.keys(source).forEach(function (key) {
      var fieldPath = path + '.' + key;
      if (Object.prototype.hasOwnProperty.call(ALWAYS_EXCLUDED, key)) {
        noteExcluded(report, fieldPath, key, ALWAYS_EXCLUDED[key]);
        return;
      }
      if (SECURITY_FIELD.test(key)) {
        noteExcluded(report, fieldPath, key, 'security');
        return;
      }
      if (COUNTER_FIELD.test(key)) {
        noteExcluded(report, fieldPath, key, 'counter');
        return;
      }
      if (allowed.indexOf(key) === -1 && !(nested && nested.dynamicContentKeys && nested.dynamicContentKeys.indexOf(key) !== -1)) {
        noteExcluded(report, fieldPath, key, 'unsupported');
        return;
      }
      var value = source[key];
      if (['date', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].indexOf(key) !== -1) addDate(report, fieldPath, value);

      if (key === 'theme') {
        result[key] = copyRecord(value, FIELD_SETS.theme, fieldPath, report);
      } else if (key === 'stats') {
        result[key] = copyStats(value, fieldPath, report);
      } else if (key === 'skills') {
        result[key] = copyArray(value, FIELD_SETS.skill, fieldPath, report);
      } else if (key === 'infobox') {
        result[key] = copyInfobox(value, fieldPath, report);
      } else if (key === 'blocks') {
        result[key] = copyBlocks(value, fieldPath, report);
      } else if (key === 'turns') {
        result[key] = copyArray(value, FIELD_SETS.turn, fieldPath, report);
        report.counts.turns += result[key].length;
      } else if (key === 'participants' && allowed === FIELD_SETS.infobox && Array.isArray(value)) {
        result[key] = value.filter(copyScalar);
      } else if (key === 'fields' && allowed === FIELD_SETS.infobox) {
        result[key] = copyArray(value, FIELD_SETS.infoboxField, fieldPath, report);
      } else if (key === 'items' && allowed === FIELD_SETS.block) {
        result[key] = copyArray(value, FIELD_SETS.blockItem, fieldPath, report);
      } else if (copyScalar(value)) {
        result[key] = value;
      } else {
        noteExcluded(report, fieldPath, key, 'unsupported');
      }
    });
    return result;
  }

  function copyArray(value, allowed, path, report) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('O campo ' + path + ' precisa ser uma lista.');
    return value.map(function (item, index) {
      if (!isObject(item)) {
        noteExcluded(report, path + '[' + index + ']', '(registro)', 'unsupported');
        return null;
      }
      return copyRecord(item, allowed, path + '[' + index + ']', report);
    }).filter(Boolean);
  }

  function copyStats(value, path, report) {
    if (!isObject(value)) {
      if (value !== undefined && value !== null) noteExcluded(report, path, 'stats', 'unsupported');
      return {};
    }
    var result = {};
    Object.keys(value).forEach(function (key) {
      if (SECURITY_FIELD.test(key) || Object.prototype.hasOwnProperty.call(ALWAYS_EXCLUDED, key)) {
        noteExcluded(report, path + '.' + key, key, 'security');
      } else if (COUNTER_FIELD.test(key)) {
        noteExcluded(report, path + '.' + key, key, 'counter');
      } else if (/^(?:__proto__|prototype|constructor)$/i.test(key)) {
        noteExcluded(report, path + '.' + key, key, 'unsupported');
      } else if (copyScalar(value[key])) {
        Object.defineProperty(result, key, { value: value[key], enumerable: true, configurable: true, writable: true });
      } else {
        noteExcluded(report, path + '.' + key, key, 'unsupported');
      }
    });
    return result;
  }

  function copyInfobox(value, path, report) {
    if (!isObject(value)) {
      if (value !== undefined && value !== null) noteExcluded(report, path, 'infobox', 'unsupported');
      return {};
    }
    var result = copyRecord(value, FIELD_SETS.infobox, path, report);
    if (Array.isArray(value.participants)) result.participants = value.participants.filter(copyScalar);
    if (value.fields !== undefined && !Array.isArray(value.fields)) {
      noteExcluded(report, path + '.fields', 'fields', 'unsupported');
      delete result.fields;
    }
    return result;
  }

  function copyBlocks(value, path, report) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      noteExcluded(report, path, 'blocks', 'unsupported');
      return [];
    }
    return value.map(function (block, index) {
      var blockPath = path + '[' + index + ']';
      var copied = copyRecord(block, FIELD_SETS.block, blockPath, report);
      if (copied && block.items !== undefined && !Array.isArray(block.items)) {
        noteExcluded(report, blockPath + '.items', 'items', 'unsupported');
        delete copied.items;
      }
      return copied;
    }).filter(Boolean);
  }

  function readList(source, primary, alternate, label) {
    var value = source[primary];
    if (value === undefined && alternate) value = source[alternate];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('O campo ' + label + ' precisa ser uma lista.');
    return value;
  }

  function recordIdKey(record) {
    if (!record || record.id === undefined || record.id === null) return null;
    return String(record.id);
  }

  function addUnmappedAuthorChecks(collections, labels, report) {
    var known = Object.create(null);
    labels.forEach(function (label) { known[String(label.id)] = true; });
    var seen = Object.create(null);
    function check(record, path) {
      if (!record || record.authorId === undefined || record.authorId === null || record.authorId === '') return;
      var key = String(record.authorId);
      if (!known[key] && !seen[key]) {
        seen[key] = true;
        report.unmappedAuthors.push({ legacyId: record.authorId, referencedAt: path });
      }
    }
    collections.forEach(function (entry) {
      entry.records.forEach(function (record, index) {
        var path = entry.name + '[' + index + ']';
        check(record, path);
        if (entry.name === 'scenes' && Array.isArray(record.turns)) {
          record.turns.forEach(function (turn, turnIndex) { check(turn, path + '.turns[' + turnIndex + ']'); });
        }
      });
    });
  }

  function detectRelations(data, report) {
    var categories = Object.create(null);
    var threads = Object.create(null);
    var threadTitles = Object.create(null);
    function indexIds(type, records) {
      var index = Object.create(null);
      records.forEach(function (record) {
        var id = recordIdKey(record);
        if (id === null) return;
        if (index[id]) report.candidateDuplicates.push({ type: type + '-id', legacyId: id });
        index[id] = true;
      });
      return index;
    }
    categories = indexIds('category', data.categories);
    threads = indexIds('thread', data.threads);
    indexIds('post', data.posts);
    indexIds('character', data.characters);
    indexIds('scene', data.scenes);
    data.threads.forEach(function (record) {
      var id = recordIdKey(record);
      var categoryId = record.catId === undefined || record.catId === null ? null : String(record.catId);
      if (categoryId !== null && !categories[categoryId]) report.missingParents.push({ resource: 'thread', legacyId: record.id, parentType: 'category', parentId: record.catId });
      if (record.title) {
        var titleKey = String(record.title).trim().toLocaleLowerCase();
        if (threadTitles[titleKey]) report.candidateDuplicates.push({ type: 'thread-title', title: String(record.title).slice(0, 100) });
        threadTitles[titleKey] = true;
      }
    });
    data.posts.forEach(function (record) {
      if (record.threadId !== undefined && record.threadId !== null && !threads[String(record.threadId)]) {
        report.missingParents.push({ resource: 'post', legacyId: record.id, parentType: 'thread', parentId: record.threadId });
      }
    });
  }

  function uuid(cryptoObject) {
    var source = cryptoObject || getCrypto();
    if (source && typeof source.randomUUID === 'function') return source.randomUUID();
    if (source && typeof source.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      source.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    throw new Error('Este navegador não oferece gerador seguro de identificadores.');
  }

  function getCrypto() {
    if (root && root.crypto && root.crypto.subtle) return root.crypto;
    if (typeof require === 'function') {
      try { return require('node:crypto').webcrypto; } catch (_error) { /* browser without CommonJS */ }
    }
    return null;
  }

  function bytesFromString(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value);
    var encoded = unescape(encodeURIComponent(value));
    var bytes = new Uint8Array(encoded.length);
    for (var index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
    return bytes;
  }

  async function sha256Hex(value, cryptoObject) {
    var source = cryptoObject || getCrypto();
    if (!source || !source.subtle || typeof source.subtle.digest !== 'function') {
      throw new Error('SHA-256 não está disponível neste navegador. Abra a página em localhost ou use um navegador atualizado.');
    }
    var digest = await source.subtle.digest('SHA-256', bytesFromString(value));
    return Array.prototype.map.call(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  function byteLength(value) {
    return bytesFromString(value).byteLength;
  }

  function captureRawValue(storage) {
    try {
      var value = storage.getItem(STORAGE_KEY);
      return { found: value !== null, raw: value };
    } catch (error) {
      return { found: false, raw: null, error: error };
    }
  }

  async function prepareRawExport(raw, origin, label, options) {
    if (typeof raw !== 'string') throw new Error('Não há valor bruto para exportar.');
    var hash = await sha256Hex(raw, options && options.crypto);
    return {
      raw: raw,
      metadata: {
        origin: String(origin || ''),
        exportLabel: String(label || 'Exportação local'),
        sha256: hash
      }
    };
  }

  async function convertSnapshot(raw, options) {
    if (typeof raw !== 'string') throw new Error('Cole um snapshot JSON para converter.');
    if (byteLength(raw) > MAX_CONVERSION_BYTES) throw new Error('O arquivo excede o limite de 5 MB para conversão. O snapshot bruto continua disponível separadamente.');
    var source;
    try { source = JSON.parse(raw); } catch (_error) { throw new Error('O conteúdo não é um JSON válido.'); }
    if (!isObject(source)) throw new Error('A raiz do JSON precisa ser um objeto.');

    var report = makeReport();
    var rawDigest = await sha256Hex(raw, options && options.crypto);
    var categoriesSource = readList(source, 'categories', null, 'categories');
    var threadsSource = readList(source, 'threads', null, 'threads');
    var postsSource = readList(source, 'posts', null, 'posts');
    var charactersSource = readList(source, 'personagens', 'characters', 'personagens');
    var scenesSource = readList(source, 'wikiPosts', 'scenes', 'wikiPosts');
    var usersSource = source.users === undefined ? readList(source, 'attributionLabels', null, 'attributionLabels') : readList(source, 'users', null, 'users');

    var content = {
      formatVersion: 1,
      exportId: uuid(options && options.crypto),
      sourceId: uuid(options && options.crypto),
      rawSnapshotSha256: rawDigest,
      legacyOrigin: String((options && options.origin) || 'origem não informada'),
      exportedAt: (options && options.now ? new Date(options.now) : new Date()).toISOString(),
      categories: copyArray(categoriesSource, FIELD_SETS.category, 'categories', report),
      attributionLabels: usersSource.map(function (user, index) {
        if (!isObject(user)) {
          noteExcluded(report, 'users[' + index + ']', '(registro)', 'unsupported');
          return null;
        }
        var label = {};
        if (user.id !== undefined && copyScalar(user.id)) label.id = user.id;
        else noteExcluded(report, 'users[' + index + '].id', 'id', 'unsupported');
        if (typeof user.username === 'string') label.username = user.username;
        else if (typeof user.name === 'string') label.username = user.name;
        else label.username = 'Autor legado ' + String(label.id === undefined ? 'desconhecido' : label.id);
        Object.keys(user).forEach(function (key) {
          if (['id', 'username', 'name'].indexOf(key) !== -1) return;
          noteExcluded(report, 'users[' + index + '].' + key, key, exclusionCategory(key));
        });
        return label;
      }).filter(Boolean),
      threads: copyArray(threadsSource, FIELD_SETS.thread, 'threads', report),
      posts: copyArray(postsSource, FIELD_SETS.post, 'posts', report),
      characters: copyArray(charactersSource, FIELD_SETS.character, 'personagens', report),
      scenes: copyArray(scenesSource, FIELD_SETS.scene, 'wikiPosts', report)
    };

    report.counts.categories = content.categories.length;
    report.counts.threads = content.threads.length;
    report.counts.posts = content.posts.length;
    report.counts.characters = content.characters.length;
    report.counts.scenes = content.scenes.length;
    report.counts.attributionLabels = content.attributionLabels.length;
    var recognizedRootFields = [
      'categories', 'threads', 'posts', 'personagens', 'characters', 'wikiPosts', 'scenes', 'users',
      'attributionLabels', 'formatVersion', 'exportId', 'sourceId', 'rawSnapshotSha256', 'legacyOrigin', 'exportedAt'
    ];
    Object.keys(source).forEach(function (key) {
      if (recognizedRootFields.indexOf(key) === -1) noteExcluded(report, '$.' + key, key, exclusionCategory(key));
    });
    detectRelations(content, report);
    addUnmappedAuthorChecks([
      { name: 'threads', records: content.threads },
      { name: 'posts', records: content.posts },
      { name: 'characters', records: content.characters },
      { name: 'scenes', records: content.scenes }
    ], content.attributionLabels, report);
    content.categories.concat(content.threads, content.posts, content.characters, content.scenes).slice(0, 10).forEach(function (record) {
      var label = record.title || record.titulo || record.name || record.nome || record.id;
      if (label !== undefined) report.samples.push(String(label).slice(0, 160));
    });

    return { content: content, report: report };
  }

  function filenamePart(value) {
    var result = String(value || 'exportacao').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return result || 'exportacao';
  }

  function downloadText(filename, text, type) {
    var blob = new Blob([text], { type: type || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function reportText(report) {
    var lines = [
      'Registros preservados: ' + JSON.stringify(report.counts),
      'Campos excluídos (sem copiar valores): ' + JSON.stringify(report.exclusions)
    ];
    if (report.missingParents.length) lines.push('Referências sem pai correspondente: ' + JSON.stringify(report.missingParents.slice(0, 20)));
    if (report.unmappedAuthors.length) lines.push('Autores sem rótulo correspondente: ' + JSON.stringify(report.unmappedAuthors.slice(0, 20)));
    if (report.candidateDuplicates.length) lines.push('Possíveis duplicatas para revisão (não mescladas): ' + JSON.stringify(report.candidateDuplicates.slice(0, 20)));
    if (report.legacyDates.length) lines.push('Datas legadas preservadas como texto: ' + JSON.stringify(report.legacyDates.slice(0, 10)));
    lines.push('Formato e URLs: preservados sem normalização; a sanitização acontece em uma etapa de importação posterior.');
    if (report.samples.length) lines.push('Amostras de títulos/IDs: ' + JSON.stringify(report.samples));
    if (report.excludedFields.length) lines.push('Campos removidos (caminho e nome, sem valores): ' + JSON.stringify(report.excludedFields.slice(0, 30)));
    return lines.join('\n');
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function initPage() {
    if (!root.document) return;
    var rawStatus = document.getElementById('raw-status');
    var input = document.getElementById('snapshot-input');
    var storage = null;
    var storageError = null;
    try { storage = root.localStorage; } catch (error) { storageError = error; }
    var preparedRawExport = null;
    var initial = storage ? captureRawValue(storage) : { found: false, raw: null, error: storageError || new Error('Armazenamento local indisponível.') };
    if (initial.error) rawStatus.textContent = 'O navegador bloqueou o acesso ao armazenamento local: ' + initial.error.message;
    else if (initial.found) {
      rawStatus.textContent = 'Snapshot encontrado (' + byteLength(initial.raw) + ' bytes). A leitura foi feita sem normalizar ou gravar o valor.';
      input.value = initial.raw;
      document.getElementById('source-origin').value = root.location.origin;
    } else rawStatus.textContent = 'Nenhum valor legado foi encontrado nesta origem do navegador.';

    document.getElementById('download-raw').addEventListener('click', async function (event) {
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var current = storage ? captureRawValue(storage) : { error: storageError || new Error('Armazenamento local indisponível.') };
        if (current.error) throw current.error;
        if (!current.found) throw new Error('Não há snapshot bruto nesta origem.');
        var label = document.getElementById('export-label').value;
        var prepared = await prepareRawExport(current.raw, root.location.origin, label);
        var name = filenamePart(label);
        downloadText(name + '.raw.json', prepared.raw, 'application/json;charset=utf-8');
        preparedRawExport = { name: name, metadata: prepared.metadata };
        document.getElementById('download-metadata').disabled = false;
        rawStatus.textContent = 'JSON bruto baixado. SHA-256: ' + prepared.metadata.sha256 + '. Baixe o sidecar separado.';
      } catch (error) {
        rawStatus.textContent = 'Falha ao exportar: ' + error.message;
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById('download-metadata').addEventListener('click', function () {
      if (!preparedRawExport) return;
      downloadText(preparedRawExport.name + '.metadata.json', JSON.stringify(preparedRawExport.metadata, null, 2) + '\n');
      rawStatus.textContent = 'Sidecar baixado para o snapshot bruto preparado.';
    });

    document.getElementById('load-local').addEventListener('click', function () {
      var current = storage ? captureRawValue(storage) : { error: storageError || new Error('Armazenamento local indisponível.') };
      if (current.error) setText('convert-status', 'Falha ao ler o armazenamento: ' + current.error.message);
      else if (!current.found) setText('convert-status', 'Não há snapshot local para carregar.');
      else {
        input.value = current.raw;
        document.getElementById('source-origin').value = root.location.origin;
        setText('convert-status', 'Cópia local carregada no campo; o armazenamento original continua intacto.');
      }
    });

    document.getElementById('snapshot-file').addEventListener('change', async function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        if (file.size > MAX_CONVERSION_BYTES) throw new Error('O arquivo excede o limite de 5 MB para conversão.');
        input.value = await file.text();
        setText('convert-status', 'Arquivo carregado como cópia editável. O armazenamento local não foi alterado.');
      } catch (error) {
        setText('convert-status', 'Falha ao ler o arquivo: ' + error.message);
      }
    });

    document.getElementById('convert-download').addEventListener('click', async function (event) {
      var button = event.currentTarget;
      button.disabled = true;
      try {
        var converted = await convertSnapshot(input.value, { origin: document.getElementById('source-origin').value.trim() });
        var label = document.getElementById('export-label').value;
        downloadText(filenamePart(label) + '.content.json', JSON.stringify(converted.content, null, 2) + '\n');
        setText('convert-status', 'Conversão concluída. O arquivo contém apenas campos de conteúdo e rótulos mínimos de autoria. Revise o relatório antes de qualquer importação.');
        setText('conversion-report', reportText(converted.report));
      } catch (error) {
        setText('convert-status', 'Falha na conversão: ' + error.message);
        setText('conversion-report', '');
      } finally {
        button.disabled = false;
      }
    });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_CONVERSION_BYTES: MAX_CONVERSION_BYTES,
    captureRawValue: captureRawValue,
    prepareRawExport: prepareRawExport,
    convertSnapshot: convertSnapshot,
    sha256Hex: sha256Hex,
    byteLength: byteLength,
    initPage: initPage
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LegacyRecovery = api;
  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initPage, { once: true });
    else initPage();
  }
}(typeof window !== 'undefined' ? window : globalThis));
