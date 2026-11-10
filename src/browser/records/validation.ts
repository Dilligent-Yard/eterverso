export const RECORD_JSON_SCHEMA_VERSION = 1;

export const STAT_KEYS = [
  'ataque', 'destreza', 'defesa', 'reserva', 'controle',
  'refino', 'emissao', 'alma', 'inteligencia', 'habilidade',
] as const;

export const CHARACTER_JSON_METADATA_FIELDS = [
  'id', 'version', 'authorId', 'author', 'createdAt', 'updatedAt',
  'hiddenAt', 'date', 'created_at', 'updated_at',
] as const;

interface UnknownRecord {
  [key: string]: unknown;
}

export interface StringField {
  name: string;
  max: number;
}

export interface ImportedSkill {
  nome: string;
  descricao: string;
  tipo: 'skill' | 'equipamento';
}

export interface ImportedInfobox {
  show?: boolean;
  title?: string;
  image?: string;
  caption?: string;
  location?: string;
  timeline?: string;
  participants?: string[];
  fields?: { label: string; value: string }[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function jsonStringLength(value: unknown): number {
  return Array.from(String(value)).length;
}

export function normalizeHexColorValue(value: string): string {
  if (!value) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return ('#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3]).toLowerCase();
  }
  return value.toLowerCase();
}

export function importedStringFields(source: unknown, fields: readonly StringField[]): Record<string, string> {
  if (!isRecord(source)) throw new Error('O JSON deve conter um objeto.');
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;
    let value = source[field.name];
    if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
    if (typeof value !== 'string' || jsonStringLength(value) > field.max) {
      throw new Error(`O campo "${field.name}" tem formato inválido.`);
    }
    values[field.name] = value;
  }
  return values;
}

export function assertJsonSchemaVersion(data: unknown, label: string): void {
  if (!isRecord(data) || !Object.prototype.hasOwnProperty.call(data, 'schemaVersion')) return;
  if (data.schemaVersion !== RECORD_JSON_SCHEMA_VERSION) {
    throw new Error('Versão de ' + label + ' não suportada: ' + String(data.schemaVersion) + '. Atualize o site e tente novamente.');
  }
}

export function assertSupportedJsonFields(data: UnknownRecord, allowedFields: readonly string[], label: string): void {
  const unknown = Object.keys(data).filter((key) => !allowedFields.includes(key));
  if (unknown.length) {
    throw new Error('Campo(s) não suportado(s) em ' + label + ': ' + unknown.slice(0, 5).join(', ') + '.');
  }
}

export function hasMeaningfulSafeHtml(html: string): boolean {
  if (/<img\b[^>]*\bsrc\s*=/i.test(html)) return true;
  const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ');
  return /[^\s\u200b-\u200f\ufeff]/u.test(text);
}

export function safeStatValue(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(number)));
}

export function importedStats(value: unknown): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('O campo "stats" deve ser um objeto.');
  const stats: Record<string, number> = {};
  for (const key of Object.keys(value)) {
    if (!STAT_KEYS.includes(key as (typeof STAT_KEYS)[number])) {
      throw new Error('Atributo desconhecido em "stats": ' + key + '.');
    }
    const number = Number(value[key]);
    if (!Number.isFinite(number) || Math.floor(number) !== number || number < 0 || number > 100) {
      throw new Error('O atributo "' + key + '" deve ser um inteiro de 0 a 100.');
    }
    stats[key] = number;
  }
  return stats;
}

export function importedSkills(value: unknown): ImportedSkill[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('O campo "skills" deve ser uma lista.');
  if (value.length > 60) throw new Error('A ficha pode ter no máximo 60 cards de skill ou equipamento.');
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error('Card inválido em "skills[' + index + ']".');
    assertSupportedJsonFields(item, ['nome', 'descricao', 'tipo'], 'skills[' + index + ']');
    const nome = item.nome === undefined ? '' : item.nome;
    const descricao = item.descricao === undefined ? '' : item.descricao;
    const tipo = item.tipo === undefined ? 'skill' : item.tipo;
    if (typeof nome !== 'string' || jsonStringLength(nome) > 100) throw new Error('O nome de "skills[' + index + ']" é inválido.');
    if (typeof descricao !== 'string' || jsonStringLength(descricao) > 2000) throw new Error('A descrição de "skills[' + index + ']" é inválida.');
    if (tipo !== 'skill' && tipo !== 'equipamento') throw new Error('O tipo de "skills[' + index + ']" deve ser "skill" ou "equipamento".');
    return { nome, descricao, tipo };
  });
}

