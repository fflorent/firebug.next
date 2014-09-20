/* See license.txt for terms of usage */
/* jshint esnext: true */
/* global require: true, exports: true, module: true */

"use strict";

const { Ci, Cu, Cc } = require("chrome");
const { Http } = require("../../core/http.js");
const { Win } = require("../../core/window.js");
const { Dom } = require("../../core/dom.js");
const { Reps } = require("../../reps/reps.js");
const { Trace, TraceError } = require("../../core/trace.js").get(module.id);
const { ConsoleMessage } = require("../console-message.js");

const { gDevTools } = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { console } = Cu.import("resource://gre/modules/devtools/Console.jsm", {});

// Calling devtools.require() does not work. For some reasons, the path
// provided will be checked according to the addons-sdk path logic.
const { Messages } = devtools["require"]("devtools/webconsole/console-output");

const Events = require("sdk/system/events.js");
const base64 = require("sdk/base64");
const tabUtils = require("sdk/tabs/utils");

// TODO support FirePHP
const acceptableLoggerHeaders = ["X-ChromeLogger-Data"];

/**
 * TODO: description
 */
let RemoteLogging =
/** @lends RemoteLogging */
{
  // Initialization

  initialize: function() {
    Trace.sysout("remoteLogging.register;");

    this.onExamineResponse = this.onExamineResponse.bind(this);

    Events.on("http-on-examine-response", this.onExamineResponse);
  },

  shutdown: function() {
    Trace.sysout("remoteLogging.unregister;");

    Events.off("http-on-examine-response", this.onExamineResponse);
  },

  // HTTP Observer

  onExamineResponse: function(event) {
    Trace.sysout("remoteLogging.onExamineResponse;", event);

    let { subject } = event;
    let httpChannel = subject.QueryInterface(Ci.nsIHttpChannel);
    let tab = getTabFromHttpChannel(subject);

    if (!tab) {
      Trace.sysout("remoteLogging.onExamineResponse; tab not found, return");
      return;
    }

    let parsedMessages = [];

    httpChannel.visitResponseHeaders((header, value) => {
      if (acceptableLoggerHeaders.indexOf(header) !== -1) {
        let parsedMessage = this.parse(header, value);
        parsedMessages.push(parsedMessage);
      }
    });

    if (!parsedMessages.length) {
      return;
    }

    // better variable names for parsedMessages, parsedMessage and msg
    // (probably a little piece of refactoring)
    for (let parsedMessage of parsedMessages) {
      for (let msg of parsedMessage) {
        this.logMessage(msg, tab);
      }
    }
  },

  logMessage: function(msg, tab) {
    Trace.sysout("remoteLogging.logMessage; " + msg.logs.join(", "), msg);

    // xxxFlorent: Passing win breaks RDP (and maybe E10S).
    var hud = this.getWebConsole(tab);
    if (!hud) {
      Trace.sysout("remoteLogging.logMessage; No HUD");
      return;
    }

    // xxxHonza: create custom Message object.
    let consoleMessage = new Messages.Extended(msg.logs, {
      location: msg.location,
      category: "js",
      severity: "info", /* msg.type */
    });

    hud.ui.output.addMessage(consoleMessage);
  },

  getWebConsole: function (tab) {
    let target = devtools.TargetFactory.forTab(tab);
    let toolbox = gDevTools.getToolbox(target);
    let panel = toolbox ? toolbox.getPanel("webconsole") : null;
    return panel ? panel.hud : null;
  },

  // TODO parse should invoke the parse method of a dedicated module.
  // Example: 
  parse: function(header, value) {
    Trace.sysout("remoteLogging.parse; value = ", value);

    let data = JSON.parse(base64.decode(value));
    let parsedMessage = [];
    let columnMap = this.getColumnMap(data);

    for (let row of data.rows) {
      let backtrace = row[columnMap.get("backtrace")];
      let label = row[columnMap.get("label")];
      let rawLogs = row[columnMap.get("log")];
      let type = row[columnMap.get("type")] || "log";

      // new version without label
      let newVersion = false;
      if (data.columns.indexOf("label") === -1) {
        newVersion = true;
      }

      // if this is the old version do some converting
      if (!newVersion) {
        let showLabel = label && typeof label === "string";

        rawLogs = [rawLogs];

        if (showLabel) {
          rawLogs.unshift(label);
        }
      }

      // xxxHonza: can we simplify the url and line info extraction?
      let result = backtrace.match(/\s*(\d+)\:(\d+)$/);
      let location;
      if (result.length == 3) {
        location = {
          url: backtrace.slice(0, -result[0].length),
          line: result[1]
        }
      }

      parsedMessage.push({
        logs: rawLogs,
        location: location,
        type: type
      });
    }

    Trace.sysout("remoteLogging.parse; parsedMessage = ", parsedMessage);

    return parsedMessage;
  },

  getColumnMap: function(data) {
    // Source taken from:
    // https://github.com/ccampbell/chromelogger/blob/b1f6e6e5482bbc7ecb874a5768d6b4ebd3f31e2a/log.js#L61-L67
    let columnMap = new Map();
    let columnName;

    for (let key in data.columns) {
      columnName = data.columns[key];
      columnMap.set(columnName, key);
    }

    return columnMap;
  },
};

// Helpers

function getTabFromHttpChannel(httpChannel) {
  let topFrame = Http.getTopFrameElementForRequest(httpChannel);
  if (!topFrame) {
    Trace.sysout("remoteLogging.getTabFromHttpChannel; topFrame not found");
    return;
  }

  // In case of in-process debugging (no e10s) the result topFrame
  // represents the content window.
  let winType = topFrame.Window;
  if (typeof winType != "undefined" && topFrame instanceof winType) {
    return tabUtils.getTabForContentWindow(topFrame);
  }

  // ... otherwise the topFrame represents the content window parent frame.
  let notificationBox = Dom.getAncestorByTagName(topFrame, "xul:notificationbox");
  if (!notificationBox) {
    Trace.sysout("remoteLogging.getTabFromHttpChannel; " +
      "notificationbox not found");
    return;
  }

  return notificationBox.ownerDocument.querySelector(
    "#tabbrowser-tabs [linkedpanel='" + notificationBox.id + "']");
}

// Exports from this module
exports.RemoteLogging = RemoteLogging;
