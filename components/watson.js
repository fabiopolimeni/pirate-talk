require('dotenv').load();

module.exports = function(){

    var middleware = require('botkit-middleware-watson')({
        username: process.env.WATSON_CONVERSATION_USERNAME,
        password: process.env.WATSON_CONVERSATION_PASSWORD,
        workspace_id: process.env.WATSON_WORKSPACE_ID,
        url: process.env.WATSON_CONVERSATION_URL || 'https://gateway.watsonplatform.net/conversation/api',
        version_date: '2017-05-26'
    });

    // Customize Watson Middleware object's before and after callbacks.
    middleware.before = function(message, payload, callback) {
        callback(null, payload);
    }

    middleware.after = function(message, response, callback) {
        callback(null, response);
    }

    return middleware;
}