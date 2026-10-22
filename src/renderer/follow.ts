/** Ближе этого к низу лента считается внизу (пока пользователь не листал вверх). */
export const NEAR_BOTTOM = 48;

/**
 * Следит ли лента за низом. upFrom — позиция, с которой пользователь нажал ↑ (колесо, PageUp, Home),
 * movedUp — после этого лента действительно отошла от низа (gap ≥ 2).
 */
export interface Follow { atBottom: boolean; userUp: boolean; upFrom: number; movedUp: boolean }

export const FOLLOW_START: Follow = { atBottom: true, userUp: false, upFrom: 0, movedUp: false };

export function followUserUp(_f: Follow, scrollTop: number): Follow {
  return { atBottom: false, userUp: true, upFrom: scrollTop, movedUp: false };
}

/**
 * Событие прокрутки. События приходят асинхронно: ни запоздалое событие от автопрокрутки вниз,
 * ни первый кадр плавной прокрутки ↑ (сдвиг на 1 px, пока ответ дописывается) не включают слежение обратно —
 * только возврат в самый низ после того, как лента от него отошла.
 */
export function followOnScroll(f: Follow, e: { scrollTop: number; gap: number }): Follow {
  const userUp = f.userUp && !(f.movedUp && e.gap < 2);
  const movedUp = f.movedUp || (f.userUp && e.gap >= 2);
  return { atBottom: !userUp && e.gap < NEAR_BOTTOM, userUp, upFrom: f.upFrom, movedUp: userUp && movedUp };
}
