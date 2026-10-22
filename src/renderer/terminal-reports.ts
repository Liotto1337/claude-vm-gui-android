/** То, что нужно от xterm.js (и браузерного, и headless для тестов). */
interface CsiParser {
  parser: { registerCsiHandler(id: { prefix?: string; final: string }, cb: (params: (number | number[])[]) => boolean): { dispose(): void } };
}

/**
 * Терминал не отвечает на запросы Device Attributes (DA1 `ESC [ c`, DA2 `ESC [ > c`).
 * tmux спрашивает их при подключении; если ответ приходит позже, чем tmux его ждёт (медленная сеть, медленный телефон),
 * tmux отдаёт его в панель как ввод — в оболочке «0;276;0c: command not found», а в Claude Code — мусор в поле ввода.
 * Без ответа tmux берёт возможности терминала по TERM (xterm-256color).
 */
export function muteDeviceAttributes(term: CsiParser): () => void {
  const handlers = [
    term.parser.registerCsiHandler({ final: 'c' }, () => true),
    term.parser.registerCsiHandler({ prefix: '>', final: 'c' }, () => true),
  ];
  return () => handlers.forEach((h) => h.dispose());
}
