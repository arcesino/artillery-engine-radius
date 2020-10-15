const debug = require('debug')('engine:radius');
const { template } = require('artillery/util');
const { promisify } = require('util');
const radclient = promisify(require('radclient'));
const getPort = require('get-port');

const time = require('./lib/time');

/**
 * Generate a random identifier for a RADIUS request.
 *
 * RADIUS request identifiers must be 1 octect (8-bit)
 */
const getRandomIdentifier = () => {
  const max = 255;
  return Math.floor(Math.random() * Math.floor(max));
};

/**
 * Returns a generator function that generates numbers from the
 * ephemeral port range.
 */
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

/**
 * Gets a free ephemeral port suitable for sending a RADIUS packet.
 */
const getFreeEphemeralPort = async () => {
  return getPort({ port: randomEphemeralPortRange });
};

/**
 * Performs RADIUS auth request
 */
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
    identifier: getRandomIdentifier(),
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

  return (context, callback) => {
    const { name, flow } = template(scenarioSpec, context);
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
