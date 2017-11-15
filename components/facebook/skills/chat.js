require('dotenv').load()

const debug = require('debug')('pirate-talk:facebook-chat');
const CJSON = require('circular-json');

module.exports = function () {

  const account_login = require("facebook-chat-api");

  // @param callback(event, stop)
  function _login(page_id, callback) {

    let credentials = {
      email: process.env.FACEBOOK_CHAT_EMAIL,
      password: process.env.FACEBOOK_CHAT_PWD
    }

    let options = {
      pageID: page_id
    }

    account_login(credentials, options, (err, api) => {
      if (err) {
        console.error('Facebook account login error: %s', err);
        return;
      } else {
        console.log('Facebook account %s, successful logged in',
          credentials.email);

        let stop = api.listen((err, event) => {
          if (err) {
            console.error('Facebook listening error: %s', err);
            return;
          }

          console.log('Facebook event received: %s', CJSON.stringify(event))
          if (callback && typeof callback === 'function') {
            callback(event, stop);
          }
        });
      }
    });
  }

  return {
    login: _login
  }
}