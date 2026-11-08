const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { registerHandlers } = require('../src/bot/registerHandlers');
const { StateRepository } = require('../src/repositories/stateRepository');

const BEP20 = '0x530c3d9d1c5a92c57d91c161470435b6d79b384a';
const TRC20 = 'TF17BgPaZYbz8oxbjhriubPDsA7ArKoLX3';
const USER = 7;

function createFakeBot() {
  const textHandlers = [];
  const eventHandlers = { message: [], callback_query: [] };
  const sent = [];
  const answers = [];

  return {
    sent,
    answers,
    onText(pattern, handler) {
      textHandlers.push({ pattern, handler });
    },
    on(event, handler) {
      eventHandlers[event].push(handler);
    },
    async sendMessage(chatId, text, options) {
      sent.push({ chatId, text, options });
    },
    async answerCallbackQuery(id, options) {
      answers.push({ id, ...options });
    },
    async say(text, userId = USER) {
      const msg = { text, chat: { id: userId }, from: { id: userId } };
      for (const { pattern, handler } of textHandlers) {
        const match = text.match(pattern);
        if (match) await handler(msg, match);
      }
      for (const handler of eventHandlers.message) await handler(msg);
    },
    async press(data, userId = USER) {
      for (const handler of eventHandlers.callback_query) {
        await handler({ id: 'q', data, from: { id: userId }, message: { chat: { id: userId } } });
      }
    },
    last() {
      return sent[sent.length - 1];
    },
    texts() {
      return sent.map((m) => m.text);
    }
  };
}

async function setup(overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcheck-bot-'));
  const stateRepository = new StateRepository(path.join(dir, 'state.json'));
  await stateRepository.init();
  const bot = createFakeBot();
  const monitorService = overrides.monitorService ?? {
    ticks: 0,
    async tick() {
      this.ticks += 1;
    },
    getStats() {
      return {
        startedAtMs: 1,
        lastTickUsers: 1,
        lastTickWallets: 2,
        totalBep20Fetches: 3,
        totalTrc20Fetches: 4,
        totalAlertsSent: 5,
        lastTickStartedAtMs: 1000,
        lastTickFinishedAtMs: 2000,
        lastError: ''
      };
    }
  };
  registerHandlers({ bot, stateRepository, defaultThreshold: 1000, monitorService, now: overrides.now, onError: overrides.onError });
  return { bot, stateRepository, monitorService };
}

test('/start shows the main menu keyboard', async () => {
  const { bot } = await setup();
  await bot.say('/start');
  assert.match(bot.last().text, /Бот запущен/);
  assert.ok(bot.last().options.reply_markup.keyboard.length > 0);
});

test('/start with an edit link opens the wallet of that user only', async () => {
  const { bot, stateRepository } = await setup();
  const wallet = await stateRepository.addWallet(USER, {
    network: 'BEP20',
    address: BEP20,
    name: 'Main',
    watchFromMs: 0
  });

  await bot.say(`/start edit_wallet_${wallet.id}`);
  assert.ok(bot.texts().some((t) => t.includes(`Управление кошельком #${wallet.id}`)));

  bot.sent.length = 0;
  await bot.say(`/start edit_wallet_${wallet.id}`, 99);
  assert.match(bot.last().text, /Кошелек не найден/);
});

test('/add validates network and address and rejects duplicates', async () => {
  const { bot, stateRepository } = await setup();

  await bot.say('/add');
  assert.match(bot.last().text, /Формат: \/add/);
  await bot.say(`/add erc20 ${BEP20} Main`);
  assert.match(bot.last().text, /Неизвестная сеть/);
  await bot.say('/add bep20 0x123 Main');
  assert.match(bot.last().text, /Некорректный адрес/);

  await bot.say(`/add bep20 ${BEP20.toUpperCase().replace('0X', '0x')} My main wallet`);
  assert.match(bot.last().text, /Кошелек добавлен/);
  const [wallet] = stateRepository.listUserWallets(USER);
  assert.equal(wallet.address, BEP20);
  assert.equal(wallet.name, 'My main wallet');

  await bot.say(`/add bep20 ${BEP20} Again`);
  assert.match(bot.last().text, /уже есть в мониторинге/);
});

test('menu button starts a dialog that adds a wallet from the next message', async () => {
  const { bot, stateRepository } = await setup();

  await bot.say('➕ Добавить TRC20');
  assert.match(bot.last().text, /Добавление TRC20/);
  await bot.say('only-one-word');
  assert.match(bot.last().text, /Неверный формат/);
  await bot.say(`${TRC20} Tron wallet`);

  assert.equal(stateRepository.listUserWallets(USER)[0].network, 'TRC20');
  assert.match(bot.last().text, /Готово/);
});

test('/add_bep20 without arguments starts the dialog, with arguments adds at once', async () => {
  const { bot, stateRepository } = await setup();
  await bot.say('/add_bep20');
  assert.match(bot.last().text, /Добавление BEP20/);
  await bot.say('/cancel');
  await bot.say(`/add_bep20 ${BEP20} Quick`);
  assert.equal(stateRepository.listUserWallets(USER).length, 1);
});

test('cancel leaves the dialog and the next message does nothing', async () => {
  const { bot, stateRepository } = await setup();
  await bot.say('➕ Добавить BEP20');
  await bot.say('отмена');
  assert.match(bot.last().text, /Действие отменено/);
  await bot.say(`${BEP20} Late`);
  assert.equal(stateRepository.listUserWallets(USER).length, 0);
});

