/* See license.txt for terms of usage */

"use strict";

var self = require("sdk/self");

const { Cu, Ci } = require("chrome");
const { Trace, TraceError } = require("./core/trace.js").get(module.id);
const { extend } = require("sdk/core/heritage");
const { EventTarget } = require("sdk/event/target");
const { emit } = require("sdk/event/core");
const { defer } = require("sdk/core/promise");
const { Locale } = require("./core/locale.js");
const { Theme } = require("./chrome/theme.js");
const { getMostRecentBrowserWindow } = require("sdk/window/utils");

const { gDevTools } = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { AddonManager } = Cu.import("resource://gre/modules/AddonManager.jsm", {});

// Register string bundles before any rep or chrome modules are loaded.
Locale.registerStringBundle("chrome://firebug/locale/firebug.properties");
Locale.registerStringBundle("chrome://firebug/locale/style-editor.properties");
Locale.registerStringBundle("chrome://firebug/locale/debugger.properties");
Locale.registerStringBundle("chrome://firebug/locale/console.properties");
Locale.registerStringBundle("chrome://firebug/locale/dom.properties");

const { Chrome } = require("./chrome/chrome.js");
const { WindowWatcher } = require("./chrome/windowWatcher.js");
const { StartButton } = require("./chrome/startButton.js");
const { RemoteLogging } = require("./console/remote/logging.js");

// All top level modules should be required here.
require("./chrome/pageContextMenu.js");
require("./dom/domPanel.js");

// Hello World (will be removed at some point)
require("./helloWorld/helloWorldPanel.js");

// Reps
require("./reps/common.js");
require("./reps/storage.js"); // xxxHonza: needs to be here FIX ME
require("./reps/xpathresult.js"); // xxxHonza: needs to be here FIX ME
require("./reps/grip.js");
require("./reps/document.js");
require("./reps/array.js");
require("./reps/element.js");
require("./reps/object-with-url.js");
require("./reps/function.js");
require("./reps/text-node.js");
require("./reps/css-rule.js");
require("./reps/attribute.js");
require("./reps/named-node-map.js");
require("./reps/date-time.js");
require("./reps/window.js");
require("./reps/regexp.js");
require("./reps/stylesheet.js");
require("./reps/event.js");

// SDK changes (should be removed as soon as the API are built-in).
const MarkupViewPatch = require("./sdk/markup-view-patch.js");

// Overlays for built-in Toolbox panels.
const { InspectorOverlay } = require("./inspector/inspectorOverlay.js");
const { ConsoleOverlay } = require("./console/consoleOverlay.js");
const { DebuggerOverlay } = require("./debugger/debuggerOverlay.js");
const { StyleEditorOverlay } = require("./style/style-editor-overlay.js");
const { ProfilerOverlay } = require("./profiler/profiler-overlay.js");
const { NetworkOverlay } = require("./net/network-overlay.js");
const { OptionsOverlay } = require("./options/optionsOverlay.js");

/**
 * This object represents the main Firebug application object,
 * The Firebug you have known and loved.
 *
 * It's singleton and there is one instance shared across all
 * browser windows.
 */
