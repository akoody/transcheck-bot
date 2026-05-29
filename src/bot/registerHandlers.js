const { normalizeNetwork, isValidAddress, normalizeAddress } = require('../utils/validators');
const { escapeHtml, formatWalletLine, getWalletUrl } = require('../utils/formatters');
const { NETWORK_LABELS, coerceNetwork } = require('../utils/constants');

const MENU = {
  ADD_BEP20: '➕ Добавить BEP20',
  ADD_TRC20: '➕ Добавить TRC20',
  WALLETS: '📋 Кошельки',
  THRESHOLD: '⚙️ Порог',
  STATUS: '📊 Статус',
  SCAN_NOW: '🔍 Скан Сейчас',
  HELP: '❓ Помощь'
};

const USER_STATE_TYPES = {
  ADD_WALLET: 'ADD_WALLET',
  RENAME_WALLET: 'RENAME_WALLET',
  SET_THRESHOLD: 'SET_THRESHOLD'
};

function parseStartPayload(text) {
  const payload = String(text || '').trim().split(' ')[1];
  return payload || null;
}

function getMainMenuMarkup() {
  return {
    reply_markup: {
      keyboard: [
        [
          { text: MENU.ADD_BEP20 },
          { text: MENU.ADD_TRC20 }
        ],
        [
          { text: MENU.WALLETS },
          { text: MENU.THRESHOLD }
        ],
        [
          { text: MENU.STATUS },
          { text: MENU.SCAN_NOW }
        ],
        [
          { text: MENU.HELP }
        ]
      ],
      resize_keyboard: true
    }
  };
}

function createWalletActionsKeyboard(walletId) {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: `✏️ Переименовать #${walletId}`, callback_data: `prompt_rename_${walletId}` },
        { text: `🗑 Удалить #${walletId}`, callback_data: `remove_wallet_${walletId}` }
      ]]
    }
  };
}

function createThresholdKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '0.98 USDT', callback_data: 'set_threshold_0.98' },
          { text: '1 USDT', callback_data: 'set_threshold_1' }
        ],
        [
          { text: '5 USDT', callback_data: 'set_threshold_5' },
          { text: '10 USDT', callback_data: 'set_threshold_10' }
        ],
        [
          { text: '✍️ Ввести вручную', callback_data: 'prompt_threshold_custom' }
        ]
      ]
    }
  };
}

function buildHelpText(defaultThreshold) {
  return [
    'Кнопки уже доступны внизу, можно работать без команд.',
    '',
    'Команды (fallback):',
    '/add <network> <address> <name> - добавить кошелек',
    '/add_bep20 <address> <name> - быстро добавить BEP20',
    '/add_trc20 <address> <name> - быстро добавить TRC20',
    '/wallets - список кошельков',
    '/rename <wallet_id> <name> - изменить название',
    '/remove <wallet_id> - удалить кошелек',
    '/threshold <usd> - порог уведомлений (по умолчанию ' + defaultThreshold + ')',
    '/status - состояние мониторинга',
    '/scan_now - запустить проверку сейчас',
    '/menu - показать кнопки',
    '/cancel - отменить текущее действие'
  ].join('\n');
}

function formatTs(tsMs) {
  if (!tsMs) {
    return 'never';
  }

  return new Date(tsMs).toISOString();
}

function parseAddCommand(text) {
  const [, ...parts] = String(text || '').trim().split(/\s+/);

  if (parts.length < 3) {
    return null;
  }

  const network = parts[0];
  const address = parts[1];
  const name = parts.slice(2).join(' ').trim();

  if (!name) {
    return null;
  }

  return { network, address, name };
}

function parseSingleNetworkAddCommand(text, forcedNetwork) {
  const [, ...parts] = String(text || '').trim().split(/\s+/);

  if (parts.length < 2) {
    return null;
  }

  const address = parts[0];
  const name = parts.slice(1).join(' ').trim();

  if (!name) {
    return null;
  }

  return {
    network: forcedNetwork,
    address,
    name
  };
}

function parseWalletInputText(text) {
  const parts = String(text || '').trim().split(/\s+/);

  if (parts.length < 2) {
    return null;
  }

  const address = parts[0];
  const name = parts.slice(1).join(' ').trim();

  if (!name) {
    return null;
  }

  return { address, name };
}

