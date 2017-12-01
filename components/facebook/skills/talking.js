require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-talking');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (controller, middleware, database) {

  // Get conversation manager
  var conv = require('../conversation')(database);

  // A transcript differs from a received message
  // because we need to verify it resembles what
  // the user meant to say. Therefore, we ask the
  // user to validate the transcript.
  // If the text doesn't represent what the user
  // said, he will be asked to provide a better translation.
  function makeTranscriptResponse(bot, message, transcript, context) {

    let user_options = [];
    
    let accept_btn = {
      type: 'postback',
      title: 'Accept',
      payload: sprintf('transcript.%s.%s',
        context.conversation_id,
        context.system.dialog_turn_counter)
    };

    let transcript_btn = {
      type: 'web_url',
      title: 'Modify',
      url: sprintf('%s/facebook/webviews/transcript_form.html?%s.%s.%s.%s',
        process.env.WEBSERVER_HOSTNAME, 'transcript',
        message.user, context.conversation_id,
        context.system.dialog_turn_counter),
        messenger_extensions: true,
        webview_height_ratio: 'compact'
    }

    // If the confidence is too low, we will ask the user
    // to provide a better transcription of what she/he said,
    // otherwise the conversation won't be able to continue.
    // The purpose of this is to allow the conversation
    // to continue meaningfully.
    if (transcript.confidence < 0.85) {
      user_options.push(transcript_btn);
    }
    else {
      // The accept button will be available only
      // if the accuracy is over a certain threshold.
      user_options.push(accept_btn);
      
      // We do also ask the user to provide a more
      // accurate transcript of what she/he said,
      // in case what the speech-to-text service
      // understood is too off.
      user_options.push(transcript_btn);
    }

    return {
      type: 'template',
      payload: {
        template_type: 'button',
        text: transcript.text,
        buttons: buttons
      }
    }
  }

  controller.on('audio_transcript', function (bot, message) {
    middleware.interpret(bot, message, function () {
      conv.handleReceivedMessage(bot, message);
    });
  });

  // Speech services
  var speech = require('../../audio/speech');
  controller.on('audio_received', function (bot, message) {
    debug('"audio": %s', JSON.stringify(message))

    bot.startTyping(message, function () {});

    let data = message.attachments[0];
    speech.stt(data.payload.url, (err, transcript) => {
      
      if (err) {
        console.error('Speech-to-Text error: %s', err)
        return bot.reply(message, 
          "Sorry, I couldn't hear you very well, can you say it again please?");
      }
      else {
        // Since events handler aren't processed by middleware and have no watsonData 
        // attribute, the context has to be extracted from the current user stored data.
        middleware.readContext(message.user, function (err, context) {
          if (err) {
            return console.error('Error in audio_received: %s', err);
          }
    
          if (!context) {
            return console.error('Error in audio_received: No valid context');
          }

          // Create a submission object, interpreted
          // as a transcript by the storing function.
          var submission = {
            text: transcript.text,
            confidence: transcript.confidence,
            seconds: transcript.seconds,
            url: data.payload.url
          }

          // Store the transcript text into the user's structure,
          // that is we won't need to pull it out from the database
          // when we receive a button reply.
          let user = database.findUserOrMake(message.user);
          if (user) {
            user.transcript = submission;
          }

          message.submission = submission;
          
          // Storing the transcript info into the database
          database.makeAndStoreTranscript(bot, message, context, (bot, message, stored) => {
            if (!stored) {
              console.error("Transcript %s, couldn't be stored", submission.url)
            }

            // If the accuracy is reasonable high, then, move on
            if (transcript.confidence > 0.93) {
              let reroute_message = {
                user: message.user,
                channel: message.user,
                page: process.env.FACEBOOK_PAGE_ID,
                text: user.transcript.text
              }

              controller.trigger('audio_transcript', [bot, reroute_message]);
            }
            else {
              let transcript_attach = makeTranscriptResponse(bot, message, submission, context);
              bot.reply(message, { attachment: transcript_attach }, (err, sent) => {
                if (!sent) return;
              })
            }
          })
        })
      }
    });
  });

}