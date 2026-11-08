/**
 * Обёртка над ботом: библиотека не ловит ошибки async-обработчиков, поэтому
 * сбой отправки (например, пользователь заблокировал бота) стал бы
 * необработанным reject и мог уронить процесс.
 */
function withErrorBoundary(bot, onError = defaultOnError) {
  const guard = (handler) => async (...args) => {
    try {
      await handler(...args);
    } catch (error) {
      onError(error);
    }
  };

  return new Proxy(bot, {
    get(target, property) {
      if (property === 'onText') {
        return (pattern, handler) => target.onText(pattern, guard(handler));
      }

      if (property === 'on') {
        return (event, handler) => target.on(event, guard(handler));
      }

      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function defaultOnError(error) {
  console.error('[bot] handler failed', error.message);
}

module.exports = {
  withErrorBoundary
};
