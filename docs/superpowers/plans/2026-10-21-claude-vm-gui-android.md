# Claude VM для Android — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android-версия клиента Claude VM (форк 0.2.2): тот же интерфейс и логика на TypeScript в WebView Capacitor, SSH и секреты — нативно на Kotlin, связь в фоне и уведомления о сессиях.

**Architecture:** `src/main` (Electron) превращается в `src/core` — сервисы работают с интерфейсом `SshTransport` вместо `SshConnection`, а `createApi(platform)` собирает `window.api` в том же JS. Платформ две: Android (Capacitor-плагин `VmBridge` → `SshService` на sshj) и dev-мост (Node-сервер на `ssh2` по WebSocket — для браузера и E2E). Интерфейс React получает телефонную раскладку до 840 px.

**Tech Stack:** TypeScript 5.9.3, React 19.3.1, Vite 8.3.4, Vitest 5.0.5, Playwright 1.64.1, Capacitor 8.5.3, Kotlin, sshj 0.40.0, JUnit 4.13.2, Robolectric 4.15.1, ws 8.22.0.

**Spec:** `docs/superpowers/specs/2026-10-21-claude-vm-gui-android-design.md`

## Global Constraints

- Версии npm и Gradle фиксируются точно (без `^`/`~`): `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` 8.5.3; `@capacitor/keyboard` 8.0.6; `@capacitor/app` 8.1.2; `@capacitor/preferences` 8.0.1; `@capacitor/clipboard` 8.0.1; `@capacitor/browser` 8.0.5; `@capacitor/status-bar` 8.0.4; `ws` 8.22.0, `@types/ws` 8.18.2; `com.hierynomus:sshj:0.40.0`; `org.bouncycastle:bcprov-jdk18on:1.80`; `junit:junit:4.13.2`; `org.robolectric:robolectric:4.15.1`. Остальные npm-версии — из 0.2.2.
- Android: compileSdk 36, targetSdk 36, minSdk 26, JDK 21, `applicationId` `io.github.liotto1337.claudevm`, имя «Claude VM».
- Телефонная раскладка — ширина `< 840px`; на 840 px и шире — раскладка 0.2.2.
- Коды `ErrorCode` и тексты 0.2.2 не меняются, кроме текстов про путь к ключу и ssh-agent и шага ping.
- `src/shared` не меняется, кроме `VmConfig` (раздел 4 спецификации) и `keyBytes` (Ctrl+буква).
- Пароль и закрытый ключ никогда не попадают в JS, логи, `Preferences`, репозиторий и тесты (тестовый пароль — только из `CVG_TEST_SSH_PASSWORD`).
- Каждый коммит обновляет затронутые заметки `obsidian/` (CLAUDE.md пользователя) и проходит `.githooks/pre-commit` (адрес ВМ).
- Все тексты интерфейса и сообщения коммитов — по-русски; коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Перед каждым коммитом: `npm run typecheck && npm test` зелёные; с задачи 4 — ещё `npm run android:build`.

## Review Focus

1. **Activity пересоздана (поворот, смена темы, возврат после долгого фона), а соединение в `SshService` живо.** Ожидание: приложение остаётся подключённым к той же сессии, второго соединения нет. Тест — задача 7 (`connect` при живом соединении с тем же конфигом не переподключается, а отдаёт текущее состояние) и задача 19 (смоук: поворот эмулятора).
2. **Смена сети Wi-Fi ↔ мобильная.** Старый TCP молча умирает, keepalive заметит его только через ~90 с. Ожидание: переподключение в течение нескольких секунд после появления новой сети. Тест — задача 18 (обратный вызов `ConnectivityManager` вызывает немедленное переподключение).
3. **Многобайтовый UTF-8 и большие порции данных через мост** (кириллица и эмодзи на границе пачки, `cat` большого файла в терминале). Ожидание: ни одного испорченного символа, порядок байтов сохранён, интерфейс не замирает. Тесты — задача 2 (символ, разрезанный между пачками), задача 5 (нарезка большого вывода) и задача 7 (base64-пачки в порядке `seq`).
4. **Маленький экран с открытой клавиатурой** (360×640): длинная карточка меню и поле ввода. Ожидание: все варианты меню доступны прокруткой, поле ввода видно над клавиатурой. Тест — задача 12.
5. **Процесс убит Android в фоне.** Ожидание: не остаётся «Подключено» в шторке без живого процесса, при открытии приложение подключается заново. Тест — задача 18 (`onTaskRemoved` и `onDestroy` снимают уведомление; сервис `START_NOT_STICKY`).

---

## Этап 1. Каркас

### Task 1: Репозиторий на GitHub, удаление Electron, `src/core` на `SshTransport`

**Files:**
- Create: `src/core/emitter.ts`, `src/core/transport.ts`, `src/core/knobs.ts`
- Move (`git mv`): `src/main/{tmux,terminal,session-watch,transcript,metrics,hints,upload}.ts` → `src/core/`
- Delete: `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/`, `electron.vite.config.ts`, `electron-builder.yml`, `.github/workflows/windows.yml`, `tests/e2e/smoke-win.spec.ts`
- Keep for task 2: `src/main/ssh.ts`, `src/main/preflight.ts`, `src/main/config.ts`, `src/main/layout-store.ts`, `src/main/controller.ts` (переезжают в задачах 2–3)
- Create: `vite.config.ts`; Modify: `package.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.mts`
- Test: `tests/unit/emitter.test.ts`; Modify: тесты сервисов в `tests/unit/` (импорт из `src/core`, фейк `SshTransport`)

