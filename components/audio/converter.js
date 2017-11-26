require('dotenv').load()

const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const request = require('request');
const sprintf = require('sprintf-js').sprintf;
const md5 = require('md5');
const debug = require('debug')('pirate-talk:audio-converter');

module.exports = {
  
  convert: function(input, callback) {

    function _command (input_stream, callback) {
      try {

        var temp_file = sprintf('temp_%s.wav', md5(Date.now()));

        ffmpeg()
          .setFfmpegPath(process.env.FFMPEG_BINARY_PATH)
          .input(input_stream)
          .inputFormat('mp4')
          .output(temp_file, { end: true })
          //.outputFormat('s16le')
          .audioCodec('pcm_s16le')
          .noVideo()
          .audioFrequency(16000)
          .audioChannels(1)
          .on('end', () => {

            // At this point we need to get buffer data 
            // out of the file, and later delete it.
            fs.readFile(temp_file, function(err, buf) {
              if (err && callback && typeof callback === 'function') {
                return callback({
                  type:'error',
                  data: sprintf('An error occurred while reading back the temprary file %s\nError: %s'),
                    temp_file, err
                });
              }

              // Once data has been read from the file, delete it.
              fs.unlink(temp_file, function(err) {
                if (err && callback && typeof callback === 'function') {
                  return callback({
                    type:'error',
                    data: sprintf('An error occurred while deleting the temprary file %s\nError: %s'),
                      temp_file, err
                  });
                }

                // At this point we can send the buffer
                if (buf && callback && typeof callback === 'function') {
                  callback({
                    type:'done',
                    data: buf
                  });
                }
              });
            });
          })
          .on('error', (err) => {
            if (callback && typeof callback === 'function') {
              return callback({
                type:'error',
                data: err
              });
            }
          })
          .run()
      }
      catch (e) {
        console.error('Error: %s', JSON.stringify(e))
      }
    }

    if (!input) {
      if (callback && typeof callback === 'function') {
        return callback({
          type: 'error',
          data: 'Invalid param: input'
        });
      }
    }
  
    if (input.uri) {

      request
        .get(input.uri, function(err) {
          if (err) {
            if (callback && typeof callback === 'function') {
              return callback({
                type: 'error', 
                data: sprintf('HTTP GET error: %s', err)
              });
            }
          }
        })
        .on('response', function(response) {

          var buffer_length = 0;
          response
            .on('data', function(chunk) {
              buffer_length += chunk.length;
              debug('HTTP read %s bytes of data', chunk.length)
            })
            .on('end', function() {
              console.log('HTTP total %s bytes read from %s',
                buffer_length, input.uri)
            })
            .on('error', function(err) {
              if (callback && typeof callback === 'function') {
                return callback({
                  type: 'error', 
                  data: sprintf('HTTP response error: %s', err)
                });
              }
            })

          _command(response, callback);
      })
    }
    else if (input.file) {
      
      if (!fs.existsSync(input.file) && callback && typeof callback === 'function') {
        return callback({
          type: 'error',
          data: sprintf("File %s doesn't exist!", input.file)
        });
      }
      
      let infile_stream = fs.createReadStream(input.file);
      _command(infile_stream, callback);
    }
    else {

      if (callback && typeof callback === 'function') {
        return callback({
          type: 'error',
          data: sprintf('Invalid input protocol: "input": %s!',
            JSON.stringify(input))
        });
      }

    }
  }

}