require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-conversation');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (database) {

  // Convert actions to buttons
  function actionToButton(action, callback_id, conversation_id, user_id) {
    let button = {};

    if (action.type && action.type == 'button') {

      if (action.text) {
        button.title = action.text;
      }

      if (callback_id == 'survey') {
        button.type = 'web_url';
        button.messenger_extensions = true,
          button.webview_height_ratio = 'compact',
          button.url = sprintf('%s/facebook/webviews/survey_form.html?%s.%s.%s',
            process.env.WEBSERVER_HOSTNAME, callback_id, user_id, conversation_id)
      } else if (callback_id == 'pick_language_level') {
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

  function sendMessageToUser(bot, message, user) {
    if (!user) return;

    // Create a waiting_for_message object.
    user.waiting_for_message = {
      source_message_id: message.mid
    };

    // If attachments exist, then, process them separately and in advance.
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

      // Skeleton of a generic template
      let attachment = {
        type: 'template',
        payload: {
          template_type: 'generic',
          sharable: false,
          elements: elements
        }
      };

      // Before creating a pending message, remove the attachments,
      // otherwise the function will keep calling itself indefinitely
      let pending_message = clone(message);
      pending_message.watsonData.output.action.attachments = null;

      // We have a message to forward, once
      // the source one has been delivered
      user.waiting_for_message.forward_message = pending_message;

      // Because messages with attachments can take time to be delivered,
      // they may arrive out of order, while, we want to make sure messages
      // are delivered in order. Therefore, we attach a message to the user's
      // object to check later, when a 'message_delivered' event is received.

      bot.reply(message, {
        attachment: attachment
      }, (err, sent) => {
        if (!(sent && user.waiting_for_message)) return;
        user.waiting_for_message.final_message_id = sent.message_id;
      });
    }
    // If no attachments need to be processed, then
    // proceed to respond with a simple text message.
    // Send reply to the user, text can't be empty
    else if (message.watsonData.output.text.length > 0) {
      let text_message = message.watsonData.output.text.join('\n')

      // No feedback request if specifically removed
      let feedback_request = !(message.watsonData.output.action && message.watsonData.output.action.no_feedback);

      // Request for a feedback
      if (feedback_request) {
        let payload_id = sprintf('%s.%s.%s.%s', 'feedback',
          message.user, message.watsonData.context.conversation_id,
          message.watsonData.context.system.dialog_turn_counter);

        let feed_attach = createFeedbackButton(payload_id, text_message)
        debug('"feed_attachment": %s', JSON.stringify(feed_attach))

        bot.reply(message, {
          attachment: feed_attach
        }, (err, sent) => {
          if (!(sent && user.waiting_for_message)) return;
          user.waiting_for_message.final_message_id = sent.message_id;
        })
      }
      // Answer with no feedback request
      else {
        bot.reply(message, {
          text: text_message
        }, (err, sent) => {
          if (!(sent && user.waiting_for_message)) return;
          user.waiting_for_message.final_message_id = sent.message_id;
        })
      }

      // Store latest conversation dialog into user's history
      database.addDialogToUserHistory(message);
    }
    // If, for whatever reason the message will never be delivered,
    // the waiting_for_message property has to be nullified, not to
    // block all next messages which can be valid at this point.
    else {
      user.waiting_for_message = null;
    }
  }

  // Replay to conversation
  function botConversationReply(bot, message) {
    //let debug_message = clone(message);
    //debug_message.watsonData.context.system = null;
    //debug('"message": %s', CJSON.stringify(debug_message, null, 2));

    var user = database.findUserOrMake(message.user);
    if (!user) return console.error('No user defined as recipient');

    var waiting_handler = setInterval(() => {
      if (!(user.waiting_for_message) ||
        (user.waiting_for_message &&
          !(user.waiting_for_message.final_message_id ||
            user.waiting_for_message.source_message_id))) {
        clearInterval(waiting_handler);

        // Send message replies
        sendMessageToUser(bot, message, user);

        // At this point we need to check whether a jump
        // is needed to continue with the conversation.
        // If so, upgrade Watson context and sand it to
        // the service to continue with the conversation.
        if (message.watsonData.output.action &&
          message.watsonData.output.action.wait_before_jump) {
          database.sendContinueToken(bot, message, {}, () => {
            botConversationReply(bot, message);
          });
        }
      }
    }, 200);
  }

  function checkOrIgnore(bot, message) {
    let user = database.findUserOrMake(message.user, true)
    if (user.waiting_for_message) {
      return false;
    }

    // Create a placeholder waiting_for_message object.
    user.waiting_for_message = {};

    return true;
  }
  
  function handleConversationMessge(bot, message) {
    debug('"handled_message": %s', JSON.stringify(message));
    
    if (message.watsonError) {
      console.error(message.watsonError);
      
      let user = database.findUserOrMake(message.user);
      if (user) {
        user.waiting_for_message = null;
      }
      
      bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
    } else {
      bot.startTyping(message, function () {});
      botConversationReply(bot, message);
      bot.stopTyping(message, function () {});
    }
  }

  return {
    handleReceivedMessage: handleConversationMessge,
    checkMessage: checkOrIgnore,
    sendMessageReplay: sendMessageToUser
  }
}