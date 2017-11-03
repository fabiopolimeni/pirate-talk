require('dotenv').load();

module.exports = function(webserver, middleware) {
  var storeDir = __dirname + '/.data/db/';

  if (process.env.USE_SLACK) {
    var Slack = require('./components/slack/slack-bot')(webserver, storeDir);
    Slack.controller.middleware.receive.use(middleware.receive);
    Slack.controller.createWebhookEndpoints(webserver);

    // Load all the handled skills
    var normalizedPath = require("path").join(__dirname, "skills");
    require("fs").readdirSync(normalizedPath).forEach(function(file) {
      require("./skills/" + file)(Slack.controller, middleware);
    });

    console.log('Slack bot is live');
    return;
  }

  if (process.env.USE_FACEBOOK) {
    var Facebook = require('./components/facebook/facebook-bot')(webserver, storeDir);
    Facebook.controller.middleware.receive.use(middleware.receive);
    Facebook.controller.createWebhookEndpoints(webserver, Facebook.bot);

    // Load all the handled skills
    var normalizedPath = require("path").join(__dirname, "skills");
    require("fs").readdirSync(normalizedPath).forEach(function(file) {
      require("./skills/" + file)(Facebook.controller, middleware);
    });

    console.log('Facebook bot is live');
  }

  if (process.env.USE_TWILIO) {
    var Twilio = require('./components/twilio/twilio-bot')(webserver, storeDir);
    Twilio.controller.middleware.receive.use(middleware.receive);
    Twilio.controller.createWebhookEndpoints(webserver, Twilio.bot);

    // Load all the handled skills
    var normalizedPath = require("path").join(__dirname, "skills");
    require("fs").readdirSync(normalizedPath).forEach(function(file) {
      require("./skills/" + file)(Twilio.controller, middleware);
    });

    console.log('Twilio bot is live');
  }

};

