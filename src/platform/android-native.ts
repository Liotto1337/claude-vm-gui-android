import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Clipboard } from '@capacitor/clipboard';
import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { Platform } from '@core/platform';
import { androidPlatformWith, type VmBridgePlugin } from './android';

/** Статус-бар — под тему интерфейса (html[data-theme]): светлые значки на тёмной теме и наоборот. */
function followTheme(): void {
  const apply = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg) void StatusBar.setBackgroundColor({ color: rgbToHex(bg) }).catch(() => {});
  };
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  apply();
}

const rgbToHex = (rgb: string) =>
  `#${(rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;

/** Android-платформа с настоящими плагинами Capacitor (только в сборке --mode android). */
export function androidPlatform(): Promise<Platform> {
  followTheme();
  return androidPlatformWith({
    plugin: registerPlugin<VmBridgePlugin>('VmBridge'),
    prefs: {
      get: async (key) => (await Preferences.get({ key })).value,
      set: (key, value) => Preferences.set({ key, value }),
    },
    clipboard: {
      read: async () => (await Clipboard.read()).value ?? '',
      write: (string) => Clipboard.write({ string }),
    },
    openExternal: (url) => Browser.open({ url }),
    // Свой обработчик «Назад» отключает системный (закрыть Activity)
    onBack: (cb) => {
      const h = App.addListener('backButton', () => cb());
      return () => void h.then((x) => x.remove());
    },
    minimize: () => void App.minimizeApp(),
    // Свёрнуто приложение или нет: страница WebView в фоне остаётся «visible»
    onVisibility: (cb) => {
      const h = App.addListener('appStateChange', (s) => cb(s.isActive));
      return () => void h.then((x) => x.remove());
    },
  });
}
