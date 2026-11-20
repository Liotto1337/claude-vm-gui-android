import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, type Result } from '../../src/shared/ipc';
import type { Attachment } from '../../src/renderer/attachments';
import { getDraft, setDraft } from '../../src/renderer/drafts';
import { sendDraft } from '../../src/renderer/send-draft';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), addPending: vi.fn(() => 'pending-1'), dropPending: vi.fn(), markPendingSent: vi.fn(), revoke: vi.fn(),
}));
vi.mock('../../src/renderer/api', () => ({ api: { term: { send: mocks.send } } }));
vi.mock('../../src/renderer/state', () => ({ addPending: mocks.addPending, dropPending: mocks.dropPending, markPendingSent: mocks.markPendingSent }));
vi.mock('../../src/renderer/attachments', () => ({ revoke: mocks.revoke }));

const attachment: Attachment = {
  id: 'image', name: 'photo.png', url: 'blob:photo', bytes: new Uint8Array([1, 2]), image: true,
  status: 'done', percent: 100, size: 2, remotePath: '/uploads/photo.png',
};
const draft = { text: '  сообщение\nсо второй строкой  ', attachments: [attachment] };

beforeEach(() => {
  vi.clearAllMocks();
  setDraft('s', draft);
  setDraft('other', { text: 'другая сессия', attachments: [] });
});

describe('sendDraft: восстановление после обрыва связи', () => {
  it.each(['result', 'rejection', 'throw'])('ошибка %s возвращает исходный текст и вложения, убирает пузырь отправки', async (mode) => {
    mocks.send.mockImplementation(() => {
      if (mode === 'throw') throw new Error('Connection lost');
      if (mode === 'rejection') return Promise.reject(new Error('Connection lost'));
      return Promise.resolve(fail('NOT_CONNECTED', 'Connection lost'));
    });
    expect(await sendDraft('s')).toMatchObject({ ok: false, error: { message: 'Connection lost' } });
    expect(getDraft('s')).toEqual(draft);
    expect(mocks.dropPending).toHaveBeenCalledWith('s', 'pending-1');
    expect(mocks.markPendingSent).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it('пока отправка ждёт, можно писать; ошибка сохраняет оба текста в исходной сессии', async () => {
    let reject!: (e: Error) => void;
    mocks.send.mockImplementation(() => new Promise((_, r) => { reject = r; }));
    const sending = sendDraft('s');
    expect(getDraft('s')).toEqual({ text: '', attachments: [] });
    setDraft('s', { text: 'следующее', attachments: [] });
    reject(new Error('Connection lost'));
    await sending;
    expect(getDraft('s')).toEqual({ text: `${draft.text}\n\nследующее`, attachments: [attachment] });
    expect(getDraft('other').text).toBe('другая сессия');
  });

  it('успех очищает только отправленный черновик и освобождает его превью', async () => {
    let resolve!: (r: Result<void>) => void;
    mocks.send.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const sending = sendDraft('s');
    setDraft('s', { text: 'следующее', attachments: [] });
    resolve(ok(undefined));
    expect(await sending).toEqual(ok(undefined));
    expect(mocks.send).toHaveBeenCalledWith(draft.text, ['/uploads/photo.png'], 's');
    expect(getDraft('s').text).toBe('следующее');
    expect(mocks.markPendingSent).toHaveBeenCalledWith('s', 'pending-1');
    expect(mocks.revoke).toHaveBeenCalledWith(attachment);
    expect(mocks.dropPending).not.toHaveBeenCalled();
  });

  it('после ошибки можно повторить отправку восстановленного сообщения', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(ok(undefined));
    await sendDraft('s');
    expect(await sendDraft('s')).toEqual(ok(undefined));
    expect(mocks.send.mock.calls).toEqual([[draft.text, ['/uploads/photo.png'], 's'], [draft.text, ['/uploads/photo.png'], 's']]);
    expect(getDraft('s')).toEqual({ text: '', attachments: [] });
  });

  it('/context тоже восстанавливается после отказа IPC, без пузыря в ленте', async () => {
    setDraft('s', { text: '/context', attachments: [] });
    mocks.send.mockRejectedValueOnce(new Error('Connection lost'));
    expect((await sendDraft('s')).ok).toBe(false);
    expect(getDraft('s').text).toBe('/context');
    expect(mocks.addPending).not.toHaveBeenCalled();
    expect(mocks.dropPending).not.toHaveBeenCalled();
  });
});
