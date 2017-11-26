require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-hearing');

module.exports = function (controller, middleware, database) {

  // Conversation manager
  var conv = require('../conversation')(database);

  // Handle reset special case
  controller.hears(['reset'], 'message_received', function (bot, message) {
    if (!conv.checkMessage(bot, message)) return;
    middleware.updateContext(message.user, {}, function (context) {
      let reset_message = clone(message);
      reset_message.text = 'reset';
      middleware.sendToWatson(bot, reset_message, {}, function () {
        conv.handleReceivedMessage(bot, reset_message);
      });
    });
  });

  // Handle common cases with  Watson conversation
  controller.hears(['.*'], 'message_received', function (bot, message) {
    if (!conv.checkMessage(bot, message)) return;
    middleware.interpret(bot, message, function () {
      conv.handleReceivedMessage(bot, message);
    });
  });

  controller.on('message_delivered', function (bot, message) {
    debug('"delivered": %s', JSON.stringify(message))
    let user = database.findUserOrMake(message.sender.id)
    if (user && user.waiting_for_message &&
      user.waiting_for_message.final_message_id) {

      // The message_delivered event can respond to multiple messages,
      // therefore we need to search for the matching one in the list.
      let matched_id = message.delivery.mids.find((mid) => {
        return mid == user.waiting_for_message.final_message_id;
      });

      // We found a matching message
      if (matched_id) {
        // Forward the pending message
        let forward_message = clone(user.waiting_for_message.forward_message);

        user.waiting_for_message = null;
        if (forward_message) {
          conv.sendMessageReply(bot, forward_message);
        }
      }
    }
  });

}