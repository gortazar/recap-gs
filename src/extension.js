// recap — agent statuses in the GNOME Shell top bar.
//
// This file is the only one that may import gi://St or resource:///org/gnome/shell:
// everything with a rule in it lives under lib/ and is tested headlessly. What happens here
// is creation and, symmetrically, destruction. An extension that leaks a timer, a signal
// handler or a subprocess across disable() is the classic review rejection, so every one of
// them is created in enable() (or in the indicator's constructor) and undone in disable().

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import GLib from 'gi://GLib';

import { RecapSource } from './lib/source.js';
import { Scheduler } from './lib/scheduler.js';
import { buildMenu } from './lib/menu.js';
import { NEUTRAL_ICON } from './lib/contract.js';
import { buildResumeLaunch } from './lib/resume.js';
import { Attention } from './lib/attention.js';
import { decodeEvent } from './lib/events.js';
import { EventService } from './lib/eventService.js';

/**
 * A vertical box, spelled the way this shell spells it. St.BoxLayout gained `orientation`
 * and deprecated `vertical` in GNOME 48, and this extension supports 46 through 50.
 */
function verticalBox(props = {}) {
    const box = new St.BoxLayout(props);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

/** How long the session must be idle before refreshing stops. */
const IDLE_SECONDS = 5 * 60;

/** The style classes the panel button can take, so they can be removed by name. */
const ATTENTION_CLASSES = ['recap-asking', 'recap-finished'];

/** Three pulses, then steady. See _pulse(). */
const PULSES = 3;
const PULSE_MS = 320;
const DIM_OPACITY = 90;

const RecapIndicator = GObject.registerClass(
class RecapIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Recap', false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._iconsDir = `${extension.path}/icons`;
        this._idleMonitor = null;
        this._idleWatchId = 0;
        this._activeWatchId = 0;
        this._idle = false;
        this._pulseId = 0;

        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._icon = new St.Icon({
            gicon: this._statusIcon(NEUTRAL_ICON),
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._source = new RecapSource({});

        // What the agents tell us, and what it adds up to. recap still decides every
        // status; attention only decides what is worth your eye right now.
        this._attention = new Attention({});
        this._eventService = new EventService({
            onEvent: (kind, payload) => this._onAgentEvent(kind, payload),
        });
        this._eventService.start();
        this._scheduler = new Scheduler({
            intervalSeconds: this._settings.get_int('refresh-interval'),
            onTick: () => this._refresh(),
            isSuppressed: () => this._suppressed(),
        });

        // Every connection made here is disconnected in _onDestroy.
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'refresh-interval')
                this._scheduler.setInterval(settings.get_int('refresh-interval'));
            else
                this._scheduler.wake();
        });

        this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
            if (!open)
                return;
            // The answer on screen should be about now, not about half a minute ago.
            this._scheduler.wake();
            // You have now seen everything the menu is showing, so it stops asking. Done
            // after the wake so that the rows cleared are the rows that were on screen.
            this._acknowledgeVisible();
        });

        this._sessionModeId = Main.sessionMode.connect('updated', () => this._render());

        this._watchIdle();
        this._render();
        this._scheduler.start();

        this.connect('destroy', () => this._onDestroy());
    }

    /**
     * Whether a scheduled refresh should be skipped. Locked or idle, nobody is reading the
     * panel, and spawning a process every 30 seconds to find that out is exactly the kind of
     * thing that shows up in a battery report.
     */
    _suppressed() {
        return Main.sessionMode.isLocked || this._idle;
    }

    /**
     * The idle monitor is a nicety, not a requirement: it is loaded dynamically so that a
     * shell without the gnome-desktop typelib gets a working extension that simply keeps
     * polling, rather than an extension that fails to load at all.
     */
    async _watchIdle() {
        let GnomeDesktop;
        try {
            GnomeDesktop = (await import('gi://GnomeDesktop?version=4.0')).default;
        } catch (e) {
            console.debug(`recap: no idle monitor available (${e.message}); polling regardless`);
            return;
        }
        if (this._destroyed)
            return;

        this._idleMonitor = new GnomeDesktop.IdleMonitor();
        this._idleWatchId = this._idleMonitor.add_idle_watch(IDLE_SECONDS * 1000, () => {
            this._idle = true;
        });
        this._watchUserActive();
    }

    /** A user-active watch fires once, so it is re-armed each time it does. */
    _watchUserActive() {
        this._activeWatchId = this._idleMonitor.add_user_active_watch(() => {
            this._activeWatchId = 0;
            this._idle = false;
            // Coming back to the machine is exactly when the panel should be right.
            this._scheduler.wake();
            if (!this._destroyed)
                this._watchUserActive();
        });
    }

    /**
     * An agent said something. Decode it, flag the project it names, and redraw.
     *
     * Nothing here blocks: the bus method has already returned by the time this runs, so a
     * hook is never waiting on the compositor.
     */
    _onAgentEvent(kind, payload) {
        const decoded = decodeEvent(kind, payload);
        if (!decoded.ok) {
            console.debug(`recap: ignoring an event (${decoded.reason})`);
            return;
        }

        const rows = this._rows();
        const result = this._attention.record(decoded.event, rows);
        this._render();
        // Coalesced and rate-limited events still update the flag, but they do not get to
        // flash the panel again: that is the whole point of the ceiling.
        if (!result.accepted)
            return;
        this._pulse();
        // Ask recap what it makes of this, so the flagged row's words are current. Through
        // the same single-flight refresher as everything else — two refreshes never overlap
        // — and it spawns nothing while the screen is locked or the session is idle.
        this._scheduler.nudge();
    }

    /** Opening the menu is acknowledgement: what it showed you has been seen. */
    _acknowledgeVisible() {
        const rows = this._rows();
        if (this._attention.count === 0)
            return;
        this._attention.acknowledgeVisible(rows);
        this._render();
    }

    /** The rows as they stand, for matching an event against. */
    _rows() {
        return buildMenu(this._source.state, this._settingsSnapshot(), Date.now(),
            this._attention).rows;
    }

    /**
     * Colour the button by what is pending. Both classes are defined in stylesheet.css from
     * the theme's accent colour, with a plain fallback for themes that have none.
     */
    _applyAttentionStyle(styleClass) {
        for (const name of ATTENTION_CLASSES) {
            if (name !== styleClass)
                this.remove_style_class_name(name);
        }
        if (styleClass !== '' && !this.has_style_class_name(styleClass))
            this.add_style_class_name(styleClass);
    }

    /**
     * Say "look at me" a bounded number of times and then stop.
     *
     * Three pulses, not a blink that runs until acknowledged: an indicator that never stops
     * moving is an accessibility problem as well as an irritating one, and the flag itself
     * stays up afterwards to carry the message. Nothing runs while the screen is locked, and
     * the whole thing is cancelled on destroy — an animation left running in the compositor
     * outlives the extension that started it.
     */
    _pulse() {
        if (this._destroyed || Main.sessionMode.isLocked)
            return;
        this._stopPulse();

        let remaining = PULSES * 2;
        this._pulseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PULSE_MS, () => {
            remaining--;
            this._icon.opacity = remaining % 2 === 1 ? DIM_OPACITY : 255;
            if (remaining > 0)
                return GLib.SOURCE_CONTINUE;
            // Always finish at full opacity: a pulse that stops halfway is a bug on show.
            this._icon.opacity = 255;
            this._pulseId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopPulse() {
        if (this._pulseId) {
            GLib.Source.remove(this._pulseId);
            this._pulseId = 0;
        }
        this._icon.opacity = 255;
    }

    async _refresh() {
        await this._source.refresh(this._settingsSnapshot());
        // The source resolves after a cancelled run too, and destroy() cancels: by then
        // this indicator may be gone.
        if (this._destroyed)
            return;
        // A question recap now reports as answered stops being a question.
        this._attention.reconcile(this._rows());
        this._render();
    }

    _settingsSnapshot() {
        const s = this._settings;
        return {
            path: s.get_string('recap-path'),
            since: s.get_string('since'),
            agent: s.get_string('agent'),
            roots: s.get_strv('project-roots'),
            hideFinished: s.get_boolean('hide-finished'),
            hideIdle: s.get_boolean('hide-idle'),
            showCount: s.get_boolean('show-count'),
        };
    }

    _render() {
        const model = buildMenu(this._source.state, this._settingsSnapshot(), Date.now(),
            this._attention);

        this._icon.gicon = this._statusIcon(model.summary.iconName);
        this._label.text = model.summary.label;
        this._label.visible = model.summary.label !== '';
        this.accessible_name = model.summary.tooltip;
        this._applyAttentionStyle(model.summary.styleClass);

        this.menu.removeAll();
        for (const row of model.rows)
            this.menu.addMenuItem(this._rowItem(row));
        for (const note of model.notes)
            this.menu.addMenuItem(this._noteItem(note));
    }

    _rowItem(row) {
        const item = new PopupMenu.PopupBaseMenuItem({
            style_class: 'recap-row',
            // A row with nothing to resume is still worth reading; it just does not pretend
            // to be a button.
            reactive: row.resume !== null,
            can_focus: row.resume !== null,
        });
        if (row.resume !== null)
            item.connect('activate', () => this._resume(row));
        // Clicking a row answers it, whether or not there was anything to resume.
        item.connect('activate', () => this._attention.acknowledge(row.key));

        item.add_child(new St.Icon({
            gicon: this._statusIcon(row.iconName),
            style_class: 'popup-menu-icon recap-row-icon',
        }));

        const text = verticalBox({ x_expand: true, style_class: 'recap-row-text' });

        const heading = new St.BoxLayout({ x_expand: true });
        if (row.attention !== null) {
            // A leading dot, the way an unread mark is drawn everywhere else.
            heading.add_child(new St.Label({
                text: '•',
                style_class: `recap-row-mark recap-${row.attention.kind}`,
            }));
        }
        heading.add_child(new St.Label({
            text: row.name,
            style_class: row.attention !== null ? 'recap-row-name recap-row-flagged' : 'recap-row-name',
        }));
        const aside = [row.agentLabel, row.ageLabel].filter(s => s !== '').join(' · ');
        if (aside !== '') {
            heading.add_child(new St.Label({
                text: aside,
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                style_class: 'recap-row-aside',
            }));
        }
        text.add_child(heading);

        if (row.recap !== '') {
            const sentence = new St.Label({ text: row.recap, style_class: 'recap-row-sentence' });
            // Wrapped rather than elided: the whole point of the sentence is the detail at
            // the end of it, and the shell has no tooltips to put the rest in.
            sentence.clutter_text.line_wrap = true;
            sentence.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            text.add_child(sentence);
        }

        // What the agent itself said, under recap's sentence and wrapped like it. recap
        // describes the session; this is the session's own words about right now.
        if (row.attention !== null && row.attention.message !== '') {
            const said = new St.Label({
                text: row.attention.message,
                style_class: `recap-row-message recap-${row.attention.kind}`,
            });
            said.clutter_text.line_wrap = true;
            said.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            text.add_child(said);
        }

        item.add_child(text);
        item.accessible_name = [
            `${row.name}: ${row.statusLabel}.`,
            row.recap,
            row.attention === null ? '' : row.attention.message,
        ].filter(part => part !== '').join(' ');
        return item;
    }

    /**
     * Open a terminal in the session's own directory and resume the agent there. The
     * directory is the point: an agent resumed somewhere else reads a different project.
     */
    _resume(row) {
        const launch = buildResumeLaunch(row.resume, {
            terminal: this._settings.get_string('terminal'),
            isAvailable: name => GLib.find_program_in_path(name) !== null,
        });

        if (launch.argv === null) {
            // This one is worth a notification: somebody just clicked, so somebody is
            // waiting to see what happened.
            Main.notifyError('Could not resume that session', launch.problem);
            return;
        }

        try {
            const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
            // Belt and braces with the terminal's own --working-directory: the terminals
            // that have no such flag inherit this instead.
            launcher.set_cwd(launch.cwd);
            launcher.spawnv(launch.argv);
        } catch (e) {
            Main.notifyError('Could not resume that session', e.message);
        }
    }

    _noteItem(note) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'recap-note',
        });
        const box = verticalBox({ x_expand: true });
        box.add_child(new St.Label({ text: note.title, style_class: 'recap-note-title' }));
        if (note.detail) {
            const detail = new St.Label({ text: note.detail, style_class: 'recap-note-detail' });
            detail.clutter_text.line_wrap = true;
            detail.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            box.add_child(detail);
        }
        item.add_child(box);
        return item;
    }

    _statusIcon(name) {
        return Gio.icon_new_for_string(`${this._iconsDir}/${name}.svg`);
    }

    _onDestroy() {
        this._destroyed = true;

        this._scheduler.stop();
        this._stopPulse();
        this._source.destroy();
        this._eventService.stop();
        this._attention.clear();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
        if (this._sessionModeId) {
            Main.sessionMode.disconnect(this._sessionModeId);
            this._sessionModeId = 0;
        }
        if (this._idleMonitor !== null) {
            if (this._idleWatchId)
                this._idleMonitor.remove_watch(this._idleWatchId);
            if (this._activeWatchId)
                this._idleMonitor.remove_watch(this._activeWatchId);
            this._idleWatchId = 0;
            this._activeWatchId = 0;
            this._idleMonitor = null;
        }
        this._settings = null;
    }
});

export default class RecapExtension extends Extension {
    enable() {
        this._indicator = new RecapIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        // destroy() runs _onDestroy, which stops the schedule, cancels any run in flight and
        // disconnects every handler.
        this._indicator?.destroy();
        this._indicator = null;
    }
}
