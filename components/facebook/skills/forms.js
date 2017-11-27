require('dotenv').load()

const debug = require('debug')('pirate-talk:facebook-hearing');
const CJSON = require('circular-json');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware, database) {

  function replyToUser(bot, message, stored) {
    let header = sprintf('(%s)\nUser: (%s)\n',
      CJSON.stringify(message), message.user);

    return (stored) ?
      debug('%s has been successfully saved! :)', header) :
      debug('%s has not been saved! :(', header);
  }

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
    let action_query = tokens[0];

    // Feedback form submit
    if (action_query == 'feedback' && body.suggestion && tokens.length >= 4) {
      var feedback_message = {
        user: tokens[1],

        // Reconstruct the callback_id as expected by the db interface.
        callback_id: sprintf('%s:%s', tokens[2], tokens[3]),

        // Not really used, though useful
        // info to look at debugging time.
        submission: {
          action: action_query,
          conversation: tokens[2],
          turn: tokens[3]
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

      middleware.readContext(feedback_message.user, function (err, context) {
        database.makeAndStoreFeedback(bot, feedback_message, context, replyToUser);
      });
    }
    // Survey form submit
    else if (action_query == 'survey' && body.comment && tokens.length >= 3) {
      var survey_message = {
        user: tokens[1],
        submission: {
          action: action_query,
          conversation: tokens[2],
          comment: body.comment.trim()
        }
      };

      middleware.readContext(survey_message.user, function (err, context) {
        database.handleSurveySubmit(bot, survey_message, context, replyToUser);
      });
    }
    else if (action_query == 'transcript' && tokens.length >= 4) {

      var transcript_message = {
        user: tokens[1],
        channel: tokens[1],
        page: process.env.FACEBOOK_PAGE_ID,
        submission: {
          action: action_query,
          conversation: tokens[2],
          turn: tokens[3],
          text: body.transcript.trim()
        }
      };

      middleware.readContext(transcript_message.user, function (err, context) {
        database.handleTranscriptSubmit(bot, transcript_message, context,
          (bot, message, updated, transcript) => {
            if (!updated) {
              console.warn("Couldn't update transcript %s", transcript.url)
            }

            // For sanity check, and that is the user can receive a feedback,
            // we are going to show the corrected transcript from the user.
            transcript_message.text = transcript_message.submission.text
            bot.reply(transcript_message, {text: transcript_message.text}, (err, sent) => {
              // Trigger an audio transcript message
              controller.trigger('audio_transcript', [bot, transcript_message]);
            })
          });
      });
    }
  });

}