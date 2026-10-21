# Claude VM для Android — дизайн

Форк Windows-клиента `claude-vm-gui` 0.2.2 для Android-телефонов. Всё, что здесь не сказано, работает как в 0.2.2 (спецификации `2026-10-18-claude-vm-gui-design.md` и `2026-10-19-claude-vm-gui-v0.2-design.md`).

## Цель

Тот же клиент для Claude Code на ВМ (SSH → tmux → claude), но на телефоне: подключиться к ВМ, видеть и создавать tmux-сессии, читать ленту переписки, отвечать в карточке меню, писать сообщения, открывать терминал и панель «Сервер». Пока приложение свёрнуто, связь держится, а когда Claude закончил ответ или ждёт ответа, приходит уведомление.

### Решения, принятые с пользователем

| Вопрос | Решение |
|---|---|
| Набор функций | Всё как на Windows: лента, терминал, сессии с группами и закреплением, подсказки `/` и `@`, картинки, панель «Сервер», модель и effort |
| Где код | Отдельный репозиторий `Liotto1337/claude-vm-gui-android` с историей исходного; исходный — remote `upstream` |
| Подход | Capacitor: React и сервисы на TypeScript в WebView, SSH и хранение секретов — нативный плагин на Kotlin (sshj) |
| Свёрнутое приложение | Foreground-сервис держит SSH; уведомления «Claude закончил» и «Claude ждёт ответа» по всем сессиям |
| Карта Obsidian | Да: `obsidian/` в репозитории, переписывается под Android-версию |
| Распространение | APK в GitHub Releases, без Play Store |

## 1. Архитектура

### Слои

| Слой | Что | Откуда |
|---|---|---|
| Интерфейс | React-компоненты, состояние (`src/renderer`) | из 0.2.2, плюс мобильная раскладка (раздел 2) |
| Общая логика | `src/shared` целиком | из 0.2.2 без изменений |
| Сервисы | `tmux`, `terminal`, `session-watch`, `transcript`, `metrics`, `hints`, `upload`, `controller`, `layout-store`, `config` → `src/core/` | из `src/main`, Node-модули заменены (ниже) |
| Мост | `window.api` (тот же контракт `Api` из `src/shared/ipc.ts`) вызывает `AppController` напрямую в том же JS | вместо `src/preload` и `src/main/ipc.ts` |
| Платформа | интерфейс `Platform` (`src/core/platform.ts`) | новое |
| Android | Capacitor-плагин `VmBridge` и `SshService` на Kotlin (`android/app/src/main/java/.../`) | новое |

`src/main` (Electron), `src/preload`, `electron-builder.yml`, `.github/workflows/windows.yml` и сборка под Windows из форка удаляются.

### Интерфейс `Platform`

Всё, что сервисам нужно от устройства:

```ts
interface Platform {
  ssh: SshTransport;                          // см. ниже
  prefs: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
  secrets: { save(name: 'password' | 'key', value: string | null): Promise<void>; has(name: 'password' | 'key'): Promise<'yes' | 'no' | 'unreadable'> };
  clipboard: { read(): Promise<string>; write(text: string): Promise<void> };
  openExternal(url: string): Promise<void>;
  pickImage(): Promise<{ name: string; bytes: Uint8Array } | null>;
  background: { setKeepAlive(on: boolean): Promise<void>; setNotifications(on: boolean): Promise<void>; onOpenSession(cb: (name: string) => void): void };
}

interface SshTransport {
  connect(cfg: VmConfig): Promise<Result<void>>;   // секреты читает нативная сторона, в JS их нет
  readonly connected: boolean;
  exec(cmd: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<ExecResult>;
  stream(cmd: string): Promise<Channel>;          // tail -F журнала
  openPty(cmd: string, cols: number, rows: number): Promise<PtyChannel>;
  writeFile(path: string, bytes: Uint8Array, onProgress: (sent: number) => void): Promise<void>;  // SFTP
  close(): Promise<void>;
  on(event: 'state' | 'hostkey', cb): () => void;
  answerHostKey(trust: boolean): void;
}
```

