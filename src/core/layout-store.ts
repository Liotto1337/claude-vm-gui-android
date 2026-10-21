import { ok, type Result, type SidebarLayout } from '@shared/ipc';
import { normalize } from '@shared/layout';
import type { Prefs } from './platform';

const KEY = 'layout';

/**
 * Раскладка сайдбара: `{ [адрес ВМ]: SidebarLayout }` в Preferences.
 * Запись — с задержкой, чтобы перетаскивание не писало на каждое движение.
 */
export class LayoutStore {
  private data: Promise<Record<string, SidebarLayout>> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly prefs: Prefs, private readonly debounceMs = 300) {}

  private load(): Promise<Record<string, SidebarLayout>> {
    this.data ??= this.prefs.get(KEY).then(
      (raw) => {
        const out: Record<string, SidebarLayout> = {};
        let parsed: unknown = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          for (const [host, l] of Object.entries(parsed as Record<string, unknown>)) out[host] = normalize(l);
        return out;
      },
      () => ({}),
    );
    return this.data;
  }

  async get(host: string): Promise<SidebarLayout> {
    return (await this.load())[host] ?? { v: 1, items: [] };
  }

  async save(host: string, l: SidebarLayout): Promise<Result<void>> {
    (await this.load())[host] = normalize(l);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
    return ok(undefined);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.data) return;
    await this.prefs.set(KEY, JSON.stringify(await this.data));
  }
}
