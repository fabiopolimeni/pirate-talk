var clone = require('clone');
var debug = require('debug')('pirate-talk:sample-hears');

module.exports = function (controller, middleware) {

  controller.hears(['^hello$'], ['direct_message, direct_mention, mention'], function (bot, message) {
    bot.reply(message, "Hi there, you're on workspace: " + message.team)
  });

  controller.hears(['say'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    debug('Say: ' + JSON.stringify(message));
    bot.say({
      text: "Does anyone want to talk to me? Contact me in private <@U7UBP24P7>",
      channel: "D7UBP2605"
    });
  });

  controller.hears(['card'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    debug('Card: ' + JSON.stringify(message));
    bot.reply(message, {
      attachments: [{
        "mrkdwn_in": ["text"],
        text: 'This is _what_ the guide will say! It can be short or long.'
      }, {
        text: 'Second attachment',
        callback_id: 'yes_no',
        actions: [{
          "name": "yes",
          "text": "Yes",
          "value": "yes",
          "type": "button",
        }, {
          "name": "no",
          "text": "No",
          "value": "no",
          "type": "button",
        }]
      }]
    });
  });

};