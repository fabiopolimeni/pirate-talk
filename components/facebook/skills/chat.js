require('dotenv').load()

const debug = require('debug')('pirate-talk:facebook-chat');
const CJSON = require('circular-json');

module.exports = function () {

  const account_login = require("facebook-chat-api");
  
  var _is_logged_in = false;
  var _api = null;

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
        _is_logged_in = false;
        return;
      } else {
        _api = api;
        _is_logged_in = true;
        console.log('Facebook account %s, successful logged in as page: %s',
          credentials.email, options.pageID);

        var stop = api.listen((err, event) => {
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
  
  // @param callback(error)
  function _logout(callback) {
    if (_api) {
      _api.logout(callback);
    }
  }

  return {
    login: _login,
    logout: _logout,    
    isLogged: function() { return _is_logged_in; }
  }
}