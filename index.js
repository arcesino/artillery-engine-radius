const debug = require('debug')('engine:radius');
const radclient = require('radclient');
const A = require('async');

const getRandomInt = (max) => {
  return Math.floor(Math.random() * Math.floor(max));
};

const authRequest = (config, ee, context, callback) => {
  const options = {
    host: context.radius.host,
    timeout: context.radius.timeout || config.timeout,
    retries: context.radius.retries || config.retries
  };
  debug(`Radclient options: ${JSON.stringify(options)}`);

  const packet = {
    code: 'Access-Request',
    secret: config.secret,
    identifier: getRandomInt(255),
    attributes: [
      ['User-Name', config.username],
      ['User-Password', config.password]
    ]
  };
  debug(`Radclient packet: ${JSON.stringify(packet)}`);

  ee.emit('request');
  radclient(packet, options, (error, response) => {
    if (error) {
      const errorMsg = `Radclient error: ${error}`;
      ee.emit('error', errorMsg);
      return callback(errorMsg, context);
    }

    const { code } = response;
    ee.emit('response', 0, code, context._uid);

    return callback(null, context);
  });
};

function RADIUSEngine(script, ee, helpers) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;

  return this;
}

RADIUSEngine.prototype.step = function (spec, ee) {
  if (spec.auth) {
    return (context, callback) => {
      authRequest(spec.auth, ee, context, callback);
    };
  }

  return (context, callback) => {
    return callback(null, context);
  };
};

RADIUSEngine.prototype.createScenario = function (scenarioSpec, ee) {
  const { target: host, radius: config } = this.script.config;
  const { name, flow } = scenarioSpec;

  return (initialContext, callback) => {
    const init = (next) => {
      const context = {
        ...initialContext,
        radius: {
          host,
          ...config
        }
      };
      ee.emit('started');
      return next(null, context);
    };

    const tasks = flow.map((rs) => this.step(rs, ee));
    const steps = [init].concat(tasks);

    debug(`Running scenario ${name}`);
    A.waterfall(steps, function (err, context) {
      if (err) {
        debug(err);
      }

      ee.emit('done');
      return callback(err, context);
    });
  };
};

module.exports = RADIUSEngine;