**Interfaces:**
- Produces:
  - `class Emitter<E extends Record<string, (...a: any[]) => void>>` — `on(e, cb): () => void`, `off(e, cb)`, `once(e, cb)`, `emit(e, ...args): void`. Сервисы наследуют его вместо `EventEmitter`, имена событий прежние.
  - `src/core/transport.ts`:
    ```ts
    export interface ExecResult { code: number; stdout: string; stderr: string }
    export interface Channel {
      on(e: 'data', cb: (d: Uint8Array) => void): void;
      on(e: 'close' | 'error', cb: () => void): void;
      stderr: { on(e: 'data', cb: (d: Uint8Array) => void): void };
      write(data: string): void;
      end(): void;
      close(): void;
      setWindow(rows: number, cols: number): void;   // только PTY
    }
    export interface SshTransport {
      readonly connected: boolean;
      exec(cmd: string, opts?: { stdin?: string; timeoutMs?: number }): Promise<ExecResult>;
      stream(cmd: string): Promise<Channel>;
      openPty(cmd: string, cols: number, rows: number): Promise<Channel>;
      writeFile(path: string, bytes: Uint8Array, onProgress: (sent: number) => void): Promise<void>;
      on(e: 'state', cb: (s: ConnectionState) => void): () => void;
      on(e: 'lost' | 'reconnected', cb: () => void): () => void;
    }
    ```
  - Сервисы `src/core/*` принимают `SshTransport` первым аргументом конструктора, остальные сигнатуры как в 0.2.2.
  - `src/core/knobs.ts`: `export const knobs: { tmuxSocket?: string; claudeCmd?: string; claudeBin?: string; claudeDir?: string; fakeClaude?: boolean } = {}` — тестовые настройки вместо `process.env.CVG_TMUX_SOCKET`, `CVG_CLAUDE_CMD`, `CVG_CLAUDE_BIN`, `CVG_CLAUDE_DIR`, `CVG_FAKE_CLAUDE` (в WebView нет `process`). Тесты Node заполняют их напрямую, интеграционные — из своих `process.env`.

- [ ] **Step 1:** Создать публичный (как исходный) репозиторий: `gh repo create Liotto1337/claude-vm-gui-android --public --description "Android-клиент для Claude Code на ВМ: SSH, tmux и интерфейс в стиле claude.ai"`, `git remote add origin git@github.com:Liotto1337/claude-vm-gui-android.git`, `git push -u origin main`. Ожидается: ветка `main` на GitHub с историей и коммитом спецификации.
- [ ] **Step 2: Тест `emitter.test.ts`**: `on` возвращает функцию отписки; `once` срабатывает один раз; `emit` без подписчиков не бросает; подписчик, отписавшийся внутри `emit`, не ломает обход остальных.
- [ ] **Step 3:** `npx vitest run tests/unit/emitter.test.ts` — FAIL (нет модуля).
- [ ] **Step 4:** Реализовать `Emitter` и `transport.ts`.
- [ ] **Step 5:** `git mv` сервисов; в них: `EventEmitter` → `Emitter`, `StringDecoder` → `new TextDecoder('utf-8')` с `decode(d, { stream: true })`, `stderr` → `decode(d)`, `ClientChannel` → `Channel`, `stream.setWindow(rows, cols, 0, 0)` → `setWindow(rows, cols)`. В `upload.ts`: `randomBytes(3)` → `crypto.getRandomValues(new Uint8Array(3))` в hex; цикл SFTP-записи → `conn.writeFile(path, bytes, (sent) => emit('progress', { id, sent, total }))`.
- [ ] **Step 6:** Фейки в тестах сервисов (`terminal-send`, `terminal-keys`, `metrics-service`) переписать под `SshTransport`: `Channel` на `Emitter`, `data` — `Uint8Array` (`new TextEncoder().encode(...)`).
- [ ] **Step 7:** Удалить Electron: файлы из списка, из `package.json` — `electron`, `electron-vite`, `electron-builder`, `@types/ssh2` остаётся (нужен мосту), `main`, скрипты `dev`/`build`/`build:win`/`screenshots`. `ssh2` переезжает в `devDependencies` (нужен только мосту). Новые скрипты: `"dev": "vite"`, `"build": "vite build"`. `vite.config.ts`: `root: 'src/renderer'`, `build.outDir: '../../dist'`, алиасы `@shared` → `src/shared`, `@core` → `src/core`, плагин react. Алиас `@core` — в `vitest.config.mts` и обоих tsconfig; `src/core/**` — в `tsconfig.web.json` (сервисы теперь выполняются в WebView и не видят типов Node).
- [ ] **Step 8:** `npm run typecheck && npm test` — PASS (интеграционные и E2E пока не запускаются, они переезжают в задачах 2–3).
- [ ] **Step 9:** Карта: хаб `obsidian/Claude VM GUI.md` → `obsidian/Claude VM для Android.md` (что это: форк 0.2.2 для Android, ссылка на исходный репозиторий, этап разработки), «Структура кода» — строки `src/core`, `src/main` помечены «переезжает». Проверить, что каждая `[[ссылка]]` ведёт ровно в один файл.
- [ ] **Step 10:** Коммит «Android: src/core на SshTransport, Electron удалён», `git push`.

### Task 2: Node-транспорт и dev-мост

**Files:**
- Move: `src/main/ssh.ts` → `bridge/ssh.ts`, `src/main/preflight.ts` → `bridge/preflight.ts` (ping удалён, остаётся `checkTcp`)
- Create: `bridge/node-transport.ts`, `bridge/server.ts`, `bridge/protocol.ts`, `src/platform/devbridge.ts`
- Move: `tests/integration/*` — импорт сервисов из `src/core`, транспорт — `NodeTransport`
- Test: `tests/unit/bridge-protocol.test.ts`, `tests/unit/core-decode.test.ts`

**Interfaces:**
- Consumes: `SshTransport`, `Channel` (задача 1).
- Produces:
  - `class NodeTransport implements SshTransport` поверх `SshConnection` (`bridge/node-transport.ts`); конструктор `(conn: SshConnection)`.
  - `bridge/protocol.ts` — сообщения WebSocket (JSON, байты в base64):
    - клиент → сервер: `{ id, op: 'connect' | 'disconnect' | 'exec' | 'stream' | 'pty' | 'write' | 'end' | 'close' | 'resize' | 'writeFile' | 'answerHostKey' | 'tcp' | 'secrets.save' | 'secrets.has', ...args }`;
    - сервер → клиент: `{ id, ok, result | error }` на каждый запрос и события `{ ev: 'state' | 'lost' | 'reconnected' | 'hostkey' | 'preflight' | 'data' | 'stderr' | 'close' | 'progress', ch?, seq?, b64?, ... }`.
    - `seq` — номер пачки внутри канала, с 0.
  - `bridge/server.ts`: `npm run bridge` слушает `127.0.0.1:${CVG_BRIDGE_PORT ?? 8790}`; секреты — в памяти процесса (переменная `CVG_BRIDGE_PASSWORD` задаёт пароль при старте, ключ — путь `CVG_BRIDGE_KEY`); `known_hosts` — `CVG_KNOWN_HOSTS`.
  - `src/platform/devbridge.ts`: `export function devBridgeTransport(url: string): SshTransport & { connect(cfg: VmConfig): Promise<Result<void>>; close(): Promise<void>; answerHostKey(trust: boolean): void; onHostKey(cb): () => void; onPreflight(cb): () => void }`.

