import { afterEach, describe, expect, it } from 'vitest';
import { handleBack, pushBack, resetBackStack } from '../../src/renderer/back-stack';

function ctx(over: Partial<Parameters<typeof handleBack>[0]> = {}) {
  const calls: string[] = [];
  const c = {
    serverOpen: false,
    closeServer: () => calls.push('closeServer'),
    drawerOpen: false,
    openDrawer: () => calls.push('openDrawer'),
    exit: () => calls.push('exit'),
    ...over,
  };
  return { c, calls };
}

afterEach(() => resetBackStack());

describe('кнопка «Назад»', () => {
  it('сначала закрывает верхний слой (лист над диалогом), потом следующий', () => {
    const closed: string[] = [];
    pushBack(() => closed.push('dialog'));
    pushBack(() => closed.push('sheet'));
    const { c, calls } = ctx({ serverOpen: true });
    handleBack(c);
    expect(closed).toEqual(['sheet']);
    handleBack(c);
    expect(closed).toEqual(['sheet', 'dialog']);
    expect(calls).toEqual([]);
  });

  it('снятый слой больше не закрывается', () => {
    const closed: string[] = [];
    const off = pushBack(() => closed.push('menu'));
    off();
    const { c, calls } = ctx();
    handleBack(c);
    expect(closed).toEqual([]);
    expect(calls).toEqual(['openDrawer']);
  });

  it('слоёв нет, открыт «Сервер» — закрыть его', () => {
    const { c, calls } = ctx({ serverOpen: true });
    handleBack(c);
    expect(calls).toEqual(['closeServer']);
  });

  it('открыта сессия (список спрятан) — показать список', () => {
    const { c, calls } = ctx();
    handleBack(c);
    expect(calls).toEqual(['openDrawer']);
  });

  it('виден список сессий — свернуть приложение', () => {
    const { c, calls } = ctx({ drawerOpen: true });
    handleBack(c);
    expect(calls).toEqual(['exit']);
  });
});
