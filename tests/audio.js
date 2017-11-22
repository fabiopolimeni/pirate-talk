const speech = require('../components/audio/speech')

try {
  var file_url = "https://cdn.fbsbx.com/v/t59.3654-21/23553014_10159556524665573_4415290074652999680_n.mp4/audioclip-1511377629000-24192.mp4?oh=601c12f790d07e267cfe195a9d449de2&oe=5A179BCE";
  //var file_url = 'https://cdn.fbsbx.com/v/t59.3654-21/23735708_10159556785710573_7423145746095931392_n.mp4/audioclip-1511380502000-6016.mp4?oh=bb54c93555a87509d6a800f4d8d9d6f9&oe=5A1796F5'

  speech.stt(file_url, (err, transcript) => {
    if (err) {
      return console.error(err);
    }

    if (transcript) {
      console.log('"transcript": %s', JSON.stringify(transcript))
    }
  })
}
catch (e) {
  console.error('Excpetion: %s', e.message)
}