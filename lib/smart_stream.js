/**
 * @file An implementation of a smart stream
 *
 * @author Anand Suresh <anandsuresh@gmail.com>
 * @copyright Copyright (C) 2018 Anand Suresh. All rights reserved.
 */

const {createReadStream} = require('fs')
const {PassThrough} = require('stream')
const qs = require('querystring')
const zlib = require('zlib')
const msgpack = require('msgpack5')()
const {create: createTimer} = require('@anandsuresh/smart-timer')

/**
 * A regular expression for valid MIME types
 * @type {RegExp}
 */
const CONTENT_TYPES = /^((application|audio|image|multipart|text|video)\/([\w-]+));?.*$/

/**
 * A regular expression for valid content encodings
 * @type {RegExp}
 */
const CONTENT_ENCODINGS = /^(identity|gzip|deflate)$/

/**
 * A list of deserializable MIME types
 * @type {Array}
 */
const DESERIALIZABLE_TYPES = [
  'application/json',
  'application/msgpack',
  'application/x-www-urlencoded'
]

/**
 * A list of compressed encodings
 * @type {Array}
 */
const COMPRESSED_ENCODINGS = ['gzip', 'deflate']

/**
 * Serializes an object into a buffer
 *
 * @param {String} type The MIME type of the serialization algorithm
 * @param {Object} data The data to be serialized
 * @returns {Buffer}
 */
function serialize (type, data) {
  switch (type) {
    case 'application/json':
      return Buffer.from(JSON.stringify(data))

    case 'application/msgpack':
      return msgpack.encode(data).slice()

    case 'application/x-www-form-urlencoded':
      return Buffer.from(qs.stringify(data))

    default:
      throw new TypeError(`unknown type "${type}"!`)
  }
}

/**
 * Deserializes a buffer into an object
 *
 * @param {String} type The MIME type of the serialization algorithm
 * @param {Buffer} data The data to be deserialized
 * @returns {Object}
 */
function deserialize (type, data) {
  switch (type) {
    case 'application/json': {
      const val = JSON.parse(data.toString('utf8'))
      return (val === 'null') ? null : val
    }

    case 'application/msgpack':
      return msgpack.decode(data).slice()

    case 'application/x-www-form-urlencoded':
      return qs.parse(data.toString('utf8'))

    default:
      throw new TypeError(`unknown type "${type}"!`)
  }
}

/**
 * Compresses a stream/buffer
 *
 * @param {String} algorithm The algorithm to use for compression
 * @param {Buffer|Readable} data The data to be compressed
 * @returns {Promise<Readable>}
 */
function compress (algorithm, data) {
  let stream

  if (algorithm === 'gzip') {
    stream = zlib.createGzip()
  } else if (algorithm === 'deflate') {
    stream = zlib.createDeflate()
  } else if (algorithm === 'identity') {
    stream = new PassThrough()
  } else {
    throw new TypeError(`unknown algorithm "${algorithm}"!`)
  }

  if (Buffer.isBuffer(data)) {
    stream.end(data)
  } else if (typeof data.pipe === 'function') {
    data.pipe(stream)
  } else {
    throw new TypeError(`expected a Buffer/Readable; got "${typeof data}"`)
  }

  return stream
}

/**
 * Decompresses a stream/buffer
 *
 * @param {String} algorithm The algorithm to use for compression
 * @param {Buffer|Stream} data The data to be decompressed
 * @returns {Promise<Buffer|Stream>}
 */
function decompress (algorithm, data) {
  let stream

  if (algorithm === 'gzip') {
    stream = zlib.createGunzip()
  } else if (algorithm === 'deflate') {
    stream = zlib.createInflate()
  } else if (algorithm === 'identity') {
    stream = new PassThrough()
  } else {
    throw new TypeError(`unknown algorithm "${algorithm}"!`)
  }

  if (Buffer.isBuffer(data)) {
    stream.end(data)
  } else if (typeof data.pipe === 'function') {
    data.pipe(stream)
  } else {
    throw new TypeError(`expected a Buffer/Readable; got "${typeof data}"`)
  }

  return stream
}

/**
 * Collects a stream into a buffer
 *
 * @param {Readable} stream The stream to collect
 * @returns {Promise<Buffer>}
 */
function streamToBuffer (stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream
      .on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      .once('end', () => resolve(Buffer.concat(chunks)))
      .once('error', reject)
  })
}

/**
 * An implementation of a smart stream
 * @extends {PassThrough}
 * @type {SmartStream}
 */
