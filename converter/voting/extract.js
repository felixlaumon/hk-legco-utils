'use strict';

var async = require('async');
var _ = require('lodash');
var cheerio = require('cheerio');
var mkdirp = require('mkdirp');
var fs = require('fs');
var request = require('request');
var path = require('path');
var util = require('../util');
var debug = require('debug')('voting');
var noop = function () {};

module.exports.start = function (cb) {
  this.extract(null, cb);
};

function normalizeChName (name) {
  return name.replace('強', '强');
}

function extractXmlUrls (session, cb) {
  request(session.url, function (err, response, body) {
    if (err || response.statusCode !== 200) { return cb(err || response); }
    var $ = cheerio.load(body);

    // cm20121024 => 20121024
    var dates = _.map($('a[name^=cm]'), function (el) {
      return $(el).attr('name').substring(2);
    });

    // 20121024 => 12-13
    var yy1 = +dates[0].substring(2, 4);
    var yy2 = yy1 + 1;

    var xml_urls = dates.map(function (date) {
      var url = 'http://www.legco.gov.hk/yr' + yy1 + '-' + yy2 + '/chinese/counmtg/voting/cm_vote_' + date + '.xml';
      return url;
    });
    debug('extracted %s urls for yr', xml_urls.length, session.yr);

    session.xml_urls = xml_urls;
    cb(null, session);
  });
}

function downloadXml (url, cb) {
  request(url, function (err, response, body) {
    if (err) { return cb(err); }
    if (response.statusCode !== 200) { return cb(null, null); }
    cb(null, {url: url, body: body});
  });
}

function downloadXmls (session, cb) {
  async.map(session.xml_urls, downloadXml, function (err, xmls) {
    if (err) { return cb(err); }
    xmls = xmls.filter(function (xml) { return xml && xml.body; });
    debug('downloaded %s xml for yr', xmls.length, session.yr);
    session.xmls = xmls;
    cb(null, session);
  });
}

function saveXml (xml, cb) {
  var yr = this.yr;
  var dirPrefix = './data/voting-raw/';
  var dir = dirPrefix + yr + '/';
  var ext = '.xml';
  var name = path.basename(xml.url, ext);
  debug('saving to %s', dir + name + ext);
  mkdirp.sync(dir);
  fs.writeFile(dir + name + ext, xml.body, cb);
}

function saveXmls (session, cb) {
  async.map(session.xmls, saveXml.bind(session), function (err) {
    if (err) { return cb(err); }
    debug('saved %s xml for yr %s', session.xmls.length, session.yr);
    cb(null, session);
  });
}

function parseXml (xml, cb) {
  util.parseXml(xml.body, function (err, parsedXml) {
    if (err) { return cb(err); }
    debug('parsed %s', xml.url);
    xml.parsed = parsedXml;
    cb(null, xml);
  });
}

function parseXmls (session, cb) {
  async.map(session.xmls, parseXml, function (err) {
    if (err) { return cb(err); }
    cb(null, session);
  });
}

