require('dotenv').load()

var debug = require('debug')('pirate-talk:database');
var merge = require('deepmerge');
var CJSON = require('circular-json');
var sprintf = require('sprintf-js').sprintf;

var mongo = require('botkit-storage-mongo')({
  mongoUri: process.env.MONGO_URI, tables: [
    'workspaces', 'feedbacks', 'surveys'
  ]
});

module.exports = function (controller, middleware) {
  
  // Keep an array of users in order to reduce concurrency
  // as much as possible when storing history information.
  var _users = [];
  
  // Look up for a user, if doesn't exist, and
  // create is true, then, instantiate a new one.
  function _findUserOrMake(id, create) {
    // Find the user if exists
    let user = _users.find(function(item) {
      return item.id && item.id == id;
    });
    
    if (!user && create) {
      user = {
        id: id,
        latest_button_message: null,
        waiting_for_message: null,
        history: []
      };
      
      _users.push(user);
    }
    
    return user;
  }
  
  function _storeFeedback(storage, feedback, callback) {
    debug('Saving feedback: %s', CJSON.stringify(feedback));
    storage.feedbacks.save(feedback, function(err, id) {
      if (err) {
        console.error('Could not save feedback %s', feedback.id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        callback(err);
      }
    });
  }
  
  function _updateUserFeedback(bot, storage, id, suggestion, callback) {
    // Retrieve the feedback from the database/filesystem
    storage.feedbacks.get(id, function(err, feedback) {
      if (err) console.warn('Warn: could not retrieve feedback %s', id);
      
      // Incorporate user's suggestions
      feedback.suggestion = suggestion;
      
      // Store the feeback back
      _storeFeedback(storage, feedback, null);
      if (callback && typeof callback === 'function') {
        callback(err);
      }
    });
  }
  
  function _storeSurvey(bot, storage, survey, callback) {
    console.log('"survey": %s', CJSON.stringify(survey));    
    storage.surveys.save(survey, function(err, id) {
      if (err) {
        console.error('Could not save survey %s', survey.id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        callback(err);
      }
    });
  }
  
  function _sendReadyToContinueToken(bot, message, delta, callback) {
    let delta_context = merge({ user_input_received: true }, delta);
    middleware.sendToWatson(bot, message, delta_context, function() {
      if (callback && typeof callback === 'function') {
        callback(bot, message);
      }
    });
  }

  function _getStorage() {
    // Pick the right storage system database of filesystem
    return process.env.STORE_FEEDBACK_ON_FS ? controller.storage : mongo;
  }

  return {
    users: _users,
    findUserOrMake: _findUserOrMake,
    storeFeedback: _storeFeedback,
    updateFeedback: _updateUserFeedback,
    storeSurvey: _storeSurvey,
    sendContinueToken: _sendReadyToContinueToken,
    getStorageDriver: _getStorage
  }

}