const { NETWORKS, coerceNetwork, KNOWN_EXCHANGES } = require('../utils/constants');
const { formatAlertMessage, getWalletUrl } = require('../utils/formatters');

class MonitorService {
  constructor({
    stateRepository,
    bscClient,
    tronClient,
    bot,
    minAlertUsdt,
    pollIntervalMs,
    walletErrorBaseCooldownMs,
    walletErrorMaxCooldownMs,
    walletErrorLogIntervalMs,
    getBotUsername
  }) {
    this.stateRepository = stateRepository;
    this.bscClient = bscClient;
    this.tronClient = tronClient;
    this.bot = bot;
    this.minAlertUsdt = minAlertUsdt;
    this.pollIntervalMs = pollIntervalMs;
    this.walletErrorBaseCooldownMs = Math.max(5_000, Number(walletErrorBaseCooldownMs || 30_000));
    this.walletErrorMaxCooldownMs = Math.max(this.walletErrorBaseCooldownMs, Number(walletErrorMaxCooldownMs || 10 * 60_000));
    this.walletErrorLogIntervalMs = Math.max(10_000, Number(walletErrorLogIntervalMs || 60_000));
    this.getBotUsername = getBotUsername;
    this.timer = null;
    this.isRunning = false;
    this.walletFailureState = new Map();
    this.stats = {
      startedAtMs: null,
      totalTicks: 0,
      lastTickStartedAtMs: null,
      lastTickFinishedAtMs: null,
      lastTickDurationMs: null,
      lastTickUsers: 0,
      lastTickWallets: 0,
      totalBep20Fetches: 0,
      totalTrc20Fetches: 0,
      totalAlertsSent: 0,
      lastError: ''
    };
  }

