require('dotenv').load()

var clone = require('clone');
var debug = require('debug')('pirate-talk:converse');
var merge = require('deepmerge');
var CJSON = require('circular-json');

var mongo = require('botkit-storage-mongo')({
  mongoUri: process.env.MONGO_URI, tables: [
    'workspaces', 'feedbacks'
  ]
});

module.exports = function (controller, middleware) {
  
  // Keep an array of users in order to reduce concurrency
  // as much as possible when storing history information.
  var users = [];
  
  // Look up for a user, if doesn't exist, and `create` 
  // is true, then, a new one will be created.
  function findUser(user_id, create) {
    // Find the user if exists
    let user = users.find(function(item) {
      return item.id && item.id == user_id;
    });
    
    if (!user && create) {
      user = {
        id: user_id,
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
  
  // Main reply function, where all the logic to
  // interact with watson conversation is processed.
  function botConversationReply(bot, msg) {
    debug('Message: ' + JSON.stringify(msg));

    var has_attachments = false;
    if (msg.watsonData.output.action && msg.watsonData.output.action.attachments) {
      has_attachments = true;
      bot.reply(msg, {
        attachments: msg.watsonData.output.action.attachments
      });
    }
    
    // Construct the replay message
    var reply = {
        text: msg.watsonData.output.text.join('\n'),
        attachments : []
    };
    
    // No feedback request if specifically removed
    var no_feedback_request = (msg.watsonData.output.action && msg.watsonData.output.action.no_feedback);
  
    // Request for a feedback, if this is not the first dialog round.
    if (!no_feedback_request) {
      
      // Reply with feedback request, that is, adding action buttons
      reply.attachments.push({
        // callback_id will be in the form of: conversation_id:turn_counter.
        // This is necessary because we can have answers that are given
        // out of order, it is not necessarily last a lifo process.
        callback_id: msg.watsonData.context.conversation_id.concat(
          ':', msg.watsonData.context.system.dialog_turn_counter),
        mrkdwn_in: ['text'],
        text: '',
        actions: [{
          "name": "ok",
          "text": "Right :thumbsup:",
          "value": "good",
          "style": "primary",
          "type": "button"
        }, {
          "name": "no",
          "text": "Wrong :thumbsdown:",
          "value": "bad",
          "style": "danger",
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
    setTimeout(function() {
      debug('Reply: ' + JSON.stringify(reply));
      bot.reply(msg, reply);
      
      // Retrieve the user, or make a new one if doesn't exist
      let user = findUser(msg.user, true);
      let dialogs = user.history;
      
      // Add a dialog info to the list of dialogs. When the conversation restarts, the index
      // of dialog_turn_counter starts over again, hence, previous dialogs will be overwritten,
      // and this will prevent the array to grow indefinitely.
      dialogs.splice(msg.watsonData.context.system.dialog_turn_counter, 1, {
        user_input: msg.watsonData.input.text,
        bot_output: msg.watsonData.output.text,
        intents: msg.watsonData.intents,
        entities: msg.watsonData.entities,
        turn_id: msg.watsonData.context.system.dialog_turn_counter,
        conversation_id: msg.watsonData.context.conversation_id,
        user_id: msg.user,
        date: (new Date()).toString()
      })
      
      //debug('Dialogs: ' + JSON.stringify(dialogs, null, 2))

      // At this point we need to check if a jump is needed in order to continue with the conversation.
      // If a jump is needed, then we send Watson a continue placeholder to be consumed.
      if (msg.watsonData.output.action && msg.watsonData.output.action.wait_before_continue) {
        let continue_request = clone(msg);
        continue_request.text = msg.watsonData.output.action.wait_before_continue;
        debug('Continue: ' + JSON.stringify(continue_request));
        middleware.sendToWatson(bot, continue_request, { }, function() {
          botConversationReply(bot, continue_request);
        });
      }
      
    }, (has_attachments) ? 1000 : 0 );
  }
  
  function botReplyToFeedbackButton(bot, message, stored) {   
    // Update the original message, that is, the user will be 
    // notified its contribution it has been taken into account.
    bot.replyInteractive(message, {
      text: message.original_message.text,
      attachments : [{
        fallback: '',
        footer: stored
          ? 'Thanks for the feedback :clap:'
          : 'Some problem occurred when storing feedback :scream:',
        ts: message.action_ts
      }]
    });
  }
  
  function saveAndRespondToUserFeedback(bot, storage, message, context) {
    // Retrieve the turn id
    let ids = message.callback_id.split(':', 2);
    let callback_conv_id = ids[0];
    let callback_turn_id = ids[1];
    
    let user = findUser(message.user, false);
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
        bot_asked: (prev_dialog) ? prev_dialog.bot_output: ''
        }, cur_dialog
      );
      
      // Store the feedback
      storeFeedback(storage, feedback, function(stored) {
        botReplyToFeedbackButton(bot, message, stored)
      });
    }  
  }
  
  // Show the dialog to allow the user to provide written feedback
  function showSuggestionDialog(bot, message) {    
    let dialog = bot.createDialog('Leave your suggestions', message.callback_id, 'Submit')
      .addSelect('What we need to improve','what',null,[{label:'Conversation flow',value:'flow'},{label:'Bot response',value:'response'}],{placeholder: 'Select One'})
      .addTextarea('How can we improve','how','',{placeholder: 'Write your comment here'});

    bot.replyWithDialog(message, dialog.asObject(), function(err, res) {
      if (err) console.error('Dialog Error: %s', err);
    });
  }
  
  // Validate the interactive message is part of a current conversation
  function validateAndRespondToAction(bot, storage, message, context) {
    if (!context || !message.callback_id) return;
      
    // Parse callback_id to extract the conversation_id
    let ids = message.callback_id.split(':', 2);
    let callback_conv_id = ids[0];
       
    // Check message.actions and message.callback_id to see what action to take ...
    if (callback_conv_id == context.conversation_id) {
      
      // Save the user feedback to database/filesystem
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
      debug('Context: ' + JSON.stringify(context));
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
        debug('Watson: ' + JSON.stringify(message.watsonData));
        botConversationReply(bot, message);
      }
    });
  });
  
  // Handle and interactive message response from buttons press
  controller.on('interactive_message_callback', function(bot, message) {
    debug('Interactive: %j', message);
    
    // Since event handler aren't processed by middleware and have no watsonData 
    // attribute, the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function(err, context) {
      
      // Whether using database of filesystem
      let storage = process.env.STORE_FEEDBACK_ON_FS
        ? controller.storage : mongo;
      
      validateAndRespondToAction(bot, storage, message, context);
    });
  });
  
  // Handle a dialog submission the values from the form are in event.submission    
  controller.on('dialog_submission', function(bot, message) {
    middleware.readContext(message.user, function(err, context) {
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
          "error":"An error occurred while saving your suggestions :fearful:"
        });
      });
    });
  });

} 