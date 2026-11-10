import type {
  NotificationInput,
  NotificationRow,
  PublicNotification,
  QueryExecutor,
} from './contract.js';
import { coerceText, warningDetail } from './contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publicNotification(n: NotificationRow): PublicNotification {
  return {
    id: n.id,
    type: n.type,
    referenceId: n.reference_id,
    referenceType: n.reference_type,
    title: n.title,
    message: n.message,
    read: n.read === true,
    createdAt: n.created_at,
    actorId: n.actor_id,
  };
}

function notificationLockKey(
  recipient: string,
  actor: string | null,
  type: string,
  referenceId: string | null,
): string {
  // PostgreSQL text parameters reject NUL bytes. Use the unit separator; a
  // hash collision only serializes unrelated notifications, it does not merge
  // their rows.
  return [recipient, actor || '', type || '', referenceId || ''].join('\u001f');
}

interface NotificationWork {
  recipient: string;
  actor: string | null;
  safeType: string;
  safeRefId: string | null;
  safeRefType: string | null;
  safeTitle: string;
  safeMessage: string;
}

async function performNotificationUpsert(
  executor: QueryExecutor,
  work: NotificationWork,
): Promise<PublicNotification | null> {
  const {
    recipient, actor, safeType, safeRefId, safeRefType, safeTitle, safeMessage,
  } = work;

  // Serializa a checagem/inserção concorrente sem exigir uma restrição única nova.
  // O lock é transacional e só permanece enquanto a transação do chamador durar.
  await executor`SELECT pg_advisory_xact_lock(hashtext(${notificationLockKey(recipient, actor, safeType, safeRefId)}))`;

  // Dedup: se já existe notificação não lida para este recipient, do mesmo actor, tipo e referência
  const existing = await executor<NotificationRow>`
    SELECT id FROM notifications
    WHERE user_id = ${recipient}
      AND actor_id IS NOT DISTINCT FROM ${actor}
      AND type = ${safeType}
      AND reference_id IS NOT DISTINCT FROM ${safeRefId}
      AND read = false
      AND created_at > now() - interval '24 hours'
    LIMIT 1`;

  const existingRow = existing[0];
  if (existingRow) {
    const updated = await executor<NotificationRow>`
      UPDATE notifications
      SET title = ${safeTitle}, message = ${safeMessage}, created_at = now()
      WHERE id = ${existingRow.id}
      RETURNING *`;
    const updatedRow = updated[0];
    return updatedRow ? publicNotification(updatedRow) : null;
  }

  const inserted = await executor<NotificationRow>`
    INSERT INTO notifications (user_id, actor_id, type, reference_id, reference_type, title, message)
    VALUES (${recipient}, ${actor}, ${safeType}, ${safeRefId}, ${safeRefType}, ${safeTitle}, ${safeMessage})
    RETURNING *`;
  const insertedRow = inserted[0];
  return insertedRow ? publicNotification(insertedRow) : null;
}

/**
 * Cria ou atualiza uma notificação com proteção anti-spam (dedup).
 * Se o usuário já tiver uma notificação recente não lida do mesmo ator/tipo/referência,
 * apenas renova o timestamp em vez de criar linhas duplicadas.
 *
 * O trabalho roda em um savepoint quando o executor oferece um, de modo que uma
 * falha de notificação não aborta a transação que gravou o conteúdo principal.
 * Executores simples (sem savepoint) continuam recebendo a tentativa direta e o
 * erro é apenas registrado, como antes.
 */
export async function createNotification(
  executor: QueryExecutor,
  {
    recipientId, actorId, type, referenceId, referenceType, title, message,
  }: NotificationInput,
): Promise<PublicNotification | null> {
  if (!recipientId || coerceText(recipientId) === coerceText(actorId)) return null;
  const recipient = coerceText(recipientId).toLowerCase();
  const actor = actorId && UUID_RE.test(coerceText(actorId)) ? coerceText(actorId).toLowerCase() : null;
  const safeType = coerceText(type || '').slice(0, 40);
  const safeRefId = referenceId ? coerceText(referenceId).slice(0, 200) : null;
  const safeRefType = referenceType ? coerceText(referenceType).slice(0, 40) : null;
  const safeTitle = coerceText(title || 'Notificação').slice(0, 200);
  const safeMessage = coerceText(message || '').slice(0, 1000);
  const work: NotificationWork = {
    recipient, actor, safeType, safeRefId, safeRefType, safeTitle, safeMessage,
  };

  try {
    let result: PublicNotification | null = null;
    if (executor && typeof executor.savepoint === 'function') {
      await executor.savepoint(async function (savepointExecutor) {
        result = await performNotificationUpsert(savepointExecutor ?? executor, work);
      });
    } else {
      result = await performNotificationUpsert(executor, work);
    }
    return result;
  } catch (error) {
    console.warn('createNotification aviso:', warningDetail(error));
    return null;
  }
}