- [ ] **Step 1: Тест `core-decode.test.ts`**: фейковый канал отдаёт «ё» (`0xD1 0x91`) двумя пачками `[0xD1]`, `[0x91]` и эмодзи 😀 четырьмя по байту; `TerminalService` эмитит `data` с текстом `ё😀` без `�` (Review Focus 3).
- [ ] **Step 2: Тест `bridge-protocol.test.ts`**: клиент `devBridgeTransport` с фейковым WebSocket — пачки `seq` 1, 0, 2 приходят не по порядку и отдаются каналу в порядке 0, 1, 2; ответ на неизвестный `id` игнорируется; `exec` после закрытия сокета → reject `NOT_CONNECTED`.
- [ ] **Step 3:** Запустить оба — FAIL.
- [ ] **Step 4:** Реализовать `NodeTransport`, `protocol.ts`, `server.ts`, `devbridge.ts`. Из `bridge/ssh.ts` убрать ping (`runPreflight` шлёт шаги `tcp`, `ssh`); ssh-agent остаётся только в мосте.
- [ ] **Step 5:** Тесты PASS; `npm run test:int` (тестовый ключ есть на ВМ) — PASS; без ключа — пропуск, как раньше.
- [ ] **Step 6:** Карта («Стек и запуск»: `npm run bridge`, переменные `CVG_BRIDGE_*`; «Структура кода»: `bridge/`, `src/platform/`), коммит «Android: dev-мост и Node-транспорт».

### Task 3: `createApi` и `Platform`, приложение в браузере, E2E на мосту

**Files:**
- Create: `src/core/platform.ts`, `src/core/api.ts`, `src/core/config.ts` (из `src/main/config.ts`), `src/core/layout-store.ts` (из `src/main/layout-store.ts`), `src/platform/select.ts`
- Move+Modify: `src/main/controller.ts` → `src/core/controller.ts`; удалить `src/main/`
- Modify: `src/shared/ipc.ts` (`VmConfig`), `src/renderer/api.ts`, `src/renderer/main.tsx`, `src/renderer/components/SettingsDialog.tsx`, `src/renderer/components/ConnectScreen.tsx`
- Modify: `tests/e2e/helpers.ts`, `playwright.config.ts`, все `tests/e2e/*.spec.ts`
- Test: `tests/unit/config.test.ts`, `tests/unit/layout-store.test.ts`, `tests/unit/api.test.ts`

**Interfaces:**
- Consumes: `SshTransport` (1), `devBridgeTransport` (2).
- Produces:
  - `VmConfig`: поле `keyPath` удалено; добавлены только для чтения `hasKey?: boolean`, `keyType?: string`, и настройки `keepAlive: boolean` (по умолчанию `true`), `notifications: boolean` (по умолчанию `true`).
  - `src/core/platform.ts` — `Platform` из раздела 1 спецификации, где `ssh: ConnectableTransport`:
    ```ts
    interface ConnectableTransport extends SshTransport {
      connect(cfg: VmConfig): Promise<Result<void>>;
      close(): Promise<void>;
      checkTcp(host: string, port: number): Promise<{ ok: boolean; ms: number | null }>;
      onHostKey(cb: (p: HostKeyPrompt) => void): () => void;
      answerHostKey(trust: boolean): void;
      onPreflight(cb: (e: PreflightEvent) => void): () => void;
    }
    ```
    и `secrets: { save(name: 'password' | 'key', value: string | null, passphrase?: string): Promise<Result<{ keyType?: string }>>; has(name: 'password' | 'key'): Promise<'yes' | 'no' | 'unreadable'> }`.
  - `createApi(p: Platform): Api` (`src/core/api.ts`) — реализует весь контракт `Api`; `config.save(c, password)` дополнен необязательным третьим аргументом `key?: { text: string; passphrase?: string } | null` (`null` — удалить ключ). `Api.platform` дополнен `isPhone(): boolean`.
  - `PreflightStep` = `'tcp' | 'ssh' | 'tmux'`.
  - `selectPlatform(): Promise<Platform>` (`src/platform/select.ts`): `Capacitor.isNativePlatform()` → Android (задача 7), иначе dev-мост `ws://127.0.0.1:8790` (`?bridge=` в адресе переопределяет). Мост подключается только `if (import.meta.env.MODE !== 'android') await import('./devbridge')`, чтобы в сборке APK его не было.
  - Тестовые `knobs` в браузере — из параметров адреса `?knobs=<json>`, только при `import.meta.env.MODE !== 'android'`; в APK — из `localStorage['cvg-knobs']`, только при сборке с `VITE_TEST_KNOBS=1` (задача 19).

- [ ] **Step 1: Тесты.** `config.test.ts`: `loadConfig` из `prefs` с `hasPassword`/`passwordUnreadable` по `secrets.has('password')`; `validateConfig` требует ключ или пароль («Импортируйте SSH-ключ или задайте пароль»); `keepAlive`/`notifications` по умолчанию `true`. `layout-store.test.ts`: прежние проверки поверх фейкового `prefs`, запись через 300 мс. `api.test.ts`: `createApi` с фейковым `Platform` — `connection.connect` шлёт `onPreflight` шаги `tcp → ssh → tmux`; без конфига — `CONFIG_INVALID`; `tmux.list` до подключения — `NOT_CONNECTED`; повторный `connect`, пока соединение живо и конфиг тот же, не вызывает `ssh.connect` второй раз и отдаёт `connected` (Review Focus 1).
- [ ] **Step 2:** Запустить — FAIL.
- [ ] **Step 3:** Реализовать: `controller.ts` без `IpcHub` (события — через собственный `Emitter` внутри `createApi`), без `process.env` (каталог Claude Code — `knobs.claudeDir ?? \`${home}/.claude\``). `ConnectScreen` — без шага ping. `SettingsDialog` — блок «Ключ»: «Импортирован (ed25519) · Заменить · Удалить» / «Импортировать» (поле вставки текста + кнопка «Из файла» через `<input type="file">`, поле «Парольная фраза» появляется, если `save` вернул ошибку `CONFIG_INVALID` с текстом «Ключ защищён парольной фразой»).
- [ ] **Step 4:** Unit PASS.
- [ ] **Step 5:** E2E: `helpers.ts` запускает мост (`CVG_KNOWN_HOSTS`, тестовый ключ) и `vite preview`, а `CVG_TMUX_SOCKET`, `CVG_CLAUDE_CMD`, `CVG_CLAUDE_DIR`, `CVG_FAKE_CLAUDE` — как в 0.2.2 — передаёт странице через `?knobs=`; тесты открывают Chromium 1280×800. `CVG_TEST_HOOKS`-хук обрыва — op `__drop` моста. Существующие спеки переносятся без изменения проверок, кроме шагов ping и поля пути к ключу.
- [ ] **Step 6:** `npm run test:e2e` — PASS.
- [ ] **Step 7:** Карта, коммит «Android: createApi и Platform, приложение работает в браузере через мост».

