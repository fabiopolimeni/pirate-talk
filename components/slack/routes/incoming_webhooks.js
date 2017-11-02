require('dotenv').load()

var debug = require('debug')('botkit:incoming_webhooks');

module.exports = function(webserver, controller) {
    
    debug('Configured /slack/receive url');
    webserver.post('/slack/receive', function(req, res) {
        // respond to Slack that the webhook has been received.
        debug(JSON.stringify(req.body));

        // If a url verification request, then given token
        // must correspond to the one set in the .env file.
        if (req.body.type === 'url_verification'
        && process.env.SLACK_TOKEN != req.body.token) {
            console.error('Vrification rquest error: token received '
             + res.body.token + ', while expected ' + process.env.SLACK_TOKEN);
            return;
        }

        res.status(200);

        // Now, pass the webhook into be processed
        controller.handleWebhookPayload(req, res);
    });
}
