/* See license.txt for terms of usage */

"use strict";

const { Trace, TraceError } = require("../core/trace.js").get(module.id);
const { EventTarget } = require("sdk/event/target");
const { Class } = require("sdk/core/heritage");
const { prefs } = require("sdk/simple-prefs");
const { Locale } = require("../core/locale.js");
const { on } = require("sdk/dom/events.js");
const { Dom } = require("../core/dom.js");

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

var Menu = {};

Menu.createMenu = function(popup, item) {
  let menu = popup.ownerDocument.createElement("menu");
  popup.appendChild(menu);

  Menu.setItemIntoElement(menu, item);

  this.createMenuPopup(menu, item);

  return menu;
};

Menu.createMenuPopup = function(parent, item) {
  var menuPopup = parent.ownerDocument.createElement("menupopup");
  parent.appendChild(menuPopup);

  if (!item.items) {
    return;
  }

  if (typeof item.items == "function") {
    on(menuPopup, "popupshowing", (event) => {
      let popup = event.target;
      Dom.clearNode(popup);
      Menu.createMenuItems(popup, item.items());
    });
  }
  else {
    Menu.createMenuItems(menuPopup, item.items);
  }

  return menuPopup;
}

// Menu.createMenuItems(popup, items[, before])
Menu.createMenuItems = function(popup, items, before) {
  for (let i=0; i<items.length; i++) {
    let item = items[i];

    // Override existing items to avoid duplicates.
    let existingItem = popup.querySelector("#" + item.id);
    if (existingItem) {
      Menu.createMenuItem(popup, item, existingItem);
      popup.removeChild(existingItem);
      continue;
    }

    Menu.createMenuItem(popup, item, before);
  }
};

Menu.createMenuItem = function(popup, item, before) {
  if ((typeof(item) == "string" && item == "-") || item.label == "-")
    return Menu.createMenuSeparator(popup, item, before);

  var menuitem;

  if (item.items)
    menuitem = Menu.createMenu(popup, item);
  else
    menuitem = popup.ownerDocument.createElement("menuitem");

  Menu.setItemIntoElement(menuitem, item);

  if (before)
    popup.insertBefore(menuitem, before);
  else
    popup.appendChild(menuitem);

  return menuitem;
};

Menu.setItemIntoElement = function(element, item) {
  let label = item.nol10n ? item.label : Locale.$STR(item.label);

  element.setAttribute("label", label);

  if (item.id)
    element.setAttribute("id", item.id);

  if (item.type)
    element.setAttribute("type", item.type);

  // Avoid closing the popup menu if a preference has been changed.
  // This allows to quickly change more options.
  if (item.type == "checkbox" && !item.closemenu)
    element.setAttribute("closemenu", "none");

  if (item.disabled)
    element.setAttribute("disabled", "true");

  if (item.image) {
    element.setAttribute("class", "menuitem-iconic");
    element.setAttribute("image", item.image);
  }

  if (item.command)
    element.addEventListener("command", item.command, false);

  if (item.commandID)
    element.setAttribute("command", item.commandID);

  if (item.option)
    element.setAttribute("option", item.option);

  if (item.tooltiptext) {
    let tooltiptext = item.nol10n ? item.tooltiptext :
      Locale.$STR(item.tooltiptext);
    element.setAttribute("tooltiptext", tooltiptext);
  }

  if (item.className)
    element.classList.add(item.className);

  if (item.acceltext)
    element.setAttribute("acceltext", item.acceltext);
  else if (item.key)
    element.setAttribute("key", item.key);

  if (item.accesskey) {
    element.setAttribute("accesskey", item.nol10n ? item.accesskey :
        Locale.$STR(item.accesskey));
  }

  if (item.name)
    element.setAttribute("name", item.name);

  if (item.checked)
    element.setAttribute("checked", "true");

  // Allows to perform additional custom initialization of the menu-item.
  if (item.initialize)
    item.initialize(element);

  return element;
};

Menu.createMenuHeader = function(popup, item) {
  let header = popup.ownerDocument.createElement("label");
  header.setAttribute("class", "menuHeader");

  let label = item.nol10n ? item.label : Locale.$STR(item.label);

  header.setAttribute("value", label);

  popup.appendChild(header);
  return header;
};

Menu.createMenuSeparator = function(popup, item, before) {
  if (!popup.firstChild)
    return;

  let menuItem = popup.ownerDocument.createElement("menuseparator");
  if (typeof item == "object" && item.id)
    menuItem.setAttribute("id", item.id);

  if (before)
    popup.insertBefore(menuItem, before);
  else
    popup.appendChild(menuItem);

  return menuItem;
};

/**
 * Create an option menu item definition. This method is usually used
 * in methods like:
 * {@link Panel.getOptionsMenuItems} or {@link Panel.getContextMenuItems}.
 *
 * @param {String} label Name of the string from *.properties file.
 * @param {String} option Name of the associated option.
 * @param {String, Optional} tooltiptext Optional name of the string
 * from *.properties file that should be used as a tooltip for the menu.
 */
Menu.optionMenu = function(label, option, tooltiptext) {
  return {
    label: label,
    type: "checkbox",
    checked: prefs[option],
    option: option,
    tooltiptext: tooltiptext,
    command: function() {
      return prefs[option] = !prefs[option];
    }
  };
};

/**
 * Remove unnecessary separators (at the top or at the bottom of the menu).
 */
Menu.optimizeSeparators = function(popup)
{
  while (popup.firstChild && popup.firstChild.tagName == "menuseparator")
    popup.removeChild(popup.firstChild);

  while (popup.lastChild && popup.lastChild.tagName == "menuseparator")
    popup.removeChild(popup.lastChild);

  // xxxHonza: We should also check double-separators
};

exports.Menu = Menu;
