#!/usr/bin/env node

'use strict';

let Engine = require('../').Engine,
  browserScripts = require('../lib/support/browserScript'),
  logging = require('../').logging,
  toArray = require('../lib/support/toArray'),
  cli = require('../lib/support/cli'),
  fileNamer = require('../lib/support/fileNamer').fileNamer,
  Promise = require('bluebird'),
  merge = require('lodash.merge'),
  fs = require('fs'),
  path = require('path'),
  log = require('intel');

Promise.promisifyAll(fs);

function parseUserScripts(scripts) {
  if (!Array.isArray(scripts))
    scripts = [scripts];

  return Promise.reduce(scripts, (results, script) =>
      browserScripts.findAndParseScripts(path.resolve(script), 'custom')
        .then((scripts) => merge(results, scripts)),
    {});
}

function loadPrePostTasks(tasks) {
  return toArray(tasks).map((task) => {
    try {
      return require(path.resolve(task));
    } catch (e) {
      throw new Error('Couldn\'t load task file: ' + task);
    }
  });
}

function run(url, options) {
  let dir = 'browsertime-results';
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir);
  }

  try {
    if (options.preTask) {
      options.preTask = loadPrePostTasks(options.preTask);
    }
    if (options.postTask) {
      options.postTask = loadPrePostTasks(options.postTask);
    }
  } catch (e) {
    log.error(e.message);
    process.exit(1);
  }

  let engine = new Engine(options);

  log.info('Running %s for url: %s', options.browser, url);
  if (log.isEnabledFor(log.VERBOSE)) {
    log.verbose('Running with options: %:2j', options);
  }

  const scriptCategories = browserScripts.allScriptCategories;
  let scriptsByCategory = browserScripts.getScriptsForCategories(scriptCategories);

  if (options.script) {
    const userScripts = parseUserScripts(options.script);
    scriptsByCategory = Promise.join(scriptsByCategory, userScripts,
      (scriptsByCategory, userScripts) => merge(scriptsByCategory, userScripts));
  }

  const indentation = options.prettyPrint ? 2 : 0;

  engine.start()
    .then(function() {
      return engine.run(url, scriptsByCategory);
    })
    .then(function(result) {
      const namer = fileNamer();
      let saveOperations = [];

      const resultsFolder = 'browsertime-results';
      if (result.browsertimeData) {
        let browsertimeData = JSON.stringify(result.browsertimeData, null, indentation);
        let jsonName = options.output || namer.getNameFromUrl(url, 'json');
        saveOperations.push(fs.writeFileAsync(path.join(resultsFolder, jsonName), browsertimeData));
      }
      if (result.har) {
        let har = JSON.stringify(result.har, null, indentation);
        let harName = options.har || namer.getNameFromUrl(url, 'har');
        saveOperations.push(fs.writeFileAsync(path.join(resultsFolder, harName), har));
      }

      return Promise.all(saveOperations)
        .then(() => log.info('Wrote data to %s', resultsFolder));
    })
    .catch(function(e) {
      log.error('Error running browsertime', e);
      throw e;
    })
    .finally(function() {
      log.verbose('Stopping Browsertime');
      return engine.stop()
        .tap(() => {
          log.debug('Stopped Browsertime');
        })
        .catch((e) => {
          log.error('Error stopping Browsertime!', e);

          process.exitCode = 1;
        });
    })
    .catch(function() {
      process.exitCode = 1;
    })
    .finally(process.exit); // explicitly exit to avoid a hanging process
}

let cliResult = cli.parseCommandLine();

logging.configure(cliResult.options);

if (log.isEnabledFor(log.CRITICAL)) { // TODO change the threshold to VERBOSE before releasing 1.0
  Promise.longStackTraces();
}

run(cliResult.url, cliResult.options);