function parseThresholdValue(raw) {
  const normalized = String(raw || '').trim().replace(',', '.');
  const value = Number(normalized);

  if (!Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

function isCancelText(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === '/cancel' || normalized === 'отмена' || normalized === 'cancel';
}

async function sendMainMenu(bot, chatId, text = 'Главное меню:') {
  await bot.sendMessage(chatId, text, getMainMenuMarkup());
}

async function handleAddWallet({ chatId, userId, addPayload, stateRepository, bot }) {
  const normalizedNetwork = normalizeNetwork(addPayload.network);

  if (!normalizedNetwork) {
    await bot.sendMessage(chatId, 'Неизвестная сеть. Используй: bep20 или trc20.');
    return false;
  }

  const normalizedAddr = normalizeAddress(normalizedNetwork, addPayload.address);

  if (!isValidAddress(normalizedNetwork, normalizedAddr)) {
    await bot.sendMessage(chatId, 'Некорректный адрес для выбранной сети.');
    return false;
  }

  const duplicate = stateRepository.findWallet(userId, normalizedNetwork, normalizedAddr);

  if (duplicate) {
    await bot.sendMessage(chatId, `Этот кошелек уже есть в мониторинге (#${duplicate.id}).`);
    return false;
  }

  const created = await stateRepository.addWallet(userId, {
    network: normalizedNetwork,
    address: normalizedAddr,
    name: addPayload.name,
    watchFromMs: Date.now()
  });

  const walletUrl = getWalletUrl(created.network, created.address);
  const networkLabel = NETWORK_LABELS[created.network] || created.network;

  await bot.sendMessage(
    chatId,
    `Кошелек добавлен:\n${networkLabel} #${created.id} · <a href=\"${walletUrl}\">${escapeHtml(created.name)}</a>\n<code>${escapeHtml(created.address)}</code>`,
    {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...createWalletActionsKeyboard(created.id)
    }
  );

  return true;
}

async function sendWalletList({ chatId, userId, stateRepository, bot }) {
  const wallets = stateRepository.listUserWallets(userId);

  if (!wallets.length) {
    await bot.sendMessage(chatId, 'Список пуст. Добавь кошелек через кнопку "➕ Добавить".');
    return;
  }

  const lines = wallets.map((wallet) => formatWalletLine(wallet));
  const keyboard = wallets.map((wallet) => ([
    { text: `✏️ #${wallet.id}`, callback_data: `prompt_rename_${wallet.id}` },
    { text: `🗑 #${wallet.id}`, callback_data: `remove_wallet_${wallet.id}` }
  ]));

  await bot.sendMessage(chatId, `Отслеживаемые кошельки:\n\n${lines.join('\n\n')}`, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

async function sendStatus({ chatId, userId, stateRepository, monitorService, bot, defaultThreshold }) {
  const wallets = stateRepository.listUserWallets(userId);
  const threshold = stateRepository.getThreshold(userId, defaultThreshold);

  const perNetwork = {
    BEP20: 0,
    TRC20: 0,
    UNKNOWN: 0
  };

  for (const wallet of wallets) {
    const network = coerceNetwork(wallet.network);

    if (network === 'BEP20') {
      perNetwork.BEP20 += 1;
    } else if (network === 'TRC20') {
      perNetwork.TRC20 += 1;
    } else {
      perNetwork.UNKNOWN += 1;
    }
  }

  const monitorStats = monitorService ? monitorService.getStats() : null;

  const lines = [
    `Кошельков: ${wallets.length}`,
    `BEP20: ${perNetwork.BEP20}, TRC20: ${perNetwork.TRC20}, unknown: ${perNetwork.UNKNOWN}`,
    `Порог: ${threshold} USDT`
  ];

  if (monitorStats) {
    lines.push(`Монитор запущен: ${monitorStats.startedAtMs ? 'yes' : 'no'}`);
    lines.push(`Tick users/wallets: ${monitorStats.lastTickUsers}/${monitorStats.lastTickWallets}`);
    lines.push(`BEP20 API calls: ${monitorStats.totalBep20Fetches}`);
    lines.push(`TRC20 API calls: ${monitorStats.totalTrc20Fetches}`);
    lines.push(`Alerts sent: ${monitorStats.totalAlertsSent}`);
    lines.push(`Last tick start: ${formatTs(monitorStats.lastTickStartedAtMs)}`);
    lines.push(`Last tick finish: ${formatTs(monitorStats.lastTickFinishedAtMs)}`);
    lines.push(`Last error: ${monitorStats.lastError || '-'}`);
  } else {
    lines.push('Monitor stats unavailable');
  }

  await bot.sendMessage(chatId, lines.join('\n'));
}

async function runScanNow({ chatId, monitorService, bot }) {
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

async function sendThresholdMenu({ chatId, userId, stateRepository, bot, defaultThreshold }) {
  const current = stateRepository.getThreshold(userId, defaultThreshold);
  await bot.sendMessage(
    chatId,
    `Текущий порог: ${current} USDT\nВыбери значение или введи вручную:`,
    createThresholdKeyboard()
  );
}

function registerHandlers({ bot, stateRepository, defaultThreshold, monitorService }) {
  const userStates = new Map();

  function setUserState(userId, state) {
    userStates.set(String(userId), state);
  }

  function getUserState(userId) {
    return userStates.get(String(userId)) || null;
  }

  function clearUserState(userId) {
    userStates.delete(String(userId));
  }

  async function startAddFlow({ chatId, userId, network }) {
    setUserState(userId, {
      type: USER_STATE_TYPES.ADD_WALLET,
      network
    });

    const networkLabel = network === 'bep20' ? 'BEP20 (BSC)' : 'TRC20 (TRON)';
    await bot.sendMessage(
      chatId,
      `Добавление ${networkLabel}.\nОтправь в одном сообщении:\n<address> <name>\n\nПример:\n${network === 'bep20' ? '0x530c3d9d1c5a92c57d91c161470435b6d79b384a Main BSC' : 'TF17BgPaZYbz8oxbjhriubPDsA7ArKoLX3 Main TRON'}\n\nДля отмены: /cancel`
    );
  }

  async function processStateInput(msg) {
    if (!msg.from || !msg.text) {
      return false;
    }

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = getUserState(userId);

    if (!state) {
      return false;
    }

    if (isCancelText(msg.text)) {
      clearUserState(userId);
      await sendMainMenu(bot, chatId, 'Действие отменено.');
      return true;
    }

    if (state.type === USER_STATE_TYPES.ADD_WALLET) {
      const parsed = parseWalletInputText(msg.text);

      if (!parsed) {
        await bot.sendMessage(chatId, 'Неверный формат. Нужно: <address> <name>');
        return true;
      }

      const created = await handleAddWallet({
        chatId,
        userId,
        addPayload: {
          network: state.network,
          address: parsed.address,
          name: parsed.name
        },
        stateRepository,
        bot
      });

      if (created) {
        clearUserState(userId);
        await sendMainMenu(bot, chatId, 'Готово. Что делаем дальше?');
      }

      return true;
    }

    if (state.type === USER_STATE_TYPES.RENAME_WALLET) {
      const nextName = String(msg.text || '').trim();

      if (!nextName) {
        await bot.sendMessage(chatId, 'Название не должно быть пустым. Введи новое имя.');
        return true;
      }

      const updated = await stateRepository.renameWallet(userId, state.walletId, nextName);

      if (!updated) {
        clearUserState(userId);
        await bot.sendMessage(chatId, 'Кошелек с таким ID не найден.');
        return true;
      }

      const walletUrl = getWalletUrl(updated.network, updated.address);
      await bot.sendMessage(
        chatId,
        `Название обновлено:\n#${updated.id} · <a href=\"${walletUrl}\">${escapeHtml(updated.name)}</a>`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...createWalletActionsKeyboard(updated.id)
        }
      );

      clearUserState(userId);
      await sendMainMenu(bot, chatId, 'Название сохранено.');
      return true;
    }

    if (state.type === USER_STATE_TYPES.SET_THRESHOLD) {
      const next = parseThresholdValue(msg.text);

      if (next === null) {
        await bot.sendMessage(chatId, 'Порог должен быть положительным числом, например: 0.98');
        return true;
      }

      await stateRepository.setThreshold(userId, next);
      clearUserState(userId);
      await bot.sendMessage(chatId, `Порог уведомлений обновлен: ${next} USDT`);
      await sendMainMenu(bot, chatId, 'Готово.');
      return true;
    }

    return false;
  }

  bot.onText(/^\/start(?:\s+(.+))?$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const payload = parseStartPayload(msg.text);

    clearUserState(userId);

    if (payload && payload.startsWith('edit_wallet_')) {
      const walletId = Number(payload.replace('edit_wallet_', ''));
      const wallet = stateRepository.getWalletById(userId, walletId);

      if (!wallet) {
        await sendMainMenu(bot, chatId, 'Кошелек не найден или уже удален.');
        return;
      }

      const networkLabel = NETWORK_LABELS[wallet.network] || wallet.network;
      const walletUrl = getWalletUrl(wallet.network, wallet.address);

      await bot.sendMessage(
        chatId,
        `Управление кошельком #${wallet.id}:\n${networkLabel} · <a href=\"${walletUrl}\">${escapeHtml(wallet.name)}</a>\n<code>${escapeHtml(wallet.address)}</code>`,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...createWalletActionsKeyboard(wallet.id)
        }
      );

      await sendMainMenu(bot, chatId, 'Главное меню:');
      return;
    }

    await sendMainMenu(bot, chatId, 'Бот запущен. Выбери действие кнопкой ниже.');
  });

  bot.onText(/^\/menu$/, async (msg) => {
    await sendMainMenu(bot, msg.chat.id, 'Главное меню:');
  });

  bot.onText(/^\/cancel$/, async (msg) => {
    if (msg.from) {
      clearUserState(msg.from.id);
    }

    await sendMainMenu(bot, msg.chat.id, 'Действие отменено.');
  });

  bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(msg.chat.id, buildHelpText(defaultThreshold), getMainMenuMarkup());
  });

  bot.onText(/^\/add(?:\s+.+)?$/, async (msg) => {
    const addPayload = parseAddCommand(msg.text);

    if (!addPayload) {
      await bot.sendMessage(
        msg.chat.id,
        'Формат: /add <network> <address> <name>\nПример: /add trc20 TF17BgPaZYbz8oxbjhriubPDsA7ArKoLX3 Main TRON'
      );
      return;
    }

    await handleAddWallet({
      chatId: msg.chat.id,
      userId: msg.from.id,
      addPayload,
      stateRepository,
      bot
    });
  });

  bot.onText(/^\/add_bep20(?:\s+.+)?$/, async (msg) => {
    const addPayload = parseSingleNetworkAddCommand(msg.text, 'bep20');

    if (!addPayload) {
      await startAddFlow({
        chatId: msg.chat.id,
        userId: msg.from.id,
        network: 'bep20'
      });
      return;
    }

    await handleAddWallet({
      chatId: msg.chat.id,
      userId: msg.from.id,
      addPayload,
      stateRepository,
      bot
    });
  });

  bot.onText(/^\/add_trc20(?:\s+.+)?$/, async (msg) => {
    const addPayload = parseSingleNetworkAddCommand(msg.text, 'trc20');

    if (!addPayload) {
      await startAddFlow({
        chatId: msg.chat.id,
        userId: msg.from.id,
        network: 'trc20'
      });
      return;
    }

    await handleAddWallet({
      chatId: msg.chat.id,
      userId: msg.from.id,
      addPayload,
      stateRepository,
      bot
    });
  });

  bot.onText(/^\/wallets$/, async (msg) => {
    await sendWalletList({
      chatId: msg.chat.id,
      userId: msg.from.id,
      stateRepository,
      bot
    });
  });

  bot.onText(/^\/rename(?:\s+(\d+)\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const walletId = Number(match?.[1]);
    const nextName = String(match?.[2] || '').trim();

    if (!walletId || !nextName) {
      await bot.sendMessage(chatId, 'Формат: /rename <wallet_id> <new_name>');
      return;
    }

    const updated = await stateRepository.renameWallet(userId, walletId, nextName);

    if (!updated) {
      await bot.sendMessage(chatId, 'Кошелек с таким ID не найден.');
      return;
    }

    const walletUrl = getWalletUrl(updated.network, updated.address);
    await bot.sendMessage(
      chatId,
      `Название обновлено:\n#${updated.id} · <a href=\"${walletUrl}\">${escapeHtml(updated.name)}</a>`,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...createWalletActionsKeyboard(updated.id)
      }
    );
  });

  bot.onText(/^\/remove(?:\s+(\d+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const walletId = Number(match?.[1]);

    if (!walletId) {
      await bot.sendMessage(chatId, 'Формат: /remove <wallet_id>');
      return;
    }

    const removed = await stateRepository.removeWallet(userId, walletId);

    if (!removed) {
      await bot.sendMessage(chatId, 'Кошелек с таким ID не найден.');
      return;
    }

    await bot.sendMessage(chatId, `Кошелек #${walletId} удален.`);
  });

  bot.onText(/^\/threshold(?:\s+([\d.,]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!match?.[1]) {
      await sendThresholdMenu({
        chatId,
        userId,
        stateRepository,
        bot,
        defaultThreshold
      });
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

  bot.onText(/^\/status$/, async (msg) => {
    await sendStatus({
      chatId: msg.chat.id,
      userId: msg.from.id,
      stateRepository,
      monitorService,
      bot,
      defaultThreshold
    });
  });

  bot.onText(/^\/scan_now$/, async (msg) => {
    await runScanNow({
      chatId: msg.chat.id,
      monitorService,
      bot
    });
  });

  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    const message = query.message;

    if (!message || !query.from) {
      return;
    }

    const userId = query.from.id;
    const chatId = message.chat.id;

    if (data.startsWith('remove_wallet_')) {
      const walletId = Number(data.replace('remove_wallet_', ''));

      if (!walletId) {
        await bot.answerCallbackQuery(query.id, { text: 'Некорректный ID.' });
        return;
      }

      const removed = await stateRepository.removeWallet(userId, walletId);

      if (!removed) {
        await bot.answerCallbackQuery(query.id, { text: 'Уже удален или недоступен.' });
        return;
      }

      await bot.answerCallbackQuery(query.id, { text: `Кошелек #${walletId} удален.` });
      await bot.sendMessage(chatId, `Кошелек #${walletId} удален.`);
      return;
    }

    if (data.startsWith('prompt_rename_')) {
      const walletId = Number(data.replace('prompt_rename_', ''));

      if (!walletId) {
        await bot.answerCallbackQuery(query.id, { text: 'Некорректный ID.' });
        return;
      }

      const wallet = stateRepository.getWalletById(userId, walletId);

      if (!wallet) {
        await bot.answerCallbackQuery(query.id, { text: 'Кошелек не найден.' });
        return;
      }

      setUserState(userId, {
        type: USER_STATE_TYPES.RENAME_WALLET,
        walletId
      });

      await bot.answerCallbackQuery(query.id, { text: 'Введите новое название.' });
      await bot.sendMessage(chatId, `Введи новое название для кошелька #${walletId} (текущее: ${wallet.name}).\nДля отмены: /cancel`);
      return;
    }

    if (data === 'prompt_threshold_custom') {
      setUserState(userId, {
        type: USER_STATE_TYPES.SET_THRESHOLD
      });

      await bot.answerCallbackQuery(query.id, { text: 'Введи порог вручную.' });
      await bot.sendMessage(chatId, 'Введи порог в USDT, например: 0.98\nДля отмены: /cancel');
      return;
    }

    if (data.startsWith('set_threshold_')) {
      const valueRaw = data.replace('set_threshold_', '');
      const next = parseThresholdValue(valueRaw);

      if (next === null) {
        await bot.answerCallbackQuery(query.id, { text: 'Некорректное значение.' });
        return;
      }

      await stateRepository.setThreshold(userId, next);
      clearUserState(userId);
      await bot.answerCallbackQuery(query.id, { text: `Порог: ${next} USDT` });
      await bot.sendMessage(chatId, `Порог уведомлений обновлен: ${next} USDT`);
      return;
    }

    await bot.answerCallbackQuery(query.id);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || !msg.from) {
      return;
    }

    const text = String(msg.text || '').trim();

    if (!text) {
      return;
    }

    if (text.startsWith('/')) {
      return;
    }

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (text === MENU.ADD_BEP20) {
      clearUserState(userId);
      await startAddFlow({ chatId, userId, network: 'bep20' });
      return;
    }

    if (text === MENU.ADD_TRC20) {
      clearUserState(userId);
      await startAddFlow({ chatId, userId, network: 'trc20' });
      return;
    }

    if (text === MENU.WALLETS) {
      clearUserState(userId);
      await sendWalletList({ chatId, userId, stateRepository, bot });
      return;
    }

    if (text === MENU.THRESHOLD) {
      clearUserState(userId);
      await sendThresholdMenu({ chatId, userId, stateRepository, bot, defaultThreshold });
      return;
    }

    if (text === MENU.STATUS) {
      clearUserState(userId);
      await sendStatus({
        chatId,
        userId,
        stateRepository,
        monitorService,
        bot,
        defaultThreshold
      });
      return;
    }

    if (text === MENU.SCAN_NOW) {
      clearUserState(userId);
      await runScanNow({ chatId, monitorService, bot });
      return;
    }

    if (text === MENU.HELP) {
      clearUserState(userId);
      await bot.sendMessage(chatId, buildHelpText(defaultThreshold), getMainMenuMarkup());
      return;
    }

    const consumed = await processStateInput(msg);

    if (consumed) {
      return;
    }

    if (isCancelText(text)) {
      clearUserState(userId);
      await sendMainMenu(bot, chatId, 'Действие отменено.');
    }
  });
}

module.exports = {
  registerHandlers
};