### Task 4: Проект Android и плагин `VmBridge` (каркас)

**Files:**
- Create: `capacitor.config.ts`, `android/` (через `npx cap add android`), `android/app/src/main/java/io/github/liotto1337/claudevm/VmBridgePlugin.kt`, `scripts/android-env.sh`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: плагин `VmBridge` с методами-заглушками (`connect`, `close`, `exec`, `openChannel`, `write`, `end`, `closeChannel`, `resize`, `writeFile`, `answerHostKey`, `checkTcp`, `secretsSave`, `secretsHas`, `setBackground`), каждая отвечает `reject("not implemented")`; скрипты `android:build` (`vite build --mode android && npx cap sync android && cd android && ./gradlew assembleDebug`), `android:run`, `test:android` (`cd android && ./gradlew testDebugUnitTest`).

- [ ] **Step 1:** Установить JDK 21 (`apt-get install -y openjdk-21-jdk-headless`) и Android cmdline-tools в `/opt/android-sdk`; `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`. `scripts/android-env.sh` экспортирует `ANDROID_HOME`, `JAVA_HOME`, `PATH`. Проверка: `sdkmanager --list_installed` показывает три пакета.
- [ ] **Step 2:** `npm i -E` Capacitor-пакетов из Global Constraints; `capacitor.config.ts`: `appId`, `appName`, `webDir: 'dist'`, `plugins.Keyboard.resize: 'native'`, `android.allowMixedContent: false`. `npx cap add android`; в `android/variables.gradle` — compileSdk/targetSdk 36, minSdk 26.
- [ ] **Step 3:** Плагин-заглушка, регистрация в `MainActivity`. Иконка: адаптивная из `build/icon.png` (передний план — логотип, фон — `#FAF9F5`) во всех `mipmap-*` через `npx @capacitor/assets@3.0.5 generate --android --iconBackgroundColor '#FAF9F5'` (версию зафиксировать в `devDependencies`).
- [ ] **Step 4:** `npm run android:build` — `android/app/build/outputs/apk/debug/app-debug.apk` создан. Проверка, что мост не попал в бандл: `! grep -rq devbridge dist/` (добавить в `android:build` перед `cap sync`).
- [ ] **Step 5:** Карта («Стек и запуск»: SDK, команды), коммит «Android: проект Capacitor и каркас плагина».

### Task 5: `SshService` на sshj и JUnit против sshd

**Files:**
- Create: `android/app/src/main/java/io/github/liotto1337/claudevm/ssh/{SshService.kt,SshSession.kt,HostKeys.kt,Channels.kt,Backoff.kt,AuthPlan.kt}`
- Test: `android/app/src/test/java/io/github/liotto1337/claudevm/ssh/{SshSessionTest.kt,HostKeysTest.kt,AuthPlanTest.kt,ChannelsTest.kt}`

**Interfaces:**
- Produces (Kotlin, внутренний API для плагина):
  - `class SshSession(cfg: SshConfig, secrets: SecretSource, hostKeys: HostKeys, listener: SshListener)` — `suspend fun connect(interactive: Boolean): SshResult`, `val connected: Boolean`, `suspend fun exec(cmd: String, stdin: String?, timeoutMs: Long?): ExecResult`, `fun openStream(cmd): Int` / `fun openPty(cmd, cols, rows): Int` (id канала), `fun write(ch: Int, data: ByteArray)`, `fun end(ch)`, `fun close(ch)`, `fun resize(ch, cols, rows)`, `suspend fun writeFile(path, bytes, onProgress: (Long) -> Unit)`, `fun forceReconnect()`, `fun close()`.
  - `SshListener`: `onState(state, attempt?)`, `onLost()`, `onReconnected()`, `onHostKey(prompt): Deferred<Boolean>`, `onData(ch, seq, bytes)`, `onStderr(ch, seq, bytes)`, `onClose(ch)`.
  - `SshResult` — `Ok` или `Err(code: String, message: String)`, `code` из `ErrorCode`.
  - `object Backoff { fun delayMs(attempt: Int): Long }` — 1000, 2000, 5000, 10000, 30000 (дальше 30000).
  - `AuthPlan.build(offered: List<String>?, hasKey: Boolean, hasPassword: Boolean): List<String>` — порядок `publickey → password → keyboard-interactive`, методы вне `offered` пропускаются.

- [ ] **Step 1: Тесты (чистый JVM).** `AuthPlanTest`: `offered = [publickey]`, есть пароль → только `publickey`; ключа нет → `password`, `keyboard-interactive`. `HostKeysTest`: формат `known_hosts` (в т.ч. `[host]:port` и хешированные строки `|1|` из `tests/fixtures`… использовать те же примеры, что `tests/unit/known-hosts.test.ts`), известный хост с ключом другого типа → разрешены только известные типы, изменившийся ключ → `HOSTKEY_MISMATCH` с текстом «Ключ сервера изменился. В known_hosts: SHA256:…, сервер прислал: SHA256:…». `ChannelsTest`: пачки нумеруются с 0 подряд, вывод больше 64 КБ режется на пачки ≤ 32 КБ без потери байтов (Review Focus 3).
- [ ] **Step 2: `SshSessionTest`** против `127.0.0.1:22` (пропуск через `Assume`, если нет `~/.ssh/cvg_test_ed25519`): вход ключом; неизвестный ключ хоста → `onHostKey`, ответ `false` → `HOSTKEY_REJECTED`; `exec("cat", stdin="ok")` → `stdout == "ok"`; `exec("sleep 5", timeoutMs=300)` возвращается быстрее 2 с; PTY `echo $COLUMNS` после `resize(…, 100, 30)` → `100`; `writeFile` 200 КБ → `sha256sum` на сервере совпадает, `onProgress` монотонен и заканчивается на 204800; закрытие сокета → `onLost`, затем `onReconnected`. Пароль и keyboard-interactive — с `CVG_TEST_SSH_USER`/`CVG_TEST_SSH_PASSWORD`, иначе пропуск.
- [ ] **Step 3:** `npm run test:android` — FAIL.
- [ ] **Step 4:** Реализовать. Перед первым использованием sshj на Android заменить урезанный системный BouncyCastle: `Security.removeProvider("BC"); Security.insertProviderAt(BouncyCastleProvider(), 1)`. Keepalive 30 с. Таймаут рукопожатия 20 с замирает, пока ждётся ответ про ключ хоста (как в 0.2.2), ответ ждётся не дольше 120 с. Переподключение не интерактивно: неизвестный или изменившийся ключ → состояние `failed`.
- [ ] **Step 5:** `npm run test:android` — PASS.
- [ ] **Step 6:** Карта, коммит «Android: SSH на sshj».

