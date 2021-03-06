require('dotenv').load()

const debug = require('debug')('pirate-talk:database');
const merge = require('deepmerge');
const CJSON = require('circular-json');
const sprintf = require('sprintf-js').sprintf;

var mongo = require('botkit-storage-mongo')({
  mongoUri: process.env.MONGO_URI, tables: [
    'workspaces', 'feedbacks', 'surveys', 'transcripts'
  ]
});

module.exports = function (fs_storage, middleware) {
  
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
        turn_bias: 0,
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
    // of dialog_turn_counter starts over, hence,
    // previous dialogs will be overwritten, and
    // this will prevent the array from growing
    // indefinitely.

    // The above statement is partially true.
    // If the user does issue a `reset` command, then,
    // the turn counter does reset to 0. Although, if
    // the conversation restarts, because some user's
    // input triggers the conversation to jump back to
    // the 'Welcome' node, then the turn counter will 
    // keep growing. In order to fix this, we always
    // want to restart the conversation with a `reset`
    // command, or checking here if the context has in 
    // its latest traversed nodes the 'Welcome' node,
    // and, if this is the case, then we set the user's
    // turn_bias property equal to the current turn counter.
    let traversed_nodes = message.watsonData.output.nodes_visited;
    let matching_node = traversed_nodes.find((node_name) => {
      return node_name == 'Welcome';  
    });

    let turn_counter = message.watsonData.context.system.dialog_turn_counter;
    if (matching_node) {
      user.turn_bias = turn_counter;
    }

    let history_index = turn_counter - user.turn_bias;

    // Index cannot be smaller than 0.
    if (history_index < 0) {
      user.turn_bias += history_index;
      history_index = 0;
    }

    // Replace user's dialog
    user.history.splice(history_index, 1, {
      user_input: message.watsonData.input.text,
      bot_output: message.watsonData.output.text,
      intents: message.watsonData.intents,
      entities: message.watsonData.entities,
      turn_id: message.watsonData.context.system.dialog_turn_counter,
      conversation_id: message.watsonData.context.conversation_id,
      user_id: message.user,
      date: (new Date()).toString(),
      timestamp: Date.now()
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
    if (!suggestion) return;

    debug('"suggestion": %s', CJSON.stringify(suggestion));

    // Retrieve the feedback from the database/filesystem
    let storage = _getStorage();
    storage.feedbacks.get(id, function(err, feedback) {
      if (err || !feedback) {
        console.warn('Warn: could not retrieve feedback %s', id);
        console.error('Error: %s', err);
      }
      
      if (feedback) {
        // Incorporate user's suggestions
        feedback.suggestion = suggestion;
                
        // Re-store the updated feedback
        _storeFeedback(feedback, function (stored) {
          if (callback && typeof callback === 'function') {
            callback(stored);
          }
        });
      }
    });
  }
  
  function _handleSuggestionSubmission(bot, message, context, callback) {
    if (!context) return;

    let submission = message.submission;
    let suggestion = {
      what: 'response', //submission.what,
      how: submission.how
    };

    _updateUserFeedback(bot, message.callback_id, suggestion, function (stored) {
      if (callback && typeof callback === 'function') {
        callback(bot, message, stored);
      }
    });
  }

  function _saveAndRespondToUserFeedback(bot, message, context, callback) {
    if (!context) return;

    // Retrieve the turn id
    let ids = message.callback_id.split(':', 2);
    //let callback_conv_id = ids[0];
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
        id: message.callback_id,
        workspace: process.env.WATSON_WORKSPACE_ID,
        frontend: bot.type,
        action: message.text,
        level: context.language_level,
        version: context.version,
        // This exists only in facebook at this point, in slack instead,
        // it will be added later when the feedback will be updated.
        suggestion: message.suggestion,
        bot_asked: (prev_dialog) ? prev_dialog.bot_output : ''
      }, cur_dialog);

      // Store the feedback
      _storeFeedback(feedback, function (stored) {
        if (callback && typeof callback === 'function') {
          callback(bot, message, stored);
        }
      });
    }
  }

  function _storeSurvey(bot, survey, callback) {
    debug('"survey": %s', CJSON.stringify(survey));    

    let storage = _getStorage();
    storage.surveys.save(survey, function(err, id) {
      if (err) {
        console.error('Could not save survey %s', id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        callback(err ? false : true);
      }
    });
  }
  
  function _handleSurveySubmission(bot, message, context, callback) {
    if (!context) return;
    
    debug('"context": ' + CJSON.stringify(context))
    let submission = message.submission;
    let survey = {
      id: context.conversation_id,
      comment: submission.comment,
      level: context.language_level,
      version: context.version,
      frontend: bot.type,
      conversation: context.conversation_id,
      workspace: process.env.WATSON_WORKSPACE_ID,
      date: (new Date()).toString(),
      timestamp: Date.now()
    }

    _storeSurvey(bot, survey, function (stored) {
      if (callback && typeof callback === 'function') {
        callback(bot, message, stored);
      }
    });
  }

  function _storeTranscript(bot, transcript, callback) {
    debug('"transcript": %s', CJSON.stringify(transcript));

    let storage = _getStorage();
    storage.transcripts.save(transcript, function(err, id) {
      if (err) {
        console.error('Could not save transcript %s', id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        callback(err ? false : true, transcript);
      }
    });
  }

  function _getTranscript(id, callback) {
    let storage = _getStorage();
    storage.transcripts.get(id, function(err, transcript) {
      if (err || !transcript) {
        console.warn('Warn: could not retrieve transcript %s', id);
        console.error('Error: %s', err);
      }

      if (callback && typeof callback === 'function') {
        callback(err, transcript);
      }
    })
  }

  function _updateTranscript(bot, id, text, callback) {
    if (!text) return;

    _getTranscript(id, function(err, transcript) {
      if (transcript) {
        // Update the text and the modified field.
        transcript.original = transcript.text;
        transcript.text = text;
        transcript.modified = true;
                
        // Re-store the updated transcript
        _storeTranscript(bot, transcript, function (stored, transcript) {
          if (callback && typeof callback === 'function') {
            callback(stored, transcript);
          }
        });
      }
      else {
        callback(false);
      }
    });
  }

  function _handleCorrectionSubmission(bot, message, context, callback) {
    if (!context) return;

    // Needed to find out what is the transcript id to update
     let transcript_id = sprintf('%s:%s',
      message.submission.conversation,
      message.submission.turn);

    _updateTranscript(bot, transcript_id, message.submission.text,
      function (updated, transcript) {
        if (callback && typeof callback === 'function') {
          callback(bot, message, updated, transcript);
        }
    });
  }

  function _saveUserAudioTranscript(bot, message, context, callback) {
    if (!context) return;

    let submission = message.submission;
    let transcript = {
      id: sprintf('%s:%s', context.conversation_id,
        context.system.dialog_turn_counter),
      version: context.version,
      frontend: bot.type,
      level: context.language_level,
      conversation: context.conversation_id,
      workspace: process.env.WATSON_WORKSPACE_ID,
      text: submission.text,
      url: submission.url,
      confidence: submission.confidence,
      seconds: submission.seconds,
      modified: false,
      date: (new Date()).toString(),
      timestamp: Date.now()
    }

    _storeTranscript(bot, transcript, function (stored, transcript) {
        if (callback && typeof callback === 'function') {
          callback(bot, message, stored, transcript);
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
    return process.env.STORE_FEEDBACK_ON_FS ? fs_storage : mongo;
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
    storeTranscript: _storeTranscript,
    updateTranscript: _updateTranscript,
    getTranscript: _getTranscript,

    /* High level utils */
    makeAndStoreFeedback: _saveAndRespondToUserFeedback,
    handleSuggestionSubmit: _handleSuggestionSubmission,
    handleSurveySubmit: _handleSurveySubmission,
    makeAndStoreTranscript: _saveUserAudioTranscript,
    handleTranscriptSubmit: _handleCorrectionSubmission,

    /* Middleware APIs */
    sendContinueToken: _sendReadyToContinueToken,
    addDialogToUserHistory: _storeWatsonDialog,
  }

}