require('dotenv').load()

const debug = require('debug')('pirate-talk:facebook-hearing');

module.exports = function (controller, middleware, database) {

  // Conversation manager
  var conv = require('../conversation')(database);

  // Handle button postbacks
  controller.hears(['.*'], 'facebook_postback', function (bot, message) {
    debug('"postback": %s', JSON.stringify(message));
    if (!conv.checkMessage(bot, message)) return;

    // Since events handler aren't processed by middleware and have no watsonData 
    // attribute, the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function (err, context) {
      if (!context || !message.text) return;

      let query = message.text.split('.');

      // Handle language pick level
      if (query[0] == 'pick_language_level') {
        let level = query[1];
        database.sendContinueToken(bot, message, { language_level: level }, () => {
          conv.sendMessageReplay(bot, message, database.findUserOrMake(message.user));
        });
      }
      // Handle transcript accepted
      else if (query.length >= 3 && query[0] == 'transcript') {

        // let conversation = query[1];
        // let turn = query[2];
        // let transcript_id = sprintf('transcript.%s:%s', conversation, turn);

        let user = database.findUserOfMake(message.user);
        if (user && user.transcript) {
          
          let transcript_message = {
            user: message.user,
            channel: message.user,
            page: process.env.FACEBOOK_PAGE_ID,
            text: user.transcript.text
          }
          
          controller.trigger('audio_transcript', [bot, transcript_message]);
      }

    });
  });
  
}