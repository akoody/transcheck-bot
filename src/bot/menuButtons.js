const { MENU, buildHelpText, getMainMenuMarkup } = require('./keyboards');
const { isCancelText } = require('./parsers');

/** Нижнее меню и свободный текст, который продолжает диалог. */
function registerMenuButtons({ bot, defaultThreshold, actions, conversation }) {
  const BUTTONS = {
    [MENU.ADD_BEP20]: (ctx) => conversation.startAddWallet({ ...ctx, network: 'bep20' }),
    [MENU.ADD_TRC20]: (ctx) => conversation.startAddWallet({ ...ctx, network: 'trc20' }),
    [MENU.WALLETS]: (ctx) => actions.sendWalletList(ctx),
    [MENU.THRESHOLD]: (ctx) => actions.sendThresholdMenu(ctx),
    [MENU.STATUS]: (ctx) => actions.sendStatus(ctx),
    [MENU.SCAN_NOW]: (ctx) => actions.runScanNow(ctx),
    [MENU.HELP]: ({ chatId }) => bot.sendMessage(chatId, buildHelpText(defaultThreshold), getMainMenuMarkup())
  };

  bot.on('message', async (msg) => {
    const text = String(msg.text || '').trim();

    if (!text || !msg.from || text.startsWith('/')) {
      return;
    }

    const ctx = { chatId: msg.chat.id, userId: msg.from.id };
    const button = BUTTONS[text];

    if (button) {
      conversation.clear(ctx.userId);
      await button(ctx);
      return;
    }

    if (await conversation.handleMessage({ ...ctx, text: msg.text })) {
      return;
    }

    if (isCancelText(text)) {
      await actions.sendMainMenu(ctx.chatId, 'Действие отменено.');
    }
  });
}

module.exports = {
  registerMenuButtons
};
