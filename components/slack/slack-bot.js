var debug = require('debug')('pirate-talk:slackbot')

module.exports = function(webserver, botkit, storePath) {

  var configuration = {
      clientId: process.env.SLACK_CLIEND_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      //debug: true,
      json_file_store : storePath,
      //require_delivery : true,
      //send_via_rtm : true,
      scopes: ['bot']
  };

  var controller = botkit.slackbot(configuration);
  var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
  });
/*
  bot.startRTM(function(err, bot, payload) {
    if (err) {
      console.log('Error while inoking bot.startRTM(): ' + err);
      console.log('Bot: ' + JSON.stringify(bot));
      console.log('Payload: ' + JSON.stringify(payload));
    }
  });
*/
  // Import all the pre-defined routes that are present in /components/routes
  var normalizedPath = require("path").join(__dirname, "routes");
  require("fs").readdirSync(normalizedPath).forEach(function(file) {
    debug('Setting up route ' + file);
    require("./routes/" + file)(webserver, controller);
  });

  // Set up a simple storage backend for keeping a record
  // of customers who sign up for the app via the oauth
  require('./user_registration.js')(controller);

  // Send an onboarding message when a new team joins
  require('./onboarding.js')(controller);

  return {
    controller : controller,
    bot : bot
  }
}