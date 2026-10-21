import { useEffect, useRef } from 'react';

/** Открытые слои (диалоги, листы, меню) — сверху последний. Кнопка «Назад» закрывает верхний. */
const stack: { close: () => void }[] = [];

/** Регистрирует слой; возвращает снятие (слой закрылся сам). */
export function pushBack(close: () => void): () => void {
  const entry = { close };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Только для тестов. */
export function resetBackStack(): void {
  stack.length = 0;
}

export interface BackContext {
  serverOpen: boolean;
  closeServer(): void;
  /** Список сессий на экране: выдвижная панель открыта или широкий экран */
  drawerOpen: boolean;
  openDrawer(): void;
  /** Свернуть приложение */
  exit(): void;
}

/** Порядок: верхний слой → панель «Сервер» → из сессии к списку → свернуть приложение. */
export function handleBack(ctx: BackContext): void {
  const top = stack.pop();
  if (top) return top.close();
  if (ctx.serverOpen) return ctx.closeServer();
  if (!ctx.drawerOpen) return ctx.openDrawer();
  ctx.exit();
}

/** Контекст главного окна (задаёт MainView); без него «Назад» после слоёв сворачивает приложение. */
let mainCtx: BackContext | null = null;

export function useBackContext(ctx: BackContext): void {
  const ref = useRef(ctx);
  ref.current = ctx;
  useEffect(() => {
    const proxy: BackContext = {
      get serverOpen() { return ref.current.serverOpen; },
      closeServer: () => ref.current.closeServer(),
      get drawerOpen() { return ref.current.drawerOpen; },
      openDrawer: () => ref.current.openDrawer(),
      exit: () => ref.current.exit(),
    };
    mainCtx = proxy;
    return () => {
      if (mainCtx === proxy) mainCtx = null;
    };
  }, []);
}

/** Нажата «Назад»: exit — свернуть приложение. */
export function backPressed(exit: () => void): void {
  handleBack(mainCtx ?? { serverOpen: false, closeServer: () => {}, drawerOpen: true, openDrawer: () => {}, exit });
}

/** Слой, пока он открыт (active), закрывается кнопкой «Назад». */
export function useBack(active: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => (active ? pushBack(() => ref.current()) : undefined), [active]);
}
