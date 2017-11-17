var debug = require('debug')('botkit:incoming_webhooks');
const CJSON = require('circular-json');

module.exports = function (webserver, controller, bot) {

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
        }
        else {
          res.send('OK');
        }
      }
    });

    debug('Configured POST /facebook/form url for receiving forms submission');
    webserver.post('/facebook/form', function (req, res) {
      if (req.body && req.body.payload_id) {
        
        let tokens = req.body.payload_id.split('.');
        
        if (tokens.length >= 4) {
          let message = {
            action: tokens[0],
            user: tokens[1],
            conversation: tokens[2],
            turn: tokens[3]
          }
          
          res.status(200);
          res.send('OK');
          
          controller.trigger('form_received', [bot, message]);
        }
      }
    });

}