require('dotenv').load()

var clone = require('clone');
var debug = require('debug')('pirate-talk:slack-conversation');
var CJSON = require('circular-json');
var sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware) {

  // Database handler
  var database = require('../../database')(controller, middleware);

  // Main reply function, where all the logic to
  // interact with watson conversation is processed.
  function botConversationReply(bot, message) {
    debug('Message: ' + JSON.stringify(message));

    var has_attachments = false;
    if (message.watsonData.output.action && message.watsonData.output.action.attachments) {
      has_attachments = true;
      bot.reply(message, {
        attachments: message.watsonData.output.action.attachments
      });
    }

    // Construct the replay message
    var reply = {
      text: message.watsonData.output.text.join('\n'),
      attachments: []
    };

    // No feedback request if specifically removed
    var feedback_request = !(message.watsonData.output.action && message.watsonData.output.action.no_feedback);

    // Request for a feedback.
    if (feedback_request) {

      // Reply with feedback request, that is, adding action buttons
      reply.attachments.push({
        // callback_id will be in the form of: conversation_id:turn_counter.
        // This is necessary because we can have answers that are given
        // out of order, it is not necessarily last a lifo process.
        callback_id: message.watsonData.context.conversation_id.concat(
          ':', message.watsonData.context.system.dialog_turn_counter),
        mrkdwn_in: ['text'],
        text: '',
        actions: [/*{
          "name": "ok",
          "text": "Nice! :thumbsup:",
          "value": "good",
          "style": "primary",
          "type": "button"
        }, */{
          "name": "soso",
          "text": "Improve :thumbsdown:",
          "value": "maybe",
          "style": "danger",
          "type": "button"
        }]
      });
    }

    // If we have attachments to process, wait for 0.5 sec, before sending the next message.
    // Unfortunately, it doesn't seem there is a more elegant way, in Slack, to know whether
    // a message has been delivered and visible or not.
    // This is needed in order to avoid a message to be received out of order, as it will happen
    // if some of the messages are heavier than others, such as, when include media files (e.g. images).
    setTimeout(function () {
      debug('Reply: ' + JSON.stringify(reply));
      bot.reply(message, reply);

      // Store the dialog into user's history
      database.addDialogToUserHistory(message);

      // At this point we need to check whether a jump is needed to continue with the conversation.
      // If it is needed, then upgrade Watson context and sand it back to continue to the next dialog.
      if (message.watsonData.output.action && message.watsonData.output.action.wait_before_jump) {
        database.sendContinueToken(bot, message, {}, () => {
          botConversationReply(bot, message);
        });
      }

    }, (has_attachments) ? 500 : 0);
  }

  function botReplyToActionButton(bot, message, footer_msg) {
    // Update the original message, that is, the user will be 
    // notified its contribution it has been taken into account.
    bot.replyInteractive(message, {
      text: message.original_message.text,
      attachments: [{
        fallback: '',
        footer: footer_msg,
        ts: message.action_ts
      }]
    });
  }

  // Show the dialog to allow the user to provide written feedback
  function showSuggestionDialog(bot, message) {
    let dialog = bot.createDialog('Leave your suggestions', message.callback_id, 'Submit')
      // .addSelect('What we need to improve', 'what', null, [{
      //     label: 'Conversation flow',
      //     value: 'flow'
      //   },
      //   {
      //     label: 'Bot response',
      //     value: 'response'
      //   }
      // ], {
      //   placeholder: 'Select One'
      // })
      .addTextarea('How can we improve', 'how', '', {
        placeholder: 'Write your comment here'
      });

    bot.replyWithDialog(message, dialog.asObject(), function (err, res) {
      if (err) console.error('Dialog Error: %s', err);
    });
  }

  function showSurveyDialog(bot, message) {
    let dialog = bot.createDialog('Open Feedback', message.callback_id, 'Submit')
      .addTextarea('Your feedback below', 'comment', '', {
        placeholder: 'Anything you would like to tell us'
      });

    bot.replyWithDialog(message, dialog.asObject(), function (err, res) {
      if (err) {
        console.error('Dialog Error: %s', err);
        console.error('Response: %s', CJSON.stringify(res));
      }
    });
  }

  // Validate the interactive message is part of a current conversation
  function validateAndRespondToUserFeedback(bot, message, context) {
    if (!context || !message.callback_id) return;

    // Parse callback_id to extract the conversation_id
    let ids = message.callback_id.split(':', 2);
    let callback_conv_id = ids[0];

    // Check message.actions and message.callback_id to see what action to take ...
    if (callback_conv_id == context.conversation_id) {

      // Save the user feedback to database/filesystem 
      // and update buttons message with a footer message.
      database.handleFeedbackSubmit(bot, message, context, function (bot, message, stored ) {
        let footer = stored ?
        'Thanks for the feedback :clap:' :
        'Some problem occurred when storing feedback :scream:'

        botReplyToActionButton(bot, message, footer);
      });

      // If the user wants to leave some feedback,
      // then a dialog will pop up, and we will save
      // the suggestions when the form is submitted.
      if (message.actions[0].value.match(/maybe/)) {
        showSuggestionDialog(bot, message);
      }
    }
  }

  // Handle reset special case
  controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.updateContext(message.user, {}, function (context) {
      let reset_request = clone(message);
      reset_request.text = 'hello';
      middleware.sendToWatson(bot, reset_request, {}, function () {
        botConversationReply(bot, reset_request);
      });
    });
  });

  // Handle common cases with  Watson conversation
  controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.interpret(bot, message, function () {
      if (message.watsonError) {
        console.error(message.watsonError);
        bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
      } else {
        debug('"watson": ' + JSON.stringify(message.watsonData));

        bot.startTyping(message, function () {});
        botConversationReply(bot, message);
        //bot.stopTyping(message, function() { });
      }
    });
  });

  // Handle and interactive message response from buttons press
  controller.on('interactive_message_callback', function (bot, message) {
    debug('"interactive": %s', CJSON.stringify(message));
    if (!message.callback_id) return;

    // Since event handler aren't processed by middleware and have no watsonData 
    // attribute, the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function (err, context) {
      if (!context) return;

      // Store this message, that is, later we'll be able to respond to it
      let user = database.findUserOrMake(message.user, false);
      if (user) {
        user.latest_button_message = message;
      }

      // Language button
      if (message.callback_id == 'pick_language_level') {
        let level = message.actions[0].name;
        database.sendContinueToken(bot, message, {
          language_level: level
        }, () => {
          botConversationReply(bot, message);
        });

        let footer_string = sprintf("The story will be for a %s level", level);
        botReplyToActionButton(bot, message, footer_string);
      }
      // Survey button
      else if (message.callback_id == 'survey') {
        showSurveyDialog(bot, message);
      }
      // Feedback button
      else {
        validateAndRespondToUserFeedback(bot, message, context);
      }
    });
  });

  // Handle a dialog submission the values from the form are in event.submission    
  controller.on('dialog_submission', function (bot, message) {
    debug('"submission": ' + CJSON.stringify(message))
    if (!message.callback_id) return;

    middleware.readContext(message.user, function (err, context) {
      if (!context) return;

      // Parse callback_id to distinguish between different dialog submissions
      if (message.callback_id == 'survey') {
        database.handleSurveySubmit(bot, message, context, function (bot, message, stored) {
          var err_msg = "Ops, an error occurred while saving user's comment :fearful:";

          // Call dialogOk() or else Slack will think this is an error
          if (stored) {
            bot.dialogOk()
          }
          else {
            bot.dialogError({
              name: 'comment',
              error: err_msg
            });
          }

          // We know we have executed this dialog by pressing a button, then,
          // we should have a valid user.latest_button_message to which we
          // should be able to answer.
          let user = database.findUserOrMake(message.user, false);
          if (user && user.latest_button_message) {
            let ok_msg = 'Thank you for your comments! :hugging_face:';
            botReplyToActionButton(bot, user.latest_button_message,
              stored ? ok_msg : err_msg);
          }
        });
      } else {
        database.handleSuggestionSubmit(bot, message, context, function (bot, message, stored) {
          // Call dialogOk() or else Slack will think this is an error
          if (stored) {
            bot.dialogOk()
          }
          else {
            bot.dialogError({
              name: 'suggestion',
              error: "An error occurred while saving user's suggestions :fearful:"
            });
          }
        })
      }
    });
  });

}