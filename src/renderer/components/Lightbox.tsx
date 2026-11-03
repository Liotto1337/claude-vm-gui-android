import { useEffect, useRef, useState } from 'react';
import { stepIndex, swipeStep } from '../swipe';

export interface LightboxImage { src: string; alt: string }

/**
 * Картинки на весь экран: Esc, ✕ или нажатие на фон закрывают; фокус возвращается туда, откуда открыли.
 * Если картинок несколько — ‹ ›, клавиши ←/→ и свайп листают, сверху счётчик.
 */
export function Lightbox({ images, start = 0, onClose }: { images: LightboxImage[]; start?: number; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [at, setAt] = useState(Math.min(start, images.length - 1));
  const many = images.length > 1;
  const go = (step: number) => setAt((i) => stepIndex(i, step, images.length));
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => back?.focus();
  }, []);
  const { src, alt } = images[at];
  return (
    <div
      className="overlay lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={many ? `${alt}, ${at + 1} из ${images.length}` : alt}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => {
        touch.current = many && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      }}
      onTouchEnd={(e) => {
        const from = touch.current;
        touch.current = null;
        if (!from) return;
        const t = e.changedTouches[0];
        go(swipeStep(t.clientX - from.x, t.clientY - from.y));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        } else if (many && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          go(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <img src={src} alt={alt} />
      {many ? (
        <>
          <div className="lightbox-count caption" aria-live="polite">{at + 1} / {images.length}</div>
          {at > 0 ? <button type="button" className="icon-btn lightbox-nav lightbox-prev" aria-label="Предыдущее фото" onClick={() => go(-1)}>‹</button> : null}
          {at < images.length - 1 ? <button type="button" className="icon-btn lightbox-nav lightbox-next" aria-label="Следующее фото" onClick={() => go(1)}>›</button> : null}
        </>
      ) : null}
      <button ref={close} type="button" className="icon-btn lightbox-close" aria-label="Закрыть" onClick={onClose}>✕</button>
    </div>
  );
}
