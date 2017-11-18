require('dotenv').load()
var debug = require('debug')('botkit:thread_settings');

module.exports = function (controller) {
  debug('Configuring Facebook thread settings...');
  controller.api.thread_settings.greeting('Hello! I\'m the Captain of the boat. Do you fancy a ride?');
  controller.api.thread_settings.get_started('sample_get_started_payload');
  controller.api.thread_settings.menu([{
    "locale": "default",
    "composer_input_disabled": false,
    "call_to_actions": [{
      "type": "web_url",
      "title": "Find out more @ Play2Speak",
      "url": "https://lgamesmadrid.com",
      "webview_height_ratio": "compact",
    }]
  }]);
  
  controller.api.messenger_profile.domain_whitelist([
    'https://127.0.0.1',
    'https://0.0.0.0',
    'https://localhost',
    process.env.WEBSERVER_HOSTNAME
  ]);
  
  controller.api.messenger_profile.get_domain_whitelist(function (err, data)  {
    console.log('****** Whitelisted domains :', data);
  });
}