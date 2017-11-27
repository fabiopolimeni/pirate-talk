const debug = require('debug')('botkit:facebook-webhooks');
const sprintf = require('sprintf-js').sprintf;

module.exports = function (webserver, controller, bot, database) {

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

    debug('Configured GET /facebook/transcript url for retrieving an audio transcript');
    webserver.get('/facebook/transcript', function (req, res) {
      console.log('"query": %s', JSON.stringify(req.query));

      if (!req.query || !req.query.conversation || !req.query.turn) {
        // Bad request: Invalid query
        return res.status(400)
      }

      let transcript_id = sprintf('%s:%s', req.query.conversation, req.query.turn)
      database.getTranscript(transcript_id,
        function receivedTranscript(err, transcript) {
          if (err) {
            // Not found: Transcript doesn't exist
            return res.status(404);
          }

          res.status(200);
          res.json(transcript);
        })
    });

    debug('Configured POST /facebook/form url for receiving forms submission');
    webserver.post('/facebook/form', function (req, res) {
      if (req.body) {
        res.status(200);
        res.send('OK');  
        controller.trigger('form_received', [bot, req.body]);
      }
    });

}