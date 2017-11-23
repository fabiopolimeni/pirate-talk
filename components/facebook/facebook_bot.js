var debug = require('debug')('pirate-talk:facebookbot')

module.exports = function (webserver, botkit, storage, middleware) {
  
  // Create the Botkit controller, which controls all instances of the bot.
  var controller = botkit.facebookbot({
      log: true,
      //debug: true,
      storage: storage,
      require_delivery: true,
      verify_token: process.env.FACEBOOK_VERIFY_TOKEN,
      access_token: process.env.FACEBOOK_ACCESS_TOKEN,
      app_secret: process.env.FACEBOOK_APP_SECRET,
      validate_requests: true, // Refuse any requests that don't come from FB on your receive webhook, must provide FB_APP_SECRET in environment variables
  });
  
  var bot = controller.spawn({});
  
  // Import all the pre-defined routes that are present in /components/routes
  let routes_path = require("path").join(__dirname, "routes");
  require("fs").readdirSync(routes_path).forEach(function (file) {
    debug('Setting up route ' + file);
    require("./routes/" + file)(webserver, controller, bot);
  });

  // Tell Facebook to start sending events to this application
  require('./subscribe_events.js')(controller);

  // Set up Facebook "thread settings" such as get started button, persistent menu
  require('./thread_settings.js')(controller);

  // Send an onboarding message when a user activates the bot
  require('./onboarding.js')(controller);

  // Database handler
  var database = require('../../database')(controller, middleware);

  // Load slack specific skills
  let skills_path = require("path").join(__dirname, "./skills");
  require("fs").readdirSync(skills_path).forEach(function (file) {
    require("./skills/" + file)(controller, middleware, database);
  });

  return {
    controller: controller,
    bot: bot
  }
}