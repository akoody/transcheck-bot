const { normalizeNetwork, isValidAddress, normalizeAddress } = require('../utils/validators');
const { escapeHtml, formatWalletLine, getWalletUrl } = require('../utils/formatters');
const { NETWORK_LABELS, coerceNetwork } = require('../utils/constants');
const {
  createThresholdKeyboard,
  createWalletActionsKeyboard,
  getMainMenuMarkup
} = require('./keyboards');

const HTML_MESSAGE = { parse_mode: 'HTML', disable_web_page_preview: true };

function formatTs(tsMs) {
  return tsMs ? new Date(tsMs).toISOString() : 'never';
}

function walletLink(wallet) {
  return `<a href="${getWalletUrl(wallet.network, wallet.address)}">${escapeHtml(wallet.name)}</a>`;
}

/** Действия бота: отправка экранов и операции с кошельками. */
function createActions({ bot, stateRepository, monitorService, defaultThreshold }) {
  async function sendMainMenu(chatId, text = 'Главное меню:') {
    await bot.sendMessage(chatId, text, getMainMenuMarkup());
  }

  async function addWallet({ chatId, userId, addPayload }) {
    const network = normalizeNetwork(addPayload.network);

    if (!network) {
      await bot.sendMessage(chatId, 'Неизвестная сеть. Используй: bep20 или trc20.');
      return false;
    }

    const address = normalizeAddress(network, addPayload.address);

    if (!isValidAddress(network, address)) {
      await bot.sendMessage(chatId, 'Некорректный адрес для выбранной сети.');
      return false;
    }

    const duplicate = stateRepository.findWallet(userId, network, address);

    if (duplicate) {
      await bot.sendMessage(chatId, `Этот кошелек уже есть в мониторинге (#${duplicate.id}).`);
      return false;
    }

    const created = await stateRepository.addWallet(userId, {
      network,
      address,
      name: addPayload.name,
      watchFromMs: Date.now()
    });
    const networkLabel = NETWORK_LABELS[created.network] || created.network;

    await bot.sendMessage(
      chatId,
      `Кошелек добавлен:\n${networkLabel} #${created.id} · ${walletLink(created)}\n<code>${escapeHtml(created.address)}</code>`,
      { ...HTML_MESSAGE, ...createWalletActionsKeyboard(created.id) }
    );

    return true;
  }

  async function renameWallet({ chatId, userId, walletId, name }) {
    const updated = await stateRepository.renameWallet(userId, walletId, name);

    if (!updated) {
      await bot.sendMessage(chatId, 'Кошелек с таким ID не найден.');
      return false;
    }

    await bot.sendMessage(chatId, `Название обновлено:\n#${updated.id} · ${walletLink(updated)}`, {
      ...HTML_MESSAGE,
      ...createWalletActionsKeyboard(updated.id)
    });

    return true;
  }

  async function sendWalletDetails({ chatId, wallet }) {
    const networkLabel = NETWORK_LABELS[wallet.network] || wallet.network;

    await bot.sendMessage(
      chatId,
      `Управление кошельком #${wallet.id}:\n${networkLabel} · ${walletLink(wallet)}\n<code>${escapeHtml(wallet.address)}</code>`,
      { ...HTML_MESSAGE, ...createWalletActionsKeyboard(wallet.id) }
    );
  }

  async function sendWalletList({ chatId, userId }) {
    const wallets = stateRepository.listUserWallets(userId);

    if (!wallets.length) {
      await bot.sendMessage(chatId, 'Список пуст. Добавь кошелек через кнопку "➕ Добавить".');
      return;
    }

    const lines = wallets.map((wallet) => formatWalletLine(wallet));
    const keyboard = wallets.map((wallet) => [
      { text: `✏️ #${wallet.id}`, callback_data: `prompt_rename_${wallet.id}` },
      { text: `🗑 #${wallet.id}`, callback_data: `remove_wallet_${wallet.id}` }
    ]);

    await bot.sendMessage(chatId, `Отслеживаемые кошельки:\n\n${lines.join('\n\n')}`, {
      ...HTML_MESSAGE,
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  async function sendStatus({ chatId, userId }) {
    const wallets = stateRepository.listUserWallets(userId);
    const threshold = stateRepository.getThreshold(userId, defaultThreshold);
    const perNetwork = { BEP20: 0, TRC20: 0, UNKNOWN: 0 };

    for (const wallet of wallets) {
      perNetwork[coerceNetwork(wallet.network) || 'UNKNOWN'] += 1;
    }

    const stats = monitorService ? monitorService.getStats() : null;
    const lines = [
      `Кошельков: ${wallets.length}`,
      `BEP20: ${perNetwork.BEP20}, TRC20: ${perNetwork.TRC20}, unknown: ${perNetwork.UNKNOWN}`,
      `Порог: ${threshold} USDT`
    ];

    if (stats) {
      lines.push(
        `Монитор запущен: ${stats.startedAtMs ? 'yes' : 'no'}`,
        `Tick users/wallets: ${stats.lastTickUsers}/${stats.lastTickWallets}`,
        `BEP20 API calls: ${stats.totalBep20Fetches}`,
        `TRC20 API calls: ${stats.totalTrc20Fetches}`,
        `Alerts sent: ${stats.totalAlertsSent}`,
        `Last tick start: ${formatTs(stats.lastTickStartedAtMs)}`,
        `Last tick finish: ${formatTs(stats.lastTickFinishedAtMs)}`,
        `Last error: ${stats.lastError || '-'}`
      );
    } else {
      lines.push('Monitor stats unavailable');
    }

    await bot.sendMessage(chatId, lines.join('\n'));
  }

  async function runScanNow({ chatId }) {
    if (!monitorService) {
      await bot.sendMessage(chatId, 'Монитор недоступен.');
      return;
    }

    try {
      await monitorService.tick();
      const stats = monitorService.getStats();
      await bot.sendMessage(
        chatId,
        `Проверка завершена.\nWallets: ${stats.lastTickWallets}\nBEP20 calls: ${stats.totalBep20Fetches}\nTRC20 calls: ${stats.totalTrc20Fetches}\nLast error: ${stats.lastError || '-'}`
      );
    } catch (error) {
      await bot.sendMessage(chatId, `Ошибка scan_now: ${error.message}`);
    }
  }

  async function sendThresholdMenu({ chatId, userId }) {
    const current = stateRepository.getThreshold(userId, defaultThreshold);
    await bot.sendMessage(
      chatId,
      `Текущий порог: ${current} USDT\nВыбери значение или введи вручную:`,
      createThresholdKeyboard()
    );
  }

  return {
    addWallet,
    renameWallet,
    runScanNow,
    sendMainMenu,
    sendStatus,
    sendThresholdMenu,
    sendWalletDetails,
    sendWalletList
  };
}

module.exports = {
  createActions
};