test('wallet list, rename and remove through buttons', async () => {
  const { bot, stateRepository } = await setup();
  await bot.say('📋 Кошельки');
  assert.match(bot.last().text, /Список пуст/);

  await bot.say(`/add bep20 ${BEP20} Old`);
  await bot.say('/wallets');
  assert.match(bot.last().text, /Отслеживаемые кошельки/);
  assert.equal(bot.last().options.reply_markup.inline_keyboard.length, 1);

  await bot.press('prompt_rename_1');
  assert.match(bot.last().text, /текущее: Old/);
  await bot.say('New <name>');
  assert.equal(stateRepository.getWalletById(USER, 1).name, 'New <name>');
  assert.ok(bot.texts().some((t) => t.includes('New &lt;name&gt;')));

  await bot.press('remove_wallet_1');
  assert.equal(stateRepository.listUserWallets(USER).length, 0);
  await bot.press('remove_wallet_1');
  assert.match(bot.answers.at(-1).text, /Уже удален/);
});

test('commands cannot touch wallets of another user', async () => {
  const { bot, stateRepository } = await setup();
  await bot.say(`/add bep20 ${BEP20} Mine`);

  await bot.say('/rename 1 Stolen', 99);
  assert.match(bot.last().text, /не найден/);
  await bot.say('/remove 1', 99);
  assert.match(bot.last().text, /не найден/);
  await bot.press('remove_wallet_1', 99);

  assert.equal(stateRepository.getWalletById(USER, 1).name, 'Mine');
});

test('/rename and /remove report wrong usage', async () => {
  const { bot } = await setup();
  await bot.say('/rename');
  assert.match(bot.last().text, /Формат: \/rename/);
  await bot.say('/remove');
  assert.match(bot.last().text, /Формат: \/remove/);
});

test('threshold can be set by command, preset button and manual input', async () => {
  const { bot, stateRepository } = await setup();

  await bot.say('/threshold');
  assert.match(bot.last().text, /Текущий порог: 1000 USDT/);
  await bot.say('/threshold 2,5');
  assert.equal(stateRepository.getThreshold(USER, 1000), 2.5);

  await bot.press('set_threshold_5');
  assert.equal(stateRepository.getThreshold(USER, 1000), 5);

  await bot.press('prompt_threshold_custom');
  await bot.say('abc');
  assert.match(bot.last().text, /положительным числом/);
  await bot.say('0.98');
  assert.equal(stateRepository.getThreshold(USER, 1000), 0.98);
});

test('status reports wallets, threshold and monitor counters', async () => {
  const { bot } = await setup();
  await bot.say(`/add bep20 ${BEP20} Main`);
  await bot.say('📊 Статус');
  assert.match(bot.last().text, /Кошельков: 1/);
  assert.match(bot.last().text, /BEP20: 1, TRC20: 0/);
  assert.match(bot.last().text, /Порог: 1000 USDT/);
  assert.match(bot.last().text, /Alerts sent: 5/);
});

test('scan now runs the monitor and reports errors', async () => {
  const { bot, monitorService } = await setup();
  await bot.say('/scan_now');
  assert.equal(monitorService.ticks, 1);
  assert.match(bot.last().text, /Проверка завершена/);

  const failing = await setup({
    monitorService: {
      async tick() {
        throw new Error('rpc down');
      },
      getStats() {
        return {};
      }
    }
  });
  await failing.bot.say('/scan_now');
  assert.match(failing.bot.last().text, /Ошибка scan_now: rpc down/);
});

test('help lists the commands and unknown text is ignored', async () => {
  const { bot } = await setup();
  await bot.say('/help');
  assert.match(bot.last().text, /\/add_trc20/);
  const before = bot.sent.length;
  await bot.say('просто текст');
  assert.equal(bot.sent.length, before);
});

test('wallet names and the number of wallets are limited', async () => {
  const { bot, stateRepository } = await setup();
  await bot.say(`/add bep20 ${BEP20} ${'x'.repeat(65)}`);
  assert.match(bot.last().text, /слишком длинное/);
  assert.equal(stateRepository.listUserWallets(USER).length, 0);

  await bot.say(`/add bep20 ${BEP20} ok`);
  await bot.say(`/rename 1 ${'y'.repeat(65)}`);
  assert.match(bot.last().text, /слишком длинное/);
  assert.equal(stateRepository.getWalletById(USER, 1).name, 'ok');

  for (let i = 1; i < 30; i += 1) {
    const address = `0x${String(i).padStart(40, '0')}`;
    await stateRepository.addWallet(USER, { network: 'BEP20', address, name: `w${i}`, watchFromMs: 0 });
  }
  await bot.say(`/add trc20 ${TRC20} extra`);
  assert.match(bot.last().text, /лимит: 30/);
  assert.equal(stateRepository.listUserWallets(USER).length, 30);
});

test('manual scan is rate limited per user', async () => {
  let time = 100_000;
  const { bot, monitorService } = await setup({ now: () => time });

  await bot.say('/scan_now');
  await bot.say('/scan_now');
  assert.equal(monitorService.ticks, 1);
  assert.match(bot.last().text, /Подожди 30 с/);

  await bot.say('/scan_now', 99);
  assert.equal(monitorService.ticks, 2);

  time += 30_000;
  await bot.say('/scan_now');
  assert.equal(monitorService.ticks, 3);
});

test('a failing handler is reported instead of rejecting', async () => {
  const errors = [];
  const { bot } = await setup({ onError: (error) => errors.push(error.message) });
  bot.sendMessage = async () => {
    throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
  };

  await assert.doesNotReject(bot.say('/menu'));
  await assert.doesNotReject(bot.press('prompt_threshold_custom'));

  assert.equal(errors.length, 2);
  assert.match(errors[0], /blocked/);
});
