import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.liotto1337.claudevm',
  appName: 'Claude VM',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    // Поле ввода поднимается вместе с клавиатурой: окно WebView уменьшается
    Keyboard: { resize: 'native' },
  },
};

export default config;
