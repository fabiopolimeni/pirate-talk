var express = require('express');
var bodyParser = require('body-parser');
var verify = require('./security');
var debug = require('debug')('pirate-talk:webserver');

module.exports = function(controller) {

    var webserver = express();
    webserver.use(bodyParser.json({
      verify: verify
    }));
  
    webserver.use(bodyParser.urlencoded({ extended: true }));
    webserver.use(express.static('public'));

    webserver.listen(process.env.WEBSERVER_PORT || 5000, null, function() {
        console.log('Express webserver configured and listening at ' + process.env.WEBSERVER_HOSTNAME + ':' + process.env.WEBSERVER_PORT || 5000);
    });

    return webserver;
}
