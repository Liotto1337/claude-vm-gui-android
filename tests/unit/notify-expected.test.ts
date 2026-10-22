import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { notifyQuestion, notifyState, parseMenu, stripAnsi } from '../../src/shared/screen-parse';

// Та же таблица проверяется JUnit-тестом NotifyDetectorTest: две реализации детектора не должны разойтись
const DIR = 'tests/fixtures/screens';
const table = JSON.parse(readFileSync(`${DIR}/notify-expected.json`, 'utf8')) as { states: Record<string, string>; questions: Record<string, string> };
const screen = (f: string) => readFileSync(`${DIR}/${f}`, 'utf8');

describe('таблица снимков для уведомлений', () => {
  it('в таблице все снимки', () => expect(Object.keys(table.states).sort()).toEqual(readdirSync(DIR).filter((f) => f.endsWith('.ans')).sort()));
  for (const [f, state] of Object.entries(table.states)) it(`${f} — ${state}`, () => expect(notifyState(screen(f))).toBe(state));
  for (const [f, q] of Object.entries(table.questions)) {
    it(`${f}: вопрос «${q}»`, () => expect(notifyQuestion(screen(f))).toBe(q));
    it(`${f}: вопрос совпадает с заголовком карточки`, () => expect(parseMenu(stripAnsi(screen(f)))?.title).toBe(q));
  }
});
