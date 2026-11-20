import { fail, type Result } from '@shared/ipc';
import { api } from './api';
import { revoke } from './attachments';
import { getDraft, restoreFailed, setDraft } from './drafts';
import { addPending, dropPending, markPendingSent } from './state';

/** Передача черновика: любая ошибка, включая отклонённый IPC/SSH-вызов, возвращает его в исходную сессию. */
export async function sendDraft(session: string): Promise<Result<void>> {
  const sent = getDraft(session);
  const paths = sent.attachments.filter((a) => a.status === 'done').map((a) => a.remotePath!);
  // /context не отображается в журнале — пузырь ему не нужен.
  const pendingId = /^\/context(\s|$)/.test(sent.text.trim()) ? null : addPending(session, sent.text.trim(), paths);
  setDraft(session, { text: '', attachments: [] });
  let result: Result<void>;
  try {
    result = await api.term.send(sent.text, paths, session);
  } catch (e) {
    result = fail('SEND_NOT_CONFIRMED', e instanceof Error ? e.message : 'Не удалось подтвердить отправку. Проверьте связь и повторите.');
  }
  if (!result.ok) {
    if (pendingId) dropPending(session, pendingId);
    restoreFailed(session, sent);
    return result;
  }
  if (pendingId) markPendingSent(session, pendingId);
  for (const a of sent.attachments) revoke(a);
  return result;
}
