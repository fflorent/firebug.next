/* See license.txt for terms of usage */

"use strict";

module.metadata = {
  "stability": "experimental"
};

const { Cc, Ci, Cu } = require("chrome");
const { Trace, TraceError } = require("../../core/trace.js").get(module.id);
const { LoggerActor } = require("./logger-actor.js");
const Events = require("sdk/event/core");

const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { gDevTools } = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});

const { Messages, Widgets } = devtools["require"]("devtools/webconsole/console-output");
const { Front, FrontClass } = devtools["require"]("devtools/server/protocol");

/**
 * @front TODO: description
 */
var LoggerFront = FrontClass(LoggerActor,
/** @lends LoggerFront */
{
  // Initialization

  initialize: function(tab, client, form, ...args) {
    Front.prototype.initialize.apply(this, [client, form, ...args]);

    Trace.sysout("loggerFront.initialize;", this);

    this.onHTTPLog = this.onHTTPLog.bind(this);
    this.on("http-log", this.onHTTPLog);

    this.actorID = form[LoggerActor.prototype.typeName];
    this.tab = tab;
    this.manage(this);
  },

  destroy: function() {
    Front.prototype.destroy.apply(this, arguments);

    this.off(this, "http-log", this.onHTTPLog);
  },

  onPacket: function(packet) {
    Trace.sysout("loggerFront.onPacket; " + JSON.stringify(packet),
      packet);

    let type = packet.type;

    Front.prototype.onPacket.apply(this, arguments);

    switch (type) {
    case "attached":
      this.onAttached(packet);
      break;
    case "detached":
      this.onDetached(packet);
      break;
    }
  },

  onAttached: function(response) {
    Trace.sysout("loggerFront.onAttached; ", response);
  },

  onDetached: function(response) {
    Trace.sysout("loggerFront.onDetached; ", response);
  },

  onHTTPLog: function(message) {
    let hud = getWebConsole(this.tab);
    let consoleMessage = new Messages.ConsoleGeneric(message);
    hud.ui.output.addMessage(consoleMessage);
  },
});

// Helpers

// Should be client-side
// Note: Future work for special rendering.
/*Widgets.ObjectRenderers.add({
  byKind: "ChromeLoggerRemoteObject",
  render: function() {
    let preview = this.objectActor.preview;
    let className = preview.ownProperties.___class_name;
    delete preview.ownProperties.___class_name;
    Widgets.ObjectRenderers.byKind.Object.render.apply(this, arguments);
    this.element.querySelector(".cm-variable").textContent = className;
  },
});*/

function getWebConsole(tab) {
  let target = devtools.TargetFactory.forTab(tab);
  let toolbox = gDevTools.getToolbox(target);
  let panel = toolbox ? toolbox.getPanel("webconsole") : null;
  return panel ? panel.hud : null;
}

// Exports from this module
exports.LoggerFront = LoggerFront;
