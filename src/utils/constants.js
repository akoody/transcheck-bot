const NETWORKS = {
  BEP20: 'BEP20',
  TRC20: 'TRC20'
};

const NETWORK_LABELS = {
  [NETWORKS.BEP20]: 'BEP 20',
  [NETWORKS.TRC20]: 'TRC 20'
};

const NETWORK_SYMBOLS = {
  [NETWORKS.BEP20]: 'BNB',
  [NETWORKS.TRC20]: 'TRX'
};

const KNOWN_EXCHANGES = {
  [NETWORKS.BEP20]: {
    '0xef3aeff9a5f61c6dda33069c58c1434006e13b20': 'Binance',
    '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance',
    '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance',
    '0x0000000000000000000000000000000000000000': 'Burn Address'
  },
  [NETWORKS.TRC20]: {}
};

function coerceNetwork(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (['bep20', 'bsc', 'bnb'].includes(normalized)) {
    return NETWORKS.BEP20;
  }

  if (['trc20', 'tron', 'trx'].includes(normalized)) {
    return NETWORKS.TRC20;
  }

  return null;
}

module.exports = {
  coerceNetwork,
  NETWORKS,
  NETWORK_LABELS,
  NETWORK_SYMBOLS,
  KNOWN_EXCHANGES
};
