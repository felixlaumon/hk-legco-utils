'use strict';

var _ = require('lodash');
var async = require('async');
var cheerio = require('cheerio');
var path = require('path');
var fs = require('fs');
var mkdirp = require('mkdirp');
var request = require('request');
var util = require('../util');
var debug = require('debug')('members');
var noop = function () {};

var default_biography_pages = [{
   yr: '1216',
   // url: 'http://www.legco.gov.hk/general/chinese/members/yr12-16/biographies.htm',
   urls: [
    { type: 'ch', url: 'http://www.legco.gov.hk/general/chinese/members/yr12-16/biographies.htm' },
    { type: 'en', url: 'http://www.legco.gov.hk/general/english/members/yr12-16/biographies.htm' }
  ],
  // urls: {
  //   url_ch: 'http://www.legco.gov.hk/general/chinese/members/yr12-16/biographies.htm',
  //   url_en: 'http://www.legco.gov.hk/general/english/members/yr12-16/biographies.htm'
  // },
  // member_urls: [ { url_en: '', url_ch: '' }, ... ]
}];

function extractLists (biography_page, cb) {
  async.map(biography_page.urls, extractList.bind(biography_page), function (err, url_data) {
    if (err) { return cb(err); }

    biography_page.member_urls = _.reduce(url_data, function (memo, data) {
      return inplace_arr_merge(memo, data.member_urls);
    }, []);

    cb(null, biography_page);
  });
}

function extractList (url_data, cb) {
  request(url_data.url, function (err, response, body) {
    if (err || response.statusCode !== 200) { return cb(err || response); }
    var $ = cheerio.load(body);
    var dirname = path.dirname(url_data.url);
    var member_urls = _.map($('.bio-member-info a'), function (el) {
      var member = {};
      member['url_' + url_data.type] = dirname + '/' + $(el).attr('href');
      return member;
    });
    member_urls = util.arrayFrom(member_urls);

    debug('found %s members for %s from the main list', member_urls.length, this.yr);
    url_data.member_urls = member_urls;
    cb(null, url_data);
  });
}

function extractMemberInfo (urls, cb) {
  async.parallel([
    extractMember.bind(null, urls.url_ch, 'ch'),
    extractMember.bind(null, urls.url_en, 'en')
  ], function (err, results) {
    var member_ch = suffix_key(results[0], '_ch', ['id', 'img', 'homepage', 'email']);
    var member_en = suffix_key(results[1], '_en', ['id', 'img', 'homepage', 'email']);
    var member = _.assign(member_ch, member_en);
    cb(null, member);
  });
}

function extractMember (url, type, cb) {
  var imgPrefix = 'http://www.legco.gov.hk';

  request(url, function (err, response, body) {
    if (err || response.statusCode !== 200) { return cb(err || response); }
    var $ = cheerio.load(body);
    var member = {};
    var $info = $('#container > div');

    $info.find('br').remove();

    var src = $info.find('img').attr('src');
    member.img = imgPrefix + src;
    member.id = src.match(/(\w*)\.jpg/)[1];

    // Remove titles, for the sake of cleanliness. Sorry :(
    var name = $info.children().eq(1).text()
    .replace(/, /g, '')
    .replace('Hon ', '')
    .replace('GBS', '')
    .replace('SBS', '')
    .replace('BBS', '')
    .replace('MH', '')
    .replace('JP', '')
    .replace('PhDRN', '')
    .replace('SC', '')
    .replace('議員', '')
    .replace('大紫荊勳賢', '');

    member.name = name;
    debug(member.name);

    var constituency_raw;
    constituency_raw = $info.children().eq(3).find('li').text().split(' - ');
    if (constituency_raw.length === 1) {
      constituency_raw = $info.children().eq(3).find('li').text().split(' – ');
    }
    member.constituency = { type: constituency_raw[0], area: constituency_raw[1] };

    var $educations = $info.children().eq(5).find('li');
    var educations = _.map($educations, function (el) {
      return $(el).html();
    });
    member.educations = educations;

    var $occupations = $info.children().eq(7).find('li');
    var occupations = _.map($occupations, function (el) {
      return $(el).html();
    });
    member.occupations = occupations;

    var $parties = $info.children().eq(9).find('li');
    var parties = _.map($parties, function (el) {
      return $(el).html();
    });
    member.parties = parties;

    member.email = $info.find('a[href^="mailto:"]').text();
    member.homepage = $info.find('a:not([href^="mailto:"])').text();

    cb(null, member);
  });
}

function extractMembersInfo (biography_page, cb) {
  async.map(biography_page.member_urls, extractMemberInfo, function (err, members) {
    if (err) { return cb(err); }
    biography_page.members = members;
    cb(null, biography_page);
  });
}

function saveMember (member, cb) {
  var yr = this.yr;
  var dir = './data/member-json/';
  mkdirp.sync(dir);
  fs.writeFile(dir + member.id + '.json', JSON.stringify(member, null, 2), cb);
}

function saveMembers (biography_page, cb) {
  // Save everyone to all.json
  var dir = './data/member-json/';
  mkdirp.sync(dir);
  fs.writeFile(dir + 'all.json', JSON.stringify(biography_page.members, null, 2));

  async.map(biography_page.members, saveMember.bind(biography_page), function (err) {
    if (err) { return cb(err); }
    cb(null, biography_page);
  });
}

function inplace_arr_merge (arr1, arr2) {
  return _.merge(arr1, arr2, function (el1, el2) {
    return _.assign(el1, el2);
  });
}

function suffix_key (obj, suffix, exceptions) {
  var newObj = {};
  _.each(obj, function (value, key) {
    if (!_.contains(exceptions, key)) {
      newObj[key + suffix] = value;
    } else {
      newObj[key] = value;
    }
  });
  return newObj;
}

module.exports = function extract (options, callback) {
  options.biography_pages = options.biography_pages || default_biography_pages;

  async.map(options.biography_pages, function (biography_page, mapCb) {
    async.waterfall([
      function (cb) { cb(null, biography_page); },
      extractLists,
      extractMembersInfo,
      saveMembers
    ], mapCb);
  }, callback);
};
