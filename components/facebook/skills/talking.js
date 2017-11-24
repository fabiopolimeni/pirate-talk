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
    return {
      type:"template",
      payload:{
        template_type:"button",
        text:transcript.text,
        buttons:[{
          type:"postback",
          title:"Accept",
          payload: sprintf('transcript.%s.%s',
            context.conversation_id,
            context.system.dialog_turn_counter)
        },{
          type:"web_url",
          title:"Transcribe",
          url: sprintf('%s/facebook/webviews/transcript_form.html?%s.%s.%s.%s',
            process.env.WEBSERVER_HOSTNAME, 'transcript',
            message.user, context.conversation_id,
            context.system.dialog_turn_counter),
        }]
      }
    }
  }

  controller.on('audio_transcript', function (bot, message) {
    if (!conv.checkMessage(bot, message)) return;
    middleware.interpret(bot, message, function () {
      conv.handleReceivedMessage(bot, message);
    });
  });

  // Speech services
  var speech = require('../../audio/speech');
  controller.on('audio_received', function (bot, message) {
    debug('"audio": %s', JSON.stringify(message))

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
          if (!context) return;

          // Create a submission object, interpreted
          // as a transcript by the storing function.
          var submission = {
            text: transcript.text,
            confidence: transcript.confidence,
            url: data.payload.url
          }

          // Store the transcript text into the user's structure,
          // that is we won't need to pull it out from the database
          // when we receive a button reply.
          let user = database.findUserOfMake(message.user);
          if (user) {
            user.transcript = submission;
          }

          message.submission = submission;
          
          // Storing the transcript info into the database
          database.makeAndStoreTranscript(bot, message, context, (bot, message, stored) => {
            if (!stored) {
              console.error("Transcript %s, couldn't be stored", submission.url)
            }

            let transcript_attach = makeTranscriptResponse(bot, message, submission, context);
            bot.reply(message, { attachment: transcript_attach }, (err, sent) => {
              if (!sent) return;
            })
          })
        })
      }

      // let reroute_message = clone(message);

      // // We need to remove the attachments from the message
      // // received substituting it with the transcript text. 
      // if (reroute_message.message.attachments) {
      //   reroute_message.message.attachments = undefined;
      //   reroute_message.message.text = transcript.text;
      // }

      // if (reroute_message.attachments) {
      //   reroute_message.attachments = undefined;
      //   reroute_message.text = transcript.text;
      // }

      // if (reroute_message.raw_message.message.attachments) {
      //   reroute_message.raw_message.message.attachments = undefined;
      //   reroute_message.raw_message.message.text = transcript.text;
      // }

      // debug('"reroute": %s', JSON.stringify(reroute_message))
      // controller.trigger('audio_transcript', [bot, reroute_message]);
    });
  });

}