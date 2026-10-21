/**
 * Настройки для тестов вместо переменных окружения (в WebView нет process.env):
 * отдельный сервер tmux, фейковый claude, каталог Claude Code на ВМ.
 */
export const knobs: {
  tmuxSocket?: string;
  claudeCmd?: string;
  claudeBin?: string;
  claudeDir?: string;
  fakeClaude?: boolean;
} = {};
