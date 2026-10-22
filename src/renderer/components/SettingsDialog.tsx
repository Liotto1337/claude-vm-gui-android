import { useState, type FormEvent } from 'react';
import type { VmConfig } from '@shared/ipc';
import { api } from '../api';
import { useBack } from '../back-stack';
import { keyToSave, passwordToSave, type PasswordMode } from '../settings-password';
import { connect, getState, previewTheme, saveConfig, setState, useAppState } from '../state';

const DEFAULTS: VmConfig = { host: '', port: 22, username: 'root', theme: 'system', keepAlive: true, notifications: true };
const NEEDS_PASSPHRASE = ['Ключ защищён парольной фразой', 'Неверная парольная фраза'];

export function SettingsDialog({ onClose }: { onClose?: () => void }) {
  const { config } = useAppState();
  const [form, setForm] = useState<VmConfig>(config ?? DEFAULTS);
  const [portText, setPortText] = useState(String((config ?? DEFAULTS).port));
  const [error, setError] = useState<string | null>(null);
  const [pwdMode, setPwdMode] = useState<PasswordMode>(config?.hasPassword ? 'saved' : 'edit');
  const [password, setPassword] = useState('');
  const [keyMode, setKeyMode] = useState<PasswordMode>(config?.hasKey ? 'saved' : 'edit');
  const [keyText, setKeyText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [askPassphrase, setAskPassphrase] = useState(false);
  const [notifyDenied, setNotifyDenied] = useState(false);
  const set = (patch: Partial<VmConfig>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = { ...form, port: Number(portText) };
    // Уведомления включают впервые — спросить разрешение Android (13+); отказ — выключить и объяснить
    if (next.notifications && !config?.notifications) {
      const granted = await api.platform.requestNotifications();
      if (!granted) {
        next.notifications = false;
        set({ notifications: false });
        setNotifyDenied(true);
      }
    }
    const pwd = passwordToSave(pwdMode, password, config?.passwordUnreadable === true);
    const err = await saveConfig(next, pwd, keyToSave(keyMode, keyText, passphrase));
    setError(err);
    if (err && NEEDS_PASSPHRASE.includes(err)) setAskPassphrase(true);
    if (!err) void connect();
  };

  const cancel = () => {
    previewTheme(getState().config?.theme ?? 'system');
    if (onClose) onClose();
    else if (getState().config) setState({ view: 'connect' });
  };
  // Без сохранённых настроек закрыть нечего — «Назад» сворачивает приложение
  useBack(!!config || !!onClose, cancel);

  return (
    <div className="overlay">
      <form role="dialog" aria-modal="true" aria-labelledby="settings-title" className="dialog" onSubmit={(e) => void submit(e)}>
        <h2 id="settings-title">Настройки подключения</h2>
        <div className="field">
          <label htmlFor="set-host">Адрес ВМ</label>
          <input id="set-host" value={form.host} autoFocus placeholder="203.0.113.10" onChange={(e) => set({ host: e.target.value })} />
        </div>
        <div className="row gap-12">
          <div className="field grow">
            <label htmlFor="set-user">Пользователь</label>
            <input id="set-user" value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </div>
          <div className="field port">
            <label htmlFor="set-port">Порт</label>
            <input id="set-port" inputMode="numeric" value={portText} onChange={(e) => setPortText(e.target.value)} />
          </div>
        </div>
        {keyMode === 'saved' ? (
          <div className="field">
            <span className="label-like">SSH-ключ</span>
            <div className="row gap-8">
              <span className="grow">Импортирован{config?.keyType ? ` (${config.keyType})` : ''}</span>
              <button type="button" className="btn" onClick={() => setKeyMode('edit')}>Заменить</button>
              <button type="button" className="btn" onClick={() => setKeyMode('deleted')}>Удалить ключ</button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="set-key">SSH-ключ (закрытый, OpenSSH или PEM)</label>
            <textarea
              id="set-key"
              className="mono key-input"
              rows={4}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              value={keyText}
              placeholder={keyMode === 'deleted' ? 'Сохранённый ключ будет удалён' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
              onChange={(e) => setKeyText(e.target.value)}
            />
            <div className="row gap-8">
              <label className="btn file-btn">
                Из файла…
                <input
                  type="file"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void f.text().then(setKeyText);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="hint grow">Не нужен, если задан пароль. Хранится в хранилище ключей Android и в интерфейс не возвращается</span>
            </div>
            {askPassphrase ? (
              <>
                <label htmlFor="set-passphrase">Парольная фраза ключа</label>
                <input id="set-passphrase" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </>
            ) : null}
          </div>
        )}
        {pwdMode === 'saved' ? (
          <div className="field">
            <span className="label-like">Пароль</span>
            <div className="row gap-8">
              <span className="grow">Пароль сохранён</span>
              <button type="button" className="btn" onClick={() => setPwdMode('edit')}>Изменить пароль</button>
              <button type="button" className="btn" onClick={() => setPwdMode('deleted')}>Удалить пароль</button>
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="set-password">Пароль (необязательно)</label>
            <input
              id="set-password"
              type="password"
              autoComplete="off"
              value={password}
              placeholder={pwdMode === 'deleted' ? 'Сохранённый пароль будет удалён' : ''}
              onChange={(e) => setPassword(e.target.value)}
            />
            {config?.passwordUnreadable && pwdMode === 'edit' ? (
              <span className="hint hint-error">
                Сохранённый пароль не удалось расшифровать — например, после переустановки приложения или сброса хранилища ключей. Введите пароль заново или оставьте поле пустым, чтобы удалить его
              </span>
            ) : (
              <span className="hint">Хранится зашифрованным в хранилище ключей Android. Пусто — вход по ключу</span>
            )}
          </div>
        )}
        <div className="field">
          <label className="check-row">
            <input type="checkbox" checked={form.keepAlive} onChange={(e) => set({ keepAlive: e.target.checked })} />
            <span>Держать связь в фоне</span>
          </label>
          <span className="hint">Пока приложение свёрнуто, соединение с ВМ не рвётся (постоянное уведомление «Подключено к ВМ»)</span>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.notifications}
              onChange={(e) => {
                set({ notifications: e.target.checked });
                setNotifyDenied(false);
              }}
            />
            <span>Уведомления</span>
          </label>
          {notifyDenied ? (
            <span className="hint hint-error">Уведомления запрещены в настройках Android — разрешите их там и включите снова</span>
          ) : (
            <span className="hint">«Claude закончил» и «Claude ждёт ответа», пока приложение свёрнуто. Только от сессий, отмеченных „Отслеживать“</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="set-theme">Тема</label>
          <select
            id="set-theme"
            value={form.theme}
            onChange={(e) => {
              const theme = e.target.value as VmConfig['theme'];
              set({ theme });
              previewTheme(theme);
            }}
          >
            <option value="system">Как в системе</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="row end gap-8">
          {config ? <button type="button" className="btn" onClick={cancel}>Отмена</button> : null}
          <button type="submit" className="btn btn-dark">Сохранить и подключиться</button>
        </div>
      </form>
    </div>
  );
}