class SmartStream extends PassThrough {
  /**
   * An implementation of a smart stream
   *
   * @param {Object} props Properties of the instance
   * @param {String} props.contentType The MIME type of the stream
   * @param {String} props.contentEncoding The encoding of the stream
   * @param {Boolean} [props.endStream=true] Whether to end the smart-stream when the incoming stream ends
   * @param {Number} [props.limit=16384] The maximum number of bytes accepted before terminating the input
   * @param {Number} [props.timeout=2000] The timeout (ms) for receiving the incoming data
   * @param {Number} [props.interval=100] The interval (ms) to check for timeouts
   * @returns {SmartStream}
   */
  constructor (props) {
    if (props == null) {
      throw new TypeError('props is a required argument!')
    } else if (!CONTENT_TYPES.test(props.contentType)) {
      throw new TypeError(`"${props.contentType}" is not a valid content type!`)
    } else if (!CONTENT_ENCODINGS.test(props.contentEncoding)) {
      throw new TypeError(`"${props.contentEncoding}" is not a valid encoding!`)
    }

    super()

    this._props = props = Object.assign({
      endStream: true,
      limit: 16384,
      timeout: 2000,
      interval: 100
    }, props, {
      contentType: CONTENT_TYPES.exec(props.contentType)[1],
      _src: null
    })

    let size = 0
    const timer = createTimer(duration => {
      this.emit('error', new Error(`timed out after ${duration}ms`))
    }, props)

    // monkey-patch the _write() method to track progress. The alternate method
    // was to track data events on "this" SmartStream, which would unpause this
    // stream and might cause its destination to lose data unless the caller
    // synchonously attaches a data event handler or pipes it.
    const oldWrite = this._write
    this._write = (chunk, encoding, cb) => {
      size += Buffer.byteLength(chunk)
      if (size <= props.limit) {
        timer.touch()
        return oldWrite.call(this, chunk, encoding, cb)
      }

      this.emit('error', new Error(`size exceeds ${props.limit} bytes`))
    }

    this
      .on('pipe', src => {
        if (props._src != null) {
          throw new Error(`cannot pipe multiple streams into a smart stream!`)
        }

        props._src = src.once('error', err => this.emit('error', err))
      })
      .once('error', err => {
        timer.destroy(err)
        if (props._src != null && typeof props._src.destroy === 'function') {
          props._src.destroy(err)
        }
        this.destroy(err)
      })
      .once('finish', () => timer.destroy())
  }

  /**
   * Returns the MIME type of the stream
   * @name {SmartStream#contentType}
   * @type {String}
   */
  get contentType () {
    return this._props.contentType
  }

  /**
   * Returns the encoding of the stream
   * @name {SmartStream#contentEncoding}
   * @type {String}
   */
  get contentEncoding () {
    return this._props.contentEncoding
  }

  /**
   * Returns whether to end the smart-stream when the incoming stream ends
   * @name {SmartStream#endStream}
   * @type {Boolean}
   */
  get endStream () {
    return this._props.endStream
  }

  /**
   * Returns the maximum number of bytes accepted before terminating the input
   * @name {SmartStream#limit}
   * @type {Number}
   */
  get limit () {
    return this._props.limit
  }

  /**
   * Returns the timeout (ms) for receiving the incoming data
   * @name {SmartStream#timeout}
   * @type {Number}
   */
  get timeout () {
    return this._props.timeout
  }

  /**
   * Returns the interval (ms) to check for timeouts
   * @name {SmartStream#interval}
   * @type {Number}
   */
  get interval () {
    return this._props.interval
  }

  /**
   * Returns whether or not the stream is compressed
   * @name {SmartStream#isCompressed}
   * @type {Boolean}
   */
  get isCompressed () {
    return COMPRESSED_ENCODINGS.indexOf(this.contentEncoding) >= 0
  }

  /**
   * Returns whether or not the stream is deserializable
   * @name {SmartStream#isDeserializable}
   * @type {Boolean}
   */
  get isDeserializable () {
    return DESERIALIZABLE_TYPES.indexOf(this.contentType) >= 0
  }

  /**
   * Collects the incoming stream into a buffer
   *
   * @param {Boolean} toIdentity Whether or not the convert the stream into an identity-encoded stream
   * @returns {Promise<Buffer>}
   */
  toBuffer (toIdentity) {
    return (this.isCompressed && toIdentity)
      ? decompress(this.contentEncoding, this).then(streamToBuffer)
      : streamToBuffer(this)
  }

