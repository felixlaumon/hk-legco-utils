'use strict';

var q = require('q');
var HTTP = require('q-io/http');
var _ = require('lodash');
var debug = require('debug')('util');
var xml2js = require('xml2js');
var parser = new xml2js.Parser();

// ESnext FTW! Array.from polyfill from https://gist.github.com/hemanth/3155574
module.exports.arrayFrom = function (arg) {
  var O = Object( arg );
  var len = O.length >>> 0;
  var A = [];
  var k = 0;

  while( k < len ) {
    var kValue;
    if ( k in O ) {
      kValue = O[ k ];
      A[ k ] = kValue;
    }
    k++;
  }
  return A;
};

module.exports.download = function (url) {
  return HTTP.request(url).then(function (response) {
    // debug('downloading', url);
    if (response.status !== 200) {
      debug('url %s returned non-200 status', url);
      throw new Error('Non-200 status code');
    }
    return response.body.read();
  }).then(function (buffer) {
    // debug('downloaded', url);
    return buffer.toString();
  });
};

module.exports.qAllFulfilled = function (promises) {
  return q.allSettled(promises)
  .then(function (results) {
    return results.filter(function (result) {
      if (result.state === 'fulfilled') {
        return result.value;
      }
    }).map(function (result) {
      return result.value;
    });
  });
};

module.exports.parseXml = function (xml, cb) {
  parser.parseString(xml, cb);
};

module.exports.unwrapArray = function unwrapArray (obj) {
  if (_.isArray(obj)) {
    return unwrapArray(obj[0]);
  } else if (_.isObject(obj)) {
    return _.mapValues(obj, unwrapArray);
  } else {
    return obj;
  }
};

module.exports.tryParseInt = function (val) {
  var number = parseInt(val, 10);
  return _.isNaN(number) ? val : number;
};
