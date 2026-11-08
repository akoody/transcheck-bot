const { isCancelText, parseThresholdValue, parseWalletInputText } = require('./parsers');

const STEP = {
  ADD_WALLET: 'ADD_WALLET',
  RENAME_WALLET: 'RENAME_WALLET',
  SET_THRESHOLD: 'SET_THRESHOLD'
};

const ADD_EXAMPLES = {
  bep20: { label: 'BEP20 (BSC)', example: '0x530c3d9d1c5a92c57d91c161470435b6d79b384a Main BSC' },
  trc20: { label: 'TRC20 (TRON)', example: 'TF17BgPaZYbz8oxbjhriubPDsA7ArKoLX3 Main TRON' }
};

/** Многошаговые диалоги: бот ждёт от пользователя следующее сообщение. */
function createConversation({ bot, stateRepository, actions }) {
  const steps = new Map();

  const clear = (userId) => steps.delete(String(userId));
  const begin = (userId, step) => steps.set(String(userId), step);

  async function startAddWallet({ chatId, userId, network }) {
    begin(userId, { type: STEP.ADD_WALLET, network });
    const { label, example } = ADD_EXAMPLES[network];

    await bot.sendMessage(
      chatId,
      `Добавление ${label}.\nОтправь в одном сообщении:\n<address> <name>\n\nПример:\n${example}\n\nДля отмены: /cancel`
    );
  }

  const startRename = (userId, walletId) => begin(userId, { type: STEP.RENAME_WALLET, walletId });
  const startThreshold = (userId) => begin(userId, { type: STEP.SET_THRESHOLD });

  async function continueAddWallet({ chatId, userId, text, step }) {
    const parsed = parseWalletInputText(text);

    if (!parsed) {
      await bot.sendMessage(chatId, 'Неверный формат. Нужно: <address> <name>');
      return;
    }

    const created = await actions.addWallet({
      chatId,
      userId,
      addPayload: { network: step.network, address: parsed.address, name: parsed.name }
    });

    if (created) {
      clear(userId);
      await actions.sendMainMenu(chatId, 'Готово. Что делаем дальше?');
    }
  }

  async function continueRename({ chatId, userId, text, step }) {
    const name = String(text || '').trim();

    if (!name) {
      await bot.sendMessage(chatId, 'Название не должно быть пустым. Введи новое имя.');
      return;
    }

    const renamed = await actions.renameWallet({ chatId, userId, walletId: step.walletId, name });
    clear(userId);

    if (renamed) {
      await actions.sendMainMenu(chatId, 'Название сохранено.');
    }
  }

  async function continueThreshold({ chatId, userId, text }) {
    const next = parseThresholdValue(text);

    if (next === null) {
      await bot.sendMessage(chatId, 'Порог должен быть положительным числом, например: 0.98');
      return;
    }

    await stateRepository.setThreshold(userId, next);
    clear(userId);
    await bot.sendMessage(chatId, `Порог уведомлений обновлен: ${next} USDT`);
    await actions.sendMainMenu(chatId, 'Готово.');
  }

  const HANDLERS = {
    [STEP.ADD_WALLET]: continueAddWallet,
    [STEP.RENAME_WALLET]: continueRename,
    [STEP.SET_THRESHOLD]: continueThreshold
  };

  /** Возвращает true, если сообщение было частью диалога. */
  async function handleMessage({ chatId, userId, text }) {
    const step = steps.get(String(userId));

    if (!step) {
      return false;
    }

    if (isCancelText(text)) {
      clear(userId);
      await actions.sendMainMenu(chatId, 'Действие отменено.');
      return true;
    }

    await HANDLERS[step.type]({ chatId, userId, text, step });
    return true;
  }

  return { clear, handleMessage, startAddWallet, startRename, startThreshold };
}

module.exports = {
  createConversation
};
