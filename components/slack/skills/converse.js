require('dotenv').load()

var clone = require('clone');
var debug = require('debug')('pirate-talk:converse');
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
  var users = [];
  
  // Look up for a user, if doesn't exist, and `create` 
  // is true, then, a new one will be created.
  function findUserOrMake(user_id, create) {
    // Find the user if exists
    let user = users.find(function(item) {
      return item.id && item.id == user_id;
    });
    
    if (!user && create) {
      user = {
        id: user_id,
        latest_button_message: null,
        history: []
      };
      
      users.push(user);
    }
    
    return user;
  }
  
  function storeFeedback(storage, feedback, callback) {
    debug('Saving feedback: %s', CJSON.stringify(feedback));
    storage.feedbacks.save(feedback, function(err, id) {
      if (err) {
        console.error('Could not save feedback %s', feedback.id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        debug('storeFeedback.cb: ' + callback);
        callback(!(err));
      }
    });
  }
  
  function updateUserFeedback(bot, storage, message, suggestion, callback) {
    // Retrieve the feedback from the database/filesystem
    storage.feedbacks.get(message.callback_id, function(err, feedback) {
      if (err) console.warn('Warn: could not retrieve feedback %s', message.callback_id);
      
      // Incorporate user's suggestions
      feedback.suggestion = suggestion;
      
      // Store the feeback back
      storeFeedback(storage, feedback, null);
      
      if (callback && typeof callback === 'function') {
        debug('updateUserFeedback.cb: ' + callback);
        callback(!(err));
      }
    });
  }
  
  function storeSurvey(bot, storage, message, survey, callback) {
    console.log('"survey": %s', CJSON.stringify(survey));    
    storage.surveys.save(survey, function(err, id) {
      if (err) {
        console.error('Could not save survey %s', survey.id);
        console.error('Error: %s', err);
      }
      
      if (callback && typeof callback === 'function') {
        debug('storeSurvey.cb: ' + callback);
        callback(!(err));
      }
    });
  }
  
  function sendReadyToContinueToken(bot, message, delta) {
    let delta_context = merge({ user_input_received: true }, delta);
    middleware.sendToWatson(bot, message, delta_context, function() {
      botConversationReply(bot, message);
    });
  }
  
  // Main reply function, where all the logic to
  // interact with watson conversation is processed.
  function botConversationReply(bot, message) {
    debug('Message: ' + JSON.stringify(message));

    var has_attachments = false;
    if (message.watsonData.output.action && message.watsonData.output.action.attachments) {
      has_attachments = true;
      bot.reply(message, {
        attachments: message.watsonData.output.action.attachments
      });
    }
    
    // Construct the replay message
    var reply = {
      text: message.watsonData.output.text.join('\n'),
      attachments : []
    };
    
    // No feedback request if specifically removed
    var feedback_request = !(message.watsonData.output.action && message.watsonData.output.action.no_feedback);
  
    // Request for a feedback.
    if (feedback_request) {
      
      // Reply with feedback request, that is, adding action buttons
      reply.attachments.push({
        // callback_id will be in the form of: conversation_id:turn_counter.
        // This is necessary because we can have answers that are given
        // out of order, it is not necessarily last a lifo process.
        callback_id: message.watsonData.context.conversation_id.concat(
          ':', message.watsonData.context.system.dialog_turn_counter),
        mrkdwn_in: ['text'],
        text: '',
        actions: [{
          "name": "ok",
          "text": "Right :thumbsup:",
          "value": "good",
          "style": "primary",
          "type": "button"
        }, {
          "name": "soso",
          "text": "Improve :raised_hand:",
          "value": "maybe",
          "style": "default",
          "type": "button"
        }]
      });
    }
    
    // If we have attachments to process, wait for 0.5 sec, before sending the next message.
    // Unfortunately, it doesn't seem there is a more elegant way, in slack, to know whether
    // a message has been delivered and visible or not.
    // This is needed in order to avoid a message to be received out of order, as it will happen
    // if some of the messages are heavier than others, such as, when include media files (e.g. images).
    bot.startTyping(message, function() { });
    setTimeout(function() {
      debug('Reply: ' + JSON.stringify(reply));
      bot.reply(message, reply);
      
      // Retrieve the user, or make a new one if doesn't exist
      let user = findUserOrMake(message.user, true);
      let dialogs = user.history;
      
      // Add a dialog info to the list of dialogs. When the conversation restarts, the index
      // of dialog_turn_counter starts over again, hence, previous dialogs will be overwritten,
      // and this will prevent the array to grow indefinitely.
      dialogs.splice(message.watsonData.context.system.dialog_turn_counter, 1, {
        user_input: message.watsonData.input.text,
        bot_output: message.watsonData.output.text,
        intents: message.watsonData.intents,
        entities: message.watsonData.entities,
        turn_id: message.watsonData.context.system.dialog_turn_counter,
        conversation_id: message.watsonData.context.conversation_id,
        user_id: message.user,
        date: (new Date()).toString()
      })
      
      //debug('Dialogs: ' + JSON.stringify(dialogs, null, 2))

      // At this point we need to check whether a jump is needed to continue with the conversation.
      // If it is needed, then upgrade Watson context and sand it back to continue to the next dialog.
      if (message.watsonData.output.action && message.watsonData.output.action.wait_before_jump) {
        sendReadyToContinueToken(bot, message, {});
      }
      
      bot.stopTyping();
    }, (has_attachments) ? 1000 : 0 );
  }
  
  function botReplyToActionButton(bot, message, footer_msg) {
    // Update the original message, that is, the user will be 
    // notified its contribution it has been taken into account.
    bot.replyInteractive(message, {
      text: message.original_message.text,
      attachments : [{
        fallback: '',
        footer: footer_msg,
        ts: message.action_ts
      }]
    });
  }
  
  function saveAndRespondToUserFeedback(bot, storage, message, context) {
    // Retrieve the turn id
    let ids = message.callback_id.split(':', 2);
    let callback_conv_id = ids[0];
    let callback_turn_id = ids[1];
    
    let user = findUserOrMake(message.user, false);
    if (!user) return;
    
    let dialogs = user.history;
    
    // Get last stored dialog, if the dialog_turn and the conversation_id match,
    // then, add the feedback score to the object before we save it to storage.
    let cur_dialog = dialogs.find(function(dialog){
      return (dialog.turn_id == callback_turn_id)
        && (dialog.conversation_id == context.conversation_id);
    })
    
    // We also need the previous dialog, as we want to
    // extract what the bot has asked in the first place.
    // This is not a mandatory requirement though.
    let prev_dialog = dialogs.find(function(dialog){
      return (dialog.turn_id == callback_turn_id - 1)
        && (dialog.conversation_id == context.conversation_id);
    })
    
    // Store given feedback for later revision
    if (cur_dialog) {
      //debug('Current: %s\nPrevious: %s',
      //  JSON.stringify(cur_dialog), JSON.stringify(prev_dialog));
      
      let feedback = merge({
        id: callback_conv_id.concat(':', callback_turn_id),
        workspace: process.env.WATSON_WORKSPACE_ID,
        action: message.text,
        level: context.language_level,
        version: context.version,
        bot_asked: (prev_dialog) ? prev_dialog.bot_output: ''
        }, cur_dialog
      );
      
      // Store the feedback
      storeFeedback(storage, feedback, function(stored) {
        let footer = stored
          ? 'Thanks for the feedback :clap:'
          : 'Some problem occurred when storing feedback :scream:'
        
        botReplyToActionButton(bot, message, footer)
      });
    }  
  }
  
  // Show the dialog to allow the user to provide written feedback
  function showSuggestionDialog(bot, message) {    
    let dialog = bot.createDialog('Leave your suggestions', message.callback_id, 'Submit')
      .addSelect('What we need to improve','what',null,[
        {label:'Conversation flow',value:'flow'},
        {label:'Bot response',value:'response'}
      ],{placeholder: 'Select One'})
      .addTextarea('How can we improve','how','',{placeholder: 'Write your comment here'});

    bot.replyWithDialog(message, dialog.asObject(), function(err, res) {
      if (err) console.error('Dialog Error: %s', err);
    });
  }
  
  function handleSuggestionDialogSubmission(bot, message, context) {
    let submission = message.submission;
    let suggestion = {
      what: submission.what,
      how: submission.how
    };
    
    // Pick the right storage system database of filesystem
    let storage = process.env.STORE_FEEDBACK_ON_FS ? controller.storage : mongo;
     
    updateUserFeedback(bot, storage, message, suggestion, function(stored) {
      // Call dialogOk() or else Slack will think this is an error
      stored ? bot.dialogOk() : bot.dialogError({
        "name":"suggestion",
        "error":"An error occurred while saving user's suggestions :fearful:"
      });
    });
  }
  
  function showSurveyDialog(bot, message) {
    let dialog = bot.createDialog('Open feedback', message.callback_id, 'Submit')
      .addTextarea('Here your feedback','comment','',{placeholder: 'Anything you would like to tell us'});

    bot.replyWithDialog(message, dialog.asObject(), function(err, res) {
      if (err){
        console.error('Dialog Error: %s', err);
        console.error('Response: %s', CJSON.stringify(res));
      }
    });
  }
  
  function handleSurveyDialogSubmission(bot, message, context) {
    console.log('"context": ' + CJSON.stringify(context))
    let submission = message.submission;
    let survey = {
      comment: submission.comment,
      level: context.language_level,
      version: context.version,
      conversation: context.conversation_id
    }
    
    // Pick the right storage system database of filesystem
    let storage = process.env.STORE_FEEDBACK_ON_FS ? controller.storage : mongo;

    storeSurvey(bot, storage, message, survey, function(stored) {
      // Call dialogOk() or else Slack will think this is an error
      let err_msg = 'Ops, an error occurred while saving user\'s comment :fearful:';
      stored ? bot.dialogOk() : bot.dialogError({
        "name": "comment",
        "error": err_msg
      });
      
      // We know we have executed this dialog by pressing a button, then,
      // we should have a valid user.latest_button_message to which we
      // should be able to answer.
      let user = findUserOrMake(message.user, false);
      if (user && user.latest_button_message) {
        let ok_msg = 'Thank you for your feedback! :hugging_face:'
        botReplyToActionButton(bot, user.latest_button_message,
          stored ? ok_msg : err_msg);
      }
    });
  }
  
  // Validate the interactive message is part of a current conversation
  function validateAndRespondToUserFeedback(bot, storage, message, context) {
    if (!context || !message.callback_id) return;
      
    // Parse callback_id to extract the conversation_id
    let ids = message.callback_id.split(':', 2);
    let callback_conv_id = ids[0];
       
    // Check message.actions and message.callback_id to see what action to take ...
    if (callback_conv_id == context.conversation_id) {
      
      // Save the user feedback to database/filesystem 
      // and update buttons message with a footer message.
      saveAndRespondToUserFeedback(bot, storage, message, context);
      
      // If the user wants to leave some feedback,
      // then a dialog will pop up, and we will save
      // her/his suggestions only when complete.
      if (message.actions[0].value.match(/maybe/)) {
        showSuggestionDialog(bot, message);
      }
    }
  }
  
  // Handle reset special case
  controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.updateContext(message.user, {}, function (context) {
      let reset_request = clone(message);
      reset_request.text = 'hello';
      middleware.sendToWatson(bot, reset_request, { }, function() {
        botConversationReply(bot, reset_request);
      });
    });
  });
   
  // Handle common cases with  Watson conversation
  controller.hears(['.*'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.interpret(bot, message, function () {
      if (message.watsonError) {
        console.error(message.watsonError);
        bot.reply(message, "I'm sorry, but for technical reasons I can't respond to your message");
      } else {
        debug('"watson": ' + JSON.stringify(message.watsonData));
        botConversationReply(bot, message);
      }
    });
  });
  
  // Handle and interactive message response from buttons press
  controller.on('interactive_message_callback', function(bot, message) {
    console.log('"interactive": %s', CJSON.stringify(message));
    if (!message.callback_id) return;
    
    // Since event handler aren't processed by middleware and have no watsonData 
    // attribute, the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function(err, context) {
      if (!context) return;
      
      // Whether using database of filesystem
      let storage = process.env.STORE_FEEDBACK_ON_FS
        ? controller.storage : mongo;
      
      // Store this message, that is, later we'll be able to responde to it
      let user = findUserOrMake(message.user, false);
      if (user) {
        user.latest_button_message = message;
      }
      
      // Language button
      if (message.callback_id == 'pick_language_level') {
        var languge_level = message.actions[0].name;
        sendReadyToContinueToken(bot, message, {language_level: languge_level});

        let footer_string = sprintf("The story will be for a %s level", languge_level);
        botReplyToActionButton(bot, message, footer_string);
      }
      // Survey button
      else if (message.callback_id == 'survey') {
        showSurveyDialog(bot, message);
      }
      // Feedback button
      else {
        validateAndRespondToUserFeedback(bot, storage, message, context);
      }
    });
  });
  
  // Handle a dialog submission the values from the form are in event.submission    
  controller.on('dialog_submission', function(bot, message) {
    console.log('"submission": ' + CJSON.stringify(message))
    if (!message.callback_id) return;
    
    middleware.readContext(message.user, function(err, context) {
      if (!context) return;
      
      // Parse callback_id to distinguish different dialog submissions
      if (message.callback_id == 'survey') {
        handleSurveyDialogSubmission(bot, message, context);
      }
      else {
        handleSuggestionDialogSubmission(bot, message, context);
      }
    });
  });

} 