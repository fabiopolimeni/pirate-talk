require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-conversation');
const CJSON = require('circular-json');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware) {

  // Database handler
  var database = require('../../database')(controller, middleware);

  // Speech services
  var speech = require('../../audio/speech');

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

  function sendMessage(bot, message, user) {

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
      // otherwise the function will keep calling itself indefinitely.
      let pending_message = clone(message);
      pending_message.watsonData.output.action.attachments = null;

      // We have a message to forward, once
      // the source one has been delivered.
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

      // Request for a feedback.
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
        sendMessage(bot, message, user);

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

  // Handle reset special case
  controller.hears(['reset'], 'message_received', function (bot, message) {
    if (!checkOrIgnore(bot, message)) return;
    middleware.updateContext(message.user, {}, function (context) {
      let reset_message = clone(message);
      reset_message.text = 'reset';
      middleware.sendToWatson(bot, reset_message, {}, function () {
        botConversationReply(bot, reset_message);
      });
    });
  });
  
  function handleConversationMessge(bot, message) {
    console.log('"handled_message": %s', JSON.stringify(message));
    if (!checkOrIgnore(bot, message)) return;
    middleware.interpret(bot, message, function () {
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
    });
  }

  // Handle common cases with  Watson conversation
  controller.hears(['.*'], 'message_received', function (bot, message) {
    handleConversationMessge(bot, message);
  });
  
  controller.on('audio_transcript', function(bot, message) {
    handleConversationMessge(bot, message)
  });

  // Handle button postbacks
  controller.hears(['.*'], 'facebook_postback', function (bot, message) {
    debug('"postback": %s', JSON.stringify(message));
    if (!checkOrIgnore(bot, message)) return;
    
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

  controller.on('message_delivered', function (bot, message) {
    debug('"delivered": %s', JSON.stringify(message))

    let user = database.findUserOrMake(message.sender.id)
    if (user && user.waiting_for_message && user.waiting_for_message.final_message_id) {

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
          sendMessage(bot, forward_message, user);
        }
      }
    }
  });

  controller.on('form_received', function (bot, body) {
    debug('"form_received": %s', CJSON.stringify(body))
    if (!body.payload_id) return;

    // Query string received from HTTP request is in
    // the form of action.user.conversation.<turn>.
    // For some reason facebook wouldn't parse correctly
    // a typical url query, such ?name=value&something=else,
    // This is why I had to pick such fixed query format.
    // I used '.' instead of ':' because the latter is a non
    // standard URL character, it is reserved, hence, not
    // to be used within URL query strings.
    let tokens = body.payload_id.split('.');

    // Survey form submit
    if (body.suggestion && tokens.length >= 4) {
      let message = {
        user: tokens[1],

        // Reconstruct the callback_id as expected by the db interface.
        callback_id: sprintf('%s:%s', tokens[2], tokens[3]),

        // Not really used, though useful
        // info to look at debugging time.
        submission: {
          action: tokens[0],
          conversation: tokens[2],
          turn: tokens[3],
        },

        // On facebook we set a feedback and the suggestion
        // at the same time, so we incorporate these at once.
        suggestion: {
          what: 'response',
          how: body.suggestion.trim()
        },

        // This indicates the feedback on the conversation.
        // If we want to distinguish between different types
        // of user's feedback, then we need to incorporate these
        // into the URL query.
        text: 'maybe'
      };

      middleware.readContext(message.user, function (err, context) {
        if (context) {
          database.handleFeedbackSubmit(bot, message, context,
            function replyToUser(bot, message, stored) {
              let header = sprintf('The feedback: (%s)\nfor user: (%s)\nwith dialog: (%s)\n',
                CJSON.stringify(message), message.user, message.callback_id);

              let output = stored ?
                debug('%s has been successfully saved! :)', header) :
                debug('%s has not been saved! :(', header);
            });
        }
      });
    }
    // Feedback form submit
    else if (body.comment && tokens.length >= 3) {
      var message = {
        user: tokens[1],
        submission: {
          action: tokens[0],
          conversation: tokens[2],
          comment: body.comment.trim()
        }
      };

      middleware.readContext(message.user, function (err, context) {
        if (context) {
          database.handleSurveySubmit(bot, message, context,
            function replyToUser(bot, message, stored) {
              let header = sprintf('The survey: (%s)\nfor user: (%s)\n',
                CJSON.stringify(message), message.user);

              if (stored) {
                debug('%s has been successfully saved! :)', header)
              }
              else {
                debug('%s has not been saved! :(', header);
              }
            });
        }
      });
    }
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
    debug('"audio_data": %s', JSON.stringify(message))

    let data = message.attachments[0];
    speech.stt(data.payload.url, (err, transcript) => {

      if (err) {
        return bot.reply(message, 
          "Sorry, I couldn't hear you very well, can you say it again please?");
      }
      else {
        bot.reply(message, transcript.text);
      }

      let reroute_message = clone(message);

      // We need to remove the attachments from the message
      // received substituting it with the transcript text. 
      if (reroute_message.message.attachments) {
        reroute_message.message.attachments = undefined;
        reroute_message.message.text = transcript.text;
      }

      if (reroute_message.attachments) {
        reroute_message.attachments = undefined;
        reroute_message.text = transcript.text;
      }

      if (reroute_message.raw_message.message.attachments) {
        reroute_message.raw_message.message.attachments = undefined;
        reroute_message.raw_message.message.text = transcript.text;
      }

      debug('"reroute": %s', JSON.stringify(reroute_message))
      controller.trigger('audio_transcript', [bot, reroute_message]);
    });
  });

}