### Task 6: `SecretStore` и импорт ключа

**Files:**
- Create: `android/app/src/main/java/io/github/liotto1337/claudevm/secrets/{SecretStore.kt,KeyImport.kt}`
- Test: `android/app/src/test/java/io/github/liotto1337/claudevm/secrets/{SecretStoreTest.kt,KeyImportTest.kt}`

**Interfaces:**
- Produces:
  - `class SecretStore(ctx: Context)` — `fun save(name: String, value: String?)`, `fun has(name): String` (`"yes" | "no" | "unreadable"`), `fun read(name): String?` (только для `SshSession`). AES-256-GCM, ключ Keystore `cvg-secrets`, шифротекст и IV в `SharedPreferences("cvg-secrets")`.
  - `KeyImport.parse(text: String, passphrase: String?): KeyImport.Result` — `Ok(pemWithoutPassphrase: String, type: String)` | `NeedsPassphrase` | `Invalid(message)`. Тип — `ed25519`, `ecdsa`, `rsa`.

- [ ] **Step 1: Тесты (Robolectric для `SecretStore`).** Сохранить → `has == "yes"`, `read` возвращает строку; `save(null)` → `"no"`; повреждённый шифротекст → `"unreadable"`, `read == null`. `KeyImport`: тестовый ed25519 без фразы → `Ok`, `type == "ed25519"`; ключ с фразой без неё → `NeedsPassphrase`; с неверной → `Invalid("Неверная парольная фраза")`; мусор → `Invalid("Это не закрытый ключ OpenSSH или PEM")`. Тестовые ключи — фикстуры `android/app/src/test/resources/keys/` (`ed25519`, `ed25519-pass` с фразой `test`, `rsa`), созданные один раз `ssh-keygen` и закоммиченные; нигде, кроме тестов, они не используются.
- [ ] **Step 2:** FAIL → реализовать (Keystore в Robolectric подменяется: интерфейс `KeyProvider` с реализацией `AndroidKeystoreProvider` и тестовой `InMemoryKeyProvider`) → PASS.
- [ ] **Step 3:** Карта, коммит «Android: хранение пароля и ключа в Keystore».

### Task 7: Плагин `VmBridge` и Android-платформа в TS

**Files:**
- Modify: `VmBridgePlugin.kt`
- Create: `src/platform/android.ts`, `src/platform/android-channels.ts`
- Test: `tests/unit/android-platform.test.ts`; Kotlin: `VmBridgePluginTest.kt` (Robolectric)

**Interfaces:**
- Consumes: `SshSession` (5), `SecretStore`, `KeyImport` (6), `Platform` (3).
- Produces: `androidPlatform(plugin = VmBridge): Platform`. События плагина: `state`, `lost`, `reconnected`, `hostkey`, `preflight`, `chunk` (`{ ch, seq, kind: 'data' | 'stderr', b64 }`), `closed` (`{ ch }`), `progress`. Пачки `chunk` копятся в Kotlin и отправляются не чаще раза в 16 мс. Для задачи 18 — метод `setBackground({ keepAlive, notifications, visible })`.

- [ ] **Step 1: TS-тест** с фейковым плагином: `chunk` `seq` 2, 0, 1 → канал получает байты по порядку; `chunk` закрытого канала игнорируется; `connect` возвращает `Result` с кодом из ошибки плагина (`{ code: 'AUTH_FAILED', message }`); `secrets.save('key', …)` с ответом `NeedsPassphrase` → `fail('CONFIG_INVALID', 'Ключ защищён парольной фразой')`.
- [ ] **Step 2: Kotlin-тест**: `connect` при уже подключённой сессии с тем же `host/port/username` → `resolve` без нового соединения и событие `state: connected` (Review Focus 1); с другим конфигом → старая сессия закрывается.
- [ ] **Step 3:** FAIL → реализовать. Сессия живёт в `SshService` (обычный bound-сервис на этом этапе; foreground — задача 18), плагин привязывается к нему в `load()`.
- [ ] **Step 4:** PASS; `npm run android:build`.
- [ ] **Step 5:** Ручная проверка на эмуляторе (`sdkmanager "emulator" "system-images;android-35;google_apis;x86_64"`, AVD `cvg`, `emulator -avd cvg -no-window -gpu swiftshader_indirect`): подключение к `10.0.2.2` тестовым ключом (импорт текстом), доверие ключу хоста, список сессий виден. Снимок `adb exec-out screencap -p`.
- [ ] **Step 6:** Карта, коммит «Android: плагин VmBridge и платформа».

### Task 8: Телефонная раскладка

**Files:**
- Create: `src/renderer/use-phone.ts`, `src/renderer/components/Drawer.tsx`, `src/renderer/styles/phone.css`
- Modify: `MainView.tsx`, `Sidebar.tsx`, `SessionHeader.tsx`, `NewSessionDialog.tsx`, `SettingsDialog.tsx`, `HostKeyDialog.tsx`, `GroupNameDialog.tsx`, `src/renderer/styles/tokens.css`, `src/renderer/main.tsx`
- Test: `tests/e2e/phone-layout.spec.ts`

**Interfaces:**
- Produces: `usePhone(): boolean` (`matchMedia('(max-width: 839.98px)')`); `<Drawer open onClose>`; в `MainView` состояние `drawerOpen` (открыт без подключения и без выбранной сессии); шапка — кнопка `aria-label="Сессии"` (☰) и меню `aria-label="Ещё"` (⋯) с «Завершить сессию».

