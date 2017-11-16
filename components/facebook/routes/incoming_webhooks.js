var debug = require('debug')('botkit:incoming_webhooks');

module.exports = function (webserver, controller) {

    debug('Configured POST /facebook/receive url for receiving events');
    webserver.post('/facebook/receive', function (req, res) {
        // NOTE: we should enforce the token check here
        // respond to Facebook that the webhook has been received.
        res.status(200);
        res.send('ok');
        var bot = controller.spawn({});
        // Now, pass the webhook into be processed
        controller.handleWebhookPayload(req, res, bot);
    });

    debug('Configured GET /facebook/receive url for verification');
    webserver.get('/facebook/receive', function (req, res) {
        if (req.query['hub.mode'] == 'subscribe') {
            if (req.query['hub.verify_token'] == controller.config.verify_token) {
                res.send(req.query['hub.challenge']);
            } else {
                res.send('OK');
            }
        }
    });

    debug('Configured POST /facebook/form url for receiving forms submission');
    webserver.post('/facebook/form', function (req, res) {

        console.log('"form": %s', JSON.stringify(req))
        res.status(200);
        res.send('OK');
    });

}