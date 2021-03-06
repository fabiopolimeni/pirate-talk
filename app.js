require('dotenv').load();

// Load and initialise the watson botkit middeleware
var middelware = require(__dirname + '/components/watson.js')();

// Set up an Express-powered webserver to expose oauth and webhook endpoints
var webserver = require(__dirname + '/components/webserver.js')();

// Create the Botkit controller, which controls all instances of the bot
require(__dirname + '/bots.js')(webserver, middelware);

// Load in some helpers to keep the Glitch server alive
require(__dirname + '/components/glitch.js')();