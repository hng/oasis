"use strict";

// This module exports a function that connects to SSB and returns an interface
// to call methods over MuxRPC. It's a thin wrapper around SSB-Client, which is
// a thin wrapper around the MuxRPC module.

const ssbClient = require("ssb-client");
const ssbConfig = require("ssb-config");
const flotilla = require("@fraction/flotilla");
const ssbTangle = require("ssb-tangle");
const debug = require("debug")("oasis");

const server = flotilla(ssbConfig);

const log = (...args) => {
  const isDebugEnabled = debug.enabled;
  debug.enabled = true;
  debug(...args);
  debug.enabled = isDebugEnabled;
};

const rawConnect = () =>
  new Promise((resolve, reject) => {
    ssbClient()
      .then(api => {
        if (api.tangle === undefined) {
          // HACK: SSB-Tangle isn't available in Patchwork, but we want that
          // compatibility. This code automatically injects SSB-Tangle into our
          // stack so that we don't get weird errors when using Patchwork.
          //
          // See: https://github.com/fraction/oasis/issues/21
          api.tangle = ssbTangle.init(api);
        }

        resolve(api);
      })
      .catch(reject);
  });

let handle;

const createConnection = config => {
  handle = new Promise(resolve => {
    rawConnect()
      .then(ssb => {
        log("Using pre-existing Scuttlebutt server instead of starting one");
        resolve(ssb);
      })
      .catch(() => {
        log("Initial connection attempt failed");
        log("Starting Scuttlebutt server");
        server(config);
        const connectOrRetry = () => {
          rawConnect()
            .then(ssb => {
              log("Retrying connection to own server");
              resolve(ssb);
            })
            .catch(e => {
              log(e);
              connectOrRetry();
            });
        };

        connectOrRetry();
      });
  });

  return handle;
};

module.exports = ({ offline }) => {
  if (offline) {
    log("Offline mode activated - not connecting to scuttlebutt peers or pubs");
    log(
      "WARNING: offline mode cannot control the behavior of pre-existing servers"
    );
  }

  const config = {
    conn: {
      autostart: !offline
    },
    ws: {
      http: false
    }
  };

  createConnection(config);

  /**
   * This is "cooler", a tiny interface for opening or reusing an instance of
   * SSB-Client.
   */
  return {
    open() {
      // This has interesting behavior that may be unexpected.
      //
      // If `handle` is already an active [non-closed] connection, return that.
      //
      // If the connection is closed, we need to restart it. It's important to
      // note that if we're depending on an external service (like Patchwork) and
      // that app is closed, then Oasis will seamlessly start its own SSB service.
      return new Promise(resolve => {
        handle.then(ssb => {
          if (ssb.closed) {
            createConnection();
          }
          resolve(handle);
        });
      });
    }
  };
};
