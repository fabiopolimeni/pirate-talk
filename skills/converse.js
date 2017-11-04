var clone = require('clone');
var debug = require('debug')('pirate-talk:converse');

module.exports = function (controller, middleware) {

  var attachments = [];
  function bot_reply(bot, msg) {
    console.log('Message: ' + JSON.stringify(msg));

    attachments = [];
    if (typeof msg.watsonData.output !== 'undefined' &&
      typeof msg.watsonData.output.action !== 'undefined' &&
      typeof msg.watsonData.output.action.slack !== 'undefined') {
      
      if (typeof msg.watsonData.output.action.slack.attachments !== 'undefined')
        attachments = msg.watsonData.output.action.slack.attachments;
    }
  
    // wrap dialog output into attachments
    attachments.push({
      callback_id: 'watson_reponse',
      mrkdwn_in: ['text'],
      text: msg.watsonData.output.text.join('\n'),
      actions: [{
        "name": "ok",
        "text": ":thumbsup: ",
        "value": "good",
        "type": "button",
      }, {
        "name": "soso",
        "text": ":raised_hand:",
        "value": "maybe",
        "type": "button",
      }, {
        "name": "no",
        "text": ":thumbsdown:",
        "value": "bad",
        "type": "button",
      }]
    });
  
    //debug('Attachments: ' + JSON.stringify(attachments));
    bot.reply(msg, {
      attachments
    });
  }
  
  controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.updateContext(message.user, {}, function () {
      const msg = clone(message);
      msg.text = 'reset';
      middleware.sendToWatson(bot, msg, function () {
        debug('Reset: ' + JSON.stringify(msg));
        bot_reply(bot, msg);
      });
    });
  });

  controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.interpret(bot, message, function () {
      if (message.watsonError) {
        console.error(message.watsonError);
        bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
      } else {
        debug('Watson: ' + JSON.stringify(message.watsonData));
        bot_reply(bot, message);
      }
    });
  });

  // receive an interactive message, and reply with a message that will replace the original
  controller.on('interactive_message_callback', function(bot, message) {
      // check message.actions and message.callback_id to see what action to take...
      if (message && message.callback_id && message.callback_id == 'watson_reponse') {
        var response = clone(attachments);
        response.forEach(function(item, index, arr) {
          if (item.actions)
            item.actions = null;
        });

        console.log('Response: ' + JSON.stringify(response));
        bot.replyInteractive(message, {response});
      }
  });

}