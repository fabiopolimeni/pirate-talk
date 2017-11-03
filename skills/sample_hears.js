var clone = require('clone');

module.exports = function(controller, middleware) {

    controller.hears(['^hello$'], ['direct_message, direct_mention, mention'], function(bot, message) {
        bot.reply(message, "Hi there, you're on workspace: " + message.team)
    });
    
    controller.hears(['say'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
      console.log('Say: ' + JSON.stringify(message));
      botsays(bot, {
        text: "Does anyone want to talk to me? Contact me in private <@U7UBP24P7>",
        channel : "D7UBP2605"
      });
    });
    
    controller.hears(['card'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
      console.log('Card: ' + JSON.stringify(message));
      bot.reply(message, {
        attachments:[{
          "mrkdwn_in": ["text"],
          text : 'This is _what_ the guide will say! It can be short or long.'
        },{
          text: 'Second attachment',
          callback_id : 'yes_no',
          actions: [{
            "name":"yes",
            "text": "Yes",
            "value": "yes",
            "type": "button",
          },{
            "name":"no",
            "text": "No",
            "value": "no",
            "type": "button",
          }]
        }]
      });
    });

    controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
      middleware.updateContext(message.user, { }, function() {
        const msg = clone(message);
        msg.text = 'reset';    
        middleware.sendToWatson(bot, msg, function() {
          console.log('Reset: ' + JSON.stringify(msg));

          var attachments = [];
          if (typeof msg.watsonData.output !== 'undefined'
             && typeof msg.watsonData.output.action !== 'undefined'
             && typeof msg.watsonData.output.action.slack !== 'undefined') {
            //bot.reply(msg, msg.watsonData.output.action.slack);

            if (typeof msg.watsonData.output.action.slack.attachments !== 'undefined')
              attachments = msg.watsonData.output.action.slack.attachments;
          }

          // wrap dialog output into attachments
          attachments.push({
            mrkdwn_in : ['text'],
            text : msg.watsonData.output.text.join('\n')
          });

          //console.log('Attachments: ' + JSON.stringify(attachments));
          bot.reply(msg, {attachments});

        });
      });
    });

    controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
      middleware.interpret(bot, message, function() {
        console.log('Message: ' + JSON.stringify(message));
        if (message.watsonError) {
          console.log(message.watsonError);
          bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
        } else {
          //console.log('Watson: ' + JSON.stringify(message.watsonData));
          var attachments = [];
          if (typeof message.watsonData.output !== 'undefined'
             && typeof message.watsonData.output.action !== 'undefined'
             && typeof message.watsonData.output.action.slack !== 'undefined') {
            //bot.reply(message, message.watsonData.output.action.slack);

            if (typeof message.watsonData.output.action.slack.attachments !== 'undefined')
              attachments = message.watsonData.output.action.slack.attachments;
          }

          // wrap dialog output into attachments
          attachments.push({
            mrkdwn_in : ['text'],
            text : message.watsonData.output.text.join('\n')
          });

          //console.log('Attachments: ' + JSON.stringify(attachments));
          bot.reply(message, {attachments});
        }
      });
    });

};
