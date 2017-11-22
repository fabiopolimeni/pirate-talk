require('dotenv').load()

let Speech = function () {
  
  var _stt = null;
  var _tts = null;

  if (process.env.USE_AZURE_STT || process.env.USE_AZURE_TTS) {
    let _azure_speech = require('./azure_speech');

    if (process.env.USE_AZURE_TTS) {
      console.log('Azure Text-to-Speech service used')
      _tts = _azure_speech.tts;
    }
    if (process.env.USE_AZURE_STT) {
      console.log('Azure Speech-to-Text service used')
      _stt = _azure_speech.stt;
    }
  }

  if (process.env.USE_WATSON_STT || process.env.USE_WATSON_TTS) {
    let _watson_speech = require('./watson_speech');

    if (process.env.USE_WATSON_TTS) {
      console.log('Watson Speech-to-Text service used')
      _tts = _watson_speech.tts;
    }
    if (process.env.USE_WATSON_STT) {
      console.log('Watson Text-to-Speech service used')
      _stt = _watson_speech.stt;
    }
  }

  return {
    stt: _stt,
    tts: _tts
  }
}

module.exports = new Speech();