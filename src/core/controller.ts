import { fail, ok, type MenuKey, type Result, type VmConfig } from '@shared/ipc';
import { transcriptPath } from '@shared/claude-session';
import { plural } from '@shared/plural';
import { HintsService } from './hints';
import { MetricsService } from './metrics';
import { UsagePoller } from '@shared/usage-poller';
import { SessionWatcher } from './session-watch';
import { TranscriptService } from './transcript';
import { knobs } from './knobs';
import type { Platform } from './platform';
import type { ConnectableTransport } from './transport';
import { TerminalService } from './terminal';
import { tmuxCmd, TmuxService } from './tmux';
import { UploadService } from './upload';

interface Services {
  conn: ConnectableTransport;
  cfg: VmConfig;
  unsubscribe: (() => void)[];
  tmux: TmuxService;
  term: TerminalService;
  hints: HintsService;
  upload: UploadService;
  watch: SessionWatcher;
  transcript: TranscriptService;
  metrics: MetricsService;
  usage: UsagePoller;
  claudeDir: string;
  stopPolling: () => void;
}

type Emit = (channel: string, payload: unknown) => void;

/** Подключение к ВМ и все сервисы, доступные интерфейсу через window.api. */
export class AppController {
  private s: Services | null = null;
  private connecting: Promise<Result<void>> | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly emit: Emit,
    private readonly config: () => Promise<VmConfig | null>,
  ) {
    const ssh = platform.ssh;
    ssh.onPreflight((e) => this.emit('connection:preflight', e));
    ssh.onHostKey((p) => this.emit('connection:hostKey', p));
  }

  answerHostKey(trust: boolean): void {
    this.platform.ssh.answerHostKey(trust);
  }

  tmuxList = () => this.need((s) => s.tmux.list());
  tmuxCreate = (name: string, dir: string, start: boolean) => this.need((s) => s.tmux.create(name, dir, start));
  tmuxKill = (name: string) =>
    this.need(async (s) => {
      if (s.term.current === name) {
        s.term.close();
        this.stopChat(s);
      }
      return s.tmux.kill(name);
    });
  tmuxStartClaude = (name: string) => this.need((s) => s.tmux.startClaude(name));

  termOpen = (name: string, cols: number, rows: number) =>
    this.need(async (s) => {
      const r = await s.term.open(name, cols, rows);
      // Устаревший open (пока открывался канал, выбрали другую сессию) тоже ok — ленту запускаем только для текущей
      if (r.ok && s.term.current === name) {
        this.startChat(s, name);
        this.platform.background?.sessionOpened(name);
      }
      return r;
    });
  termWrite = (data: string) => this.s?.term.write(data);
  termResize = (cols: number, rows: number) => this.s?.term.resize(cols, rows);
  // session — откуда пришёл ввод: если тем временем открыли другую сессию, ничего не пишется (NO_SESSION)
  termSend = (text: string, paths: string[], session?: string) => this.need((s) => s.term.send(text, paths, session));
  termSetModel = (v: string, session?: string) => this.need((s) => s.term.setModel(v, session));
  termSetEffort = (v: string, session?: string) => this.need((s) => s.term.setEffort(v, session));

  metricsSetActive = (fast: boolean) => this.s?.metrics.setActive(fast === true);
  metricsInfo = () => this.need((s) => s.metrics.info());
  usageLatest = async () => this.s?.usage.latest ?? null;
  chatKey = (k: MenuKey, session?: string) => this.need((s) => s.term.key(k, session));
  chatTypeText = (t: string, session?: string) => this.need((s) => s.term.typeText(t, session));
  chatLoadEarlier = () => this.need((s) => s.transcript.loadEarlier());

  hintsGet = (cwd: string) => this.need((s) => s.hints.get(cwd));
  hintsFiles = (cwd: string) => this.need((s) => s.hints.files(cwd));
  hintsDirs = (partial: string) => this.need((s) => s.hints.dirs(partial));
  uploadFile = (id: string, bytes: Uint8Array, name: string) => this.need((s) => s.upload.file(id, bytes, name));
  uploadRead = (path: string, maxBytes: number) => this.need((s) => s.upload.read(path, maxBytes));

  private async need<T>(fn: (s: Services) => Promise<Result<T>>): Promise<Result<T>> {
    if (!this.s || !this.s.conn.connected) return fail('NOT_CONNECTED', 'Нет подключения к ВМ');
    try {
      return await fn(this.s);
    } catch (e) {
      return fail('NOT_CONNECTED', (e as Error).message);
    }
  }

  /** Лента открытой сессии: экран (меню, статус) и журнал Claude Code. */
  private startChat(s: Services, name: string): void {
    s.transcript.stop();
    if (!this.hidden) s.watch.start(name);
  }

  private hidden = false;

  /**
   * Приложение свёрнуто (страница скрыта): опросы по SSH — экран сессии, список tmux, метрики — стоят,
   * за сессиями следят уведомления нативной стороны. Вернулись — опросы снова идут.
   */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    const s = this.s;
    if (!s) return;
    if (hidden) {
      s.stopPolling();
      s.metrics.stop();
      s.usage.stop();
      s.watch.stop();
      return;
    }
    s.stopPolling = this.pollSessions(s.tmux);
    s.metrics.start();
    s.usage.start();
    if (s.term.current) s.watch.start(s.term.current);
    // Вернулись в приложение — окно tmux под размер этого экрана (а не другого устройства с той же сессией)
    s.term.activate();
  }

  private pollSessions(tmux: TmuxService): () => void {
    return tmux.startPolling((sessions) => {
      this.emit('tmux:sessions', sessions);
      if (sessions.length !== this.sessions) {
        this.sessions = sessions.length;
        if (this.s) this.syncBackground(this.s.cfg);
      }
    });
  }

  private stopChat(s: Services): void {
    s.watch.stop();
    s.transcript.stop();
  }

  private wireChat(watch: SessionWatcher, transcript: TranscriptService, claudeDir: string): void {
    watch.on('screen', (e) => this.emit('chat:screen', { session: watch.current, ...e }));
    watch.on('claude', (info: { sessionId: string; cwd: string } | null, running: boolean) => {
      // claude запущен, но его сессию не найти (нет sessions/<pid>.json) — показываем терминал
      if (!info && running) {
        transcript.stop();
        this.emit('chat:unavailable', { session: watch.current, reason: 'Не найдена сессия Claude Code' });
        return;
      }
      let path: string | null = null;
      try {
        path = info ? transcriptPath(claudeDir, info.cwd, info.sessionId) : null;
      } catch {
        path = null;
      }
      if (path !== transcript.following) void transcript.follow(path);
    });
    transcript.on('items', (e) => this.emit('chat:items', { session: watch.current, ...e }));
    transcript.on('unavailable', (reason: string) => this.emit('chat:unavailable', { session: watch.current, reason }));
  }

  /** Подключение; повторный вызов, пока идёт подключение, ждёт его же. */
  connect(): Promise<Result<void>> {
    this.connecting ??= this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<Result<void>> {
    const cfg = await this.config();
    if (!cfg) return fail('CONFIG_INVALID', 'Укажите настройки подключения');
    const conn = this.platform.ssh;
    // Соединение уже живо с теми же настройками (например, интерфейс перезагрузился, а SSH остался в сервисе Android) — не рвём его
    if (this.s && conn.connected && sameTarget(this.s.cfg, cfg)) {
      this.emit('connection:state', { state: 'connected' });
      return ok(undefined);
    }
    // Старые сервисы (другая ВМ или мёртвое соединение) — разобрать и закрыть. Без сервисов транспорт не трогаем:
    // на Android он мог пережить перезагрузку интерфейса, и плагин сам решит, нужно ли переподключаться
    if (this.s) await this.teardown(true);

    const unsubscribe: (() => void)[] = [];
    // После обрыва «Подключено» показываем, только когда терминал снова в сессии — иначе ввод потеряется
    let reattaching = false;
    unsubscribe.push(
      conn.on('lost', () => {
        reattaching = this.s?.term.current != null;
      }),
      conn.on('state', (st) => {
        // Соединение закрыли снаружи (уведомление Android) — сервисы больше не нужны, их опросы встали бы на ошибках
        if (st.state === 'idle' && !this.disconnecting) void this.teardown(false);
        if (st.state === 'connected' && reattaching) {
          this.s?.term.once('reattached', () => {
            reattaching = false;
            this.emit('connection:state', st);
          });
          return;
        }
        this.emit('connection:state', st);
      }),
    );
    const drop = () => unsubscribe.forEach((u) => u());
    const r = await conn.connect(cfg);
    if (!r.ok) {
      drop();
      await conn.close();
      if (r.error.code === 'AUTH_FAILED' && cfg.passwordUnreadable)
        return fail('AUTH_FAILED', `${r.error.message}. Сохранённый пароль не удалось расшифровать — введите его заново в настройках`);
      return r;
    }
    const tmux = new TmuxService(conn);
    this.emit('connection:preflight', { step: 'tmux', status: 'running', detail: 'Загружаю список…' });
    const list = await tmux.list();
    if (!list.ok) {
      this.emit('connection:preflight', { step: 'tmux', status: 'fail', detail: list.error.message });
      drop();
      await conn.close();
      return list;
    }
    const n = list.data.length;
    this.emit('connection:preflight', { step: 'tmux', status: 'ok', detail: `${n} ${plural(n, 'сессия', 'сессии', 'сессий')}` });

    const term = new TerminalService(conn, tmux);
    term.on('data', (d: string) => this.emit('term:data', d));
    term.on('exit', (reason) => {
      if (reason !== 'connection-lost' && this.s) this.stopChat(this.s);
      this.emit('term:exit', reason);
    });
    // Каталог Claude Code на ВМ (журналы и sessions/*.json); knobs.claudeDir — для тестов
    const home = (await conn.exec('printf %s "$HOME"').catch(() => ({ stdout: '/root' }))).stdout.trim() || '/root';
    const claudeDir = knobs.claudeDir ?? `${home}/.claude`;
    const watch = new SessionWatcher(conn, { claudeDir });
    const transcript = new TranscriptService(conn);
    this.wireChat(watch, transcript, claudeDir);
    const metrics = new MetricsService(conn, { claudeDir });
    metrics.on('sample', (smp) => this.emit('metrics:sample', smp));
    // После переподключения терминал снова в сессии — перезапускаем ленту
    term.on('reattached', () => {
      if (this.s && term.current) this.startChat(this.s, term.current);
    });
    const upload = new UploadService(conn);
    upload.on('progress', (p) => this.emit('upload:progress', p));
    const hints = new HintsService(conn);
    this.sessions = n;
    this.syncBackground(cfg);
    const stopPolling = this.hidden ? () => {} : this.pollSessions(tmux);
    // Лимиты подписки и токены за сегодня — раз в 2 минуты, пока приложение на экране
    const usage = new UsagePoller((cmd, o) => conn.exec(cmd, o), claudeDir);
    usage.on('sample', (u) => this.emit('usage:sample', u));
    this.s = { conn, cfg, unsubscribe, tmux, term, hints, upload, watch, transcript, metrics, usage, claudeDir, stopPolling };
    if (!this.hidden) {
      metrics.start();
      usage.start();
    }
    void upload.cleanup();
    return ok(undefined);
  }

  private sessions = 0;

  /** Настройки фона, число сессий и отслеживаемые сессии — нативной стороне (foreground-сервис, уведомления). */
  syncBackground(cfg: VmConfig): void {
    this.platform.background?.set({ keepAlive: cfg.keepAlive, notifications: cfg.notifications, tmux: tmuxCmd(), sessions: this.sessions, watched: this.watched });
  }

  private watched: string[] = [];

  /** «Отслеживать» изменилось (раскладка сайдбара загружена или сохранена) */
  setWatched(names: string[]): void {
    if (names.length === this.watched.length && names.every((n, i) => n === this.watched[i])) return;
    this.watched = [...names];
    if (this.s) this.syncBackground(this.s.cfg);
  }

  /** «Отключиться»: сервисы и соединение. */
  private disconnecting = false;

  async disconnect(): Promise<void> {
    this.platform.ssh.answerHostKey(false);
    this.disconnecting = true;
    try {
      await this.teardown(true);
    } finally {
      this.disconnecting = false;
    }
  }

  private async teardown(closeTransport: boolean): Promise<void> {
    const s = this.s;
    this.s = null;
    if (!s) {
      if (closeTransport) await this.platform.ssh.close();
      return;
    }
    s.stopPolling();
    s.usage.stop();
    s.metrics.stop();
    this.stopChat(s);
    s.term.close();
    s.unsubscribe.forEach((u) => u());
    if (closeTransport) await s.conn.close();
  }
}

const sameTarget = (a: VmConfig, b: VmConfig) => a.host === b.host && a.port === b.port && a.username === b.username;