- [ ] **Step 1: E2E** (Chromium 393×851, `hasTouch`, `isMobile`): после подключения панель сессий открыта; выбор сессии закрывает её; ☰ открывает; свайп от левого края (`touchstart` x=5 → `touchmove` x=200) открывает; «⋯ → Завершить сессию» спрашивает подтверждение; диалог «Новая сессия» занимает весь экран; на 1280×800 раскладка прежняя (сайдбар виден, ☰ нет).
- [ ] **Step 2:** FAIL → реализовать (шрифт интерфейса на телефоне — `Roboto, system-ui`; отступы `env(safe-area-inset-*)`; `@capacitor/status-bar` — цвет фона и стиль по теме при её смене) → PASS.
- [ ] **Step 3:** Карта, коммит «Android: телефонная раскладка».

### Task 9: Кнопка «Назад»

**Files:**
- Create: `src/renderer/back-stack.ts`
- Modify: компоненты с диалогами, листами и меню (регистрируют закрытие), `src/platform/android.ts` (`App.addListener('backButton')`), `src/core/platform.ts` (`onBack(cb): () => void`, `exitApp()`)
- Test: `tests/unit/back-stack.test.ts`, `tests/e2e/phone-layout.spec.ts`

**Interfaces:**
- Produces: `pushBack(close: () => void): () => void` (возвращает снятие), `handleBack(ctx: { serverOpen: boolean; closeServer(): void; sessionOpen: boolean; openDrawer(): void; exit(): void }): void`. Порядок — раздел 2 спецификации.

- [ ] **Step 1: Тест**: стек из диалога и листа — первый «Назад» закрывает лист (верхний), второй — диалог; пустой стек и открыт «Сервер» → `closeServer`; открыта сессия → `openDrawer`; иначе → `exit`. E2E (dev-мост: «Назад» эмулируется `Escape` на `document` с флагом `?backKey=Escape`): открыть «Новая сессия» → «Назад» закрывает диалог.
- [ ] **Step 2:** FAIL → реализовать → PASS.
- [ ] **Step 3:** Карта, коммит «Android: кнопка Назад».

### Task 10: Терминал на телефоне

**Files:**
- Create: `src/renderer/components/KeyRow.tsx`, `src/renderer/terminal-touch.ts`
- Modify: `TerminalView.tsx`, `src/shared/paste.ts` (`ctrlKey`)
- Test: `tests/unit/paste.test.ts`, `tests/unit/terminal-touch.test.ts`, `tests/e2e/phone-terminal.spec.ts`

**Interfaces:**
- Produces: `ctrlKey(ch: string): string | null` — `a`–`z` и `[ \ ] ^ _` → байт `ch & 0x1f`, остальное → `null`; `KeyRow` с клавишами `Esc Tab Ctrl ↑ ↓ ← → / | ~ -`; `pinchFontSize(start: number, scale: number): number` — округление, предел 10–22; ключ `Preferences` `terminalFontSize`.

- [ ] **Step 1: Тесты**: `ctrlKey('c') === '\x03'`, `ctrlKey('C') === '\x03'`, `ctrlKey('1') === null`; `pinchFontSize(14, 2) === 22`, `pinchFontSize(14, 0.5) === 10`, `pinchFontSize(14, 1.07) === 15`. E2E: в терминале сессии без claude нажать «Ctrl», затем ввести `c` с клавиатуры → в tmux приходит `^C` (проверка: запущенный `sleep 100` прерван, `tmux display -p '#{pane_current_command}'` = `bash`); «Ctrl» гаснет после одной клавиши; «↑» отправляет `\x1b[A`.
- [ ] **Step 2:** FAIL → реализовать (строка видна, только когда открыт терминал и `usePhone()`; щипок — два pointer’а на контейнере xterm; долгое нажатие 500 мс включает выделение xterm, над ним кнопка «Копировать» → `platform.clipboard.write`) → PASS.
- [ ] **Step 3:** Карта, коммит «Android: терминал — строка клавиш, щипок, копирование». **Конец этапа 1:** `npm run android:build`, ручной прогон на эмуляторе как в задаче 7 плюс терминал.

## Этап 2. Лента

### Task 11: Нижний лист и модель/effort

**Files:**
- Create: `src/renderer/components/BottomSheet.tsx`
- Modify: `Composer.tsx`, `ChoiceMenu.tsx`
- Test: `tests/e2e/phone-chat.spec.ts`

**Interfaces:**
- Produces: `<BottomSheet open title onClose>{children}</BottomSheet>` — регистрирует себя в `back-stack`, закрывается касанием фона и свайпом вниз; на телефоне кнопка `aria-label="Модель и effort"` у поля ввода открывает лист с двумя списками (те же `setModel`/`setEffort`).

- [ ] **Step 1: E2E** (фейковый claude): открыть сессию с claude → кнопка «Модель и effort» → выбрать модель → в фейковый claude ушло `/model <value>`; свайп вниз закрывает лист.
- [ ] **Step 2:** FAIL → реализовать → PASS. Коммит «Android: нижний лист, модель и effort».

### Task 12: Лента и карточка меню на телефоне

**Files:**
- Modify: `ChatView.tsx`, `MenuCard.tsx`, `Composer.tsx`, `src/renderer/styles/phone.css`
- Test: `tests/e2e/phone-chat.spec.ts`

**Interfaces:**
- Consumes: `api.chat.key` (как в 0.2.2).

- [ ] **Step 1: E2E**: отправка сообщения касанием «Отправить» → пузырь и ответ фейкового claude; карточка меню: варианты высотой ≥ 48 px, касание по варианту 2 отправляет клавиши, как клик в 0.2.2; подсказки `/` и `@` открываются и выбираются касанием. Viewport 360×640 с эмуляцией клавиатуры (высота окна уменьшается до 360 px): все варианты карточки из `permission-bash.ans` достижимы прокруткой, поле ввода целиком видно (Review Focus 4).
- [ ] **Step 2:** FAIL → реализовать → PASS.
- [ ] **Step 3:** `npm run android:build`, ручная проверка на эмуляторе: лента, отправка, меню. Карта, коммит «Android: лента и карточка меню». **Конец этапа 2.**

## Этап 3. Остальное из 0.2.2

### Task 13: Панель «Сервер» во весь экран

**Files:** Modify: `ServerPanel.tsx`, `MainView.tsx`, `phone.css`; Test: `tests/e2e/phone-server.spec.ts`

