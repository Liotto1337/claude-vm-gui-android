import { useEffect, useMemo, useState } from 'react';
import type { ChatImage } from '@shared/ipc';
import { albumLayout, aspectOf, clampAspect, type AlbumNode } from '@shared/album-layout';
import { displayName, MAX_FILE_BYTES } from '@shared/upload-name';
import { fileCache } from './FileView';
import { IconImage } from './icons';
import { Lightbox } from './Lightbox';

type Slot = { kind: 'loading' } | { kind: 'ok'; url: string } | { kind: 'gone' } | { kind: 'error'; message: string };
interface Tile { alt: string; slot: Slot }

/** Фото из папки загрузок на ВМ: байты читаются через общий кэш, url живёт, пока альбом на экране. */
function useUploadedSlots(paths: string[]): Slot[] {
  const key = paths.join('\n');
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    for (const path of key ? key.split('\n') : []) {
      void fileCache.get(path, MAX_FILE_BYTES).then((r) => {
        if (!alive) return;
        let slot: Slot;
        if (r.ok) {
          const url = URL.createObjectURL(new Blob([r.data.bytes as BlobPart]));
          urls.push(url);
          slot = { kind: 'ok', url };
        } else slot = r.error.code === 'NOT_FOUND' ? { kind: 'gone' } : { kind: 'error', message: r.error.message };
        setSlots((s) => ({ ...s, [path]: slot }));
      });
    }
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);
  return paths.map((p) => slots[p] ?? { kind: 'loading' });
}

/**
 * Фото сообщения одним альбомом, как в Telegram: одно — крупно, два–четыре — мозаикой, больше — рядами по 2–3.
 * Нажатие открывает просмотр на этом фото, дальше можно листать весь альбом.
 */
export function PhotoGrid({ images, paths }: { images: ChatImage[]; paths: string[] }) {
  const uploaded = useUploadedSlots(paths);
  const total = images.length + paths.length;
  const dataUrls = useMemo(() => images.map((im) => `data:${im.mediaType};base64,${im.data}`), [images]);
  const tiles: Tile[] = [
    ...dataUrls.map((url, i): Tile => ({ alt: total > 1 ? `Фото ${i + 1} из ${total}` : 'Картинка', slot: { kind: 'ok', url } })),
    ...paths.map((p, i): Tile => ({ alt: total > 1 ? `Фото ${images.length + i + 1} из ${total}: ${displayName(p)}` : displayName(p), slot: uploaded[i] })),
  ];
  const [ratios, setRatios] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const root = albumLayout(tiles.map((_, i) => ratios[i] ?? 1));
  const viewable = tiles.flatMap((t) => (t.slot.kind === 'ok' ? [{ src: t.slot.url, alt: t.alt }] : []));

  const onSize = (i: number, w: number, h: number) => {
    if (!w || !h) return;
    setRatios((rs) => {
      if (rs[i] === w / h) return rs;
      const next = rs.slice();
      next[i] = w / h;
      return next;
    });
  };
  const show = (i: number) => setOpen(tiles.slice(0, i).filter((t) => t.slot.kind === 'ok').length);

  return (
    <>
      <div className="album" role="group" aria-label={total > 1 ? `Фото: ${total}` : 'Фото'} style={{ aspectRatio: clampAspect(aspectOf(root)) }}>
        <AlbumNodeView node={root} grow={1} tiles={tiles} onSize={onSize} onShow={show} />
      </div>
      {open !== null ? <Lightbox images={viewable} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function AlbumNodeView({ node, grow, tiles, onSize, onShow }: { node: AlbumNode; grow: number; tiles: Tile[]; onSize: (i: number, w: number, h: number) => void; onShow: (i: number) => void }) {
  const style = { flex: `${grow} 1 0` };
  if (node.kind === 'photo') {
    const { alt, slot } = tiles[node.index];
    if (slot.kind === 'ok')
      return (
        <button type="button" className="album-tile" style={style} aria-label={`Открыть: ${alt}`} onClick={() => onShow(node.index)}>
          <img className="chat-image" src={slot.url} alt={alt} onLoad={(e) => onSize(node.index, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
        </button>
      );
    if (slot.kind === 'loading') return <div className="album-tile" style={style} role="img" aria-label={`Загружается: ${alt}`} />;
    return (
      <div className="album-tile album-missing" style={style} role="img" aria-label={alt}>
        <IconImage />
        <span className="caption">{slot.kind === 'gone' ? 'Файл удалён с ВМ' : slot.message}</span>
      </div>
    );
  }
  return (
    <div className={`album-${node.kind}`} style={style}>
      {node.items.map((child) => (
        <AlbumNodeView
          key={firstIndex(child)}
          node={child}
          grow={node.kind === 'row' ? aspectOf(child) : 1 / aspectOf(child)}
          tiles={tiles}
          onSize={onSize}
          onShow={onShow}
        />
      ))}
    </div>
  );
}

const firstIndex = (n: AlbumNode): number => (n.kind === 'photo' ? n.index : firstIndex(n.items[0]));
