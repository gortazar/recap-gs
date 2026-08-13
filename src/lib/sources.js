// Where an event can come from, and what counts as one.
//
// The D-Bus method is the source that matters: the agent tells us, with the directory
// attached, and the row lights up. The other two are for people whose setup already produces
// a signal, and they are weaker in the same way as each other — neither carries a working
// directory, so neither can name a project. They raise fleet-level attention or nothing.
//
// This module holds only the deciding: which window is a terminal, which notification is an
// agent's. The connecting lives in extension.js, because signals are the shell's, and it
// calls in here to decide.

/** The identifier for each source, used by the settings and the Detection page. */
export const SOURCE = Object.freeze({
    DBUS: 'dbus',
    NOTIFICATIONS: 'notifications',
    TERMINAL_BELL: 'terminal-bell',
});

/**
 * The terminals this extension already knows how to open, by the `wm_class` their windows
 * carry. Reused rather than a second list: a terminal worth resuming a session in is a
 * terminal whose bell is worth listening to.
 */
export const TERMINAL_WM_CLASSES = Object.freeze([
    'org.gnome.Console', 'kgx',
    'org.gnome.Ptyxis', 'ptyxis',
    'org.gnome.Terminal', 'gnome-terminal-server',
    'konsole', 'org.kde.konsole',
    'xfce4-terminal',
    'tilix',
    'Alacritty', 'alacritty',
    'kitty',
    'foot', 'footclient',
    'org.wezfurlong.wezterm',
    'XTerm', 'xterm',
]);

/**
 * Whether a window belongs to a terminal.
 *
 * Case-insensitive, because `wm_class` capitalisation varies between X11 and Wayland for the
 * same application, and comparing it exactly is how a filter silently matches nothing.
 */
export function isTerminalWindow(wmClass) {
    const name = typeof wmClass === 'string' ? wmClass.trim().toLowerCase() : '';
    if (name === '')
        return false;
    return TERMINAL_WM_CLASSES.some(known => known.toLowerCase() === name);
}

/** The applications whose notifications are treated as an agent talking, by default. */
export const DEFAULT_NOTIFICATION_APPS = Object.freeze(['Claude Code', 'claude', 'opencode']);

/**
 * Whether a notification from `appName` is one the user asked us to listen to.
 *
 * Matching is case-insensitive and on whole names, not substrings: "code" as a configured
 * name should not swallow every notification from Visual Studio Code.
 */
export function matchesNotificationApp(configured, appName) {
    const name = typeof appName === 'string' ? appName.trim().toLowerCase() : '';
    if (name === '')
        return false;
    const names = Array.isArray(configured) ? configured : [];
    return names.some(candidate =>
        typeof candidate === 'string' && candidate.trim().toLowerCase() === name);
}

/**
 * What a notification means. An agent that notifies you is asking for you — that is what a
 * notification is for — so these are `asking`, and they carry the notification's own text as
 * the message.
 */
export function notificationEvent(title, body) {
    const message = [title, body]
        .map(part => (typeof part === 'string' ? part.trim() : ''))
        .filter(part => part !== '')
        .join(' — ');
    return { kind: 'asking', cwd: '', message };
}
