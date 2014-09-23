/* See license.txt for terms of usage */

"use strict";

var self = require("sdk/self");
var main = require("../main.js");

const { Cu } = require("chrome");
const { Trace, TraceError } = require("../core/trace.js").get(module.id);
const { EventTarget } = require("sdk/event/target");
const { Class } = require("sdk/core/heritage");
const { ToolbarButton } = require("./panelToolbar.js");
const { Xul } = require("../core/xul.js");

// XUL builder
const { BOX } = Xul;

/**
 * This object represents a toolbar button that is used to open
 * and close Toolbox panel side-bar with side-panels.
 */
const ToggleSideBarButton = Class(
/** @lends ToggleSideBarButton */
{
  extends: EventTarget,

  // Initialization

  initialize: function(options) {
    Trace.sysout("toggleSideBarButton.initialize; " + options.panel.id,
      options);

    this.panel = options.panel;
    this.toolbar = options.toolbar;

    // Do not create the button if there are no side panels.
    if (!this.panel.hasSidePanels())
      return;

    let win = this.panel.getPanelWindow();
    let box = BOX({"class": "fbToggleSidePanelsBox"}).build(this.toolbar);

    // xxxHonza: use ID starting with 'firebug'.
    this.button = new ToolbarButton({
      toolbar: box,
      id: "fbToggleSidePanels",
      tooltiptext: "toggleSidePanels.tip",
      className: "fbToggleSidePanels",
      command: () => this.toggleSideBar(),
    });
  },

  destroy: function() {
    if (this.button) {
      this.button.button.remove();
      this.button = null;
    }
  },

  toggleSideBar: function() {
    // The panel needs to implement the toggle logic. There is
    // default implementation in {@BasePanel} that expects the
    // 'this.sidebar' property to exist. Panel overlays need
    // to usually provide their own implementation since not all
    // built-in panels use the {@ToolSidebar} widget. 
    if (typeof this.panel.toggleSidebar == "function") {
      this.panel.toggleSidebar();
    }
  }
});

exports.ToggleSideBarButton = ToggleSideBarButton;
