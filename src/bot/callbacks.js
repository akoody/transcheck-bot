const { parseThresholdValue } = require('./parsers');

/** Inline-кнопки под сообщениями. */
function registerCallbacks({ bot, stateRepository, conversation }) {
  const answer = (query, text) => bot.answerCallbackQuery(query.id, { text });

  async function removeWallet({ query, chatId, userId, value }) {
    const walletId = Number(value);

    if (!walletId) {
      await answer(query, 'Некорректный ID.');
      return;
    }

    if (!(await stateRepository.removeWallet(userId, walletId))) {
      await answer(query, 'Уже удален или недоступен.');
      return;
    }

    await answer(query, `Кошелек #${walletId} удален.`);
    await bot.sendMessage(chatId, `Кошелек #${walletId} удален.`);
  }

  async function promptRename({ query, chatId, userId, value }) {
    const walletId = Number(value);

    if (!walletId) {
      await answer(query, 'Некорректный ID.');
      return;
    }

    const wallet = stateRepository.getWalletById(userId, walletId);

    if (!wallet) {
      await answer(query, 'Кошелек не найден.');
      return;
    }

    conversation.startRename(userId, walletId);
    await answer(query, 'Введите новое название.');
    await bot.sendMessage(chatId, `Введи новое название для кошелька #${walletId} (текущее: ${wallet.name}).\nДля отмены: /cancel`);
  }

  async function promptThreshold({ query, chatId, userId }) {
    conversation.startThreshold(userId);
    await answer(query, 'Введи порог вручную.');
    await bot.sendMessage(chatId, 'Введи порог в USDT, например: 0.98\nДля отмены: /cancel');
  }

  async function setThreshold({ query, chatId, userId, value }) {
    const next = parseThresholdValue(value);

    if (next === null) {
      await answer(query, 'Некорректное значение.');
      return;
    }

    await stateRepository.setThreshold(userId, next);
    conversation.clear(userId);
    await answer(query, `Порог: ${next} USDT`);
    await bot.sendMessage(chatId, `Порог уведомлений обновлен: ${next} USDT`);
  }

  const ROUTES = [
    ['remove_wallet_', removeWallet],
    ['prompt_rename_', promptRename],
    ['prompt_threshold_custom', promptThreshold],
    ['set_threshold_', setThreshold]
  ];

  bot.on('callback_query', async (query) => {
    const data = query.data || '';

    if (!query.message || !query.from) {
      return;
    }

    const route = ROUTES.find(([prefix]) => data.startsWith(prefix));

    if (!route) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    const [prefix, handler] = route;
    await handler({
      query,
      chatId: query.message.chat.id,
      userId: query.from.id,
      value: data.slice(prefix.length)
    });
  });
}

module.exports = {
  registerCallbacks
};