Две реализации:

- **Android** — `src/platform/android.ts` поверх плагина `VmBridge`. Данные каналов (PTY, поток) приходят событиями плагина в base64 пачками не чаще раза в 16 мс; запись в PTY — вызовом плагина.
- **Dev-мост** — `src/platform/devbridge.ts` и `scripts/dev/bridge-server.mjs`: Node-сервер на `ssh2` с тем же протоколом через WebSocket на `127.0.0.1`. Нужен для `npm run dev` в браузере и E2E. В APK не попадает: модуль подключается только при `import.meta.env.MODE !== 'android'`, а сборка APK проверяет, что в бандле нет строки `devbridge`.

### Замены Node-модулей в сервисах

| Было | Стало |
|---|---|
| `node:events` `EventEmitter` | `src/core/emitter.ts` — `on`/`off`/`once`/`emit`, без зависимостей |
| `node:string_decoder` | `TextDecoder` с `stream: true` |
| `node:fs`, `node:path` (config, layout, known_hosts) | `Platform.prefs`; known_hosts — на нативной стороне |
| `node:crypto` (отпечаток ключа хоста) | считается в Kotlin, в JS приходит готовая строка `SHA256:…` |
| `node:child_process` ping, `node:net` TCP | ping убран; проверка TCP:22 — вызов плагина |
| `electron` `safeStorage`, `clipboard`, `shell` | `Platform.secrets`, `Platform.clipboard`, `Platform.openExternal` |

Сервисы, которые работают с SSH (`tmux`, `terminal`, `session-watch`, `transcript`, `metrics`, `hints`, `upload`), получают `SshTransport` вместо `SshConnection` и в остальном не меняются. Это важно: защита от потерянного Enter, детектор меню и разбор журнала остаются общими с Windows-версией.

### Нативная часть (Kotlin)

- `SshService` — foreground-сервис (тип `specialUse`), владеет единственным соединением sshj 0.40.0. Соединение не зависит от жизни Activity и WebView.
- Вход: закрытый ключ (если сохранён) → пароль → keyboard-interactive (ответ на каждый вопрос — сохранённый пароль). Методы, которых сервер не предлагает, не пробуются (как в 0.2.2). ssh-agent нет.
- Ключ хоста: свой `HostKeyVerifier` по файлу `known_hosts` в `filesDir`. Если хост известен, разрешены только его типы ключей. Неизвестный или изменившийся ключ — рукопожатие ждёт ответа из JS (событие `hostkey` с отпечатком SHA256), таймаут 120 с = отказ.
- Keepalive 30 с. Обрыв → переподключение с паузами 1, 2, 5, 10, 30 с (`src/shared/backoff.ts` переносится константами), события `state` в JS.
- Каналы: exec (stdout, stderr, код), PTY с `resize`, поток, SFTP-запись с прогрессом. Каждый канал имеет id; закрытие Activity не закрывает каналы.
- `SecretStore` — AES-256-GCM, ключ в Android Keystore (`setUserAuthenticationRequired(false)`), шифротекст в `SharedPreferences`. Ключ Keystore пропал (переустановка, сброс) → `unreadable`; в JS это существующая ветка `passwordUnreadable`.
- Закрытый ключ импортируется в настройках: выбор файла или вставка текста (OpenSSH, PEM). Ключи с парольной фразой: фраза спрашивается при импорте, ключ сохраняется расшифрованным в `SecretStore`.

Стек: Capacitor 8.5.3 (`@capacitor/core`, `@capacitor/android`, `@capacitor/keyboard`, `@capacitor/app`, `@capacitor/preferences`, `@capacitor/clipboard`, `@capacitor/browser`, `@capacitor/status-bar`), sshj 0.40.0, остальное — версии 0.2.2 (React 19.3.1, Vite, xterm.js 6.0.0, react-markdown). Версии фиксируются точно, как в исходном проекте. Android: compileSdk 36, targetSdk 36, minSdk 26 (Android 8), JDK 21.

## 2. Интерфейс для телефона

