require('dotenv').load()

const clone = require('clone');
const debug = require('debug')('pirate-talk:facebook-talking');

module.exports = function (controller, middleware, database) {

  // Get conversation manager
  var conv = require('../conversation')(database);

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
        conv.sendMessageReplay(message, transcript.text);
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