- [ ] **Step 1: E2E**: «Сервер» на телефоне открывает экран поверх сессии с кнопкой `aria-label="Назад"`, блоки в одну колонку (ширина каждого = ширине экрана минус отступы), «Назад» (кнопка и `back-stack`) возвращает к сессии; `metrics.setActive(true)` при открытии и `false` при закрытии.
- [ ] **Step 2:** FAIL → реализовать → PASS. Коммит «Android: панель Сервер».

### Task 14: Долгое нажатие — меню нижним листом

**Files:**
- Create: `src/renderer/long-press.ts`
- Modify: `ContextMenu.tsx` (вариант `variant: 'popup' | 'sheet'`), `SessionList.tsx`
- Test: `tests/unit/long-press.test.ts`, `tests/e2e/phone-sessions.spec.ts`

**Interfaces:**
- Produces: `longPress(el: HTMLElement, cb: (x: number, y: number) => void, opts?: { ms?: number; slop?: number }): () => void` — по умолчанию 500 мс, отмена при сдвиге больше 10 px или отпускании; `ContextMenu` с `variant='sheet'` показывает подменю внутри листа со строкой «‹ Назад».

- [ ] **Step 1: Тесты**: `long-press` на фейковых pointer-событиях и фейковых таймерах — 499 мс не срабатывает, 500 срабатывает, сдвиг на 11 px отменяет. E2E: долгое нажатие на сессию → лист с «Закрепить», «Переместить в группу ›» → подменю → «‹ Назад»; долгое нажатие на пустое место → «Новая сессия…», «Новая группа…».
- [ ] **Step 2:** FAIL → реализовать → PASS. Коммит «Android: меню по долгому нажатию».

### Task 15: Перенос касанием

**Files:**
- Create: `src/renderer/touch-drag.ts`
- Modify: `SessionList.tsx` (ручка `⋮⋮` с `aria-label="Перенести"` на телефоне)
- Test: `tests/unit/touch-drag.test.ts`, `tests/e2e/phone-sessions.spec.ts`

**Interfaces:**
- Consumes: `move`, `paginate`, `ROW_HEIGHTS` из 0.2.2.
- Produces: `dropTarget(rows: RowBox[], y: number): { index: number; into?: string } | null` — та же цель вставки, что вычисляет HTML5 DnD в `SessionList` (вынести расчёт из `SessionList` в эту функцию и использовать в обоих путях); `startTouchDrag(handle, opts: { onMove(t), onDrop(t), onPageFlip(dir) })`.

- [ ] **Step 1: Тесты**: `dropTarget` — над верхней половиной строки → вставка перед ней, над нижней → после, над заголовком группы → `into` группы, вне списка → `null`; перелистывание после 600 мс над стрелкой страницы. E2E: перетащить третью сессию на место первой → порядок в списке и в `layout.save` изменился; после перезагрузки страницы порядок сохранён.
- [ ] **Step 2:** FAIL → реализовать → PASS. Коммит «Android: перенос сессий касанием».

### Task 16: Картинки

**Files:** Modify: `Composer.tsx`, `src/platform/android.ts` (`writeFile` — base64 пачками по 256 КБ, прогресс из `progress`), `VmBridgePlugin.kt`; Test: `tests/unit/android-platform.test.ts`, `tests/e2e/phone-chat.spec.ts`

- [ ] **Step 1: Тесты**: `writeFile` 600 КБ уходит тремя вызовами плагина (256+256+88 КБ), прогресс 262144 → 524288 → 614400. E2E: 📎 → `setInputFiles` PNG → значок с прогрессом → отправка → в фейковый claude ушёл путь `~/.cache/claude-vm-gui/uploads/*.png`.
- [ ] **Step 2:** FAIL → реализовать (`<input type="file" accept="image/*">` без `capture`, чтобы Android предложил галерею, камеру и файлы) → PASS.
- [ ] **Step 3:** `npm run android:build`, ручная проверка: картинка из галереи эмулятора. Карта, коммит «Android: картинки». **Конец этапа 3.**

## Этап 4. Фон

### Task 17: Детектор уведомлений и общая таблица снимков

**Files:**
- Create: `tests/fixtures/screens/notify-expected.json`, `android/app/src/main/java/io/github/liotto1337/claudevm/notify/NotifyDetector.kt`
- Test: `tests/unit/notify-expected.test.ts`, `android/app/src/test/java/io/github/liotto1337/claudevm/notify/NotifyDetectorTest.kt`

**Interfaces:**
- Produces: `NotifyDetector.state(screen: String): NotifyState` — `MENU`, `BUSY`, `IDLE`, `UNKNOWN`; `NotifyDetector.question(screen): String?` — первая непустая строка вопроса меню, не длиннее 120 символов (`title` из `parseMenu`). Gradle копирует `tests/fixtures/screens/` в ресурсы тестов (`sourceSets.test.resources.srcDir("../../tests/fixtures/screens")`).

- [ ] **Step 1:** `notify-expected.json` — для всех 11 снимков: `permission-bash`, `permission-write`, `ask`, `trust`, `trust-yes`, `model`, `config` → `menu`; `busy` → `busy`; `prompt-empty`, `prompt-text`, `image-pending` → `idle` (проверить каждый по `classifyScreen` и поправить таблицу, если снимок показывает другое; расхождение с ожиданием — повод разобраться, а не подгонять). Плюс `questions`: `permission-bash` → строка вопроса из снимка.
- [ ] **Step 2: Тесты**: Vitest — `classifyScreen` + `parseStatus` дают состояние из таблицы для каждого файла; JUnit — `NotifyDetector.state` и `question` то же самое.
- [ ] **Step 3:** FAIL → реализовать `NotifyDetector` (перенос `stripAnsi`, `dialogOpen`, `inputText` в той мере, что нужна для трёх состояний, и проверки спиннера) → оба PASS.
- [ ] **Step 4:** Карта («Дизайн и решения»: один детектор на двух языках), коммит «Android: детектор уведомлений».

### Task 18: Foreground-сервис и `SessionNotifier`

