// What the preferences window offers, as a description rather than as widgets.
//
// prefs.js builds Adwaita rows from this and binds each one to its GSettings key. Keeping
// the list here means a test can hold it against the schema: a key with no row is a setting
// nobody can change, and a row with no key is a control that does nothing — both are the
// sort of bug that survives a hundred manual checks of a preferences window.

const PANEL_AND_MENU_GROUPS = [
    {
        title: 'Panel',
        description: 'What the top bar shows.',
        rows: [
            {
                key: 'show-count',
                type: 'boolean',
                title: 'Show the count',
                subtitle: 'How many projects are in the state the icon is showing.',
            },
            {
                key: 'refresh-interval',
                type: 'int',
                title: 'Refresh every',
                subtitle: 'Seconds between runs of recap. The menu also refreshes when you ' +
                    'open it, and nothing runs while the screen is locked.',
                min: 5,
                max: 3600,
                step: 5,
                unit: 'seconds',
            },
        ],
    },
    {
        title: 'recap',
        description: 'The command this panel reads its report from.',
        rows: [
            {
                key: 'recap-path',
                type: 'string',
                title: 'Path to recap',
                subtitle: 'A bare name is looked up on PATH.',
                placeholder: 'recap',
            },
            {
                key: 'since',
                type: 'string',
                title: 'Only sessions newer than',
                subtitle: 'Passed to recap as --since: 24h, 90m, 2d. Empty uses recap\'s own default.',
                placeholder: '24h',
            },
            {
                key: 'agent',
                type: 'choice',
                title: 'Agent',
                subtitle: 'Which agent\'s sessions to report on.',
                choices: [
                    { value: 'all', label: 'All agents' },
                    { value: 'claude', label: 'Claude Code' },
                    { value: 'opencode', label: 'opencode' },
                ],
            },
            {
                key: 'project-roots',
                type: 'paths',
                title: 'Only projects under',
                subtitle: 'Directories separated by colons, the way PATH is written. Empty ' +
                    'uses recap\'s own default, which is your home directory.',
                placeholder: '/home/you/git:/srv/work',
            },
        ],
    },
    {
        title: 'Menu',
        description: 'Which sessions are listed, and what clicking one does.',
        rows: [
            {
                key: 'hide-finished',
                type: 'boolean',
                title: 'Hide finished sessions',
                subtitle: 'Sessions that ended after completing what they were asked.',
            },
            {
                key: 'hide-idle',
                type: 'boolean',
                title: 'Hide idle sessions',
                subtitle: 'Sessions that are not running and stopped at an ordinary point.',
            },
            {
                key: 'terminal',
                type: 'string',
                title: 'Terminal',
                subtitle: 'Opened in the session\'s own directory to resume it. Empty picks ' +
                    'the first terminal found.',
                placeholder: 'kgx',
            },
        ],
    },
];

/**
 * The Detection page: where events come from, and how to make your agents send them.
 *
 * It exists because the first question anyone asks about this feature is "why did nothing
 * light up?", and the answer is almost always one of three things — the extension is not
 * exporting its interface, the shim is not installed, or the agent was started before the
 * hooks were. This page shows all three without anyone having to read a log.
 */
const DETECTION_GROUPS = [
    {
        title: 'Where events come from',
        description: 'How the panel learns that a session asked you something, without ' +
            'waiting for the next refresh.',
        rows: [
            {
                key: 'source-dbus',
                type: 'boolean',
                title: 'Let your agents tell it directly',
                subtitle: 'The only source that can say which project an event came from. ' +
                    'Your agents call it through the recap-gs-notify shim.',
            },
            {
                key: 'source-notifications',
                type: 'boolean',
                title: 'Watch desktop notifications',
                subtitle: 'For agents that already notify-send. A notification cannot say ' +
                    'which project it is about, so this marks the panel, not a row.',
            },
            {
                key: 'notification-apps',
                type: 'apps',
                title: 'Applications to watch',
                subtitle: 'Comma separated, matched in whole and case-insensitively.',
                placeholder: 'Claude Code, opencode',
            },
            {
                key: 'source-terminal-bell',
                type: 'boolean',
                title: 'Watch for a terminal asking for attention',
                subtitle: 'Off by default: any bell from any terminal raises it — a build ' +
                    'finishing, a completion beep — and a signal that lies is worse than ' +
                    'one that is late.',
            },
        ],
    },
    {
        title: 'Wiring up your agents',
        description: 'Run this once. It shows you the change and asks before making it, ' +
            'backs up your settings first, and can be undone with --uninstall.',
        rows: [
            {
                type: 'command',
                title: 'Install the hooks',
                subtitle: 'Adds a Notification and a Stop hook to Claude Code, and a ' +
                    'session.idle plugin to opencode.',
                // Filled in by prefs.js with the extension's real installed path, so what is
                // on screen is a command that exists on this machine.
                command: 'hooks/install-hooks.sh',
            },
            {
                type: 'status',
                title: 'Last event received',
                subtitle: 'Nothing has arrived since the extension was enabled if this is ' +
                    'empty. Restart an agent after installing the hooks — a session that ' +
                    'was already running does not pick them up.',
            },
        ],
    },
];

/** The window, page by page. */
export const PREFERENCE_PAGES = [
    { title: 'General', iconName: 'preferences-system-symbolic', groups: PANEL_AND_MENU_GROUPS },
    { title: 'Detection', iconName: 'preferences-system-notifications-symbolic', groups: DETECTION_GROUPS },
];

/** Every group in the window, in order. Kept for the tests and for prefs.js. */
export const PREFERENCE_GROUPS = PREFERENCE_PAGES.flatMap(page => page.groups);

/**
 * Every settings key the window can change. Rows without a key — a command to copy, a
 * read-out of when the last event arrived — are not settings and are not listed.
 */
export function preferenceKeys() {
    return PREFERENCE_GROUPS
        .flatMap(group => group.rows)
        .filter(row => typeof row.key === 'string')
        .map(row => row.key);
}

/**
 * A list of directories written the way PATH is. A GSettings `as` has no natural single-line
 * spelling, and a colon-separated list is one every user of a terminal already knows.
 */
export function splitRoots(text) {
    if (typeof text !== 'string')
        return [];
    return text.split(':').map(part => part.trim()).filter(part => part !== '');
}

export function joinRoots(roots) {
    return (Array.isArray(roots) ? roots : []).join(':');
}
