const axios = require('axios');
const { NETWORKS } = require('../utils/constants');

const DEFAULT_REQUEST_RETRIES = 2;
const DEFAULT_COOLDOWN_BASE_MS = 20_000;
const DEFAULT_COOLDOWN_MAX_MS = 5 * 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TronClient {
  constructor(config) {
    this.config = config;
    this.http = axios.create({
      timeout: 15_000
    });
    this.requestRetries = Math.max(0, Number(this.config.requestRetries || DEFAULT_REQUEST_RETRIES));
    this.cooldownBaseMs = Math.max(5_000, Number(this.config.cooldownBaseMs || DEFAULT_COOLDOWN_BASE_MS));
    this.cooldownMaxMs = Math.max(this.cooldownBaseMs, Number(this.config.cooldownMaxMs || DEFAULT_COOLDOWN_MAX_MS));
    this.failureState = {
      attempts: 0,
      message: '',
      retryAtMs: 0
    };
  }

  async fetchUsdtTransactions(address, limit = 50) {
    this.throwIfCoolingDown();

    const headers = {};

    if (this.config.apiKey) {
      headers['TRON-PRO-API-KEY'] = this.config.apiKey;
    }

    const url = `${this.config.apiUrl}/accounts/${address}/transactions/trc20`;
    let lastMessage = '';

    for (let attempt = 0; attempt <= this.requestRetries; attempt += 1) {
      try {
        const { data } = await this.http.get(url, {
          params: {
            only_confirmed: true,
            limit: Math.min(Math.max(limit, 1), 200),
            contract_address: this.config.usdtContract,
            order_by: 'block_timestamp,desc'
          },
          headers
        });

        this.resetFailureState();

        if (!data || !Array.isArray(data.data)) {
          return [];
        }

        return data.data.map((item) => {
          const decimals = Number(item?.token_info?.decimals || 6);
          const value = Number(item.value) / 10 ** decimals;
          const from = String(item.from || '');
          const to = String(item.to || '');

          return {
            network: NETWORKS.TRC20,
            hash: item.transaction_id,
            timestampMs: Number(item.block_timestamp || 0),
            from,
            to,
            amount: value,
            tokenSymbol: item?.token_info?.symbol || 'USDT',
            blockNumber: Number(item.block || 0)
          };
        });
      } catch (error) {
        lastMessage = this.extractAxiosErrorMessage(error);
        const shouldRetry = this.isRetryableError(lastMessage);

        if (attempt >= this.requestRetries || !shouldRetry) {
          this.registerFailure(lastMessage);
          throw new Error(lastMessage);
        }

        await sleep(this.getBackoffMs(attempt));
      }
    }

    this.registerFailure(lastMessage);
    throw new Error(lastMessage || 'Unknown TRON API error');
  }

  throwIfCoolingDown() {
    const remainingMs = this.failureState.retryAtMs - Date.now();

    if (remainingMs <= 0) {
      return;
    }

    throw new Error(`TRON API cooldown active for ${Math.ceil(remainingMs / 1000)}s: ${this.failureState.message}`);
  }

  resetFailureState() {
    this.failureState = {
      attempts: 0,
      message: '',
      retryAtMs: 0
    };
  }

  registerFailure(message) {
    if (!this.shouldCooldown(message)) {
      this.resetFailureState();
      return;
    }

    const attempts = this.failureState.message === message
      ? Math.min(this.failureState.attempts + 1, 10)
      : 1;

    this.failureState = {
      attempts,
      message,
      retryAtMs: Date.now() + this.getCooldownMs(message, attempts)
    };
  }

  extractAxiosErrorMessage(error) {
    if (error?.response?.data?.error) {
      return String(error.response.data.error);
    }

    if (error?.response?.data?.message) {
      return String(error.response.data.message);
    }

    if (error?.response?.status) {
      return `HTTP ${error.response.status}`;
    }

    if (error?.message) {
      return String(error.message);
    }

    return 'Unknown TRON API error';
  }

  shouldCooldown(message) {
    return /eai_again|enotfound|timeout|timed out|temporar|busy|gateway|502|503|504|429|rate limit|too many requests|econnreset|etimedout|socket hang up|network error/i.test(String(message || ''));
  }

  isRetryableError(message) {
    return /eai_again|enotfound|timeout|timed out|temporar|busy|gateway|502|503|504|429|rate limit|too many requests|econnreset|etimedout|socket hang up|network error/i.test(String(message || ''));
  }

  getCooldownMs(message, attempts) {
    const baseMs = /429|rate limit|too many requests/i.test(String(message || ''))
      ? this.cooldownBaseMs
      : Math.max(5_000, Math.floor(this.cooldownBaseMs / 2));

    return Math.min(this.cooldownMaxMs, baseMs * 2 ** Math.max(0, attempts - 1));
  }

  getBackoffMs(attempt) {
    return Math.min(2_500, 300 * 2 ** attempt);
  }
}

module.exports = {
  TronClient
};
