const { NETWORKS, NETWORK_LABELS, NETWORK_SYMBOLS, coerceNetwork } = require('./constants');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function shortHash(hash, size = 8) {
  if (!hash || hash.length <= size * 2) {
    return hash;
  }

  return `${hash.slice(0, size)}...${hash.slice(-size)}`;
}

function getWalletUrl(network, address) {
  const resolvedNetwork = coerceNetwork(network);

  if (resolvedNetwork === NETWORKS.BEP20) {
    return `https://bscscan.com/address/${address}`;
  }

  return `https://tronscan.org/#/address/${address}`;
}

function getTxUrl(network, txHash) {
  const resolvedNetwork = coerceNetwork(network);

  if (resolvedNetwork === NETWORKS.BEP20) {
    return `https://bscscan.com/tx/${txHash}`;
  }

  return `https://tronscan.org/#/transaction/${txHash}`;
}

function getTokenUrl(network) {
  const resolvedNetwork = coerceNetwork(network);

  if (resolvedNetwork === NETWORKS.BEP20) {
    return 'https://bscscan.com/token/0x55d398326f99059ff775485246999027b3197955';
  }

  return 'https://tronscan.org/#/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
}

function formatAmount(amount) {
  return Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatAlertMessage({ wallet, tx, botUsername }) {
  const resolvedNetwork = coerceNetwork(wallet.network) || wallet.network;
  const networkLabel = NETWORK_LABELS[resolvedNetwork] || wallet.network;
  const networkSymbol = NETWORK_SYMBOLS[resolvedNetwork] || wallet.network;
  const walletUrl = getWalletUrl(resolvedNetwork, wallet.address);
  const txUrl = getTxUrl(resolvedNetwork, tx.hash);
  const tokenUrl = getTokenUrl(resolvedNetwork);
  const txHashShort = shortHash(tx.hash, 10);

  const walletAnchor = `<a href=\"${walletUrl}\">${escapeHtml(wallet.name)}</a>`;
  const actionLabel = tx.direction === 'OUT' ? 'Отправлено' : 'Получено';
  const counterpartyLabel = tx.direction === 'OUT' ? 'На' : 'От';

  let editPart = '';

  if (botUsername) {
    const editLink = `https://t.me/${botUsername}?start=edit_wallet_${wallet.id}`;
    editPart = ` | <a href=\"${editLink}\">✏️</a>`;
  }

  let counterpartyText = '';
  if (tx.counterpartyName && tx.counterpartyName !== tx.counterpartyAddress) {
    counterpartyText = `<a href="${tx.counterpartyUrl}">${escapeHtml(tx.counterpartyName)}</a>`;
  } else {
    counterpartyText = `<a href="${tx.counterpartyUrl}">Address</a>`;
  }

  return [
    `${networkLabel} ${walletAnchor} · ${networkSymbol}${editPart}`,
    `${actionLabel}: <a href="${tokenUrl}">${formatAmount(tx.amount)} USDT</a> (~$${formatAmount(tx.amount)})`,
    `${counterpartyLabel}: ${counterpartyText}`,
    `<a href="${txUrl}">Tx hash</a>`
  ].join('\n');
}

function formatWalletLine(wallet) {
  const resolvedNetwork = coerceNetwork(wallet.network) || wallet.network;
  const networkLabel = NETWORK_LABELS[resolvedNetwork] || wallet.network;
  const walletUrl = getWalletUrl(resolvedNetwork, wallet.address);

  return `${wallet.id}. ${networkLabel} · <a href=\"${walletUrl}\">${escapeHtml(wallet.name)}</a>\n<code>${escapeHtml(wallet.address)}</code>`;
}

module.exports = {
  escapeHtml,
  formatAlertMessage,
  formatWalletLine,
  getWalletUrl,
  shortHash
};
