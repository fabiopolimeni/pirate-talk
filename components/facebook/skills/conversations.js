require('dotenv').load()

var clone = require('clone');
var debug = require('debug')('pirate-talk:conversation');
var merge = require('deepmerge');
var CJSON = require('circular-json');
var sprintf = require('sprintf-js').sprintf;

var mongo = require('botkit-storage-mongo')({
  mongoUri: process.env.MONGO_URI, tables: [
    'workspaces', 'feedbacks', 'surveys'
  ]
});

module.exports = function (controller, middleware) {
  
  // Database hanlder
  var database = require('../../database')(controller, middleware);

  // Convert actions to buttons
  function actionToButton(action, callback_id) {
    let button = {};

    if (action.type && action.type == 'button') {
      if (action.name) {
        button.payload = sprintf('%s:%s',
        callback_id, action.name);
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

  // Replay to conversation
  function botConversationReply(bot, message) {
    let debug_message = clone(message);
    debug_message.watsonData.context.system = null;
    debug('"message": %s', CJSON.stringify(debug_message, null, 2));

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
      // we want to remove them from the message we want to forward.
      let pending_message = clone(message);
      if (pending_message.watsonData.output.action.attachments) {
        pending_message.watsonData.output.action.attachments = null;
      }

      // Retrieve the user, or make a new one if doesn't exist
      let user = database.findUserOrMake(message.user, true);
      user.waiting_for_message = {
        forward_message: pending_message
      };

      debug('"attachment": %s', CJSON.stringify(attachment));
      bot.reply(message, {attachment: attachment}, (err, sent_message) => {
        debug('"sent": %s', CJSON.stringify(sent_message));
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
      // Construct the replay message
      var reply_message = {
        text: message.watsonData.output.text.join('\n')
      };

      // Send reply to the user, text can't be empty
      if (reply_message.text)
        bot.reply(message, reply_message);
      
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
    debug('"language": %s', JSON.stringify(message));
    // Since event handler aren't processed by middleware and have no watsonData 
    // attribute, the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function(err, context) {
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
        // TODO: ...
      }
    });
  });

  // Handle reset special case
  controller.hears(['reset'], 'message_received', function (bot, message) {
    middleware.updateContext(message.user, {}, function (context) {
      let reset_request = clone(message);
      reset_request.text = 'reset';
      middleware.sendToWatson(bot, reset_request, { }, function() {
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
      }
      else {
        bot.startTyping(message, function(){});
        botConversationReply(bot, message);
        bot.stopTyping(message, function(){});
      }
    });
  });

  controller.on('message_delivered', function (bot, delivered_message) {
    //debug('"delivered": %s', JSON.stringify(delivered_message))
    //debug('"users": %s', CJSON.stringify(database.users, null, 2))

    // Lookup for messages waiting for delivering
    var user = database.findUserOrMake(delivered_message.sender.id)
    if (user && user.waiting_for_message) {

      // message_id can be not ready yet
      var message_id_ready = setInterval(() => {
        if (user.waiting_for_message.message_id) {
          var user_mid = user.waiting_for_message.message_id;

          // The message_delivered event can responde to multiple messages,
          // thereofre we need to search for the matching one in the message list.
          let message_id = delivered_message.delivery.mids.find((mid) => {
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
          // to be exectued in a time loop, even the pending
          // message is not the one we were looking for.
          clearInterval(message_id_ready);
        }
      }, 500);
    }
  });

}