  /**
   * Parses a stream into an object
   *
   * NOTE: The caller is responsible to check if the stream is deserializable.
   *
   * @returns {Promise<Object>}
   */
  toObject () {
    return this.toBuffer(true).then(buf => deserialize(this.contentType, buf))
  }
}

/**
 * Creates a SmartStream
 *
 * @param {Object} [props] Properties of the stream
 * @param {String} [props.contentType='application/json'] The MIME type of the stream
 * @param {String} [props.contentEncoding='identity'] The encoding of the stream
 * @param {Boolean} [props.endStream] Whether to end the smart-stream when the incoming stream ends
 * @param {Number} [props.limit] The maximum number of bytes accepted before terminating the input
 * @param {Number} [props.timeout] The timeout (ms) for receiving the incoming data
 * @param {Number} [props.interval] The interval (ms) to check for timeouts
 * @returns {SmartStream}
 */
function create (props) {
  return new SmartStream(props)
}

/**
 * Creates a SmartStream from another stream
 *
 * @param {Readable} stream The stream to convert into a SmartStream
 * @param {Object} [props] Properties of the stream
 * @param {String} [props.contentType='application/json'] The MIME type of the stream
 * @param {String} [props.contentEncoding='identity'] The encoding of the stream
 * @param {Boolean} [props.endStream] Whether to end the smart-stream when the incoming stream ends
 * @param {Number} [props.limit] The maximum number of bytes accepted before terminating the input
 * @param {Number} [props.timeout] The timeout (ms) for receiving the incoming data
 * @param {Number} [props.interval] The interval (ms) to check for timeouts
 * @returns {SmartStream}
 */
function fromStream (stream, props) {
  return stream.pipe(create(props))
}

/**
 * Creates a SmartStream from a file
 *
 * @param {String} path Path to the file
 * @param {Object} props Properties of the stream
 * @param {String} [props.contentType='application/octet-stream'] The MIME type of the stream
 * @param {String} [props.contentEncoding='identity'] The encoding of the stream
 * @param {Boolean} [props.endStream] Whether to end the smart-stream when the incoming stream ends
 * @param {Number} [props.limit=1048576] The maximum number of bytes accepted before terminating the input
 * @param {Number} [props.timeout] The timeout (ms) for receiving the incoming data
 * @param {Number} [props.interval] The interval (ms) to check for timeouts
 * @returns {SmartStream}
 */
function fromFile (path, props) {
  return fromStream(createReadStream(path), Object.assign({
    contentType: 'application/octet-stream',
    contentEncoding: 'identity',
    limit: 1048576
  }, props))
}

/**
 * Creates a SmartStream from an HTTP IncomingMessage object
 *
 * @param {IncomingMessage} req An HTTP (server) request or (client) response
 * @param {Object} [props] Properties of the stream
 * @param {String} [props.contentType='application/octet-stream'] The MIME type of the stream
 * @param {String} [props.contentEncoding='identity'] The encoding of the stream
 * @param {Boolean} [props.endStream] Whether to end the smart-stream when the incoming stream ends
 * @param {Number} [props.limit] The maximum number of bytes accepted before terminating the input
 * @param {Number} [props.timeout] The timeout (ms) for receiving the incoming data
 * @param {Number} [props.interval] The interval (ms) to check for timeouts
 * @returns {SmartStream}
 */
function fromHttpRequest (req, props) {
  return fromStream(req, Object.assign({
    contentType: req.headers['content-type'] || 'application/octet-stream',
    contentEncoding: req.headers['content-encoding'] || 'identity'
  }, props))
}

/**
 * Creates a SmartStream from an object
 *
 * @param {String} obj The object to convert into a stream
 * @param {Object} [props] Properties of the stream
 * @param {String} [props.contentType='application/json'] The MIME type of the stream
 * @param {String} [props.contentEncoding='identity'] The encoding of the stream
 * @param {Boolean} [props.endStream] Whether to end the smart-stream when the incoming stream ends
 * @param {Number} [props.limit] The maximum number of bytes accepted before terminating the input
 * @param {Number} [props.timeout] The timeout (ms) for receiving the incoming data
 * @param {Number} [props.interval] The interval (ms) to check for timeouts
 * @returns {Promise<*>}
 */
function fromObject (obj, props) {
  props = Object.assign({
    contentType: 'application/json',
    contentEncoding: 'identity'
  }, props)

  const buf = serialize(props.contentType, obj)
  const stream = compress(props.contentEncoding, buf)
  return fromStream(stream, props)
}

/**
 * Export the interface
 * @type {Object}
 */
module.exports = {create, fromStream, fromFile, fromHttpRequest, fromObject}