**Files:**
- Create: `android/app/src/main/java/io/github/liotto1337/claudevm/notify/{SessionNotifier.kt,Notifications.kt}`, `.../ssh/NetworkWatch.kt`
- Modify: `SshService.kt`, `AndroidManifest.xml`, `VmBridgePlugin.kt`, `MainActivity.kt`, `SettingsDialog.tsx`, `src/platform/android.ts`, `src/core/api.ts` (`background.onOpenSession` → открыть сессию в интерфейсе)
- Test: `SessionNotifierTest.kt`, `SshServiceLifecycleTest.kt`, `NetworkWatchTest.kt` (Robolectric); `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `NotifyDetector` (17), `SshSession.exec`, `forceReconnect` (5).
- Produces:
  - `SessionNotifier(exec: suspend (String) -> ExecResult, post: (session: String, kind: Kind, text: String) -> Unit, cancel: (session: String) -> Unit)` — `suspend fun tick()`; одна команда: `tmux ls -F TMUX_LS_FORMAT`, затем для сессий с claude — `capture-pane -p -t =<имя>: -S -25` с разделителем `__cvg_sep__` (как в `session-watch.ts`). Переходы — раздел 3 спецификации; первая выборка ничего не шлёт; сессия пропала → забыть её.
  - Каналы уведомлений `connection` (низкая важность) и `sessions` (обычная); id уведомления сессии — `name.hashCode()`; `PendingIntent` открывает `MainActivity` с extra `session`.
  - `VmBridge.setBackground({ keepAlive, notifications, visible })`; событие плагина `openSession` (`{ name }`).
  - Тексты: «Подключено к ВМ · N сессий» (`plural`), «Переподключение…», кнопка «Отключиться»; «<сессия>: Claude закончил»; «<сессия>: Claude ждёт ответа» + вопрос.
- [ ] **Step 1: Тесты.** `SessionNotifierTest` с фейковым `exec`: `busy → idle` → одно `post(…, FINISHED, …)`; `idle → menu` → `post(…, WAITING, "Do you want to …")`; первая выборка `menu` → ничего; `menu → menu` → ничего; сессия исчезла и появилась → первая выборка снова молчит. `SshServiceLifecycleTest`: `startForeground` с типом `specialUse` при подключении и `keepAlive = true`; `onTaskRemoved` и `onDestroy` снимают уведомление `connection`; `onStartCommand` возвращает `START_NOT_STICKY` (Review Focus 5). `NetworkWatchTest`: колбэк `onAvailable` новой сети при живом соединении → `forceReconnect()` ровно один раз (Review Focus 2). E2E: в настройках переключатели «Держать связь в фоне» и «Уведомления» сохраняются в `VmConfig`.
- [ ] **Step 2:** FAIL → реализовать: манифест — `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` (с `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Постоянное SSH-соединение с ВМ пользователя">`), `POST_NOTIFICATIONS`, `ACCESS_NETWORK_STATE`; опрос `SessionNotifier` раз в 5 с только при `visible == false && notifications == true`; `visible` — из `onStart`/`onStop` Activity; первое включение уведомлений на Android 13+ запрашивает разрешение, отказ → `notifications = false` и баннер «Уведомления запрещены в настройках Android». Открытие сессии в приложении снимает её уведомление.
- [ ] **Step 3:** PASS; `npm run android:build`. Карта, коммит «Android: связь в фоне и уведомления».

### Task 19: Дымовой тест на эмуляторе

**Files:** Create: `tests/smoke/android.spec.ts`, `playwright.android.config.ts`, `scripts/smoke-android.sh`

**Interfaces:**
- Produces: `npm run test:smoke` — поднимает AVD `cvg` без окна (если не запущен), ставит debug APK, запускает Playwright `_android`.

- [ ] **Step 1:** Тест: настройки (адрес `10.0.2.2`, пользователь `root`, импорт `cvg_test_ed25519` текстом) → подключение → «Доверять» → создать сессию с фейковым claude (APK собран `VITE_TEST_KNOBS=1 npm run android:build`; тест до подключения записывает в `localStorage['cvg-knobs']` `{ tmuxSocket: 'cvg-smoke', claudeCmd: 'node <репозиторий>/tests/fixtures/fake-claude.mjs', claudeDir, fakeClaude: true }`) → отправить «привет» → ответ в ленте → поворот эмулятора (`adb emu rotate`) → всё ещё подключено, та же сессия (Review Focus 1) → `adb shell input keyevent KEYCODE_HOME` → фейковый claude по команде теста показывает меню → в течение 15 с `adb shell dumpsys notification --noredact` содержит «ждёт ответа» → касание уведомления (`adb shell cmd notification …` / `uiautomator`) открывает приложение на этой сессии.
- [ ] **Step 2:** `npm run test:smoke` — PASS (при FAIL — исправить код, не тест).
- [ ] **Step 3:** Карта, коммит «Android: дымовой тест на эмуляторе». **Конец этапа 4.**

## Этап 5. Выпуск

### Task 20: Подпись, CI, README, релиз 0.1.0

**Files:**
- Create: `.github/workflows/android.yml`, `scripts/screenshots-android.sh`
- Modify: `android/app/build.gradle` (`signingConfigs.release` из переменных окружения), `package.json` (`version: 0.1.0`, `name: claude-vm-android`, `productName` удалить), `README.md`, `docs/screenshots/`, `obsidian/*`

- [ ] **Step 1:** Ключ подписи: `keytool -genkeypair -v -keystore $SCRATCH/claude-vm-release.jks -alias claudevm -keyalg RSA -keysize 4096 -validity 10000` (пароль генерируется, показывается пользователю один раз). Файл в репозиторий не кладётся. **Остановиться:** попросить пользователя сохранить копию ключа и добавить секреты `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (`gh secret set` пользователь может выполнить сам через `!`).
- [ ] **Step 2:** `android.yml` (ubuntu-latest): `actions/setup-java` 21, `android-actions/setup-android`, `npm ci`, `npm run typecheck`, `npm test`, `npm run test:android`, release APK, артефакт; на тег `v*` — релиз с `claude-vm-<версия>.apk`. Проверка: push в `main` → сборка зелёная (`gh run watch`).
- [ ] **Step 3:** Скриншоты с эмулятора (лента, карточка меню, список сессий, «Сервер», тёмная тема) в `docs/screenshots/`; README: что это, на чём основан (0.2.2), установка APK (разрешить установку из неизвестных источников), подключение, уведомления, разработка (`npm run dev` + `npm run bridge`).
- [ ] **Step 4:** Ревью всей ветки отдельным агентом (`superpowers:requesting-code-review`), исправления.
- [ ] **Step 5:** Ручная проверка пользователем на телефоне (debug APK из артефакта CI). **Остановиться** до подтверждения.
- [ ] **Step 6:** Карта («История разработки»: версия 0.1.0), коммит «Версия 0.1.0: релиз», тег `v0.1.0`, `git push --tags`; проверить, что релиз с APK появился (`gh release view v0.1.0`).
