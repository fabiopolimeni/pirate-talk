var debug = require('debug')('pirate-talk:slackbot')

module.exports = function (webserver, botkit, storage, middleware) {

  var configuration = {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    //debug: true,
    storage: storage,
    stats_optout: true,
    scopes: ['bot']
  };

  var controller = botkit.slackbot(configuration);
  var bot = controller.spawn({
    //require_delivery : true,
    //send_via_rtm : true,
    token: process.env.SLACK_TOKEN
  });
  /*
  bot.startRTM(function(err, bot, payload) {
    if (err) {
      console.log('Error while invoking bot.startRTM(): ' + err);
      console.log('Bot: ' + JSON.stringify(bot));
      console.log('Payload: ' + JSON.stringify(payload));
    }
  });
  */
  // Import all the pre-defined routes that are present in /components/routes
  var normalizedPath = require("path").join(__dirname, "routes");
  require("fs").readdirSync(normalizedPath).forEach(function (file) {
    debug('Setting up route ' + file);
    require("./routes/" + file)(webserver, controller);
  });

  // Set up a simple storage backend for keeping a record
  // of customers who sign up for the app via the oauth
  require('./user_registration.js')(controller);

  // Send an onboarding message when a new team joins
  require('./onboarding.js')(controller);

  // Load slack specific skills
  var normalizedPath = require("path").join(__dirname, "./skills");
  require("fs").readdirSync(normalizedPath).forEach(function (file) {
    require("./skills/" + file)(controller, middleware);
  });

  return {
    controller: controller,
    bot: bot
  }
}