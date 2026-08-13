// The preferences window.
//
// Like extension.js this is a thin shell around lib/: the list of settings, their titles and
// their ranges live in lib/preferences.js, where a test holds them against the GSettings
// schema. What is here is the Adwaita rendering of that list and the binding of each row to
// its key.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { PREFERENCE_PAGES, splitRoots, joinRoots } from './lib/preferences.js';
import { BUS_NAME } from './lib/eventService.js';

export default class RecapPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        for (const page of PREFERENCE_PAGES) {
            const adwPage = new Adw.PreferencesPage({
                title: page.title,
                icon_name: page.iconName,
            });
            for (const group of page.groups) {
                const adwGroup = new Adw.PreferencesGroup({
                    title: group.title,
                    description: group.description,
                });
                for (const row of group.rows)
                    adwGroup.add(buildRow(row, settings, this.path));
                adwPage.add(adwGroup);
            }
            window.add(adwPage);
        }
    }
}

function buildRow(row, settings, extensionPath) {
    switch (row.type) {
    case 'boolean':
        return switchRow(row, settings);
    case 'int':
        return spinRow(row, settings);
    case 'choice':
        return comboRow(row, settings);
    case 'paths':
        return pathsRow(row, settings);
    case 'apps':
        return appsRow(row, settings);
    case 'command':
        return commandRow(row, extensionPath);
    case 'status':
        return statusRow(row);
    default:
        return entryRow(row, settings);
    }
}

function switchRow(row, settings) {
    const widget = new Adw.SwitchRow({ title: row.title, subtitle: row.subtitle });
    settings.bind(row.key, widget, 'active', Gio.SettingsBindFlags.DEFAULT);
    return widget;
}

function spinRow(row, settings) {
    const widget = new Adw.SpinRow({
        title: row.title,
        subtitle: row.subtitle,
        adjustment: new Gtk.Adjustment({
            lower: row.min,
            upper: row.max,
            step_increment: row.step ?? 1,
        }),
    });
    settings.bind(row.key, widget, 'value', Gio.SettingsBindFlags.DEFAULT);
    return widget;
}

function comboRow(row, settings) {
    const widget = new Adw.ComboRow({
        title: row.title,
        subtitle: row.subtitle,
        model: Gtk.StringList.new(row.choices.map(choice => choice.label)),
    });

    const values = row.choices.map(choice => choice.value);
    const selected = values.indexOf(settings.get_string(row.key));
    widget.selected = selected === -1 ? 0 : selected;
    widget.connect('notify::selected', () => {
        settings.set_string(row.key, values[widget.selected]);
    });

    return widget;
}

function entryRow(row, settings) {
    const widget = new Adw.EntryRow({ title: row.title });
    if (row.subtitle)
        widget.set_tooltip_text(row.subtitle);
    settings.bind(row.key, widget, 'text', Gio.SettingsBindFlags.DEFAULT);
    return widget;
}

/**
 * A `as` setting has no natural single-line spelling, so it is edited as a colon-separated
 * list — the way PATH is written — and translated on the way in and out.
 */
function pathsRow(row, settings) {
    const widget = new Adw.EntryRow({
        title: row.title,
        text: joinRoots(settings.get_strv(row.key)),
    });
    if (row.subtitle)
        widget.set_tooltip_text(row.subtitle);

    let updating = false;
    widget.connect('changed', () => {
        if (updating)
            return;
        settings.set_strv(row.key, splitRoots(widget.text));
    });
    const changedId = settings.connect(`changed::${row.key}`, () => {
        updating = true;
        widget.text = joinRoots(settings.get_strv(row.key));
        updating = false;
    });
    // The preferences window is its own process, but a window closed and reopened should
    // not leave a handler behind on a live GSettings object.
    widget.connect('destroy', () => settings.disconnect(changedId));

    return widget;
}

/**
 * A list of application names, edited as a comma-separated line. Same reasoning as the
 * project roots above: an `as` has no natural single-line spelling, and this is the one
 * people already use for a list of names.
 */
function appsRow(row, settings) {
    const widget = new Adw.EntryRow({
        title: row.title,
        text: settings.get_strv(row.key).join(', '),
    });
    if (row.subtitle)
        widget.set_tooltip_text(row.subtitle);

    widget.connect('changed', () => {
        settings.set_strv(row.key, widget.text
            .split(',')
            .map(name => name.trim())
            .filter(name => name !== ''));
    });
    return widget;
}

/**
 * A command to run, with a button that copies it.
 *
 * The path is the extension's own installed path, so what is on screen is a command that
 * exists on this machine — for someone who installed from a release there is no checkout to
 * guess a path into.
 */
function commandRow(row, extensionPath) {
    const command = `${extensionPath}/${row.command}`;
    const widget = new Adw.ActionRow({
        title: row.title,
        subtitle: `${row.subtitle}\n\n${command}`,
    });
    widget.subtitle_lines = 6;

    const button = new Gtk.Button({
        icon_name: 'edit-copy-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Copy the command',
    });
    button.add_css_class('flat');
    button.connect('clicked', () => {
        Gdk.Display.get_default().get_clipboard().set(command);
        button.icon_name = 'object-select-symbolic';
        // Back to the copy icon shortly, so the button does not look stuck.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
            button.icon_name = 'edit-copy-symbolic';
            return GLib.SOURCE_REMOVE;
        });
    });

    widget.add_suffix(button);
    widget.activatable_widget = button;
    return widget;
}

/**
 * Whether the extension is listening at all, and when it last heard something.
 *
 * Read off the bus rather than out of a settings key: the question this answers is "is the
 * thing my hooks call actually there?", and the honest way to answer it is to ask the bus
 * the same question a hook would.
 */
function statusRow(row) {
    const widget = new Adw.ActionRow({ title: row.title, subtitle: row.subtitle });
    widget.subtitle_lines = 4;

    const label = new Gtk.Label({ valign: Gtk.Align.CENTER });
    label.add_css_class('dim-label');
    widget.add_suffix(label);

    const refresh = () => {
        try {
            const reply = Gio.DBus.session.call_sync(
                'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                'NameHasOwner', new GLib.Variant('(s)', [BUS_NAME]),
                null, Gio.DBusCallFlags.NONE, 1000, null);
            label.label = reply.deepUnpack()[0]
                ? 'the panel is listening'
                : 'the panel is not listening';
        } catch (e) {
            void e;
            label.label = 'could not ask the bus';
        }
    };
    refresh();

    const button = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Check again',
    });
    button.add_css_class('flat');
    button.connect('clicked', refresh);
    widget.add_suffix(button);

    return widget;
}
