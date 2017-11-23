require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-hearing');
const CJSON = require('circular-json');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware, database) {

  // Conversation manager
  var conv = require('../conversation')(database);

  // Handle reset special case
  controller.hears(['reset'], 'message_received', function (bot, message) {
    if (!conv.checkMessage(bot, message)) return;
    middleware.updateContext(message.user, {}, function (context) {
      let reset_message = clone(message);
      reset_message.text = 'reset';
      middleware.sendToWatson(bot, reset_message, {}, function () {
        conv.handleReceivedMessage(bot, reset_message);
      });
    });
  });

  // Handle common cases with  Watson conversation
  controller.hears(['.*'], 'message_received', function (bot, message) {
    if (!conv.checkMessage(bot, message)) return;
    middleware.interpret(bot, message, function () {
      conv.handleReceivedMessage(bot, message);
    });
  });

  // Handle button postbacks
  controller.hears(['.*'], 'facebook_postback', function (bot, message) {
    debug('"postback": %s', JSON.stringify(message));
    if (!conv.checkMessage(bot, message)) return;

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
          conv.sendMessageReplay(bot, message,
            database.findUserOrMake(message.user));
        });
      }

    });
  });

  controller.on('message_delivered', function (bot, message) {
    debug('"delivered": %s', JSON.stringify(message))
    let user = database.findUserOrMake(message.sender.id)
    if (user && user.waiting_for_message &&
      user.waiting_for_message.final_message_id) {

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
          conv.sendMessageReplay(bot, forward_message, user);
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

        // This indicates the feedback type on the conversation.
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

              return stored ?
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

              return (stored) ?
                debug('%s has been successfully saved! :)', header) :
                debug('%s has not been saved! :(', header);
            });
        }
      });
    }
  });

}