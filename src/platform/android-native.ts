import { Browser } from '@capacitor/browser';
import { Clipboard } from '@capacitor/clipboard';
import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { Platform } from '@core/platform';
import { androidPlatformWith, type VmBridgePlugin } from './android';

/** Android-платформа с настоящими плагинами Capacitor (только в сборке --mode android). */
export function androidPlatform(): Promise<Platform> {
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
  });
}
