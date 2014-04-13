'use strict';

var converter = require('./index');
var debug = require('debug')('example');
var _ = require('lodash');

var default_sessions = [
  { yr: '1314', url: 'http://www.legco.gov.hk/general/english/counmtg/yr12-16/mtg_1314.htm' },
  { yr: '1213', url: 'http://www.legco.gov.hk/general/english/counmtg/yr12-16/mtg_1213.htm' }
];

// converter.voting.extract({}, function (err, results) {
//   debug('err', err);
// });
converter.members.extract({}, function (err, results) {
  debug('err', err);
  debug('results[0].member_urls.length', results[0].member_urls.length);
  debug('results[0].members[0]', results[0].members[0]);

  default_sessions[0].members = results[0].members;
  default_sessions[1].members = results[0].members;

  converter.voting.extract({
    sessions: default_sessions,
  }, function (err) {
    debug('err', err);
  });
});
