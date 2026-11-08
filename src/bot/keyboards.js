const MENU = {
  ADD_BEP20: '➕ Добавить BEP20',
  ADD_TRC20: '➕ Добавить TRC20',
  WALLETS: '📋 Кошельки',
  THRESHOLD: '⚙️ Порог',
  STATUS: '📊 Статус',
  SCAN_NOW: '🔍 Скан Сейчас',
  HELP: '❓ Помощь'
};

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

module.exports = {
  MENU,
  buildHelpText,
  createThresholdKeyboard,
  createWalletActionsKeyboard,
  getMainMenuMarkup
};