Компоненты те же, раскладка зависит от ширины. До 840 px — телефонная раскладка, шире (планшет горизонтально) — как на Windows.

### Раскладка

- **Сайдбар** — выдвижная панель слева: кнопка ☰ в шапке и свайп от левого края. Выбор сессии закрывает панель. Без подключения и без выбранной сессии панель открыта.
- **Шапка сессии**: ☰, имя (папка — второй строкой мелко), переключатель «Лента | Терминал», меню «⋯» с «Завершить сессию» (подтверждение как сейчас).
- **Панель «Сервер»** — полноэкранный экран поверх сессии, блоки в одну колонку, кнопка «←».
- **Поле ввода** поднимается вместе с клавиатурой (`@capacitor/keyboard`, `resize: 'native'`). Модель и effort — одна кнопка слева от «Отправить», открывает нижний лист с двумя списками.
- **Карточка меню**: варианты на всю ширину, высота строки не меньше 48 px, касание выбирает вариант (то же, что клик). ↑↓, цифры, Enter, Esc, Tab — для внешней клавиатуры, как сейчас.
- **Диалоги** (новая сессия, настройки, ключ хоста, название группы) на телефоне — во весь экран.

### Касание

- **Долгое нажатие** (500 мс) на сессию, группу или пустое место списка открывает то же меню, что ПКМ, нижним листом (`ContextMenu` получает вариант отображения `sheet`). Подменю — переход внутри листа со стрелкой «назад».
- **Перенос сессий и групп**: долгое нажатие на ручку ⋮⋮ в строке, затем ведение пальцем. Реализация на pointer events (`src/renderer/touch-drag.ts`): та же линия вставки, перелистывание страниц при задержке на стрелке, итог — тот же вызов `move` из `layout.ts`. HTML5 DnD остаётся для мыши.
- **Терминал**: над клавиатурой строка клавиш `Esc Tab Ctrl ↑ ↓ ← → / | ~ -`. Ctrl залипает до следующей клавиши (Ctrl+C → `\x03`). Байты — через `keyBytes` (белый список дополняется Ctrl+буква). Шрифт меняется щипком (10–22 px, запоминается). Долгое нажатие начинает выделение; копирование — кнопкой «Копировать» над выделением. OSC 52 → буфер Android.
- **Картинки**: 📎 → системный выбор (галерея, камера, файлы) через `<input type="file" accept="image/*">`. Вставка картинки из буфера, где клавиатура это умеет, работает как Ctrl+V сейчас.
- **«Назад»** (`@capacitor/app` `backButton`): закрыть верхний диалог, лист, меню или выделение → закрыть панель «Сервер» → вернуться из сессии к открытой панели списка → свернуть приложение.

### Внешний вид

Палитра, Source Serif 4 и JetBrains Mono — как в 0.2.2; шрифт интерфейса — системный (Roboto) вместо Segoe UI. Светлая, тёмная и системная темы; статус-бар и панель навигации окрашиваются под тему (`@capacitor/status-bar`). Отступы под вырезы экрана — `env(safe-area-inset-*)`. Иконка приложения — из `build/icon.png` исходного проекта (адаптивная, фон — слоновая кость).

## 3. Фон и уведомления

### Foreground-сервис

- Запускается при подключении, если включено «Держать связь в фоне» (по умолчанию включено), и останавливается по «Отключиться» или при выключении настройки.
- Постоянное уведомление (канал «Подключение», низкая важность): «Подключено к ВМ · N сессий», при переподключении — «Переподключение…». Кнопка «Отключиться». Нажатие открывает приложение.
- Выключено «Держать связь в фоне» → соединение живёт, пока жив процесс; при возврате — переподключение (как сейчас после обрыва).

### Уведомления о сессиях

