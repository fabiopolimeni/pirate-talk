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

  function _storeWatsonDialog(message) {
    let user = _findUserOrMake(message.user, true);
    if (!user) return console.error(
      'An error occurred while creating a new user: %s', message.user)

    let watson = message.watsonData;
    if (!watson) return console.error(
      'Message is not conform, watsonData property is not present')

    // Add a dialog info to the user's history.
    // When the conversation restarts, the index
    // of dialog_turn_counter starts over again,
    // hence, previous dialogs will be overwritten,
    // and this will prevent the array to grow indefinitely.
    user.history.splice(message.watsonData.context.system.dialog_turn_counter, 1, {
      user_input: message.watsonData.input.text,
      bot_output: message.watsonData.output.text,
      intents: message.watsonData.intents,
      entities: message.watsonData.entities,
      turn_id: message.watsonData.context.system.dialog_turn_counter,
      conversation_id: message.watsonData.context.conversation_id,
      user_id: message.user,
      date: (new Date()).toString()
    });
  }
  
  function _storeFeedback(feedback, callback) {
    debug('"feedback": %s', CJSON.stringify(feedback));
    
    let storage = _getStorage();
    storage.feedbacks.save(feedback, function(err, id) {
      if (err) {
        console.error('Could not save feedback %s', feedback.id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        callback(err ? false : true);
      }
    });
  }
  
  function _updateUserFeedback(bot, id, suggestion, callback) {
    debug('"suggestion": %s', CJSON.stringify(suggestion));

    let storage = _getStorage();

    // Retrieve the feedback from the database/filesystem
    storage.feedbacks.get(id, function(err, feedback) {
      if (err || !feedback) {
        console.warn('Warn: could not retrieve feedback %s', id);
        console.error('Error: %s', err);
      }
      
      if (!feedback) return;
      
      // Incorporate user's suggestions
      feedback.suggestion = suggestion;
      
      // Store the feedback back
      _storeFeedback(storage, feedback, callback);
    });
  }

  function _saveAndRespondToUserFeedback(bot, message, context, callback) {
    // Retrieve the turn id
    let ids = message.callback_id.split(':', 2);
    let callback_conv_id = ids[0];
    let callback_turn_id = ids[1];

    let user = _findUserOrMake(message.user, false);
    if (!user) return;

    let dialogs = user.history;

    // Get last stored dialog, if the dialog_turn and the conversation_id match,
    // then, add the feedback score to the object before we save it to storage.
    let cur_dialog = dialogs.find(function (dialog) {
      return (dialog.turn_id == callback_turn_id) &&
        (dialog.conversation_id == context.conversation_id);
    })

    // We also need the previous dialog, as we want to
    // extract what the bot has asked in the first place.
    // This is not a mandatory requirement though.
    let prev_dialog = dialogs.find(function (dialog) {
      return (dialog.turn_id == callback_turn_id - 1) &&
        (dialog.conversation_id == context.conversation_id);
    })

    // Store given feedback for later revision
    if (cur_dialog) {
      //debug('Current: %s\nPrevious: %s',
      //  JSON.stringify(cur_dialog), JSON.stringify(prev_dialog));

      let feedback = merge({
        id: callback_conv_id.concat(':', callback_turn_id),
        workspace: process.env.WATSON_WORKSPACE_ID,
        frontend: 'Slack',
        action: message.text,
        level: context.language_level,
        version: context.version,
        bot_asked: (prev_dialog) ? prev_dialog.bot_output : ''
      }, cur_dialog);

      // Store the feedback
      _storeFeedback(feedback, function (stored) {
        let footer = stored ?
          'Thanks for the feedback :clap:' :
          'Some problem occurred when storing feedback :scream:'

        if (callback && typeof callback === 'function') {
          callback(bot, message, footer);
        }
      });
    }
  }

  function _handleSurveySubmission(bot, message, context, callback) {
    debug('"context": ' + CJSON.stringify(context))
    let submission = message.submission;
    let survey = {
      id: context.conversation_id,
      comment: submission.comment,
      level: context.language_level,
      version: context.version,
      conversation: context.conversation_id
    }

    _storeSurvey(bot, survey, function (stored) {
      if (callback && typeof callback === 'function') {
        callback(bot, message, stored);
      }
    });
  }

  function _handleSuggestionSubmission(bot, message, context, callback) {
    let submission = message.submission;
    let suggestion = {
      what: submission.what,
      how: submission.how
    };

    debug('"submission": %s', CJSON.stringify(message, null, 2))
    _updateFeedback(bot, message.callback_id, suggestion, function (stored) {
      if (callback && typeof callback === 'function') {
        callback(bot, message, stored);
      }
    });
  }
  
  function _storeSurvey(bot, survey, callback) {
    debug('"survey": %s', CJSON.stringify(survey));    

    let storage = _getStorage();
    storage.surveys.save(survey, function(err, id) {
      if (err) {
        console.error('Could not save survey %s', survey.id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        callback(err ? false : true);
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
    /* Variables */
    users: _users,

    /* Low level functions */
    findUserOrMake: _findUserOrMake,
    getStorage: _getStorage,
    storeFeedback: _storeFeedback,
    updateFeedback: _updateUserFeedback,
    storeSurvey: _storeSurvey,

    /* High level utils */
    handleFeedbackSubmit: _saveAndRespondToUserFeedback,
    handleSuggestionSubmit: _handleSuggestionSubmission,
    handleSurveySubmit: _handleSurveySubmission,

    /* Middleware APIs */
    sendContinueToken: _sendReadyToContinueToken,
    addMessageToUserHistory: _addWatsonDialog,
  }

}