var Firebug = extend(EventTarget.prototype,
/** @lends Firebug */
{
  /**
   * The initialization happens when Firefox starts and Firebug extension
   * is loaded (see also the main.js module).
   * The logic here should be as simple as possible to make sure it
   * doesn't slow down the start up time. Typical action that can
   * be done here is global browser modifications like e.g.
   * inserting new menu items in Firefox (context) menus.
   * Actions related to Firebug UI should be done within
   * {@Chrome.inintialization} method.
   */
  initialize: function(options) {
    EventTarget.prototype.initialize.call(this);

    Trace.sysout("firebug.initialize; options: ", options);

    // Map of all existing {@Chrome} instances. Every instance corresponds
    // to one native {@Toolbox} instance.
    this.chromes = new Map();

    // Bind DevTools even handlers.
    this.onToolboxReady = this.onToolboxReady.bind(this);
    this.onToolboxDestroyed = this.onToolboxDestroyed.bind(this);
    this.updateOption = this.updateOption.bind(this);

    // Hook developer tools events.
    gDevTools.on("toolbox-ready", this.onToolboxReady);
    gDevTools.on("toolbox-destroyed", this.onToolboxDestroyed);
    gDevTools.on("pref-changed", this.updateOption);

    // Iterate list of overlay-definitions and register them.
    // There are other built-in panels (hidden by default) like
    // e.g. Canvas and WebAudio that would also deserve
    // an overlay with support for Firebug theme.
    this.overlays = [
      {id: "inspector", ctor: InspectorOverlay},
      {id: "webconsole", ctor: ConsoleOverlay},
      {id: "jsdebugger", ctor: DebuggerOverlay},
      {id: "styleeditor", ctor: StyleEditorOverlay},
      {id: "profiler", ctor: ProfilerOverlay},
      {id: "netmonitor", ctor: NetworkOverlay},
      {id: "options", ctor: OptionsOverlay},
    ];

    for (let overlay of this.overlays)
      this.registerOverlay(overlay);

    // Firebug introduces a new theme that is available in the Options
    // panel (together with the built-in Light and Dark themes).
    // The Firebug theme is also automatically set as the default one
    // when Firebug is installed.
    Theme.registerFirebugTheme(options);

    // Watch browser window create/destroy events.
    WindowWatcher.initialize();
    StartButton.initialize();
    RemoteLogging.initialize();
  },

  /**
   * Register an overlay. This happens when Firebug extension initializes
   * itself at the very beginning (when Firefox starts or Firebug is just
   * installed or enabled).
   *
   * The purpose of the registration is to handle '{panel.id}-init' event
   * (that is fired every time a panel is created) and create an instance
   * of the overlay. List of actual overlay-instances for particular
   * {@Toolbox} is stored in corresponding {@Chrome} object.
   *
   * Panel initialization happens every time when a toolbox is created/opened
   * and the panel selected.
   * Note that instance of the toolbox is created for every tab in every
   * browser window. It can also be closed and created again for the same tab.
   */
  registerOverlay: function(overlay) {
    Trace.sysout("firebug.registerOverlay; " + overlay.id, overlay);

    // Listen for panel initialization event.
    let onApplyOverlay = (eventId, toolbox, panelFrame) => {
      Trace.sysout("firebug.onApplyOverlay; " + eventId, panelFrame);

      // The {@Chrome} instance for the current toolbox might be created
      // at this moment (in getChrome method) since the '{panelId}-init'
      // event is send before 'toolbox-ready'.
      let chrome = this.getChrome(toolbox);

      try {
        // Create instance of an overlay
        let instance = new overlay.ctor({
          panelFrame: panelFrame,
          toolbox: toolbox,
          id: overlay.id
        });

        // Store overlay instance in the Chrome object, so we can clean
        // it up at the end.
        chrome.overlays.set(overlay.id, instance);

        // Register for 'build' event (panel instance created).
        toolbox.once(overlay.id + "-build", (eventId, panel) => {
          Trace.sysout("firebug.applyOverlay; " + eventId, panel);
          instance.onBuild({toolbox: toolbox, panel: panel});
        });

        // Register for 'ready' event (panel frame loaded).
        toolbox.once(overlay.id + "-ready", (eventId, panel) => {
          Trace.sysout("firebug.applyOverlay; " + eventId, panel);
          instance.onReady({toolbox: toolbox, panel: panel});
        });
      }
      catch (err) {
        TraceError.sysout("chrome.initialize; Overlay for: " + overlay.id +
          " EXCEPTION " + err, err);
      }
    };

    // Use 'on' (not 'once') listener since the '*-init' event is sent
    // every time the toolbox is closed and opened again. The listener
    // will be removed in destroyOverlay method when Firebug is destroyed.
    gDevTools.on(overlay.id + "-init", onApplyOverlay);

    // Remember the listener, so we can remove at shutdown.
    overlay.onApplyOverlay = onApplyOverlay;
  },

  unregisterOverlay: function(overlay) {
    Trace.sysout("firebug.unregisterOverlay; " + overlay.id, overlay);

    // Remove the init listener.
    gDevTools.off(overlay.id + "-init", overlay.onApplyOverlay);
  },

  /**
   * Executed by the framework when Firebug is destroyed.
   * I happens when the entire extension is disabled, unloaded or
   * removed.
   */
  shutdown: function(reason) {
    Trace.sysout("firebug.shutdown; " + reason);

    emit(this, "shutdown", reason);

    gDevTools.off("toolbox-ready", this.onToolboxReady);
    gDevTools.off("toolbox-destroyed", this.onToolboxDestroyed);
    gDevTools.off("pref-changed", this.updateOption);

    // Unapply temporary patches
    MarkupViewPatch.shutdown();

    Theme.unregisterFirebugTheme();

    for (let overlay of this.overlays)
      this.unregisterOverlay(overlay);

    // Firebug is destroyed, so destroy also all existing chrome objects.
    for (let chrome of this.chromes.values())
      chrome.destroy();

    WindowWatcher.shutdown();
    StartButton.shutdown();
    RemoteLogging.shutdown();

    // Workaround for: https://github.com/firebug/firebug.next/issues/91
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1069832
    // xxxHonza: also, ask for a way to specify custom IDs for new panels.
    gDevTools.unregisterTool({id: "dev-panel-firebug-nextgetfirebug-com-DOM"});
    gDevTools.unregisterTool({id: "dev-panel-firebug-nextgetfirebug-com-Hello-World"});
  },

  // Toolbox API & Events

  /**
   * Executed by the framework when {@Toolbox} is opened and ready to use.
   * There is one instance of the {@Toolbox} per browser window.
   */ 
  onToolboxReady: function(event, toolbox) {
    Trace.sysout("firebug.onToolboxReady; ", toolbox);

    // Make sure {@Chrome} instance exists for the toolbox (it's created
    // in getChrome() method). Note that it might be already created if
    // the selected panel has an overlay (see registerOverlay).
    let chrome = this.getChrome(toolbox);
  },

  onToolboxDestroyed: function(eventId, target) {
    Trace.sysout("firebug.onToolboxDestroyed;", target);

    var chrome = this.chromes.get(target);
    if (!chrome)
    {
      Trace.sysout("firebug.onToolboxDestroyed; ERROR unknown target!",
        target);
      return;
    }

    // A toolbox object has been destroyed, so destroy even the corresponding
    // {@Chrome} object.
    chrome.destroy();
    this.chromes.delete(target);
  },

  /**
   * Returns reference to the Toolbox associated with the parent
   * browser window.
   *
   * @param {Window} win A window in the current browser. If no
   * window is specified the toolbox from the current most recent
   * browser window is used.
   */
  getToolbox: function(win) {
    let tab = getCurrentTab(win);
    if (tab) {
      let target = devtools.TargetFactory.forTab(tab);
      return gDevTools.getToolbox(target);
    }
  },

  /**
   * Open the toolbox with default panel selected.
   *
   * @param {Window} win A window in the current browser. If no
   * window is specified the toolbox from the current most recent
   * browser window is used.
   *
   * @returns A promise that is resolved as soon as the toolbox
   * is opened and fully ready (just before "toolbox-ready" event is fired).
   */
  showToolbox: function(win) {
    let tab = getCurrentTab(win);
    let target = devtools.TargetFactory.forTab(tab);
    return gDevTools.showToolbox(target);
  },

  /**
   * Destroy toolbox for the given window.
   */
  destroyToolbox: function(win) {
    let toolbox = this.getToolbox(win);
    if (toolbox)
      return toolbox.destroy();
  },

  // Options

  updateOption: function(eventType, data) {
    Trace.sysout("firebug.updateOption; ", data);

    emit(this, "updateOption", data.pref, data.newValue, data.oldValue);
  },

  getChrome: function(toolbox) {
    let target = toolbox.target;
    let chrome = this.chromes.get(target);
    if (!chrome) {
      chrome = new Chrome(toolbox);
      this.chromes.set(target, chrome);
    }
    return chrome;
  },

  // Commands

  about: function() {
    AddonManager.getAddonByID(self.id, function (addon) {
      let browser = getMostRecentBrowserWindow();
      browser.openDialog("chrome://mozapps/content/extensions/about.xul", "",
        "chrome,centerscreen,modal", addon);
    });
  }
});

// Helpers

function getCurrentTab(win) {
  if (win) {
    let browserDoc = win.top.document;
    let browser = browserDoc.getElementById("content");
    return browser.selectedTab;
  }

  // xxxHonza: do we really want this fall-back?
  let browser = getMostRecentBrowserWindow();
  if (browser)
    return browser.gBrowser.mCurrentTab;
}

// Exports from this module
exports.Firebug = Firebug;
