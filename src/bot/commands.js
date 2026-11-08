const { buildHelpText, getMainMenuMarkup } = require('./keyboards');
const {
  parseAddCommand,
  parseSingleNetworkAddCommand,
  parseStartPayload,
  parseThresholdValue
} = require('./parsers');

const EDIT_WALLET_PREFIX = 'edit_wallet_';

/** Команды с «/»: дублируют кнопки и нужны для быстрого ввода. */
function registerCommands({ bot, stateRepository, defaultThreshold, actions, conversation }) {
  const context = (msg) => ({ chatId: msg.chat.id, userId: msg.from.id });

  bot.onText(/^\/start(?:\s+(.+))?$/, async (msg) => {
    const { chatId, userId } = context(msg);
    const payload = parseStartPayload(msg.text);

    conversation.clear(userId);

    if (payload && payload.startsWith(EDIT_WALLET_PREFIX)) {
      const wallet = stateRepository.getWalletById(userId, Number(payload.slice(EDIT_WALLET_PREFIX.length)));

      if (!wallet) {
        await actions.sendMainMenu(chatId, 'Кошелек не найден или уже удален.');
        return;
      }

      await actions.sendWalletDetails({ chatId, wallet });
      await actions.sendMainMenu(chatId);
      return;
    }

    await actions.sendMainMenu(chatId, 'Бот запущен. Выбери действие кнопкой ниже.');
  });

  bot.onText(/^\/menu$/, (msg) => actions.sendMainMenu(msg.chat.id));

  bot.onText(/^\/cancel$/, async (msg) => {
    if (msg.from) {
      conversation.clear(msg.from.id);
    }

    await actions.sendMainMenu(msg.chat.id, 'Действие отменено.');
  });

  bot.onText(/^\/help$/, (msg) =>
    bot.sendMessage(msg.chat.id, buildHelpText(defaultThreshold), getMainMenuMarkup())
  );

  bot.onText(/^\/add(?:\s+.+)?$/, async (msg) => {
    const addPayload = parseAddCommand(msg.text);

    if (!addPayload) {
      await bot.sendMessage(
        msg.chat.id,
        'Формат: /add <network> <address> <name>\nПример: /add trc20 TF17BgPaZYbz8oxbjhriubPDsA7ArKoLX3 Main TRON'
      );
      return;
    }

    await actions.addWallet({ ...context(msg), addPayload });
  });

  for (const network of ['bep20', 'trc20']) {
    bot.onText(new RegExp(`^/add_${network}(?:\\s+.+)?$`), async (msg) => {
      const addPayload = parseSingleNetworkAddCommand(msg.text, network);

      if (!addPayload) {
        await conversation.startAddWallet({ ...context(msg), network });
        return;
      }

      await actions.addWallet({ ...context(msg), addPayload });
    });
  }

  bot.onText(/^\/wallets$/, (msg) => actions.sendWalletList(context(msg)));

  bot.onText(/^\/rename(?:\s+(\d+)\s+(.+))?$/, async (msg, match) => {
    const walletId = Number(match?.[1]);
    const name = String(match?.[2] || '').trim();

    if (!walletId || !name) {
      await bot.sendMessage(msg.chat.id, 'Формат: /rename <wallet_id> <new_name>');
      return;
    }

    await actions.renameWallet({ ...context(msg), walletId, name });
  });

  bot.onText(/^\/remove(?:\s+(\d+))?$/, async (msg, match) => {
    const { chatId, userId } = context(msg);
    const walletId = Number(match?.[1]);

    if (!walletId) {
      await bot.sendMessage(chatId, 'Формат: /remove <wallet_id>');
      return;
    }

    const removed = await stateRepository.removeWallet(userId, walletId);
    await bot.sendMessage(chatId, removed ? `Кошелек #${walletId} удален.` : 'Кошелек с таким ID не найден.');
  });

  bot.onText(/^\/threshold(?:\s+([\d.,]+))?$/, async (msg, match) => {
    const { chatId, userId } = context(msg);

    if (!match?.[1]) {
      await actions.sendThresholdMenu({ chatId, userId });
      return;
    }

    const next = parseThresholdValue(match[1]);

    if (next === null) {
      await bot.sendMessage(chatId, 'Порог должен быть положительным числом.');
      return;
    }

    await stateRepository.setThreshold(userId, next);
    await bot.sendMessage(chatId, `Порог уведомлений обновлен: ${next} USDT`);
  });

  bot.onText(/^\/status$/, (msg) => actions.sendStatus(context(msg)));
  bot.onText(/^\/scan_now$/, (msg) => actions.runScanNow(context(msg)));
}

module.exports = {
  registerCommands
};
