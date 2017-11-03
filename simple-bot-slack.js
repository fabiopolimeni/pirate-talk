/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

require('dotenv').load();

var clone = require('clone');
var botkit = require('botkit');
var express = require('express');

var middleware = require('botkit-middleware-watson')({
  username: process.env.WATSON_CONVERSATION_USERNAME,
  password: process.env.WATSON_CONVERSATION_PASSWORD,
  workspace_id: process.env.WATSON_WORKSPACE_ID,
  url: process.env.WATSON_CONVERSATION_URL || 'https://gateway.watsonplatform.net/conversation/api',
  version_date: '2017-05-26'
});

// Configure your bot.
var controller = botkit.slackbot({
  clientId: process.env.SLACK_CLIEND_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  //debug: true,
  json_file_store : __dirname + '/.data/db/',
  require_delivery : true,
  send_via_rtm : true,
  scopes: ['bot']
});

var instance = controller.spawn({
  token: process.env.SLACK_TOKEN
});

function botsays(bot, msg_obj) {
  if (bot && msg_obj)
    bot.say(msg_obj);
}

/*
middleware.before = function(message, payload, callback) {
  // Code here gets executed before making the call to Conversation.
  console.log("Before: " + JSON.stringify(message));
  console.log("Paylod: " + JSON.stringify(payload));

  callback(null, payload);
}

middleware.after = function(message, response, callback) {
  // Code here gets executed after the call to Conversation.
  console.log("After: " + JSON.stringify(message));
  console.log("Response: " + JSON.stringify(response));

  callback(null, response);
}
*/

controller.hears(['card'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
  console.log('Card: ' + JSON.stringify(message));
  bot.reply(message, {
    attachments:[{
      "mrkdwn_in": ["text"],
      text : 'This is _what_ the guide will say! It can be short or long.'
    },{
      text: 'Second attachment',
      actions: [{
        "name":"yes",
        "text": "Yes",
        "value": "yes",
        "type": "button",
      },{
        "name":"no",
        "text": "No",
        "value": "no",
        "type": "button",
      }]
    }]
  });
});

controller.hears(['say'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
  console.log('Say: ' + JSON.stringify(message));
  botsays(bot, {
    text: "Does anyone want to talk to me? Contact me in private <@U7RBKES8Y>",
    channel : "D7UBP2605"
  });
});

controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
  middleware.updateContext(message.user, { }, function() {
    const msg = clone(message);
    msg.text = 'reset';    
    middleware.sendToWatson(bot, msg, function() {
      console.log('Reset: ' + JSON.stringify(msg));
      
      var attachments = [];
      if (typeof msg.watsonData.output !== 'undefined'
         && typeof msg.watsonData.output.action !== 'undefined'
         && typeof msg.watsonData.output.action.slack !== 'undefined') {
        //bot.reply(msg, msg.watsonData.output.action.slack);
        
        if (typeof msg.watsonData.output.action.slack.attachments !== 'undefined')
          attachments = msg.watsonData.output.action.slack.attachments;
      }
      
      // wrap dialog output into attachments
      attachments.push({
        mrkdwn_in : ['text'],
        text : msg.watsonData.output.text.join('\n')
      });
      
      //console.log('Attachments: ' + JSON.stringify(attachments));
      bot.reply(msg, {attachments});
      
    });
  });
});

controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention'], function(bot, message) {
  middleware.interpret(bot, message, function() {
    console.log('Message: ' + JSON.stringify(message));
    if (message.watsonError) {
      console.log(message.watsonError);
      bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
    } else {
      //console.log('Watson: ' + JSON.stringify(message.watsonData));
      var attachments = [];
      if (typeof message.watsonData.output !== 'undefined'
         && typeof message.watsonData.output.action !== 'undefined'
         && typeof message.watsonData.output.action.slack !== 'undefined') {
        //bot.reply(message, message.watsonData.output.action.slack);
        
        if (typeof message.watsonData.output.action.slack.attachments !== 'undefined')
          attachments = message.watsonData.output.action.slack.attachments;
      }
      
      // wrap dialog output into attachments
      attachments.push({
        mrkdwn_in : ['text'],
        text : message.watsonData.output.text.join('\n')
      });
      
      //console.log('Attachments: ' + JSON.stringify(attachments));
      bot.reply(message, {attachments});
    }
  });
});

instance.startRTM(function(err, bot, payload) {
  if (err) {
    console.error('Could not connect to Slack: ' + err);
  }
});

//setTimeout(instance.destroy.bind(instance), 2000);

// 30 minutes = 1.8e+6 milliseconds
/*
setInterval(function() {
  botsays(instance, {
    text: "Does anyone want to talk to me?\nContact me in private @Barbarossa the Pirate",
    channel : "C7S1UCYQJ"
  });
}, 1.8e+6);

// 4 minutes = 2.4e+5 milliseconds
setInterval(function(){
  console.log("Keep the system alive: " + new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''))
}, 2.4e+5);
*/

// Load in some helpers to keep the Glitch server alive
require(__dirname + '/components/glitch.js')(controller);

// Create an Express app
var app = express();
var port = process.env.PORT || 5000;
app.set('port', port);
app.listen(port, function() {
  console.log('Client server listening on port ' + port);
});
