require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-conversation');
const merge = require('deepmerge');
const CJSON = require('circular-json');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware) {

  // Database handler
  var database = require('../../database')(controller, middleware);
  var chat = require('./chat')();

  function handleChatEvent(event, stopListening) {
    console.log('"event": %s', CJSON.stringify(event))
  }

  // Convert actions to buttons
  function actionToButton(action, callback_id) {
    let button = {};

    if (action.type && action.type == 'button') {
      if (action.name) {
        button.payload = sprintf('%s:%s', callback_id, action.name);
      }

      if (action.text) {
        button.title = action.text;
      }

      button.type = 'postback';
    }

    return button;
  }

  // Convert Slack attachment into Facebook element
  function attachmentToElement(attachment) {
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
        buttons.push(actionToButton(action, attachment.callback_id));
      });

      element.buttons = buttons;
    }

    return element;
  }

  // Create attachment feedback button
  function createFeedbackButton(payload_id) {
    let attachment = {
      type: 'template',
      payload: {
        template_type: 'button',
        sharable: false,
        text: 'Do we need to improve the latest dialogue?',
        buttons: [{
          type: 'postback',
          text: 'Improve',
          payload: payload_id
        }]
      }
    };
  }

  // Replay to conversation
  function botConversationReply(bot, message) {
    //let debug_message = clone(message);
    //debug_message.watsonData.context.system = null;
    //debug('"message": %s', CJSON.stringify(debug_message, null, 2));

    // If we haven't logged into our account yet, do it now
    // if (chat && !chat.isLogged() && message.page && message.page == process.env.FACEBOOK_PAGE_ID) {
    //   console.log('Logging in with Facebook chat API ...')
    //   chat.login(message.page, handleChatEvent);
    // }

    if (message.watsonData.output.action && message.watsonData.output.action.attachments) {
      // Because attachments are received in Slack way,
      // they need to be converted into Facebook templates.
      var elements = [];
      let attachments = message.watsonData.output.action.attachments;
      attachments.forEach(attachment => {
        elements.push(attachmentToElement(attachment));
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

        // No feedback request if specifically removed
        let feedback_request = !(message.watsonData.output.action && message.watsonData.output.action.no_feedback);
        
        // Request for a feedback.
        let feed_attach = {}
        if (feedback_request) {
          let payload_id = sprintf('%s:%s:%s',
            'feedback',
            message.watsonData.context.conversation_id,
            message.watsonData.context.system.dialog_turn_counter);

            feed_attach = createFeedbackButton(payload_id)
        }

        bot.reply(message, {
          text: message.watsonData.output.text.join('\n'),
          attachment: feed_attach
        })
      }

      // Retrieve the user, or make a new one if doesn't exist
      let user = database.findUserOrMake(message.user, true);
      let dialogs = user.history;

      // Add a dialog info to the list of dialogs.
      // When the conversation restarts, the index
      // of dialog_turn_counter starts over again,
      // hence, previous dialogs will be overwritten,
      // and this will prevent the array to grow indefinitely.
      dialogs.splice(message.watsonData.context.system.dialog_turn_counter, 1, {
        user_input: message.watsonData.input.text,
        bot_output: message.watsonData.output.text,
        intents: message.watsonData.intents,
        entities: message.watsonData.entities,
        turn_id: message.watsonData.context.system.dialog_turn_counter,
        conversation_id: message.watsonData.context.conversation_id,
        user_id: message.user,
        date: (new Date()).toString()
      })

      //debug('"dialogs": %s', CJSON.stringify(dialogs, null, 2))

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

      let postback_ids = message.text.split(':');
      if (postback_ids[0] == 'pick_language_level') {
        let level = postback_ids[1];
        database.sendContinueToken(bot, message, {
          language_level: level
        }, () => {
          botConversationReply(bot, message);
        });
      }
      else if (postback_ids[0] == 'survey') {
        console.log('survey button clicked!');
        
        // TODO: ...
      }
      else if (postback_ids[0] == 'feedback') {
        console.log('feedback on dialog id = %s:%s', 
          postback_ids[1], postback_ids[2]);

        // TODO: ...
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

  controller.on('message_delivered', function (bot, message) {
    //debug('"delivered": %s', JSON.stringify(message))

    // message_id can be not ready yet
    var message_id_ready = setInterval(() => {
      let user = database.findUserOrMake(message.sender.id)
      if (user && user.waiting_for_message &&
        user.waiting_for_message.message_id) {

        var user_mid = user.waiting_for_message.message_id;
        // The message_delivered event can respond to multiple messages,
        // therefore we need to search for the matching one in the message list.
        let message_id = message.delivery.mids.find((mid) => {
          return mid == user_mid;
        });

        debug('"mid": %s', message_id);

        // We found a matching message
        if (message_id) {
          // Forward the pending message
          let forward_message = clone(user.waiting_for_message.forward_message);
          user.waiting_for_message = null;
          botConversationReply(bot, forward_message);
        }

        // There is a message pending, we stop this function
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