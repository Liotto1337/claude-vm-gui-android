import { describe, expect, it } from 'vitest';
import { FOLLOW_START, followOnScroll, followUserUp } from '../../src/renderer/follow';

describe('слежение ленты за низом', () => {
  it('стоит внизу — следит', () => expect(followOnScroll(FOLLOW_START, { scrollTop: 1000, gap: 0 }).atBottom).toBe(true));

  it('↑ отключает слежение', () => expect(followUserUp(FOLLOW_START, 1000).atBottom).toBe(false));

  it('запоздалое событие прокрутки с прежней позиции не включает слежение обратно', () => {
    const up = followUserUp(FOLLOW_START, 1000);
    expect(followOnScroll(up, { scrollTop: 1000, gap: 0 }).atBottom).toBe(false);
  });

  it('пролистал вверх и вернулся в самый низ — слежение снова включено', () => {
    let f = followUserUp(FOLLOW_START, 1000);
    f = followOnScroll(f, { scrollTop: 960, gap: 40 });
    expect(f.atBottom).toBe(false);
    f = followOnScroll(f, { scrollTop: 1300, gap: 1 });
    expect(f.atBottom).toBe(true);
    expect(f.userUp).toBe(false);
  });

  it('после ↑ «почти внизу» (меньше порога) — ещё не внизу', () => {
    let f = followUserUp(FOLLOW_START, 1000);
    f = followOnScroll(f, { scrollTop: 960, gap: 40 });
    expect(followOnScroll(f, { scrollTop: 990, gap: 10 }).atBottom).toBe(false);
  });

  it('без ↑ «почти внизу» — внизу', () => expect(followOnScroll(FOLLOW_START, { scrollTop: 990, gap: 30 }).atBottom).toBe(true));
});