  start() {
    if (this.timer) {
      return;
    }

    if (!this.stats.startedAtMs) {
      this.stats.startedAtMs = Date.now();
    }

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[monitor] tick failed', error);
      });
    }, this.pollIntervalMs);

    this.tick().catch((error) => {
      console.error('[monitor] initial tick failed', error);
    });
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.stats.lastTickStartedAtMs = Date.now();
    let usersCount = 0;
    let walletsCount = 0;

    try {
      const users = this.stateRepository.listAllUsersWithWallets();
      usersCount = users.length;

      for (const user of users) {
        const threshold = typeof user.thresholdUsdt === 'number' ? user.thresholdUsdt : this.minAlertUsdt;

        for (const wallet of user.wallets) {
          walletsCount += 1;
          await this.processWallet(user.userId, wallet, threshold);
        }
      }

      this.stats.totalTicks += 1;
      this.stats.lastTickUsers = usersCount;
      this.stats.lastTickWallets = walletsCount;
    } finally {
      this.stats.lastTickFinishedAtMs = Date.now();
      this.stats.lastTickDurationMs = this.stats.lastTickFinishedAtMs - this.stats.lastTickStartedAtMs;
      this.isRunning = false;
    }
  }

  async processWallet(userId, wallet, threshold) {
    if (this.isWalletCoolingDown(wallet)) {
      return;
    }

    let txList = [];

    try {
      txList = await this.fetchWalletTransactions(wallet);
      this.clearWalletFailure(wallet);
    } catch (error) {
      this.handleWalletFetchFailure(wallet, error);
      return;
    }

    if (!txList.length) {
      return;
    }

    const sorted = [...txList].sort((a, b) => a.timestampMs - b.timestampMs);

    for (const tx of sorted) {
      const normalized = this.toNormalizedTx(wallet, tx);

      if (!normalized) {
        continue;
      }

      const watchFromMs = Number(wallet.watchFromMs || 0);

      if (normalized.timestampMs < watchFromMs) {
        continue;
      }

      if (normalized.amount <= threshold) {
        continue;
      }

      const txId = `${normalized.hash}-${normalized.direction}`;

      if (this.stateRepository.hasSeenTx(userId, wallet.id, txId)) {
        continue;
      }

      normalized.counterpartyName = await this.resolveCounterpartyName(wallet.network, normalized.counterpartyAddress);
      const delivered = await this.notify(userId, wallet, normalized);

      if (delivered) {
        await this.stateRepository.markTxAsSeen(userId, wallet.id, txId);
      }
    }
  }

  async fetchWalletTransactions(wallet) {
    const resolvedNetwork = coerceNetwork(wallet.network);

    if (resolvedNetwork === NETWORKS.BEP20) {
      this.stats.totalBep20Fetches += 1;
      return this.bscClient.fetchUsdtTransactions(wallet.address, 50);
    }

    if (resolvedNetwork === NETWORKS.TRC20) {
      this.stats.totalTrc20Fetches += 1;
      return this.tronClient.fetchUsdtTransactions(wallet.address, 50);
    }

    return [];
  }

  toNormalizedTx(wallet, tx) {
    const resolvedNetwork = coerceNetwork(wallet.network);
    const walletAddress = resolvedNetwork === NETWORKS.BEP20
      ? String(wallet.address).toLowerCase()
      : String(wallet.address);

    const from = resolvedNetwork === NETWORKS.BEP20 ? String(tx.from).toLowerCase() : String(tx.from);
    const to = resolvedNetwork === NETWORKS.BEP20 ? String(tx.to).toLowerCase() : String(tx.to);

    const isOutgoing = from === walletAddress;
    const isIncoming = to === walletAddress;

    if (!isOutgoing && !isIncoming) {
      return null;
    }

    const direction = isOutgoing ? 'OUT' : 'IN';
    const counterpartyAddress = isOutgoing ? to : from;
    const counterpartyName = counterpartyAddress;

    return {
      hash: tx.hash,
      timestampMs: tx.timestampMs,
      amount: tx.amount,
      direction,
      counterpartyAddress,
      counterpartyName,
      counterpartyUrl: getWalletUrl(resolvedNetwork, counterpartyAddress)
    };
  }

  async resolveCounterpartyName(network, address) {
    const resolvedNetwork = coerceNetwork(network);
    const normalizedAddress = String(address).toLowerCase();

    if (KNOWN_EXCHANGES[resolvedNetwork] && KNOWN_EXCHANGES[resolvedNetwork][normalizedAddress]) {
      return KNOWN_EXCHANGES[resolvedNetwork][normalizedAddress];
    }

    if (resolvedNetwork !== NETWORKS.BEP20) {
      return address;
    }

    if (!this.bscClient || typeof this.bscClient.resolveAddressLabel !== 'function') {
      return address;
    }

    try {
      const label = await this.bscClient.resolveAddressLabel(address);
      return label || address;
    } catch (error) {
      return address;
    }
  }

  async notify(userId, wallet, tx) {
    const message = formatAlertMessage({
      wallet,
      tx,
      botUsername: this.getBotUsername()
    });

    try {
      await this.bot.sendMessage(userId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      this.stats.totalAlertsSent += 1;
      return true;
    } catch (error) {
      this.stats.lastError = `[notify:user=${userId}] ${error.message}`;
      console.error(`[monitor] failed to send tg message user=${userId}`, error.message);
      return false;
    }
  }

  getStats() {
    return { ...this.stats, isRunning: this.isRunning };
  }

  getWalletFailureKey(wallet) {
    if (wallet && wallet.id != null) {
      return `wallet:${wallet.id}`;
    }

    return `wallet:${wallet?.network || 'unknown'}:${wallet?.address || 'unknown'}`;
  }

  isWalletCoolingDown(wallet) {
    const state = this.walletFailureState.get(this.getWalletFailureKey(wallet));

    if (!state) {
      return false;
    }

    if (state.retryAtMs <= Date.now()) {
      this.walletFailureState.delete(this.getWalletFailureKey(wallet));
      return false;
    }

    return true;
  }

  clearWalletFailure(wallet) {
    this.walletFailureState.delete(this.getWalletFailureKey(wallet));
  }

  handleWalletFetchFailure(wallet, error) {
    const key = this.getWalletFailureKey(wallet);
    const now = Date.now();
    const message = String(error?.message || 'Unknown fetch error');
    const previous = this.walletFailureState.get(key);
    const attempts = Math.min((previous?.attempts || 0) + 1, 10);
    const cooldownMs = this.getWalletCooldownMs(message, attempts);
    const shouldLog = !previous
      || previous.message !== message
      || !previous.lastLoggedAtMs
      || (now - previous.lastLoggedAtMs) >= this.walletErrorLogIntervalMs;

    this.walletFailureState.set(key, {
      attempts,
      message,
      retryAtMs: now + cooldownMs,
      lastLoggedAtMs: shouldLog ? now : (previous?.lastLoggedAtMs || 0)
    });

    this.stats.lastError = `[wallet#${wallet.id}] ${message}`;

    if (shouldLog) {
      console.error(
        `[monitor] failed to fetch transactions wallet=${wallet.id} (retry in ${Math.ceil(cooldownMs / 1000)}s)`,
        message
      );
    }
  }

  getWalletCooldownMs(message, attempts) {
    const normalizedMessage = String(message || '').toLowerCase();
    const isTemporary = /limit exceeded|usage limit|quota limit|monthly quota|rate limit|too many requests|401|429|timeout|timed out|temporar|busy|gateway|502|503|504|eai_again|enotfound|econnreset|etimedout|socket hang up|network error|cooldown active/.test(normalizedMessage);
    const baseMs = isTemporary
      ? this.walletErrorBaseCooldownMs
      : Math.max(5_000, Math.floor(this.walletErrorBaseCooldownMs / 2));

    return Math.min(this.walletErrorMaxCooldownMs, baseMs * 2 ** Math.max(0, attempts - 1));
  }
}

module.exports = {
  MonitorService
};
