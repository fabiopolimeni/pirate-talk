require('dotenv').load();

module.exports = function (webserver, middleware) {
  
  var botkit = require('botkit');
  var storage = require('./components/storage')({path: __dirname + '/.data/db/'});

  if (process.env.USE_SLACK) {
    var Slack = require('./components/slack/slack_bot')(webserver, botkit, storage, middleware);
    //Slack.controller.middleware.receive.use(middleware.receive);
    Slack.controller.createWebhookEndpoints(webserver);
    console.log('Slack bot is live');
  }

  if (process.env.USE_FACEBOOK) {
    var Facebook = require('./components/facebook/facebook_bot')(webserver, botkit, storage);
    //Facebook.controller.middleware.receive.use(middleware.receive);
    Facebook.controller.createWebhookEndpoints(webserver, Facebook.bot);
    console.log('Facebook bot is live');
  }

};