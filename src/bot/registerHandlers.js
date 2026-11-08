const { createActions } = require('./actions');
const { registerCallbacks } = require('./callbacks');
const { registerCommands } = require('./commands');
const { createConversation } = require('./conversation');
const { withErrorBoundary } = require('./errorBoundary');
const { registerMenuButtons } = require('./menuButtons');

function registerHandlers({ bot: rawBot, stateRepository, defaultThreshold, monitorService, now, onError }) {
  const bot = withErrorBoundary(rawBot, onError);
  const actions = createActions({ bot, stateRepository, monitorService, defaultThreshold, now });
  const conversation = createConversation({ bot, stateRepository, actions });
  const context = { bot, stateRepository, defaultThreshold, actions, conversation };

  registerCommands(context);
  registerCallbacks(context);
  registerMenuButtons(context);
}

module.exports = {
  registerHandlers
};