export function importedTheme(value: unknown): Record<string, string | undefined> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('O campo "theme" deve ser um objeto.');
  const choices: Record<string, readonly string[]> = {
    bannerStyle: ['cinematic', 'standard', 'compact', 'none'],
    layout: ['sidebar-left', 'sidebar-right', 'full', 'book'],
    fontFamily: ['serif', 'sans', 'mono'],
    bgEffect: ['none', 'aura', 'grid', 'dots'],
  };
  const allowed = ['accentColor', 'bannerStyle', 'layout', 'fontFamily', 'bgEffect', 'bgm'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error('Campo não permitido em "theme": ' + key + '.');
  }
  const theme: Record<string, string | undefined> = {};
  if (value.accentColor !== undefined) {
    if (typeof value.accentColor !== 'string' || (value.accentColor && !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.accentColor))) {
      throw new Error('A cor de destaque em "theme.accentColor" é inválida.');
    }
    theme.accentColor = normalizeHexColorValue(value.accentColor);
  }
  for (const key of Object.keys(choices)) {
    const selected = value[key];
    if (selected === undefined) continue;
    if (typeof selected !== 'string' || (selected && !choices[key]?.includes(selected))) {
      throw new Error('Opção inválida em "theme.' + key + '".');
    }
    theme[key] = selected;
  }
  if (value.bgm !== undefined) {
    if (typeof value.bgm !== 'string' || jsonStringLength(value.bgm) > 300) throw new Error('O campo "theme.bgm" é inválido.');
    theme.bgm = value.bgm;
  }
  return theme;
}

export function importedInfobox(value: unknown): ImportedInfobox | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('O campo "infobox" deve ser um objeto.');
  assertSupportedJsonFields(value, ['show', 'title', 'image', 'caption', 'location', 'timeline', 'participants', 'fields'], 'infobox');
  const infobox: ImportedInfobox = {};
  if (value.show !== undefined) {
    if (typeof value.show !== 'boolean') throw new Error('O campo "infobox.show" deve ser booleano.');
    infobox.show = value.show;
  }
  const textFields: readonly [string, number][] = [
    ['title', 120], ['image', 600], ['caption', 200], ['location', 160], ['timeline', 160],
  ];
  for (const [field, max] of textFields) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== 'string' || jsonStringLength(fieldValue) > max) {
      throw new Error('O campo "infobox.' + field + '" é inválido.');
    }
    if (field === 'title') infobox.title = fieldValue;
    else if (field === 'image') infobox.image = fieldValue;
    else if (field === 'caption') infobox.caption = fieldValue;
    else if (field === 'location') infobox.location = fieldValue;
    else if (field === 'timeline') infobox.timeline = fieldValue;
  }
  if (value.participants !== undefined) {
    if (!Array.isArray(value.participants) || value.participants.length > 30) throw new Error('Os participantes da infobox são inválidos.');
    infobox.participants = value.participants.map((participant) => {
      if (typeof participant !== 'string' || !jsonStringLength(participant) || jsonStringLength(participant) > 100) {
        throw new Error('Um participante da infobox é inválido.');
      }
      return participant;
    });
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length > 30) throw new Error('Os campos da infobox são inválidos.');
    infobox.fields = value.fields.map((field, index) => {
      if (!isRecord(field)) throw new Error('Campo inválido em "infobox.fields[' + index + ']".');
      assertSupportedJsonFields(field, ['label', 'value'], 'infobox.fields[' + index + ']');
      if (typeof field.label !== 'string' || jsonStringLength(field.label) > 80
          || typeof field.value !== 'string' || jsonStringLength(field.value) > 300) {
        throw new Error('Campo inválido em "infobox.fields[' + index + ']".');
      }
      return { label: field.label, value: field.value };
    });
  }
  return infobox;
}
