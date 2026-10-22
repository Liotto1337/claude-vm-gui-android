import { describe, expect, it } from 'vitest';
import { FONT_DEFAULT, pinchFontSize, rowAt } from '../../src/renderer/terminal-touch';

describe('щипок меняет размер шрифта терминала', () => {
  it('вдвое — до предела 22', () => expect(pinchFontSize(14, 2)).toBe(22));
  it('вполовину — до предела 10', () => expect(pinchFontSize(14, 0.5)).toBe(10));
  it('чуть-чуть — округление', () => expect(pinchFontSize(14, 1.07)).toBe(15));
  it('по умолчанию 13, как на Windows', () => expect(FONT_DEFAULT).toBe(13));
});

describe('строка терминала под пальцем', () => {
  const box = { top: 100, height: 240 };
  it('первая и последняя строка', () => {
    expect(rowAt(101, box, 24)).toBe(0);
    expect(rowAt(339, box, 24)).toBe(23);
  });
  it('за пределами — прижимается к краю', () => {
    expect(rowAt(0, box, 24)).toBe(0);
    expect(rowAt(1000, box, 24)).toBe(23);
  });
});
