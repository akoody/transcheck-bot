const TelegramBot = require('node-telegram-bot-api');
const env = require('./config/env');
const { StateRepository } = require('./repositories/stateRepository');
const { BscClient } = require('./chains/bscClient');
const { TronClient } = require('./chains/tronClient');
const { MonitorService } = require('./services/monitorService');
const { registerHandlers } = require('./bot/registerHandlers');

const TELEGRAM_TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const TELEGRAM_POLLING_RESTART_BASE_DELAY_MS = 5_000;
const TELEGRAM_POLLING_RESTART_MAX_DELAY_MS = 60_000;
const TELEGRAM_TRANSIENT_LOG_INTERVAL_MS = 30_000;

function maskSensitiveUrl(url) {
  return String(url || '').replace(/(\/(?:bsc|v1)\/)([A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1$2...');
}

function extractTelegramPollingErrorDetails(error) {
  const message = error?.message || 'Unknown Telegram polling error';
  const rawStatusCode = error?.response?.statusCode || error?.response?.body?.error_code;
  const parsedStatusCode = Number(rawStatusCode || message.match(/\b(\d{3})\b/)?.[1]);

  return {
    message,
    statusCode: Number.isFinite(parsedStatusCode) ? parsedStatusCode : null
  };
}

function isTransientTelegramPollingError(error) {
  const { statusCode } = extractTelegramPollingErrorDetails(error);
  return statusCode !== null && TELEGRAM_TRANSIENT_STATUS_CODES.has(statusCode);
}

function createTelegramPollingSupervisor(bot) {
  let isShuttingDown = false;
  let restartAttempt = 0;
  let restartTimer = null;
  let startPollingPromise = null;
  let lastTransientLogAt = 0;

  function clearRestartTimer() {
    if (!restartTimer) {
      return;
    }

    clearTimeout(restartTimer);
    restartTimer = null;
  }

  async function stopPollingForRestart() {
    try {
      await bot.stopPolling();
    } catch (error) {
      console.error('[telegram] failed to stop polling before restart:', error.message);
    }
  }

  async function startPolling(reason = 'startup') {
    if (isShuttingDown) {
      return;
    }

    if (startPollingPromise) {
      return startPollingPromise;
    }

    clearRestartTimer();

    startPollingPromise = bot.startPolling()
      .then(() => {
        restartAttempt = 0;
        console.log(`[telegram] polling started (${reason})`);
      })
      .catch((error) => {
        handlePollingError(error, { source: `start:${reason}` });
      })
      .finally(() => {
        startPollingPromise = null;
      });

    return startPollingPromise;
  }

  function scheduleRestart(error) {
    if (isShuttingDown || restartTimer) {
      return;
    }

    restartAttempt += 1;

    const delayMs = Math.min(
      TELEGRAM_POLLING_RESTART_BASE_DELAY_MS * (2 ** (restartAttempt - 1)),
      TELEGRAM_POLLING_RESTART_MAX_DELAY_MS
    );

    const { statusCode, message } = extractTelegramPollingErrorDetails(error);
    const now = Date.now();

    if ((now - lastTransientLogAt) >= TELEGRAM_TRANSIENT_LOG_INTERVAL_MS) {
      lastTransientLogAt = now;
      console.warn(
        `[telegram] transient polling error (${statusCode || 'unknown'}): ${message}. Retrying in ${delayMs}ms`
      );
    }

    void stopPollingForRestart();

    restartTimer = setTimeout(() => {
      restartTimer = null;
      void startPolling(`restart #${restartAttempt}`);
    }, delayMs);

    if (typeof restartTimer.unref === 'function') {
      restartTimer.unref();
    }
  }

  function handlePollingError(error, context = {}) {
    if (isTransientTelegramPollingError(error)) {
      scheduleRestart(error);
      return;
    }

    const { message, statusCode } = extractTelegramPollingErrorDetails(error);
    const sourceSuffix = context.source ? ` (${context.source})` : '';
    console.error(
      `[telegram] polling error${sourceSuffix}${statusCode ? ` [${statusCode}]` : ''}: ${message}`
    );
  }

  async function shutdown() {
    isShuttingDown = true;
    clearRestartTimer();

    if (startPollingPromise) {
      await startPollingPromise.catch(() => {});
    }

    try {
      await bot.stopPolling();
    } catch (error) {
      console.error('[telegram] failed to stop polling during shutdown:', error.message);
    }
  }

  return {
    handlePollingError,
    shutdown,
    startPolling
  };
}

async function bootstrap() {
  const stateRepository = new StateRepository(env.storage.dataFile);
  await stateRepository.init();

  const bot = new TelegramBot(env.telegram.token, {
    polling: {
      interval: 300,
      autoStart: false,
      params: {
        timeout: 10
      }
    }
  });
  const pollingSupervisor = createTelegramPollingSupervisor(bot);

  let botUsername = '';

  try {
    const me = await bot.getMe();
    botUsername = me?.username || '';
  } catch (error) {
    console.error('[startup] failed to fetch bot profile:', error.message);
  }

  bot.on('polling_error', (error) => {
    pollingSupervisor.handlePollingError(error, { source: 'event' });
  });

  const bscClient = new BscClient(env.bsc);

  const monitorService = new MonitorService({
    stateRepository,
    bscClient,
    tronClient: new TronClient(env.tron),
    bot,
    minAlertUsdt: env.monitor.minAlertUsdt,
    pollIntervalMs: env.monitor.pollIntervalMs,
    walletErrorBaseCooldownMs: env.monitor.walletErrorBaseCooldownMs,
    walletErrorMaxCooldownMs: env.monitor.walletErrorMaxCooldownMs,
    walletErrorLogIntervalMs: env.monitor.walletErrorLogIntervalMs,
    getBotUsername: () => botUsername
  });

  registerHandlers({
    bot,
    stateRepository,
    defaultThreshold: env.monitor.minAlertUsdt,
    monitorService
  });

  try {
    await bot.setMyCommands([
      { command: 'add', description: 'Добавить кошелек' },
      { command: 'add_bep20', description: 'Добавить BEP20 кошелек' },
      { command: 'add_trc20', description: 'Добавить TRC20 кошелек' },
      { command: 'wallets', description: 'Список кошельков' },
      { command: 'rename', description: 'Переименовать кошелек' },
      { command: 'remove', description: 'Удалить кошелек' },
      { command: 'threshold', description: 'Порог уведомлений' },
      { command: 'status', description: 'Статус мониторинга' },
      { command: 'scan_now', description: 'Запустить проверку сейчас' },
      { command: 'menu', description: 'Показать кнопки меню' },
      { command: 'cancel', description: 'Отменить текущее действие' },
      { command: 'help', description: 'Справка' }
    ]);
  } catch (error) {
    console.error('[startup] failed to set bot commands:', error.message);
  }

  await pollingSupervisor.startPolling();
  monitorService.start();

  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal} received`);
    monitorService.stop();
    await pollingSupervisor.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('[startup] Telegram bot is running');
  console.log(`[startup] polling interval=${env.monitor.pollIntervalMs}ms, min_alert=${env.monitor.minAlertUsdt} USDT`);
  console.log(`[startup] BSC RPC urls=${bscClient.rpcUrls.map(maskSensitiveUrl).join(', ')}`);
}

bootstrap().catch((error) => {
  console.error('[fatal] startup failed', error);
  process.exit(1);
});
