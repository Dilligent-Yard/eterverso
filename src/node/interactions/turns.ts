import { ApiError } from '../../../server/errors.js';
import type {
  QueryExecutor,
  SceneLikeRow,
  SceneTurnRow,
  TurnLikeTarget,
} from './contract.js';
import { coerceText, isRecord, isUnknownArray } from './contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TURN_ID_LENGTH = 80;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function validateTurnId(value: unknown): string {
  const rawTurnId = coerceText(value || '');
  if (!rawTurnId || rawTurnId.length > MAX_TURN_ID_LENGTH || CONTROL_CHARACTERS.test(rawTurnId)) {
    throw new ApiError(400, 'INVALID_TURN_ID', 'Identificador de turno inválido.');
  }
  return rawTurnId;
}

export function sceneScopedTurnKey(sceneId: string, rawTurnId: string): string {
  return `${sceneId}:${rawTurnId}`;
}

function turnIdentifier(turn: unknown): string {
  if (!turn) return String(turn);
  if (typeof turn === 'object' || typeof turn === 'function') {
    return String((turn as Record<string, unknown>).id);
  }
  return 'undefined';
}

function turnAuthorId(turn: unknown): unknown {
  if (!isRecord(turn)) return null;
  return turn.authorId || null;
}

/**
 * Resolve o identificador de um turno para a chave canônica usada em `likes`.
 * Turnos persistidos em `scene_turns` usam o UUID global da linha; turnos que
 * existem apenas no JSON da cena usam uma chave limitada à cena para evitar
 * colisão entre ids legados repetidos em cenas diferentes.
 */
export async function resolveTurnLikeTarget(
  executor: QueryExecutor,
  sceneId: string,
  rawTurnId: string,
  sceneRow?: SceneLikeRow | null,
): Promise<TurnLikeTarget | null> {
  const isUuid = UUID_RE.test(rawTurnId);
  const rows = isUuid
    ? await executor<SceneTurnRow>`SELECT id, legacy_id, author_id FROM scene_turns WHERE scene_id = ${sceneId} AND (id = ${rawTurnId.toLowerCase()} OR legacy_id = ${rawTurnId}) AND deleted_at IS NULL LIMIT 1`
    : await executor<SceneTurnRow>`SELECT id, legacy_id, author_id FROM scene_turns WHERE scene_id = ${sceneId} AND legacy_id = ${rawTurnId} AND deleted_at IS NULL LIMIT 1`;

  const turnRow = rows[0];
  if (turnRow) {
    return {
      key: String(turnRow.id),
      turnAuthorId: turnRow.author_id || null,
      source: 'scene_turn',
    };
  }

  let scene = sceneRow;
  if (!scene) {
    const sceneRows = await executor<SceneLikeRow>`SELECT turns FROM wiki_posts WHERE id = ${sceneId} AND hidden_at IS NULL LIMIT 1`;
    scene = sceneRows[0] ?? null;
  }

  if (scene && isUnknownArray(scene.turns)) {
    const found: unknown = scene.turns.find(function (turn) {
      return turnIdentifier(turn) === rawTurnId;
    });
    if (found) {
      return {
        key: sceneScopedTurnKey(sceneId, rawTurnId),
        turnAuthorId: turnAuthorId(found),
        source: 'json_turn',
      };
    }
  }

  return null;
}
