// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;
type EventMap = Record<string, Listener>;

/** Маленькая замена node:events для кода, который работает в WebView. */
export class Emitter<E extends EventMap = EventMap> {
  private readonly listeners = new Map<keyof E, Set<Listener>>();

  on<K extends keyof E>(event: K, cb: E[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof E>(event: K, cb: E[K]): void {
    this.listeners.get(event)?.delete(cb);
  }

  once<K extends keyof E>(event: K, cb: E[K]): () => void {
    const wrapped = ((...args: Parameters<E[K]>) => {
      this.off(event, wrapped);
      cb(...args);
    }) as E[K];
    return this.on(event, wrapped);
  }

  emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Копия: подписчик может отписаться прямо во время обхода
    for (const cb of [...set]) cb(...args);
  }
}
