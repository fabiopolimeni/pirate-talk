require('dotenv').load()

var clone = require('clone');
var debug = require('debug')('pirate-talk:converse');
var merge = require('deepmerge');

module.exports = function (controller, middleware) {

  // Dialog history
  var dialogs = [];
  
  // Store the given feedback for the workspace
  function store_dialog(controller, feedback, workspace_id) {
    return controller.storage.workspaces.get(workspace_id, function(err, workspace) {
      if (err) console.warn('Error: could not read from workspace %s', workspace_id);

      // Create a new one if none exists
      if (!workspace) {
        workspace = {
          id: workspace_id,
          feedbacks: []
        }
      }
      
      // Add the feedback to the workspace
      workspace.feedbacks.push(feedback);
      
      // Save the updated workspace
      console.log('Saving workspace: ' + workspace_id);
      return controller.storage.workspaces.save(workspace, function(err, id) {
        if (err) {
          console.error('Error: could not save workspace %s', id);
          return false;
        }

        return true;
      });
    });
  }
  
  // Main reply function, where all the logic to
  // interact with watson conversation is processed.
  function bot_reply(bot, msg) {
    console.log('Message: ' + JSON.stringify(msg));

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
          "name": "soso",
          "text": "Improve :raised_hand:",
          "value": "maybe",
          "style": "default",
          "type": "button"
        }, {
          "name": "no",
          "text": "Wrong :thumbsdown:",
          "value": "bad",
          "style": "danger",
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
      console.log('Reply: ' + JSON.stringify(reply));
      bot.reply(msg, reply);

      let time_date = new Date();
      
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
        date: time_date.toString()
      })
      
      console.error('Dialogs: ' + JSON.stringify(dialogs, null, 2))

      // At this point we need to check if a jump is needed in order to continue with the conversation.
      // If a jump is needed, then we send Watson a continue placeholder to be consumed.
      if (msg.watsonData.output.action && msg.watsonData.output.action.wait_before_continue) {
        let continue_request = clone(msg);
        continue_request.text = msg.watsonData.output.action.wait_before_continue;
        console.log('Continue: ' + JSON.stringify(continue_request));
        middleware.sendToWatson(bot, continue_request, { }, function() {
          bot_reply(bot, continue_request);
        });
      }
      
    }, (has_attachments) ? 1000 : 0 );
  }
  
  // Handle reset special case
  controller.hears(['reset'], ['direct_message', 'direct_mention', 'mention'], function (bot, message) {
    middleware.updateContext(message.user, {}, function (context) {
      console.log('Context: ' + JSON.stringify(context));
      let reset_request = clone(message);
      reset_request.text = 'hello';
      middleware.sendToWatson(bot, reset_request, { }, function() {
        bot_reply(bot, reset_request);
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
        console.log('Watson: ' + JSON.stringify(message.watsonData));
        bot_reply(bot, message);
      }
    });
  });

  // Receive an interactive message, and reply with a message that will replace the original
  controller.on('interactive_message_callback', function(bot, message) {
    console.log('Interactive: ' + JSON.stringify(message));
    
    // Since event handler aren't processed by middleware and have no watsonData attribute,
    // the context has to be extracted from the current user stored data.
    middleware.readContext(message.user, function(err, context) {
      if (!context || !message.callback_id) return;
      
      // parse callback_id to extract the conversation_id and the turn_id
      let ids = message.callback_id.split(':', 2);
      var callback_conv_id = ids[0];
      var callback_turn_id = ids[1];
    
      // check message.actions and message.callback_id to see what action to take...
      if (callback_conv_id == context.conversation_id) {
        
        // Get last stored dialog, if the dialog_turn and the conversation_id match,
        // then, add the feedback score to the object before we save it to storage.
        let current = dialogs.find(function(dialog){
          return (dialog.turn_id == callback_turn_id)
            && (dialog.conversation_id == context.conversation_id);
        })
        
        // We also need the previous dialog, as we want to
        // extract what the bot has asked in the first place.
        // This is not a mandatory requirement though.
        let previous = dialogs.find(function(dialog){
          return (dialog.turn_id == callback_turn_id - 1)
            && (dialog.conversation_id == context.conversation_id);
        })
        
        // Store given feedback for later revision
        var storage_result = false;
        if (current) {
          console.log('Current: %s\nPrevious: %s',
            JSON.stringify(current), JSON.stringify(previous));
          
          let feedback = merge(
            {
              action: message.text,
              bot_asked: (previous) ? previous.bot_output: ''
            },
            current
          );
          
          storage_result = store_dialog(controller, feedback, process.env.WATSON_WORKSPACE_ID);
        }

        // Update the original message, that is,
        // the user will be notified its contribution
        // it has been taken into account.
        bot.replyInteractive(message, {
          text: message.original_message.text,
          attachments : [{
            fallback: '',
            footer: storage_result
              ? 'Thanks for the feedback :clap:'
              : 'Some problem occurred when storing feedback :scream:',
            ts: message.action_ts
          }]
        });
      }
    });
  });

} 