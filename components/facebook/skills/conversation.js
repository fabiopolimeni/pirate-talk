require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-conversation');
const merge = require('deepmerge');
const CJSON = require('circular-json');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware) {

  // Database handler
  var database = require('../../database')(controller, middleware);

  // Convert actions to buttons
  function actionToButton(action, callback_id, conversation_id, user_id) {
    let button = {};

    if (action.type && action.type == 'button') {
      
      if (action.text) {
        button.title = action.text;
      }

      if (callback_id == 'survery') {
        button.type = 'web_url';
        button.messenger_extensions = true,
        button.webview_height_ratio = 'compact',
        button.url = sprintf('%s/facebook/webviews/survey_form.html?%s.%s.%s', 
          process.env.WEBSERVER_HOSTNAME, callback_id, user_id, conversation_id)
      }
      else if (callback_id == 'pick_language_level') {
        button.type = 'postback';
        if (action.name) {
          button.payload = sprintf('%s.%s', callback_id, action.name);
        }
      }
    }

    return button;
  }

  // Convert Slack attachment into Facebook element
  function attachmentToElement(attachment, conversation_id, user_id) {
    let element = {};

    if (attachment.image_url) {
      element.image_url = attachment.image_url;
    }

    element.title = (attachment.title) ?
      attachment.title : attachment.fallback;

    element.subtitle = (attachment.text) ?
      attachment.text : ' ';

    if (attachment.actions && attachment.callback_id) {
      var buttons = [];
      attachment.actions.forEach(action => {
        buttons.push(actionToButton(action, attachment.callback_id, conversation_id, user_id));
      });

      element.buttons = buttons;
    }

    return element;
  }
  
  // Create attachment feedback button
  function createFeedbackButton(payload_id, reply_text) {
    let attachment = {
      type: 'template',
      payload: {
        template_type: 'button',
        text: reply_text,
        buttons: [{
          title: 'Improve this',
          type: 'web_url',
          messenger_extensions: true,
          url: sprintf('%s/facebook/webviews/feedback_form.html?%s',
            process.env.WEBSERVER_HOSTNAME, payload_id),
          webview_height_ratio: 'compact'
        }]
      }
    };
    
    return attachment;
  }

  // Replay to conversation
  function botConversationReply(bot, message) {
    //let debug_message = clone(message);
    //debug_message.watsonData.context.system = null;
    //debug('"message": %s', CJSON.stringify(debug_message, null, 2));

    if (message.watsonData.output.action && message.watsonData.output.action.attachments) {
      // Because attachments are received in Slack way,
      // they need to be converted into Facebook templates.
      var elements = [];
      let attachments = message.watsonData.output.action.attachments;
      attachments.forEach(attachment => {
        elements.push(attachmentToElement(
          attachment,
          message.watsonData.context.conversation_id,
          message.user
        ));
      });

      let attachment = {
        type: 'template',
        payload: {
          template_type: 'generic',
          sharable: false,
          elements: elements
        }
      };

      // Because attachments have already been process at this point,
      // we want to remove them from the message to forward.
      let pending_message = clone(message);
      pending_message.watsonData.output.action.attachments = null;

      // Retrieve the user, or make a new one if doesn't exist
      let user = database.findUserOrMake(message.user, true);
      user.waiting_for_message = {
        forward_message: pending_message
      };

      bot.reply(message, {
        attachment: attachment
      }, (err, sent_message) => {
        if (!sent_message) return;

        // Because messages with attachments can take time to be delivered,
        // they can arrive out of order, while want to make sure messages are
        // delivered in order. Therefore, we attach a message to the user's
        // to check when a 'message_delivered' event is received.

        // Retrieve the user, or make a new one if doesn't exist
        let user = database.findUserOrMake(sent_message.recipient_id);
        user.waiting_for_message.message_id = sent_message.message_id;
      });
    }
    // If no attachments need to be processed, then
    // proceed to respond with a simple text message.
    else {
      
      // Send reply to the user, text can't be empty
      if (message.watsonData.output.text.length > 0) {
        let text_message = message.watsonData.output.text.join('\n')
        
        // No feedback request if specifically removed
        let feedback_request = !(message.watsonData.output.action && message.watsonData.output.action.no_feedback);
        
        // Request for a feedback.
        if (feedback_request) {
          let payload_id = sprintf('%s.%s.%s.%s', 'feedback',
            message.user, message.watsonData.context.conversation_id,
            message.watsonData.context.system.dialog_turn_counter);

          let feed_attach = createFeedbackButton(payload_id, text_message)
          console.log('"feed_attachment": %s', JSON.stringify(feed_attach))
          bot.reply(message, { attachment: feed_attach })
        }
        // Answer with no feedback request
        else {
          bot.reply(message, { text: text_message })
        }
      }

      // Store latest conversation dialog into user's history
      database.addMessageToUserHistory(message);

      // At this point we need to check whether a jump is needed to continue with the conversation.
      // If it is needed, then, upgrade Watson context and sand it back to continue to the next dialog.
      if (message.watsonData.output.action && message.watsonData.output.action.wait_before_jump) {
        database.sendContinueToken(bot, message, {}, () => {
          botConversationReply(bot, message);
        });
      }
    }
  }

  // Handle button postbacks
  controller.hears(['.*'], 'facebook_postback', function (bot, message) {
    debug('"postback": %s', JSON.stringify(message));

    // Since events handler aren't processed by middleware and have no watsonData 
    // attribute, the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function (err, context) {
      if (!context) return;

      let postback_ids = message.text.split('.');
      if (postback_ids[0] == 'pick_language_level') {
        let level = postback_ids[1];
        database.sendContinueToken(bot, message, {
          language_level: level
        }, () => {
          botConversationReply(bot, message);
        });
      }
    });
  });

  // Handle reset special case
  controller.hears(['reset'], 'message_received', function (bot, message) {
    middleware.updateContext(message.user, {}, function (context) {
      let reset_request = clone(message);
      reset_request.text = 'reset';
      middleware.sendToWatson(bot, reset_request, {}, function () {
        botConversationReply(bot, reset_request);
      });
    });
  });

  // Handle common cases with  Watson conversation
  controller.hears(['.*'], 'message_received', function (bot, message) {
    middleware.interpret(bot, message, function () {
      if (message.watsonError) {
        console.error(message.watsonError);
        bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
      } else {
        bot.startTyping(message, function () {});
        botConversationReply(bot, message);
        bot.stopTyping(message, function () {});
      }
    });
  });

  controller.on('form_received', function (bot, body) {
    console.log('"form_received": %s', CJSON.stringify(body))
    if (!body.payload_id) return;
    
    let tokens = body.payload_id.split('.');
    if(body.suggestion && tokens.length >= 4) {
      let message = {
        action: tokens[0],
        user: tokens[1],
        conversation: tokens[2],
        turn: tokens[3],
        suggestion: {
          what: 'response',
          how: body.suggestion.trim()
        }
      };
    }
    else if (body.comment && tokens.length >= 3) {
      let message = {
        action: tokens[0],
        user: tokens[1],
        conversation: tokens[2],
        comment: body.comment.trim()
      };
    }
  });

  controller.on('message_delivered', function (bot, message) {
    //debug('"delivered": %s', JSON.stringify(message))

    // message_id can be not ready yet
    var message_id_ready = setInterval(() => {
      let user = database.findUserOrMake(message.sender.id)
      if (user && user.waiting_for_message &&
        user.waiting_for_message.message_id) {

        // The message_delivered event can respond to multiple messages,
        // therefore we need to search for the matching one in the list.
        let message_id = message.delivery.mids.find((mid) => {
          return mid == user.waiting_for_message.message_id;
        });

        debug('"mid": %s', message_id);

        // We found a matching message
        if (message_id) {
          // Forward the pending message
          let forward_message = clone(user.waiting_for_message.forward_message);
          user.waiting_for_message = null;
          botConversationReply(bot, forward_message);
        }

        // There is a pending message, we stop this function
        // to be executed in a time loop, even the pending
        // message is not the one we were looking for.
        clearInterval(message_id_ready);
      }
    }, 500);
  });

  // look for sticker, image and audio attachments
  // capture them, and fire special events
  controller.on('message_received', function (bot, message) {

    debug('"received": %s', JSON.stringify(message))
    if (!message.text) {
      if (message.sticker_id) {
        controller.trigger('sticker_received', [bot, message]);
        return false;
      } else if (message.attachments && message.attachments[0]) {
        controller.trigger(message.attachments[0].type + '_received', [bot, message]);
        return false;
      }
    }

  });

  controller.on('sticker_received', function (bot, message) {
    bot.reply(message, 'Cool sticker.');
  });

  controller.on('image_received', function (bot, message) {
    bot.reply(message, 'Nice picture.');
  });

  controller.on('audio_received', function (bot, message) {
    bot.reply(message, 'I heard that!!');
  });

}