- Работают, только пока Activity не на экране (свёрнуто, экран выключен) и включено «Уведомления» (по умолчанию включено). На Android 13+ при первом включении — системный запрос `POST_NOTIFICATIONS`; отказ выключает настройку и показывает объяснение.
- `SessionNotifier` (Kotlin) раз в 5 с одной командой по SSH получает список tmux-сессий (`TMUX_LS_FORMAT`) и для сессий с claude — последние 25 строк экрана (`capture-pane -p`). Пока приложение на экране, опрос не идёт.
- Состояние сессии: `menu` (открыто меню Claude Code), `busy` (идёт работа), `idle` (поле ввода, работы нет), `unknown`. Переходы:
  - `busy` → `idle`: «*сессия*: Claude закончил».
  - любое → `menu`: «*сессия*: Claude ждёт ответа» + первая непустая строка вопроса меню (до 120 символов).
  - Остальные переходы, первая выборка после старта и `unknown` уведомлений не дают.
- Канал «Сессии», обычная важность. Одно уведомление на сессию (новое заменяет старое), при открытии этой сессии в приложении — снимается.
- Нажатие открывает приложение на этой сессии (`Platform.background.onOpenSession`). Кнопок действий в уведомлении нет.

### Один детектор на двух языках

`NotifyDetector.kt` — перенос `dialogOpen` и проверки спиннера из `parseStatus` (`src/shared/screen-parse.ts`), только то, что нужно для трёх состояний. Расхождение ловят тесты: таблица `tests/fixtures/screens/notify-expected.json` (`имя файла → menu|busy|idle|unknown`) проверяется и Vitest-тестом (через `classifyScreen`), и JUnit-тестом (через `NotifyDetector`) на одних и тех же снимках `*.ans`. При обновлении снимков под новую версию Claude Code падают оба теста, пока таблица не исправлена.

## 4. Хранение и ошибки

| Данные | Где |
|---|---|
| `VmConfig` (адрес, порт, пользователь, тема, последняя сессия, `keepAlive`, `notifications`) | `Preferences`, ключ `config` |
| Раскладка сессий | `Preferences`, ключ `layout`, формат `layout.json` (`{ адрес ВМ: раскладка }`), запись с задержкой 300 мс |
| Шрифт терминала | `Preferences`, ключ `terminalFontSize` |
| `known_hosts` | `filesDir/known_hosts` (Kotlin) |
| Пароль, закрытый ключ | `SecretStore` (Keystore + AES-GCM), в JS не передаются; JS знает только `hasPassword`, `hasKey`, `passwordUnreadable` |

`VmConfig.keyPath` заменяется на `hasKey` (только чтение). Настройки: вместо поля пути — «Ключ: импортирован (ed25519) / Импортировать / Удалить», как с паролем.

Ошибки: коды `ErrorCode` и тексты из 0.2.2 сохраняются. Kotlin возвращает те же коды: `TCP_UNREACHABLE`, `AUTH_FAILED`, `HOSTKEY_MISMATCH`, `HOSTKEY_REJECTED`, `NOT_CONNECTED`, `UPLOAD_FAILED`. Тексты, где упоминались путь к ключу и ssh-agent, переписываются под импортированный ключ. Шаг ping на экране подключения убирается; шаги — TCP → SSH → tmux.

## 5. Тесты

- **Vitest, модульные**: переносятся все тесты `src/shared` и сервисов (сервисы — с фейковым `SshTransport`, как сейчас с фейковым `SshConnection`). Новые: `emitter`, `touch-drag` (расчёт позиции вставки и вызов `move`), строка клавиш терминала (Ctrl+буква), порядок «Назад», `notify-expected.json` через `classifyScreen`.
- **Vitest, интеграционные**: сервисы через dev-мост против ВМ (тестовый ключ `~/.ssh/cvg_test_ed25519`, вход только с самой ВМ), как `test:int` сейчас.
- **JUnit (Kotlin)**: `SshService` против sshd на этой ВМ — вход ключом, паролем и keyboard-interactive (ключом — тестовый `~/.ssh/cvg_test_ed25519`; паролем — пользователь и пароль из `CVG_TEST_SSH_USER` и `CVG_TEST_SSH_PASSWORD`, без них эти тесты пропускаются; пароль в репозиторий не попадает), неизвестный и изменившийся ключ хоста, exec с stdin и таймаутом, PTY с resize, поток, SFTP с прогрессом, обрыв и переподключение; `SecretStore` (Robolectric); `NotifyDetector` по таблице снимков; переходы `SessionNotifier`.
- **Playwright в Chromium** (экран 393×851, касания): весь интерфейс через dev-мост с фейковым claude (`tests/fixtures/fake-claude.mjs`) — подключение и ключ хоста, выдвижная панель, создание сессии, лента и отправка, карточка меню касанием, терминал и строка клавиш, долгое нажатие, перенос сессии, панель «Сервер», «Назад».
- **Дымовой тест на эмуляторе** (KVM, образ x86_64 Android 15, без окна): APK ставится через `adb`, Playwright `_android` подключается к WebView. Путь: настройки → подключение к ВМ (адрес хоста эмулятора `10.0.2.2`) → доверие ключу → открыть сессию с фейковым claude → отправить сообщение → свернуть приложение → фейковый claude показывает меню → в шторке уведомление «ждёт ответа» (`adb shell dumpsys notification`).
- Ручная проверка на телефоне пользователя перед релизом.

