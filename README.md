# smart-stream

[![node (scoped)](https://img.shields.io/node/v/@anandsuresh/smart-stream.svg?style=plastic)](https://nodejs.org/en/download/)
[![npm (scoped)](https://img.shields.io/npm/v/@anandsuresh/smart-stream.svg?style=plastic)](https://www.npmjs.com/package/@anandsuresh/smart-stream)
[![npm](https://img.shields.io/npm/dt/@anandsuresh/smart-stream.svg?style=plastic)](https://www.npmjs.com/package/@anandsuresh/smart-stream)
[![Travis](https://img.shields.io/travis/anandsuresh/smart-stream.svg?style=plastic)](https://travis-ci.org/anandsuresh/smart-stream)
[![license](https://img.shields.io/github/license/anandsuresh/smart-stream.svg?style=plastic)](LICENSE)
[![GitHub followers](https://img.shields.io/github/followers/anandsuresh.svg?style=social&label=Follow)](https://github.com/anandsuresh)
[![Twitter Follow](https://img.shields.io/twitter/follow/anandsuresh.svg?style=social&label=Follow)](https://twitter.com/intent/follow?screen_name=anandsuresh)

A smart stream provides the abstraction of a stream of bytes. It has the following properties:

- `contentType`: representing the MIME type of that the stream of bytes represent
- `contentEncoding`: representing the type of encoding (`gzip`, `deflate`, `identity`)
- `contentLength`: the length of the stream, in bytes. Not always available.

## Usage

```
const {fromFile, fromHttpRequest} = require('smart_stream')

async function handleRequest(req, res) {
  try {
    const inStream = fromHttpRequest(req)
    if (!inStream.isDeserializable) {
      res.statusCode = 400
      return res.end()
    }

    const obj = await stream.toObject()

    // Do something with the object
    // Then respond with a file

    fromFile('/path/to/file.jpg', {contentType: 'image/jpeg'}).pipe(res)
  } catch (err) {
    res.statusCode = 500
    res.end(err.stack)
  }
}
```
