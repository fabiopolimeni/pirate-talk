require('dotenv').load()

const request = require('request');
const sprintf = require('sprintf-js').sprintf;
const converter = require('./converter');

let AzureSpeech = function () {

  var _auth_token = null;
  function _acquireAuthToken(callback) {
    
    const options = {
        url: 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken',
        method: 'POST',
        headers: {
          'Content-type':'application/x-www-form-urlencoded',
          'Content-Length': '0',
          'Ocp-Apim-Subscription-Key': process.env.AZURE_SUBSCRIPTION_KEY
        }
    };
    
    request(options, function(err, res, body) {
      if (err) throw err;
      
      _auth_token = body;
      console.log('auth-token=%s', _auth_token);
      if (callback && typeof callback === 'function') {
        callback(_auth_token);
      }
    });
  }

  function _recognize(buffer, callback) {
    if (!_auth_token) {
      // This should never happen ...
      throw sprintf("Invalid authorization token!");
    }

    console.log(sprintf('Transferring %d bytes,audio length %.2f sec.',
      buffer.length, buffer.length / 16000 / 2));
    const options = {
      url: 'https://speech.platform.bing.com/speech/recognition/conversation/cognitiveservices/v1?language=en-us&format=detailed',
      method: 'POST',
      headers: {
        'Accept': 'application/json;text/xml',
        'Content-type': 'audio/wav; codec=audio/pcm; samplerate=16000',
        'Content-Length': buffer.length,
        'Host': 'speech.platform.bing.com',
        'Transfer-Encoding': 'chunked',
        'Expect': '100-continue',
        'Authorization': 'Bearer ' + _auth_token
      },
      body: buffer
    };
  
    request(options, function(err, res, body) {
      if (err && callback && typeof callback === 'function') {
        return callback(
          sprintf('An error occurred while requesting a speech conversion: %s',
            err));
      }
      
      if (!body && callback && typeof callback === 'function') {
        return callback('Error: No body response from the STT service!');
      }
      
      if (res.statusCode !== 200 && callback && typeof callback === 'function') {
        return callback(sprintf('Request error: %s (code:%d)', body, res.statusCode));
      }

      let payload = JSON.parse(body);

      // RecognitionStatus must be present
      if (!payload.RecognitionStatus && callback && typeof callback === 'function') {
        return callback(sprintf('Corrupted response payload: %j', payload));
      }
      
      // We have a valid transcript only if the status is 'Success'
      if (payload.RecognitionStatus == 'Success') {
        let transcript = null;
        
        // Simple request
        if (payload.DisplayText) {
          transcript = {
            text: payload.DisplayText,
            confidence: 1.0
          }
        }
        // Detailed request
        else if (payload.NBest && payload.NBest.length) {
          transcript = {
            text: payload.NBest[0].Display,
            confidence: payload.NBest[0].Confidence
          }
        }
        else if (callback && typeof callback === 'function') {
          return callback(sprintf('Invalid transcript payload: %j', payload));
        }

        // Notify the requested the final result
        if (callback && typeof callback === 'function') {
          transcript.seconds = buffer.length / 16000 / 2;
          return callback(null, transcript);
        }
      }
      // Any other RecognitionStatus will trigger a warning
      else if (callback && typeof callback === 'function') {
        return callback(sprintf(
            'Error, incomplete transcript. Recognition status: ',
              payload.RecognitionStatus));
      }

    });
  }

  function _stt(url, callback) {
    converter.convert({ uri: url }, (result) => {
        if (!result && callback && typeof callback === 'function') {
          return callback(
            sprintf('No valid result while converting %s', url));
        }
    
        if (result.type == 'error' && callback && typeof callback === 'function') {
          return callback(
            sprintf('An error occurred while converting %s\nError: %s',
              url, result.data));
        }

        if (result.type == 'done' && 
          result.data instanceof Buffer) {
          if (!_auth_token) {
            // Authorization token is not ready yet,
            // we need to retrieve it before continuing.
            _acquireAuthToken((token) => {
              _recognize(result.data, callback);
            })
          }
          else {
            _recognize(result.data, callback);
          }
        }
        else if (callback && typeof callback === 'function') {
          return callback(
            sprintf('Corrupted buffer data while converting %s', url));
        }
    })
  }

  function _tss(text, callabck) {

  }

  // Auth tokens expire within 10 minutes,
  // then, refresh every: ms * sec * min.
  const interval_ms = 1000 * 60 * 8;
  setInterval(_acquireAuthToken, interval_ms);

  return {
    stt: _stt,
    tts: _tss
  }
}

module.exports = new AzureSpeech();