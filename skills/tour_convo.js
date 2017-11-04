var clone = require('clone');
var debug = require('debug')('pirate-talk:tour-convo');

module.exports = function (controller, middleware) {

    controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
        middleware.updateContext(message.user, {}, function () {
            const msg = clone(message);
            msg.text = 'reset';
            middleware.sendToWatson(bot, msg, function () {
                debug('Reset: ' + JSON.stringify(msg));

                var attachments = [];
                if (typeof msg.watsonData.output !== 'undefined' &&
                    typeof msg.watsonData.output.action !== 'undefined' &&
                    typeof msg.watsonData.output.action.slack !== 'undefined') {
                    //bot.reply(msg, msg.watsonData.output.action.slack);

                    if (typeof msg.watsonData.output.action.slack.attachments !== 'undefined')
                        attachments = msg.watsonData.output.action.slack.attachments;
                }

                // wrap dialog output into attachments
                attachments.push({
                    mrkdwn_in: ['text'],
                    text: msg.watsonData.output.text.join('\n')
                });

                //debug('Attachments: ' + JSON.stringify(attachments));
                bot.reply(msg, {
                    attachments
                });

            });
        });
    });
    
    controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    
        middleware.interpret(bot, message, function () {
            console.log('Message: ' + JSON.stringify(message));
            if (message.watsonError) {
                console.log(message.watsonError);
                bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
            } else {
                //console.log('Watson: ' + JSON.stringify(message.watsonData));
                var attachments = [];
                if (typeof message.watsonData.output !== 'undefined' &&
                    typeof message.watsonData.output.action !== 'undefined' &&
                    typeof message.watsonData.output.action.slack !== 'undefined') {
                    //bot.reply(message, message.watsonData.output.action.slack);

                    if (typeof message.watsonData.output.action.slack.attachments !== 'undefined')
                        attachments = message.watsonData.output.action.slack.attachments;
                }

                // wrap dialog output into attachments
                attachments.push({
                    mrkdwn_in: ['text'],
                    text: message.watsonData.output.text.join('\n')
                });

                //console.log('Attachments: ' + JSON.stringify(attachments));
                bot.reply(message, {
                    attachments
                });
            }
        });
    });

}