// Сборка APK не должна содержать dev-мост: ни протокола моста, ни адреса ws://127.0.0.1
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKERS = ['__drop', 'ws://127.0.0.1', 'devBridgeTransport'];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const hits = walk(process.argv[2] ?? 'dist')
  .filter((f) => /\.(js|html)$/.test(f))
  .flatMap((f) => MARKERS.filter((m) => readFileSync(f, 'utf8').includes(m)).map((m) => `${f}: ${m}`));
if (hits.length) {
  console.error(`В сборке APK есть dev-мост:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('dev-моста в сборке нет');
