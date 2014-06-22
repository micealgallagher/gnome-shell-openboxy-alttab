/*jshint esnext:true */
/*global imports, global */

const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Pango = imports.gi.Pango;
const SwitcherPopup = imports.ui.switcherPopup;

const CHECK_DESTROYED_TIMEOUT = 100;
const ICON_SIZE = 48;

const OutlineEffect = new Lang.Class({
    Name: 'OutlineEffect',
    Extends: Clutter.Effect,

    vfunc_paint: function () {
        let actor = this.get_actor();
        actor.continue_paint();

        let color = new Cogl.Color();
        color.init_from_4ub(0x99, 0x22, 0x22, 0xc4);
        Cogl.set_source_color(color);

        let thickness = 5, {width, height} = actor.get_allocation_geometry();

        // clockwise order
        Cogl.rectangle(0, 0, width, thickness);
        Cogl.rectangle(width - thickness, thickness, width, height);
        Cogl.rectangle(0, height, width - thickness, height - thickness);
        Cogl.rectangle(0, height - thickness, thickness, thickness);
    }
});

const Switcher = new Lang.Class({
    Name: 'Switcher',

    start: function (windows, mask, settings) {
        this._windows = windows;
        this._mask = SwitcherPopup.primaryModifier(mask);
        this._settings = settings;

        this._currentIndex = windows.indexOf(global.display.focus_window);
        this._haveModal = false;
        this._tracker = Shell.WindowTracker.get_default();
        this._windowManager = global.window_manager;
        this._checkDestroyedTimeoutId = 0;

        this._dcid = this._windowManager.connect('destroy', Lang.bind(this, this._windowDestroyed));
        this._mcid = this._windowManager.connect('map', Lang.bind(this, this._activateSelected));

        // create a container for all our widgets
        this.actor = new St.Widget({visible: false, reactive: true});
        Main.uiGroup.add_actor(this.actor);

        if (!Main.pushModal(this.actor) &&
            // Probably someone else has a pointer grab, try again with keyboard only
            !Main.pushModal(this.actor, {options: Meta.ModalOptions.POINTER_ALREADY_GRABBED})) {
            this._activateSelected();
            return;
        }

        this._haveModal = true;

        this.actor.connect('key-press-event', Lang.bind(this, this._keyPressEvent));
        this.actor.connect('key-release-event', Lang.bind(this, this._onKeyRelease));
        this.actor.connect('scroll-event', Lang.bind(this, this._scrollEvent));

        let [x, y, mods] = global.get_pointer();
        if (!(mods & this._mask)){
            // There's a race condition; if the user released Alt before
            // we got the grab, then we won't be notified. (See
            // https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
            // details) So we check now. (Have to do this after updating
            // selection.)
            this._activateSelected();
            return;
        }

        this.show();
    },

    show: function () {
        this._updateActiveMonitor();
        this._enableMonitorFix();

        let monitor = this._activeMonitor;
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.set_size(monitor.width, monitor.height);

        this._createPreviews();
        this._initWindowList();

        this.actor.show();

        // We want our actor to be above only the window_group. This is so the
        // drag-n-drop overlay would be on top of our actor.
        this.actor.raise(global.window_group);

        this._next();
    },

    _createPreviews: function () {
        let monitor = this._activeMonitor;
        let currentWorkspace = global.screen.get_active_workspace();

        this._previews = [];
        for (let i in this._windows) {
            let metaWin = this._windows[i];
            let compositor = metaWin.get_compositor_private();
            if (compositor) {
                let texture = compositor.get_texture();
                let [width, height] = texture.get_size();

                let clone = new Clutter.Clone({
                    opacity: (!metaWin.minimized && metaWin.get_workspace() == currentWorkspace ||
                              metaWin.is_on_all_workspaces()) ? 255 : 0,
                    source: texture,
                    x: (metaWin.minimized ? 0 : compositor.x) - monitor.x,
                    y: (metaWin.minimized ? 0 : compositor.y) - monitor.y,
                    visible: false,
                });

                if (this._settings.draw_borders)
                    clone.add_effect(new OutlineEffect());
                this._previews.push(clone);
                this.actor.add_actor(clone);
            }
        }
    },

    _updateCurrent: function () {
        if (this.__currentPreview)
            this.__currentPreview.hide();
        this.__currentPreview = this._previews[this._currentIndex];
        this.__currentPreview.show();

        if (this.__currentWindowListItem)
            this.__currentWindowListItem.remove_style_pseudo_class('focus');
        this.__currentWindowListItem = this._windowListActors[this._currentIndex];
        this.__currentWindowListItem.add_style_pseudo_class('focus');
    },

    _next: function () {
        this._currentIndex = (this._currentIndex + 1) % this._windows.length;
        this._updateCurrent();
    },

    _previous: function () {
        this._currentIndex = (this._currentIndex + this._windows.length - 1) %
                this._windows.length;
        this._updateCurrent();
    },

    _updateActiveMonitor: function () {
        this._activeMonitor = Main.layoutManager.primaryMonitor;
        if (!this._settings.enforce_primary_monitor) {
            let [x, y, mask] = global.get_pointer();
            try {
                this._activeMonitor = Main.layoutManager._chrome._findMonitorForRect(x, y, 0, 0);
            } catch (e) {
            }
        }
    },

    _initWindowList: function () {
        let monitor = this._activeMonitor;

        this._windowListOsd = new St.BoxLayout({
            style_class: 'switcher-list-osd',
            vertical: true,
            x_expand: true,
        });

        this._windowListActors = [];
        onEnter = Lang.bind(this, onEnter);
        onClick = Lang.bind(this, onClick);
        for (let i = 0, len = this._windows.length; i < len; ++i) {
            let win = this._windows[i];
            let box = new St.BoxLayout({style_class: 'switcher-list-item', reactive: true});
            box.connect('enter-event', onEnter);
            box.connect('leave-event', onLeave);
            box.connect('button-release-event', onClick);

            let app = this._tracker.get_window_app(win);
            let icon = app ? app.create_icon_texture(ICON_SIZE) : null;

            if (!icon) {
                icon = new St.Icon({
                    icon_name: 'applications-other',
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: ICON_SIZE,
                });
            }

            box.add_actor(icon);

            let label = new St.Label({
                text: win.get_title(),
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_actor(label);

            this._windowListOsd.add_actor(box);
            this._windowListActors.push(box);
        }

        this.__enableHover = false;
        if (this.__hoverTimeoutId)
            Mainloop.source_remove(this.__hoverTimeoutId);
        this.__hoverTimeoutId = Mainloop.timeout_add(500, Lang.bind(this, function () {
            this.__enableHover = true;
            this.__hoverTimeoutId = 0;
        }));

        Main.uiGroup.add_actor(this._windowListOsd);
        this._windowListOsd.x = Math.round((monitor.width - this._windowListOsd.width) / 2);
        this._windowListOsd.y = Math.round((monitor.height - this._windowListOsd.height) / 2);

        function onEnter(actor) {
            if (this.__enableHover)
                actor.add_style_pseudo_class('hover');
        }

        function onLeave(actor) {
            actor.remove_style_pseudo_class('hover');
        }

        function onClick(actor) {
            this._currentIndex = this._windowListActors.indexOf(actor);
            this._activateSelected();
        }
    },

    _keyPressEvent: function (actor, event) {
        switch (event.get_key_symbol()) {
            case Clutter.Escape:
                this._currentIndex = 0;
                this._activateSelected();
                return true;

            case Clutter.q:
            case Clutter.Q:
                // Q -> Close window
                this._windows[this._currentIndex].delete(global.get_current_time());
                this._checkDestroyedTimeoutId = Mainloop.timeout_add(CHECK_DESTROYED_TIMEOUT,
                        Lang.bind(this, this._checkDestroyed, this._windows[this._currentIndex]));
                return true;

            case Clutter.Up:
                // Up -> navigate to previous preview
                this._previous();
                return true;

            case Clutter.Down:
                // Down -> navigate to next preview
                this._next();
                return true;
        }
        // default alt-tab
        let event_state = event.get_state();
        let action = global.display.get_keybinding_action(event.get_key_code(), event_state);
        switch (action) {
            case Meta.KeyBindingAction.SWITCH_APPLICATIONS:
            case Meta.KeyBindingAction.SWITCH_GROUP:
                if (event_state & Clutter.ModifierType.SHIFT_MASK)
                    this._previous();
                else
                    this._next();
                return true;
            case Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD:
            case Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD:
                this._previous();
                return true;
        }

        return true;
    },

    _onKeyRelease: function (actor, event) {
        let [x, y, mods] = global.get_pointer();

        if ((mods & this._mask) === 0)
            this._activateSelected();

        return true;
    },

    _scrollEvent: function (actor, event) {
        switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
                this._previous();
                return true;

            case Clutter.ScrollDirection.DOWN:
                this._next();
                return true;
        }

        return true;
    },

    _windowDestroyed: function (wm, actor) {
        this._removeDestroyedWindow(actor.meta_window);
    },

    _checkDestroyed: function (window) {
        this._checkDestroyedTimeoutId = 0;
        this._removeDestroyedWindow(window);
    },

    _removeDestroyedWindow: function (window) {
        for (let i in this._windows) {
            if (window === this._windows[i]) {
                if (this._windows.length == 1)
                    this.destroy();
                else {
                    this._windows.splice(i, 1);
                    this._windowListActors[i].destroy();
                    this._windowListActors.splice(i, 1);
                    this._previews[i].destroy();
                    this._previews.splice(i, 1);
                    this._currentIndex = (i < this._currentIndex) ? this._currentIndex - 1 :
                        this._currentIndex % this._windows.length;
                    this._updateCurrent();
                }

                return;
            }
        }
    },

    _activateSelected: function () {
        Main.activateWindow(this._windows[this._currentIndex], global.get_current_time());
        this.destroy();
    },

    destroy: function () {
        Main.uiGroup.remove_actor(this.actor);
        Main.uiGroup.remove_actor(this._windowListOsd);
        this._disableMonitorFix();

        if (this._haveModal) {
            Main.popModal(this.actor);
            this._haveModal = false;
        }

        if (this._checkDestroyedTimeoutId)
            Mainloop.source_remove(this._checkDestroyedTimeoutId);

        this._windowManager.disconnect(this._dcid);
        this._windowManager.disconnect(this._mcid);
        this._windows = null;
        this._previews = null;
        this._checkDestroyedTimeoutId = null;
    },

    _enableMonitorFix: function () {
        if (global.screen.get_n_monitors() < 2)
            return;

        this._monitorFix = true;
        this._oldWidth = global.stage.width;
        this._oldHeight = global.stage.height;

        let width = 2 * (this._activeMonitor.x + this._activeMonitor.width/2);
        let height = 2 * (this._activeMonitor.y + this._activeMonitor.height/2);

        global.stage.set_size(width, height);
    },

    _disableMonitorFix: function () {
        if (this._monitorFix) {
            global.stage.set_size(this._oldWidth, this._oldHeight);
            this._monitorFix = false;
        }
    },

});
