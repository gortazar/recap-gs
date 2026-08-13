// What the preferences window offers, as a description rather than as widgets.
//
// prefs.js builds Adwaita rows from this and binds each one to its GSettings key. Keeping
// the list here means a test can hold it against the schema: a key with no row is a setting
// nobody can change, and a row with no key is a control that does nothing — both are the
// sort of bug that survives a hundred manual checks of a preferences window.

export const PREFERENCE_GROUPS = [
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

/** Every settings key the window can change. */
export function preferenceKeys() {
    return PREFERENCE_GROUPS.flatMap(group => group.rows.map(row => row.key));
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
