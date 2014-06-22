/*jshint esnext:true */
/*global imports */

const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const ExtensionImports = imports.misc.extensionUtils.getCurrentExtension().imports;

let gioSettings;

function init() {
    gioSettings = ExtensionImports.lib.getSettings();
}

function buildPrefsWidget() {
    let frame = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, border_width: 12, spacing: 6});
    frame.add(buildSwitcher('enforce-primary-monitor', 'Always show the switcher on the primary monitor'));
    frame.add(buildSwitcher('draw-borders', 'Draw borders around window previews'));
    frame.show_all();
    return frame;
}

function buildSwitcher(key, labeltext, tooltip) {
    let hbox = new Gtk.Box({spacing: 6});

    let label = new Gtk.Label({label: labeltext, xalign: 0 });
    hbox.pack_start(label, true, true, 0);

    let switcher = new Gtk.Switch({active: gioSettings.get_boolean(key)});
    hbox.add(switcher);

    gioSettings.bind(key, switcher, 'active', Gio.SettingsBindFlags.DEFAULT);

    return hbox;
}