function xmlToJson (xml, cb) {
  var votings = xml.parsed['legcohk-vote'].meeting[0].vote;
  votings = votings.map(function (voting) {
    // Process individual votes result
    var votes = voting['individual-votes'][0].member;
    votes = votes.map(function (vote) {
      return {
        vote: vote.vote[0],
        name_ch: normalizeChName(vote.$['name-ch']),
        name_en: vote.$['name-en'],
        constituency: vote.$.constituency
      };
    });

    // Process result summary
    var fc_summary = util.unwrapArray(voting['vote-summary'][0]['functional-constituency']);
    fc_summary = _.mapValues(fc_summary, util.tryParseInt);
    fc_summary = {
      present: fc_summary['preset-count'],
      vote: fc_summary['vote-count'],
      yes: fc_summary['yes-count'],
      no: fc_summary['no-count'],
      abstain: fc_summary['abstain-count'],
      result: fc_summary.result
    };
    var gc_summary = util.unwrapArray(voting['vote-summary'][0]['geographical-constituency']);
    gc_summary = _.mapValues(gc_summary, util.tryParseInt);
    gc_summary = {
      present: gc_summary['preset-count'],
      vote: gc_summary['vote-count'],
      yes: gc_summary['yes-count'],
      no: gc_summary['no-count'],
      abstain: gc_summary['abstain-count'],
      result: gc_summary.result
    };

    var isAmmendment = _.contains(voting['motion-en'][0], 'AMENDMENT BY');
    var isSeparateMechanism = voting['vote-separate-mechanism'][0] === 'Yes';

    return {
      motion_ch: voting['motion-ch'][0],
      motion_en: voting['motion-en'][0],
      mover_ch: voting['mover-ch'][0],
      mover_en: voting['mover-en'][0],
      mover_type: voting['mover-type'][0],
      ammendment: isAmmendment,
      date: voting['vote-date'][0],
      time: voting['vote-time'][0],
      separate_mechanism: isSeparateMechanism,
      summary: {
        fc: fc_summary,
        gc: gc_summary,
        overall: voting['vote-summary'][0].overall[0].result[0]
      },
      votes: votes,
    };
  });

  xml.json = votings;
  cb(null, xml);
}

function xmlsToJsons (session, cb) {
  async.map(session.xmls, xmlToJson, function (err) {
    if (err) { return cb(err); }
    cb(null, session);
  });
}

function saveJson (xml, cb) {
  var yr = this.yr;
  var dirPrefix = './data/voting-json/';
  var dir = dirPrefix + yr + '/';
  var ext = '.json';
  var name = path.basename(xml.url, '.xml');
  var json = JSON.stringify(xml.json);
  debug('saving to %s', dir + name + ext);
  mkdirp.sync(dir);
  fs.writeFile(dir + name + ext, json, cb);
}

function saveJsons (session, cb) {
  async.map(session.xmls, saveJson.bind(session), function (err) {
    if (err) { return cb(err); }
    debug('saved %s json for yr %s', session.xmls.length, session.yr);
    cb(null, session);
  });
}

// TODO: this doesn't need to be async...
function groupByMotion (memo, xmls, cb) {
  cb(null, memo.concat(xmls.json));
}

function groupByMotions (session, cb) {
  async.reduce(session.xmls, [], groupByMotion, function (err, motions) {
    if (err) { return cb(err); }
    debug('found %s motion for yr %s', motions.length, session.yr);
    var idPrefix = session.yr;
    motions.forEach(function (motion, i) {
      motion.id = idPrefix + i;
      debug(motion.id);
    });
    session.motions = motions;
    cb(null, session);
  });
}

function attachMemberId (session, cb) {
  _.each(session.motions, function (motion) {
    _.each(motion.votes, function (vote) {
      var member = _.where(session.members, { name: vote.name_ch })[0];
      if (!member) {
        debugger;
      }
      vote.id = member.id || 'not found';
    });
  });

  cb(null, session);
}

function saveMotion (motion, cb) {
  var yr = this.yr;
  var dirPrefix = './data/voting-motion-json/';
  var dir = dirPrefix + yr + '/';
  var ext = '.json';
  var name = motion.id;
  var json = JSON.stringify(motion);
  debug('saving to %s', dir + name + ext);
  mkdirp.sync(dir);
  fs.writeFile(dir + name + ext, json, cb);
}

function saveMotions (session, cb) {
  async.map(session.motions, saveMotion.bind(session), function (err) {
    if (err) { return cb(err); }
    debug('saved %s motions for yr %s', session.motions.length, session.yr);
    cb(null, session);
  });
}

module.exports = function extract (options, callback) {
  options = options || {};
  options.sessions = options.sessions || [];

  async.map(options.sessions, function (session, mapCb) {
    async.waterfall([
      function (cb) { cb(null, session); },
      extractXmlUrls,
      downloadXmls,
      saveXmls,
      parseXmls,
      xmlsToJsons,
      saveJsons,
      groupByMotions,
      attachMemberId,
      saveMotions
    ], mapCb);
  }, callback);
};
