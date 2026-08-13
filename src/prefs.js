// The preferences window.
//
// Like extension.js this is a thin shell around lib/: the list of settings, their titles and
// their ranges live in lib/preferences.js, where a test holds them against the GSettings
// schema. What is here is the Adwaita rendering of that list and the binding of each row to
// its key.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { PREFERENCE_GROUPS, splitRoots, joinRoots } from './lib/preferences.js';

export default class RecapPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Recap',
            icon_name: 'preferences-system-symbolic',
        });

        for (const group of PREFERENCE_GROUPS) {
            const adwGroup = new Adw.PreferencesGroup({
                title: group.title,
                description: group.description,
            });
            for (const row of group.rows)
                adwGroup.add(buildRow(row, settings));
            page.add(adwGroup);
        }

        window.add(page);
    }
}

function buildRow(row, settings) {
    switch (row.type) {
    case 'boolean':
        return switchRow(row, settings);
    case 'int':
        return spinRow(row, settings);
    case 'choice':
        return comboRow(row, settings);
    case 'paths':
        return pathsRow(row, settings);
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
