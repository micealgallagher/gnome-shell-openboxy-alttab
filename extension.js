/*jshint esnext:true */
/*global imports, global */

const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;

const ExtensionImports = imports.misc.extensionUtils.getCurrentExtension().imports;
const Switcher = ExtensionImports.switcher.Switcher;

let settings, _gioSettings, _changeHandlerId, _switcher;

function init() { }

function enable() {
    settings = {};
    _gioSettings = ExtensionImports.lib.getSettings();
    _loadSettings();
    _changeHandlerId = _gioSettings.connect('changed', function (gioSettings, key) {
        _readKey(key);
    });

    _switcher = new Switcher();

    Main.wm.setCustomKeybindingHandler('switch-applications', Shell.KeyBindingMode.NORMAL, _startSwitcher);
    Main.wm.setCustomKeybindingHandler('switch-applications-backward', Shell.KeyBindingMode.NORMAL, _startSwitcher);
    Main.wm.setCustomKeybindingHandler('switch-group', Shell.KeyBindingMode.NORMAL, _startSwitcher);
    Main.wm.setCustomKeybindingHandler('switch-group-backward', Shell.KeyBindingMode.NORMAL, _startSwitcher);
}

function disable() {
    _gioSettings.disconnect(_changeHandlerId);
    settings = _switcher = null;

    Main.wm.setCustomKeybindingHandler('switch-applications', Shell.KeyBindingMode.NORMAL, Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setCustomKeybindingHandler('switch-applications-backward', Shell.KeyBindingMode.NORMAL, Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setCustomKeybindingHandler('switch-group', Shell.KeyBindingMode.NORMAL, Lang.bind(Main.wm, Main.wm._startAppSwitcher));
    Main.wm.setCustomKeybindingHandler('switch-group-backward', Shell.KeyBindingMode.NORMAL, Lang.bind(Main.wm, Main.wm._startAppSwitcher));
}

function _loadSettings() {
    _gioSettings.list_keys().map(_readKey);
}

function _readKey(key) {
    switch (_gioSettings.get_value(key).get_type_string()) {
        case 'b':
            settings[key.replace(/-/g, '_')] = _gioSettings.get_boolean(key);
            break;
    }
}

function _startSwitcher(display, screen, window, binding) {
    let currentWorkspace = screen.get_active_workspace();

    let windows = global.get_window_actors();
    for (let i in windows)
        windows[i] = windows[i].get_meta_window();

    switch (binding.get_name()) {
        case 'switch-group':
            // Switch between windows of same application from all workspaces
            let focused = display.focus_window || windows[0];
            windows = windows.filter(_matchWmClass, focused.get_wm_class());
            break;
        default:
            // Switch between windows of current workspace
            windows = windows.filter(_matchWorkspace, currentWorkspace);
            break;
    }

    if (windows.length) {
        windows.sort(function (win1, win2) {
            return win2.get_user_time() - win1.get_user_time();
        });
        _switcher.start(windows, binding.get_mask(), settings);
    }
}

function _matchWmClass(win) {
    return win.get_wm_class() == this && !win.is_skip_taskbar();
}

function _matchWorkspace(win) {
    return win.get_workspace() == this && !win.is_skip_taskbar();
}