## 6. Сборка и выпуск

- Здесь ставятся JDK 21 и Android SDK (cmdline-tools, platform 36, build-tools, эмулятор и образ — для дымового теста).
- Команды: `npm run dev` (браузер + dev-мост), `npm run android:build` (debug APK), `npm run android:run` (на эмулятор или устройство), `npm test`, `npm run test:int`, `npm run test:e2e`, `npm run test:android` (JUnit), `npm run test:smoke` (эмулятор).
- `.github/workflows/android.yml` (ubuntu): типы, Vitest, JUnit, release APK, подписанный ключом из секретов (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Тег `v*` — релиз с `claude-vm-<версия>.apk`.
- Ключ подписи создаётся здесь (`keytool`), в репозиторий не попадает. Пользователь кладёт его в секреты GitHub и хранит копию отдельно: без него обновления ставятся только через удаление приложения.
- Защита адреса ВМ (`scripts/check-no-host.mjs`, `.githooks/pre-commit`) остаётся.
- Версии свои, с `0.1.0`; `applicationId` — `io.github.liotto1337.claudevm`, имя — «Claude VM». README и карта указывают, на какой версии Windows-клиента основан форк. Исправления из `upstream` переносятся `git merge upstream/main` с разрешением конфликтов в `src/core` и `src/renderer`.

## 7. Карта Obsidian

`obsidian/` переписывается под Android-версию в первом этапе: хаб «Claude VM для Android» (что это, как пользоваться на телефоне, ссылки), «Стек и запуск», «Структура кода», «Дизайн и решения», «История разработки» (история Windows-версии — кратко, с отсылкой к исходному репозиторию). Обновляется в каждом коммите.

## 8. Этапы

Каждый этап заканчивается рабочим debug APK и зелёными тестами.

1. **Каркас.** Репозиторий на GitHub, удаление Electron, Capacitor и Gradle, `Platform` и dev-мост, `src/core` из `src/main`, Kotlin `SshService` (без уведомлений) и `SecretStore`, экран подключения, ключ хоста, настройки с импортом ключа, список сессий, выдвижная панель, терминал со строкой клавиш, «Назад». Карта Obsidian.
2. **Лента.** Лента, поле ввода с клавиатурой, карточка меню касанием, модель и effort нижним листом.
3. **Остальное из 0.2.2.** Панель «Сервер», подсказки `/` и `@`, картинки, группы, закрепление, долгое нажатие и перенос.
4. **Фон.** Foreground-сервис, `SessionNotifier`, `NotifyDetector` и общая таблица снимков, настройки «Держать связь в фоне» и «Уведомления», переход по уведомлению, дымовой тест на эмуляторе.
5. **Выпуск.** Подпись, `android.yml`, README со скриншотами с эмулятора, версия 0.1.0, релиз.

## Вне рамок

- Play Store, iOS.
- ssh-agent, несколько ВМ одновременно (как и в 0.2.2 — одна ВМ).
- Кнопки «Разрешить» и «Отклонить» прямо в уведомлении.
- Push-уведомления без постоянного соединения (через сервер на ВМ).
