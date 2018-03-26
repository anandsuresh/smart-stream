/**
 * @file An implementation of a smart stream
 *
 * @author Anand Suresh <anandsuresh@gmail.com>
 * @copyright Copyright (C) 2018 Anand Suresh. All rights reserved.
 */

const {expect} = require('chai')
const {readFileSync} = require('fs')
const http = require('http')
const SmartStream = require('../lib/smart_stream')

describe('SmartStream', () => {
  it('api', () => {
    expect(SmartStream).to.be.an('object')
    expect(SmartStream.create).to.be.a('function')
    expect(SmartStream.fromStream).to.be.a('function')
    expect(SmartStream.fromFile).to.be.a('function')
    expect(SmartStream.fromHttpRequest).to.be.a('function')
    expect(SmartStream.fromObject).to.be.a('function')
  })

  describe('.fromFile()', function () {
    it('should create a stream for the specified file', function (done) {
      const thisFile = readFileSync(__filename)
      const stream = SmartStream.fromFile(__filename, {
        contentType: 'text/javascript'
      })

      expect(stream.contentType).to.equal('text/javascript')
      expect(stream.contentEncoding).to.equal('identity')

      stream
        .toBuffer()
        .then(buf => {
          expect(buf.toString('utf8')).to.equal(thisFile.toString('utf8'))
          done()
        })
        .catch(done)
    })
  })

  describe('.fromHttpRequest()', function () {
    it('should create a stream for the specified object', function (done) {
      const thisFile = readFileSync(__filename)
      const server = http
        .createServer()
        .on('request', (req, res) => {
          const stream = SmartStream.fromHttpRequest(req)

          expect(stream.contentType).to.equal('application/javascript')
          expect(stream.contentEncoding).to.equal('identity')

          stream
            .toBuffer()
            .then(buf => {
              expect(buf.toString('utf8')).to.equal(thisFile.toString('utf8'))
              res.end()
            })
            .catch(done)
        })
        .on('listening', () => {
          http
            .request({
              method: 'POST',
              port: 8080,
              headers: {'content-type': 'application/javascript'}
            })
            .on('error', done)
            .on('response', res => {
              expect(res.statusCode).to.equal(200)
              server.close()
              done()
            })
            .end(thisFile)
        })
        .listen(8080)
    })
  })

  describe('.fromObject(), .toObject()', function () {
    it('should serialize and deserialize an object', function (done) {
      const obj = {foo: 'bar', bar: 'baz'}
      SmartStream
        .fromObject(obj)
        .toObject()
        .then(streamObj => {
          expect(streamObj).to.deep.equal(obj)
          done()
        })
        .catch(done)
    })
  })
})
