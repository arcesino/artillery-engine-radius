const debug = require('debug')('engine:radius');
const { promisify } = require('util');
const radclient = promisify(require('radclient'));
const getPort = require('get-port');

const time = require('./lib/time');

const getRandomInt = (max) => {
  return Math.floor(Math.random() * Math.floor(max));
};

const randomEphemeralPortRange = (() => {
  const from = 49152;
  const to = 65535;

  const generator = function* (from, to) {
    while (true) {
      const port = Math.floor(Math.random() * (to - from + 1) + from);
      yield port;
    }
  };

  return generator(from, to);
})();

const getFreeEphemeralPort = async () => {
  return getPort({ port: randomEphemeralPortRange });
};

const authRequest = async (config, ee, context) => {
  const options = {
    host: context.radius.host,
    localPort: await getFreeEphemeralPort(),
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
  const startTime = time.getTime();
  await radclient(packet, options)
    .then((response) => {
      const { code } = response;
      const delta = time.getDelta(startTime);
      ee.emit('response', delta, code, context._uid);
    })
    .catch((error) => {
      const errorMsg = `Auth error: ${error}`;
      throw new Error(errorMsg);
    });
};

function RADIUSEngine(script, ee, helpers) {
  this.script = script;
  this.ee = ee;
  this.helpers = helpers;

  return this;
}

const runStep = async (spec, ee, context) => {
  if (spec.auth) {
    await authRequest(spec.auth, ee, context);
  }
};

const runFlow = async (flow, ee, context) => {
  for (const step of flow) await runStep(step, ee, context);
};

RADIUSEngine.prototype.createScenario = function (scenarioSpec, ee) {
  const { target: host, radius: config } = this.script.config;
  const { name, flow } = scenarioSpec;

  return (context, callback) => {
    const radiusContext = {
      ...context,
      radius: {
        host,
        ...config
      }
    };
    ee.emit('started');
    debug(`Running scenario ${name}`);

    runFlow(flow, ee, radiusContext)
      .then(() => {
        ee.emit('done');
        return callback(null, radiusContext);
      })
      .catch((error) => {
        ee.emit('error', error);
        return callback(error, radiusContext);
      });
  };
};

module.exports = RADIUSEngine;
